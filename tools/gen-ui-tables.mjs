#!/usr/bin/env node
// Generates firmware/src/ui/gen_tables.inc (parameter descriptors, edit-page bindings, enum texts, null program)
// for the NeoV8 UI firmware. Source of truth: spec/params.yaml + spec/pages.yaml, read through the expansion
// the prototype uses (sim/src/gen/params.ts, written by tools/gen-params.mjs) so the ROM and the prototype
// work on exactly the same tables. The null program comes from sim/src/proto/patch.ts (NULL_PROGRAM_IMAGE).
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const genTs = readFileSync(join(root, 'sim/src/gen/params.ts'), 'utf8');
const grab = (re, what) => {
  const m = re.exec(genTs);
  if (!m) throw new Error(`gen-ui-tables: cannot find ${what} in sim/src/gen/params.ts (run npm run gen)`);
  return JSON.parse(m[1]);
};
const ENUMS = grab(/export const ENUMS: Record<string, EnumDef\[\]> = (\{[\s\S]*?\});\nexport const PARAMS/, 'ENUMS');
const PARAMS = grab(/export const PARAMS: ParamDef\[\] = (\[[\s\S]*?\]);\nexport const PAGES/, 'PARAMS');
const PAGES = grab(/export const PAGES: PageDef\[\] = (\[[\s\S]*?\]);\n/, 'PAGES');
const patchTs = readFileSync(join(root, 'sim/src/proto/patch.ts'), 'utf8');
const nullImg = /NULL_PROGRAM_IMAGE = \[([\s\S]*?)\]/.exec(patchTs)[1].split(',').map((s) => s.trim()).filter(Boolean).map(Number);
if (nullImg.length !== 40) throw new Error('NULL_PROGRAM_IMAGE must have 40 bytes');

// Hardware facts (duplicated from sim/src/machine/backend.ts: BUTTON_CODE, POT_INDEX).
const BUTTON_CODE = {
  uni_l: 0x00, uni_r: 0x01, kb_split: 0x02, kb_layer: 0x03, hold_l: 0x04, hold_r: 0x05, kb_whole: 0x06,
  k0: 0x08, k1: 0x09, k2: 0x0a, k3: 0x0b, k4: 0x0c, k5: 0x0d, k6: 0x0e, k7: 0x0f, k8: 0x10, k9: 0x11, rev: 0x12, fwd: 0x13,
  oct_r: 0x18, oct_l: 0x19, tape_load: 0x1a, tape_dump: 0x1b, store: 0x1c, edit: 0x1d, autotune: 0x1e,
  call_r: 0x20, call_l: 0x21, step_enable: 0x22, step_load: 0x23,
  pbdef_r: 0x28, pbdef_l: 0x29, mute: 0x2b,
  reldef_r: 0x30, reldef_l: 0x31, arp_right: 0x32, arp_left: 0x33, arp_pause: 0x34,
  arp_down: 0x38, arp_random: 0x39, arp_up: 0x3a,
};
const POT_INDEX = {
  r_fc: 0, l_fc: 1, r_glide: 2, l_glide: 3, r_lfo: 4, l_lfo: 5, r_a: 6, l_a: 7, r_r: 8, l_r: 9,
  r_detune: 10, l_detune: 11, r_vol: 12, l_vol: 13, arp_speed: 14,
};
const PAGE_CHAR = { P1: '1', P2: '2', A: 'A', B: 'b', C: 'c', D: 'd' }; // as the prototype displays them
const PAGE_ORDER = ['P1', 'P2', 'A', 'B', 'C', 'D'];
const VARS = ['pwm', 'lfo']; // keypad selector variables -> ui_sel index
const POT_MODE = { undefined: 0, coarse12: 1, fine12: 2, fine: 3 };

const errors = [];
const enumIds = Object.keys(ENUMS);
const pIndex = new Map(PARAMS.map((p, i) => [p.id, i]));
if (PARAMS.length > 254) errors.push('too many params for a byte index');
const pidx = (id, where) => {
  const i = pIndex.get(id);
  if (i === undefined) errors.push(`${where}: unknown param ${id}`);
  return i ?? 0xff;
};
const hex = (n) => '$' + (n & 0xff).toString(16).toUpperCase().padStart(2, '0');
const rows = (arr, per = 16) => {
  const out = [];
  for (let i = 0; i < arr.length; i += per) out.push('        .byte ' + arr.slice(i, i + per).map(hex).join(','));
  return out.join('\n');
};
const ch = (c) => {
  const k = c.charCodeAt(0);
  if (k < 0x20 || k > 0x7e) errors.push(`non-ASCII mnemonic char '${c}'`);
  return k;
};

