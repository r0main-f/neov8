// Runs spec/scenarios/*.yaml against the NeoV8 ROM (real core + UI, logging stubs for eng/midi/tune) in the
// machine model, through the UIDBG adapter (sim/src/machine/neov8-inspect.ts). Scenarios tagged
// `requires: engine` (voices, autotune progress, held keys) only run on the prototype; `requires: full-rom`
// (polysequencer page) run on the full ROM with the real engine.
import { describe, it, expect, beforeAll } from 'vitest';
import { readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import YAML from 'yaml';
import { MachineBackend } from '../src/machine/backend';
import { neoInspect, neoEditBuffer, neoPanelCheck } from '../src/machine/neov8-inspect';
import { demoBank, getRaw, nullProgram } from '../src/proto/patch';
import { renderText, segToChar } from '../src/font7';
import type { ButtonId, PotId } from '../src/types';
import { ROOT, buildFirmware, loadNeoRomFrom, readCallLog, neoSymbols, protoBattery } from './helpers';

// NEOV8_UI_FULL=1: run against the full ROM (real engine / MIDI / tune) instead of the logging stubs
const FULL = !!process.env.NEOV8_UI_FULL;
const BUILD = FULL ? 'build-uifull' : 'build-ui';
const GAP = 30; // ms between button events (as the prototype runner)
const POT_GAP = 100; // the core scans one pot per 2 ms tick: 15 pots = 31 ms; with the arpeggiator running a move
// can take ~80-90 ms to land (seed 7 at 80 ms passed or failed with a few cycles of code elsewhere)
const ID_MIDI_DUMP = 0x2d; // ui weak stub of midi_dump_all (STUB_MIDI build)

type Step = Record<string, any>;
interface Scenario { name: string; requires?: string | string[]; steps: Step[] }
const dir = join(ROOT, 'spec/scenarios');
const files = readdirSync(dir).filter((f) => f.endsWith('.yaml')).sort();

/** Same glyph = same text: the 7-segment display cannot tell O from 0, etc. */
const canon = (t: string) => renderText(t).map((s) => segToChar(s)).join('');

let rom: Uint8Array;
/** full ROM (real engine): scenarios tagged `requires: full-rom` (the polysequencer page needs eng/seq.asm) */
let fullRom: Uint8Array;
const boot = (r: Uint8Array = rom) => {
  const b = new MachineBackend('neov8-ui', r, protoBattery());
  b.run(300);
  return b;
};

function press(b: MachineBackend, ids: ButtonId | ButtonId[]) {
  const list = Array.isArray(ids) ? ids : [ids];
  const holds = list.slice(0, -1);
  const last = list[list.length - 1];
  for (const h of holds) { b.button(h, true); b.run(GAP); }
  b.button(last, true); b.run(GAP);
  b.button(last, false); b.run(GAP);
  for (const h of [...holds].reverse()) { b.button(h, false); b.run(GAP); }
}

function subsetMatch(actual: any, expected: any, path: string) {
  if (expected !== null && typeof expected === 'object' && !Array.isArray(expected)) {
    for (const [k, v] of Object.entries(expected)) subsetMatch(actual?.[k], v, `${path}.${k}`);
  } else expect(actual, path).toEqual(expected);
}

function runOnRom(sc: Scenario, r: Uint8Array = rom) {
  const b = boot(r);
  const m = b.machine;
  for (const [i, st] of sc.steps.entries()) {
    const where = `step ${i + 1} ${JSON.stringify(st)}`;
    if (st.press) press(b, st.press);
    if (st.down) { b.button(st.down, true); b.run(GAP); }
    if (st.up) { b.button(st.up, false); b.run(GAP); }
    if (st.pot) for (const [id, v] of Object.entries(st.pot)) { b.pot(id as PotId, v as number); b.run(POT_GAP); }
    if (st.key) { b.key(st.key.note, true, st.key.vel ?? 100); b.run(GAP); if (!st.key.hold) { b.key(st.key.note, false, 64); b.run(GAP); } }
    if (st.wait) b.run(st.wait);
    if (st.protect !== undefined) b.setProtect(st.protect);
    const e = st.expect;
    if (!e) continue;
    expect(m.cpu.illegal, `${where}: illegal opcodes`).toBe(0);
    let bad = neoPanelCheck(m);
    if (bad) { b.run(3); bad = neoPanelCheck(m); } // may have stopped between render and flush
    expect(bad, `${where}: 8279 display RAM = UI image`).toBeNull();
    const s = neoInspect(m) as any;
    if (e.display !== undefined) expect(canon(s.display), `${where}: display`).toBe(canon(e.display));
    if (e.dp !== undefined) expect(s.dp, `${where}: dp`).toBe(e.dp);
    if (e.displayBlink !== undefined) expect(s.displayBlink, `${where}: blink`).toBe(e.displayBlink);
    if (e.mode !== undefined) expect(s.mode, `${where}: mode`).toBe(e.mode);
    if (e.page !== undefined) expect(s.page, `${where}: page`).toBe(e.page);
    if (e.leds) for (const [id, v] of Object.entries(e.leds)) expect(s.leds[id] ?? 'off', `${where}: led ${id}`).toBe(v);
    if (e.state) subsetMatch(s, e.state, `${where}: state`);
    if (e.param) expect(getRaw(neoEditBuffer(m, e.param.side), e.param.id), `${where}: param ${e.param.id}`).toBe(e.param.raw);
    // MIDI bytes are produced by the MIDI module (tested in fw-midi); here: the UI asked for the program dump
    if (e.midiOut !== undefined && !FULL) expect(readCallLog(m.ram).some((c) => c.id === ID_MIDI_DUMP && (c.a & 1)), `${where}: midi_dump_all(programs)`).toBe(e.midiOut > 0);
  }
}

beforeAll(() => {
  execFileSync('node', [join(ROOT, 'tools/gen-ui-tables.mjs')], { stdio: 'pipe' });
  rmSync(join(ROOT, `firmware/${BUILD}/main.o`), { force: true }); // gen_tables.inc is not a make dependency
  buildFirmware(BUILD, FULL ? [] : ['STUB_ENG', 'STUB_MIDI', 'STUB_TUNE']);
  rom = loadNeoRomFrom(BUILD);
  if (FULL) fullRom = rom;
  else {
    rmSync(join(ROOT, 'firmware/build-uifull/main.o'), { force: true });
    buildFirmware('build-uifull', []);
    fullRom = loadNeoRomFrom('build-uifull');
  }
}, 120_000);

for (const f of files) {
  const scenarios: Scenario[] = YAML.parse(readFileSync(join(dir, f), 'utf8'));
  describe(`NeoV8 ROM: ${f}`, () => {
    for (const sc of scenarios) {
      const req = ([] as string[]).concat(sc.requires ?? []);
      const full = req.includes('full-rom');
      it.skipIf(req.includes('engine'))(sc.name, () => runOnRom(sc, full ? fullRom : rom));
    }
  });
}

describe('NeoV8 ROM: UI internals', () => {
  it('first boot initialises the NeoV8 globals and the empty undo slot, leaves programs alone', () => {
    const b = boot();
    const m = b.machine;
    expect([m.bram[0x1a7a], m.bram[0x1a7b]]).toEqual([0x4e, 0x38]); // "N8"
    expect(m.bram[0x1ac0]).toBe(0xff);
    expect(m.bram.slice(40, 80)).toEqual(demoBank()[1]);
    expect(m.cpu.illegal).toBe(0);
  });

  it('boot gives an unset MIDI pitch-bend sensitivity ($5A79 = 0, MIDI bend silent) the stock $7F, keeps others', () => {
    for (const [v, want] of [[0, 0x7f], [0x40, 0x40]]) {
      const bat = protoBattery();
      bat[0x1a79] = v;
      const b = new MachineBackend('neov8-ui', rom, bat);
      b.run(300);
      expect(b.machine.bram[0x1a79]).toBe(want);
    }
  });

  it.skipIf(FULL)('power-on recalls the step and applies the performance (programs included) once', () => {
    const b = boot();
    const log = readCallLog(b.machine.ram);
    expect(log.filter((c) => c.id === 0x11 || c.id === 0x12).map((c) => c.id)).toEqual([0x12]); // eng_apply_perf only
  });

  it.skipIf(FULL)('engine updates are coalesced: one call per main-loop pass', () => {
    const b = boot();
    const n0 = b.machine.ram[0x0fe8];
    press(b, 'step_enable'); press(b, 'k0'); press(b, 'k3'); // step recall: 2 programs + perf
    const log = readCallLog(b.machine.ram).slice(-(b.machine.ram[0x0fe8] - n0));
    // engine calls only: a panel step recall also sends MIDI (stub ids $30-$3F: SysEx "new step")
    expect(log.filter((c) => c.id < 0x30 || c.id > 0x3f).map((c) => c.id)).toEqual([0x12, 0x1b]); // eng_apply_perf, then eng_recalled
    expect(log.some((c) => c.id === 0x35)).toBe(true); // midi_sx_event
  });

  it('a stored step reads back with the stock 24-byte layout', () => {
    const b = boot();
    press(b, 'kb_split');
    press(b, ['a440', 'oct_r']); // arp octaves R 2
    press(b, 'step_load');
    press(b, 'k4');
    press(b, 'k2');
    press(b, 'store');
    const st = [...b.machine.bram.slice(0x1000 + 24 * 42, 0x1000 + 24 * 43)];
    expect(st[0] & 0xc0).toBe(0x40); // SPLIT
    expect(st[1]).toBe(1);
    expect(st[2]).toBe(0);
    expect(st[4] & 0x3f).toBe(48);
    expect(b.machine.bram[0x1c90 + 42] & 3).toBe(1); // NeoV8 step extension: arp octaves R - 1
    expect(neoInspect(b.machine).step).toBe(42);
  });

  it.skipIf(FULL)('A440+CALL R loads the null program and tells the engine', () => {
    const b = boot();
    press(b, ['a440', 'call_r']);
    expect([...neoEditBuffer(b.machine, 'R')]).toEqual([...nullProgram()]);
    expect(readCallLog(b.machine.ram).slice(-1)[0]).toMatchObject({ id: 0x11, x: 0 });
  });

  it('A440+digit in EDIT jumps to a page (no EDIT+digit chord on the 8279)', () => {
    const b = boot();
    press(b, 'edit');
    b.run(700); // past the EDIT->digit window
    press(b, ['a440', 'k4']);
    expect((neoInspect(b.machine) as any).page).toBe('B');
    press(b, 'k4'); // plain digit = keypad (mod source)
    expect((neoInspect(b.machine) as any).page).toBe('B');
    expect(getRaw(neoEditBuffer(b.machine, 'R'), 'modB_src')).toBe(4);
  });

  it('footswitch function 99 = none ($FF) in the stock record', () => {
    const b = boot();
    press(b, ['a440', 'edit']);
    press(b, 'k4'); press(b, 'k3');
    expect(canon((neoInspect(b.machine) as any).display)).toBe(canon('43F399'));
    press(b, ['a440', 'rev']);
    expect(b.machine.bram[0x1a46 + 10]).toBe(98);
    press(b, ['a440', 'fwd']);
    expect(b.machine.bram[0x1a46 + 10]).toBe(0xff);
  });

  it('undo is refused under memory protect and the slot is kept', () => {
    const b = boot();
    press(b, 'edit'); b.run(700);
    press(b, 'kb_split'); press(b, 'store'); press(b, 'k0'); press(b, 'k9'); press(b, 'store');
    b.run(1500);
    press(b, 'edit'); b.run(700);
    b.setProtect(true);
    press(b, ['a440', 'store']);
    expect(canon((neoInspect(b.machine) as any).display)).toBe(canon('UndO09'));
    press(b, 'store');
    const s = neoInspect(b.machine) as any;
    expect(canon(s.display)).toBe(canon('PrOtEC'));
    expect(s.undo).toBe(9);
  });

  it('SysEx receive page sets midi_rxall and EDIT clears it', () => {
    const b = boot();
    const rxall = neoSymbols(BUILD).midi_rxall;
    press(b, 'tape_load');
    expect(neoInspect(b.machine).mode).toBe('receive');
    expect(neoInspect(b.machine).display).toBe(canon('Ld  00'));
    expect(b.machine.ram[rxall]).toBe(1);
    press(b, 'edit');
    expect(neoInspect(b.machine).mode).toBe('play');
    expect(b.machine.ram[rxall]).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------------------
// Differential test: random panel sequences on the prototype (the reference) and on the ROM, compared after
// every step. Excluded: what the hardware cannot do the same way (EDIT+digit chord timing, A440+digit in EDIT),
// what needs the engine/tune modules (AUTO TUNE), and service items whose value is hardware specific (91 92 94).
const FUZZ_BUTTONS: ButtonId[] = [
  'call_l', 'call_r', 'step_enable', 'step_load', 'fwd', 'rev', 'store', 'edit', 'kb_whole', 'kb_split', 'kb_layer',
  'uni_l', 'uni_r', 'oct_l', 'oct_r', 'hold_l', 'hold_r', 'reldef_l', 'reldef_r', 'pbdef_l', 'pbdef_r',
  'arp_up', 'arp_down', 'arp_random', 'arp_left', 'arp_right', 'arp_pause', 'mute', 'tape_dump', 'tape_load',
  'k0', 'k1', 'k2', 'k3', 'k4', 'k5', 'k6', 'k7', 'k8', 'k9', 'k0', 'k1', 'k2', 'k3', 'fwd', 'rev', 'store', 'edit',
];
const FUZZ_SHIFT: ButtonId[] = ['call_l', 'call_r', 'store', 'edit', 'fwd', 'rev', 'oct_l', 'oct_r', 'arp_down', 'arp_random', 'step_enable', 'autotune', 'mute'];
const FUZZ_POTS: PotId[] = ['l_a', 'l_r', 'l_lfo', 'l_glide', 'l_fc', 'l_detune', 'l_vol', 'r_a', 'r_r', 'r_lfo', 'r_glide', 'r_fc', 'r_detune', 'r_vol', 'arp_speed'];
const FUZZ_WAITS = [0, 0, 0, 300, 900, 1700, 4500];
const PROTO_LEDS: ButtonId[] = [
  'mute', 'kb_split', 'kb_layer', 'uni_l', 'uni_r', 'kb_whole', 'arp_left', 'pbdef_r', 'hold_l', 'reldef_l', 'reldef_r',
  'hold_r', 'pbdef_l', 'arp_up', 'arp_pause', 'arp_random', 'arp_down', 'autotune', 'a440', 'arp_right', 'edit', 'store', 'tape_load', 'tape_dump',
];

function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}

async function fuzz(seed: number, steps: number) {
  const { NeoV8Proto } = await import('../src/proto/proto');
  const r = rng(seed);
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
  const p = new NeoV8Proto();
  p.steps[0].progR = 1; // same battery as protoBattery(): step 00 = the power-on programs
  const b = boot();
  p.run(300);
  const pot7: Record<string, number> = {};
  const trace: string[] = [];
  for (let i = 0; i < steps; i++) {
    if (i % 50 === 49) await new Promise((r) => setImmediate(r)); // let vitest's worker RPC breathe
    const pi = p.inspect() as any;
    const x = r();
    let op: string;
    if (x < 0.12) {
      const id = pick(FUZZ_POTS);
      let k = Math.floor(r() * 128);
      if (Math.abs(k - (pot7[id] ?? 64)) < 3) k = (k + 40) % 128;
      pot7[id] = k;
      const v = Math.round((k * 1023) / 127);
      op = `pot ${id} ${k}`;
      p.pot(id, v); p.run(POT_GAP);
      b.pot(id, v); b.run(POT_GAP);
    } else {
      const shifted = x > 0.85;
      const id = shifted ? pick(FUZZ_SHIFT) : pick(FUZZ_BUTTONS);
      if (id === 'autotune' && !shifted) continue;
      if (shifted && pi.mode === 'edit' && /^k\d$/.test(id)) continue;
      const ids: ButtonId[] = shifted ? ['a440', id] : [id];
      op = ids.join('+');
      press(p as any, ids);
      press(b, ids);
      if (id === 'edit') { p.run(650); b.run(650); } // no digit inside the EDIT+digit window (hardware chord)
    }
    const w = pick(FUZZ_WAITS);
    if (w) { p.run(w); b.run(w); op += ` wait ${w}`; }
    let ps = p.inspect() as any;
    let bs = neoInspect(b.machine) as any;
    trace.push(`${op} [${ps.mode} ${ps.display}/${bs.mode} ${bs.display}]`);
    const where = `seed ${seed} step ${i}: ${trace.slice(-8).join(' | ')}`;
    // Timers start up to ~30 ms apart (prototype: EDIT acts on release; ROM: pots are scanned every 31 ms),
    // so a check that lands on a timeout boundary is retried 40 ms later before it counts as a difference.
    if (!sameUi(p, b, ps, bs)) { p.run(40); b.run(40); ps = p.inspect(); bs = neoInspect(b.machine); }
    checkUi(p, b, ps, bs, where);
  }
}

function uiDiffs(p: any, b: MachineBackend, ps: any, bs: any): [string, unknown, unknown][] {
  const out: [string, unknown, unknown][] = [];
  const norm = (v: unknown) => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort()) : x));
  const eq = (k: string, x: unknown, y: unknown) => { if (norm(x) !== norm(y)) out.push([k, x, y]); };
  eq('mode', bs.mode, ps.mode);
  if (out.length) return out;
  if (!(ps.mode === 'menu' && [91, 92, 94].includes(ps.menuItem))) {
    eq('display', canon(bs.display), canon(ps.display));
    eq('dp', bs.dp, ps.dp);
    eq('blink', bs.displayBlink, ps.displayBlink);
  }
  for (const id of PROTO_LEDS) eq(`led ${id}`, bs.leds[id] ?? 'off', ps.leds[id] ?? 'off');
  eq('page/side/focus', [bs.page, bs.editSide, bs.focus], [ps.page, ps.editSide, ps.focus]);
  eq('progs', [bs.progL, bs.progR, bs.step, bs.editedL, bs.editedR, bs.compare], [ps.progL, ps.progR, ps.step, ps.editedL, ps.editedR, ps.compare]);
  eq('edit L', [...neoEditBuffer(b.machine, 'L')], [...p.edit.L]);
  eq('edit R', [...neoEditBuffer(b.machine, 'R')], [...p.edit.R]);
  const pf = ps.perf, bf = bs.perf;
  for (const k of ['kbMode', 'uniL', 'uniR', 'octL', 'octR', 'holdL', 'holdR', 'relDefL', 'relDefR', 'pbDefL', 'pbDefR',
    'arpL', 'arpR', 'arpPause', 'arpMode', 'arpOctL', 'arpOctR', 'arpSpeed', 'trimL', 'trimR']) eq(`perf.${k}`, bf[k], pf[k]);
  eq('undo', bs.undo, ps.undo);
  return out;
}
const sameUi = (p: any, b: MachineBackend, ps: any, bs: any) => uiDiffs(p, b, ps, bs).length === 0;
function checkUi(p: any, b: MachineBackend, ps: any, bs: any, where: string) {
  const d = uiDiffs(p, b, ps, bs);
  expect(d.map(([k, rom, proto]) => `${k}: ROM ${JSON.stringify(rom)} / proto ${JSON.stringify(proto)}`), where).toEqual([]);
}

describe.skipIf(!Number(process.env.NEOV8_FUZZ_SEEDS ?? 4))('NeoV8 ROM vs prototype: random panel sequences', () => {
  const SEEDS = Number(process.env.NEOV8_FUZZ_SEEDS ?? 4); // more: NEOV8_FUZZ_SEEDS=40 npx vitest run sim/test/fw-ui.test.ts
  for (let seed = 1; seed <= SEEDS; seed++) it(`seed ${seed}`, () => fuzz(seed, 500), 120_000);
});
