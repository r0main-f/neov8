// Parity harness: run the stock Rev4 ROM and NeoV8 on identical emulated hardware and compare everything
// the CPU sends to the analog side: 128 S&H slot voltages (DAC x mDAC) and the control latches.
import { Machine } from './machine';

/** S&H slot names (docs/hardware.md §3.1) — for readable diffs. */
export function slotName(s: number): string {
  if (s < 64) return `v${s >> 3}.${['VCO2 trim', 'VCO2 PWM', 'VCO2 PW', 'VCO2 pitch', 'VCO1 trim', 'VCO1 PWM', 'VCO1 PW', 'VCO1 pitch'][s & 7]}`;
  const named: Record<number, string> = {
    0x44: 'VCO1 vol L', 0x45: 'VCO2 vol L', 0x46: 'Q L', 0x47: 'VCF offs L', 0x4c: 'VCO1 vol R', 0x4d: 'VCO2 vol R', 0x4e: 'Q R', 0x4f: 'VCF offs R',
    0x50: 'kbd gate', 0x52: 'noise L', 0x53: 'prog vol L', 0x55: 'kbd CV', 0x56: 'noise R', 0x57: 'prog vol R',
    0x78: 'LFO1 offs L', 0x79: 'LFO1 L', 0x7a: 'LFO2 L', 0x7b: 'wave comp L', 0x7c: 'LFO1 offs R', 0x7d: 'LFO1 R', 0x7e: 'LFO2 R', 0x7f: 'wave comp R',
  };
  if (named[s]) return named[s];
  if (s >= 0x40 && s < 0x44) return `v${s - 0x40}.VCF Fc`;
  if (s >= 0x48 && s < 0x4c) return `v${s - 0x44}.VCF Fc`;
  if (s >= 0x58 && s < 0x60) return `v${s - 0x58}.velocity`;
  if (s >= 0x60 && s < 0x68) return `depth ${'ABCD'[s & 3]} ${s < 0x64 ? 'L' : 'R'}`;
  if (s >= 0x68 && s < 0x70) return `v${s - 0x68}.ADSR2->VCA`;
  if (s >= 0x70 && s < 0x78) return `v${s - 0x70}.ADSR1->VCF`;
  if (s >= 0x80) return `MIDI CV ${s - 0x80}`;
  return `slot $${s.toString(16)}`;
}

export interface Snapshot {
  /** effective S&H level per slot, 0..1 (14-bit DAC x 8-bit multiplier) */
  cv: number[];
  ic1: number; ic2: number; ic3: number; ic23: number;
  xpoint: number[];
  ls670: number[];
}

export function snapshot(m: Machine): Snapshot {
  const cv = Array.from({ length: 136 }, (_, i) => (m.cv[i] / 16383) * (m.cvMult[i] / 255));
  const c = m.ctl;
  return { cv, ic1: c.ic1, ic2: c.ic2, ic3: c.ic3, ic23: c.ic23, xpoint: [...c.xpoint], ls670: [...c.ls670] };
}

export interface DiffOptions {
  /** slots to compare (default: all 0..127) */
  slots?: number[];
  /** absolute tolerance on the 0..1 level (default 1/1000) */
  tol?: number;
  /** compare control latches too (default true) */
  ctl?: boolean;
  /** IC3 bits to ignore (e.g. autotune select bits) */
  ic3Mask?: number;
}

export function diff(a: Snapshot, b: Snapshot, o: DiffOptions = {}): string[] {
  const out: string[] = [];
  const tol = o.tol ?? 1e-3;
  for (const s of o.slots ?? Array.from({ length: 128 }, (_, i) => i)) {
    if (Math.abs(a.cv[s] - b.cv[s]) > tol) out.push(`${slotName(s)} ($${s.toString(16)}): ${a.cv[s].toFixed(4)} vs ${b.cv[s].toFixed(4)}`);
  }
  if (o.ctl ?? true) {
    const bits = (name: string, x: number, y: number, mask = 0xff) => {
      if ((x & mask) !== (y & mask)) out.push(`${name}: ${x.toString(2).padStart(8, '0')} vs ${y.toString(2).padStart(8, '0')}`);
    };
    bits('IC1 (VCO L latches $61xx)', a.ic1, b.ic1);
    bits('IC2 (VCO R latches $62xx)', a.ic2, b.ic2);
    bits('IC3 ($63xx)', a.ic3, b.ic3, ~(o.ic3Mask ?? 0) & 0xff);
    bits('IC23 ($64xx)', a.ic23, b.ic23);
    const xa = a.xpoint.flatMap((v, i) => (v ? [i] : []));
    const xb = b.xpoint.flatMap((v, i) => (v ? [i] : []));
    if (xa.join() !== xb.join()) out.push(`crosspoints closed: [${xa.map((x) => x.toString(16)).join(' ')}] vs [${xb.map((x) => x.toString(16)).join(' ')}]`);
    if (a.ls670.join() !== b.ls670.join()) out.push(`LS670 routing: [${a.ls670.join(' ')}] vs [${b.ls670.join(' ')}]`);
  }
  return out;
}

/** Deterministic pseudo-random 40-byte programs: every bit of the stored format is meaningful or unused. */
export function randomProgram(seed: number): Uint8Array {
  let x = (seed * 2654435761) >>> 0 || 1;
  const p = new Uint8Array(40);
  for (let i = 0; i < 40; i++) {
    x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0;
    p[i] = x & 0xff;
  }
  return p;
}

/** A battery-RAM image with `programs` at $4000 + 40n (the format both OSes share). */
export function bramWith(programs: Uint8Array[]): Uint8Array {
  const b = new Uint8Array(0x2000);
  programs.forEach((p, n) => b.set(p.slice(0, 40), n * 40));
  b[0x0fff] = 0xaa;
  return b;
}