// ---------------------------------------------------------------- parameters
const pByte = [], pShift = [], pMask = [], pSMask = [], pFlags = [], pMn0 = [], pMn1 = [];
for (const p of PARAMS) {
  const mask = (1 << p.width) - 1;
  pByte.push(p.byte);
  pShift.push(p.shift);
  pMask.push(mask);
  pSMask.push((mask << p.shift) & 0xff);
  const en = p.enum ? enumIds.indexOf(p.enum) + 1 : 0;
  if (en > 7) errors.push('too many enums');
  pFlags.push((p.activeLow ? 0x80 : 0) | en);
  const mn = p.mn.padEnd(2).slice(0, 2);
  pMn0.push(ch(mn[0]));
  pMn1.push(ch(mn[1]));
}

// enum texts: 2 chars per value, values 0..n-1
const enumOfs = [], enumTxt = [];
for (const id of enumIds) {
  enumOfs.push(enumTxt.length / 2);
  const vals = ENUMS[id].slice().sort((a, b) => a.v - b.v);
  vals.forEach((e, i) => { if (e.v !== i) errors.push(`enum ${id}: values must be 0..n-1`); });
  for (const e of vals) { const t = e.t.padEnd(2).slice(0, 2); enumTxt.push(ch(t[0]), ch(t[1])); }
}

// ---------------------------------------------------------------- pages
const pages = PAGE_ORDER.map((id) => {
  const pg = PAGES.find((p) => p.id === id);
  if (!pg) errors.push(`page ${id} missing`);
  return pg;
});
const pgChar = [], pgPot = [], pgPMode = [], pgKpVar = [], pgKpT = [], pgKeys = [], pgWin = [], pgWinP = [], pgInv = [];
const btnLists = [];
pages.forEach((pg, n) => {
  pgChar.push(ch(PAGE_CHAR[pg.id]));
  // buttons: triples (code, kind, param)
  const list = [];
  for (const [bid, b] of Object.entries(pg.buttons ?? {})) {
    const code = BUTTON_CODE[bid];
    if (code === undefined) { errors.push(`${pg.id}: unknown button ${bid}`); continue; }
    if (b.select) {
      const v = VARS.indexOf(b.select.var);
      if (v < 0) errors.push(`${pg.id}.${bid}: unknown select var ${b.select.var}`);
      list.push(code, 0x80 | (v << 3) | (b.select.value & 7), 0);
    } else if (b.field) {
      const i = pidx(b.field.param, `${pg.id}.${bid}`);
      list.push(code, 0x40 | ((b.field.onWhen & 1) << 5) | (b.field.bit & 7), i);
    } else if (b.param) {
      const i = pidx(b.param, `${pg.id}.${bid}`);
      const p = PARAMS[i];
      if (p && p.width !== 1) errors.push(`${pg.id}.${bid}: button param ${b.param} is not 1 bit`);
      const onWhen = b.onWhen ?? (p?.activeLow ? 0 : 1);
      list.push(code, ((onWhen & 1) << 5), i);
    }
  }
  list.push(0xff);
  btnLists.push(list);
  // pots
  for (let k = 0; k < 15; k++) {
    const id = Object.keys(POT_INDEX).find((x) => POT_INDEX[x] === k);
    const b = pg.pots?.[id];
    if (!b) { pgPot.push(0xff); pgPMode.push(0); continue; }
    pgPot.push(pidx(b.param, `${pg.id}.${id}`));
    const m = POT_MODE[b.mode];
    if (m === undefined) errors.push(`${pg.id}.${id}: unknown pot mode ${b.mode}`);
    pgPMode.push(m ?? 0);
  }
  // keypad
  const kp = pg.keypad;
  if (kp) {
    const v = kp.var ? VARS.indexOf(kp.var) : 0xff;
    if (kp.var && v < 0) errors.push(`${pg.id}: unknown keypad var ${kp.var}`);
    pgKpVar.push(v);
    for (const t of ['0', '1', '2']) pgKpT.push(kp.targets[t] ? pidx(kp.targets[t], `${pg.id}.keypad`) : 0xff);
    for (let d = 0; d < 10; d++) pgKeys.push(kp.keys[String(d)] ?? 0xff);
  } else {
    pgKpVar.push(0xfe); // no keypad at all
    pgKpT.push(0xff, 0xff, 0xff);
    for (let d = 0; d < 10; d++) pgKeys.push(0xff);
  }
  // window: 1 = one digit per keypad target (var), 2 = param in hex
  const w = pg.window;
  if (w?.param) { pgWin.push(2); pgWinP.push(pidx(w.param, `${pg.id}.window`)); }
  else if (w?.var) { pgWin.push(1); pgWinP.push(0xff); }
  else { pgWin.push(0); pgWinP.push(0xff); }
  // mod pages (window = param + keypad): RIGHT window shows the source, DP = source inverted (as the prototype)
  if (w?.param && kp) pgInv.push(pidx(`mod${kp.targets['0'].slice(3, 4)}_inv`, `${pg.id}.inv`));
  else pgInv.push(0xff);
});

