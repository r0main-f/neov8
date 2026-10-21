// The Voyetra Eight program: 40 bytes in battery RAM, 45 bytes over SysEx (docs/rev4-ram-map.md).
import { PARAMS, ENUMS } from '../gen/params';
import type { ParamDef } from '../types';

/** Bytes stored per program in battery RAM ($4000 + 40*n). SysEx sends 45: the last 5 are constants. */
export const PROGRAM_SIZE = 40;
export const SYSEX_PROGRAM_SIZE = 45;
export const SYSEX_PROGRAM_TAIL = [0x80, 0x80, 0xff, 0xff, 0xff]; // what the stock ROM transmits for $28-$2C
export const NUM_PROGRAMS = 100;

export const PARAM: Record<string, ParamDef> = Object.fromEntries(PARAMS.map((p) => [p.id, p]));

export function maxOf(p: ParamDef): number {
  return (1 << p.width) - 1;
}

/** Raw field value (0..2^width-1), exactly the bits in the byte. */
export function getRaw(prog: Uint8Array, id: string): number {
  const p = PARAM[id];
  if (!p) throw new Error(`unknown param ${id}`);
  return (prog[p.byte] >> p.shift) & maxOf(p);
}

export function setRaw(prog: Uint8Array, id: string, v: number): void {
  const p = PARAM[id];
  if (!p) throw new Error(`unknown param ${id}`);
  const m = maxOf(p);
  const val = Math.max(0, Math.min(m, Math.round(v)));
  prog[p.byte] = (prog[p.byte] & ~(m << p.shift)) | (val << p.shift);
}

/** For 1-bit params: is the function switched on? Active-low flags are on when the bit is 0. */
export function isOn(prog: Uint8Array, id: string, onWhen?: number): boolean {
  const p = PARAM[id];
  const raw = getRaw(prog, id);
  const want = onWhen ?? (p.activeLow ? 0 : 1);
  return raw === want;
}

export function setOn(prog: Uint8Array, id: string, on: boolean, onWhen?: number): void {
  const p = PARAM[id];
  const want = onWhen ?? (p.activeLow ? 0 : 1);
  setRaw(prog, id, on ? want : 1 - want);
}

export function enumText(id: string, raw: number): string {
  const p = PARAM[id];
  const e = p.enum ? ENUMS[p.enum].find((x) => x.v === raw) : undefined;
  return e ? e.t : String(raw);
}

/** Human value for inspector/docs. */
export function describe(prog: Uint8Array, id: string): string {
  const p = PARAM[id];
  const raw = getRaw(prog, id);
  if (p.enum) return ENUMS[p.enum].find((x) => x.v === raw)?.name ?? String(raw);
  if (p.width === 1) return p.activeLow ? (raw === 0 ? 'on' : 'off') : String(raw);
  return String(raw);
}

/**
 * NULL / init program, byte-for-byte the 40-byte image the stock Rev4 ROM loads on A440+CALL
 * (ROM $F068, routine $F1F7 - docs/rev4-ram-map.md). "Sawtooths on both VCOs, Fc up, Q down,
 * A,D,R fast, S up full, no modulation" (Reference Guide).
 */
export const NULL_PROGRAM_IMAGE = [
  0xaf, 0xaf, 0xaf, 0xaf, 0xff, 0xff, 0x00, 0x00, 0x00, 0x00, 0x80, 0x90, 0x80, 0xc8, 0xc8, 0xc0,
  0xc0, 0xc0, 0x80, 0xff, 0x80, 0x80, 0x00, 0x80, 0xff, 0x80, 0x00, 0x80, 0xff, 0x80, 0xf0, 0xff,
  0x80, 0xff, 0xc0, 0x96, 0xff, 0x00, 0xc0, 0xf8,
];
export function nullProgram(): Uint8Array {
  return Uint8Array.from(NULL_PROGRAM_IMAGE);
}