if (errors.length) {
  console.error('gen-ui-tables errors:\n  ' + errors.join('\n  '));
  process.exit(1);
}

const equ = PARAMS.map((p, i) => `UIP_${p.id} = ${i}`);
const out = `; GENERATED by tools/gen-ui-tables.mjs from spec/params.yaml + spec/pages.yaml (via sim/src/gen/params.ts)
; and sim/src/proto/patch.ts (null program). Do not edit.
UI_NPARAMS = ${PARAMS.length}
UI_NPAGES = ${pages.length}
${equ.join('\n')}

; ---- parameter descriptors (index = UIP_*)
ui_p_byte:
${rows(pByte)}
ui_p_shift:
${rows(pShift)}
ui_p_mask:                      ; field mask (unshifted): 1, 3, 7, $0F, $7F, $FF
${rows(pMask)}
ui_p_smask:                     ; field mask in place
${rows(pSMask)}
ui_p_flags:                     ; bit7 active low, bits 2-0 enum id + 1 (0 = not an enum)
${rows(pFlags)}
ui_p_mn0:
${rows(pMn0)}
ui_p_mn1:
${rows(pMn1)}

; ---- enum texts (2 chars per value); ui_enum_ofs[enum id] = first value index
ui_enum_ofs:
${rows(enumOfs)}
ui_enum_txt:
${rows(enumTxt)}

; ---- edit pages (order: ${PAGE_ORDER.join(' ')})
ui_pg_char:                     ; page glyph shown after the side letter
${rows(pgChar)}
ui_pg_btn_lo:
        .byte ${pages.map((_, n) => `<ui_pg_btn${n}`).join(', ')}
ui_pg_btn_hi:
        .byte ${pages.map((_, n) => `>ui_pg_btn${n}`).join(', ')}
; button bindings: code, kind, param ... $FF
;   kind %00o00000 param toggle (o = raw value meaning ON)
;   kind %01obbbbb field: toggle bit b of the param (o = raw bit meaning ON)
;   kind %1000vxxx select: ui_sel[v] = xxx
${btnLists.map((l, n) => `ui_pg_btn${n}:\n${rows(l, 15)}`).join('\n')}
ui_pg_pot:                      ; 15 per page, by pot index: param ($FF = none)
${rows(pgPot, 15)}
ui_pg_pmode:                    ; 0 absolute (global pot mode), 1 coarse12, 2 fine12, 3 fine
${rows(pgPMode, 15)}
ui_pg_kpvar:                    ; keypad selector var (0 pwm, 1 lfo), $FF = target 0, $FE = no keypad
${rows(pgKpVar)}
ui_pg_kpt:                      ; 3 per page: keypad target for selector value 0, 1, 2
${rows(pgKpT, 18)}
ui_pg_keys:                     ; 10 per page: raw value for digit 0-9 ($FF = none)
${rows(pgKeys, 10)}
ui_pg_win:                      ; STEP window: 0 none, 1 one digit per keypad target, 2 param in hex
${rows(pgWin)}
ui_pg_winp:
${rows(pgWinP)}
ui_pg_inv:                      ; mod pages: source-invert param (DP of the RIGHT window), $FF = program number shown
${rows(pgInv)}

; ---- null / init program (stock ROM image $F068)
ui_null_prog:
${rows(nullImg)}
`;
writeFileSync(join(root, 'firmware/src/ui/gen_tables.inc'), out);
console.log(`gen-ui-tables: ${PARAMS.length} params, ${pages.length} pages -> firmware/src/ui/gen_tables.inc`);