/** A small synthetic demo bank so recall/compare show different values. NOT the factory sounds. */
export function demoBank(): Uint8Array[] {
  const bank: Uint8Array[] = [];
  const tweak = (o: Record<string, number | boolean>) => {
    const p = nullProgram();
    for (const [k, v] of Object.entries(o)) typeof v === 'boolean' ? setOn(p, k, v) : setRaw(p, k, v);
    return p;
  };
  bank[0] = nullProgram();
  bank[1] = tweak({ vcf_fc: 60, vcf_q: 30, adsr1_depth: 70, adsr1_attack: 20, adsr1_decay: 60, adsr1_sustain: 50, adsr2_attack: 25, adsr2_release: 40, vco1_detune: 70 }); // brass-ish
  bank[2] = tweak({ vco1_saw: false, vco1_pulse: true, vco2_saw: false, vco2_pulse: true, vco1_pwm_depth: 9, vco2_pwm_depth: 11, vcf_fc: 85, adsr2_attack: 70, adsr2_release: 80, adsr1_attack: 60, adsr1_release: 70 }); // strings-ish
  bank[3] = tweak({ vco2_sub: true, vco2_freq: 52, vcf_fc: 35, vcf_q: 70, adsr1_depth: 90, adsr1_decay: 35, adsr1_sustain: 0, adsr2_decay: 45, adsr2_sustain: 80, glide_time: 20 }); // bass-ish
  bank[4] = tweak({ vco_sync: true, vco1_freq: 90, modA_d_vco1: true, modA_src: 6, modA_depth: 120, vcf_fc: 100, adsr1_decay: 50, adsr1_sustain: 40 }); // sync lead
  for (let i = 5; i < NUM_PROGRAMS; i++) bank[i] = nullProgram();
  return bank;
}

// ---------------- legacy SysEx (Octave-Plateau ID 3) ----------------
export const OP_ID = 0x03;
export const EOX = 0xf7; // the scanned doc prints 11111110; real EOX is $F7 -> accept both on input

export function encodeProgramDump(num: number, prog: Uint8Array, fromController = false): number[] {
  const out = [0xf0, OP_ID, (fromController ? 0x40 : 0) | 1, 0x00, num & 0x7f];
  for (const b of [...prog.slice(0, PROGRAM_SIZE), ...SYSEX_PROGRAM_TAIL]) out.push(b & 0x0f, (b >> 4) & 0x0f);
  out.push(EOX);
  return out;
}

export interface SysexMsg { cmd: number; controller: boolean; body: number[] }

/** Splits a byte stream into complete Octave-Plateau SysEx messages. */
export function parseSysex(bytes: number[]): SysexMsg[] {
  const msgs: SysexMsg[] = [];
  let cur: number[] | null = null;
  for (const b of bytes) {
    if (b === 0xf0) { cur = []; continue; }
    if (cur === null) continue;
    if (b === 0xf7 || b === 0xfe) {
      if (cur[0] === OP_ID && cur.length >= 2) msgs.push({ cmd: cur[1] & 0x3f, controller: !!(cur[1] & 0x40), body: cur.slice(2) });
      cur = null;
      continue;
    }
    if (b & 0x80) { cur = null; continue; } // stray status aborts
    cur.push(b);
  }
  return msgs;
}

/** Program dump body = [machineId, progNum, 90 nibbles]; only the first 40 bytes are kept (like the stock ROM). */
export function decodeProgramBody(body: number[]): { num: number; prog: Uint8Array } | null {
  if (body.length < 2 + PROGRAM_SIZE * 2) return null;
  const prog = new Uint8Array(PROGRAM_SIZE);
  for (let i = 0; i < PROGRAM_SIZE; i++) prog[i] = (body[2 + 2 * i] & 0x0f) | ((body[3 + 2 * i] & 0x0f) << 4);
  return { num: body[1], prog };
}

export function equal(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export function noteName(n: number): { letter: string; sharp: boolean; octave: number } {
  const names = ['C', 'C', 'd', 'd', 'E', 'F', 'F', 'G', 'G', 'A', 'A', 'b'];
  const sharp = [1, 3, 6, 8, 10].includes(n % 12);
  return { letter: names[n % 12], sharp, octave: Math.floor(n / 12) - 1 };
}
