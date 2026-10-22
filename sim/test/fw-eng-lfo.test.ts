// Engine parity, LFOs: LFO1 ($79/$7D + offset slots $78/$7C, x delay fade-in) and LFO2 ($7A/$7E) of both sides,
// the 4 waveforms (sine, triangle, saw, sample & hold), key retrigger, L-R sync, keyboard rate tracking, the
// LFO1 delay, WHOLE 8 (LEFT outputs copy the RIGHT LFOs), LFO -> PWM, LFO1 square latches ($6305/$6306).
// LFO phases run freely from power-on, so every test enables key retrigger: the first key of a side restarts
// its LFOs on both ROMs (sync tests restart the RIGHT one). Rates are kept moderate: a one-update offset
// (6 ms, main-loop latency of the retrigger) then stays within the time window.
import { describe, it, expect, beforeAll } from 'vitest';
import { MachineBackend } from '../src/machine/backend';
import { randomProgram, bramWith, recordPair, traceDiff, keyPairSync } from '../src/machine/parity';
import { loadStockRom, loadNeoRomFrom, buildFirmware, hasStock, neoSymbols, tp } from './helpers';
import type { ButtonId } from '../src/types';

const BUILD = 'build-eng-lfo';
const PF = { KBMODE: 3, OCT_R: 6, OCT_L: 7, LFOSYNC: 21 };
const LFO_SLOTS = [0x78, 0x79, 0x7a, 0x7c, 0x7d, 0x7e];

function press(b: MachineBackend, ...ids: ButtonId[]) {
  for (const id of ids) { b.button(id, true); b.run(30); b.button(id, false); b.run(50); }
}
const digits = (n: number) => [`k${Math.floor(n / 10)}`, `k${n % 10}`] as ButtonId[];

interface LfoP { w1: number; w2: number; r1: number; r2: number; delay?: number; trk1?: 0 | 1 | 2; trk2?: 0 | 1 | 2; pwm?: number; retrig?: boolean }
function lfoProgram(seed: number, l: LfoP) {
  const p = randomProgram(seed);
  p[0x0a] &= 0x80; // glide off
  p[0x1d] = (p[0x1d] & 0x90) | (l.w1 << 5) | (15 - (l.delay ?? 0)); // waveform LFO1, delay (0 = none)
  p[0x1e] = (p[0x1e] & 0xf3) | (l.w2 << 2);
  p[0x0b] = (p[0x0b] & 0x80) | l.r1;
  p[0x23] = (p[0x23] & 0x80) | l.r2;
  p[0x1f] = l.retrig === false ? p[0x1f] | 0x60 : p[0x1f] & ~0x60;
  // tracking bits (active low): $24 bit 6 LFO1 track, bit 4 LFO1 half, bit 5 LFO2 track, bit 3 LFO2 half
  p[0x24] = (p[0x24] & 0x87) | (l.trk1 ? 0 : 0x40) | (l.trk1 === 2 ? 0 : 0x10) | (l.trk2 ? 0 : 0x20) | (l.trk2 === 2 ? 0 : 0x08);
  if (l.pwm !== undefined) { p[0x11] &= 0x7f; p[0x12] &= 0x7f; p[0x20] = (p[0x20] & ~0x1b) | l.pwm | (l.pwm << 3); p[0x25] = 0xb7; }
  return p;
}

function pair(programs: Uint8Array[], mode: 'whole' | 'split' | 'layer', o: { stock?: (s: MachineBackend) => void; perf?: [number, number][] } = {}) {
  const bram = bramWith(programs);
  const st = new MachineBackend('stock', loadStockRom(), bram);
  const ne = new MachineBackend('neo', loadNeoRomFrom(BUILD), bram);
  st.run(1500); ne.run(1500);
  tp(ne, 5, 2, PF.KBMODE); tp(ne, 5, 0, PF.OCT_R); tp(ne, 5, 0, PF.OCT_L); tp(ne, 4); tp(ne, 1, 0, 0); tp(ne, 1, 0, 1);
  const kb = mode === 'whole' ? 0 : mode === 'split' ? 1 : 2;
  press(st, mode === 'whole' ? 'kb_whole' : mode === 'split' ? 'kb_split' : 'kb_layer');
  tp(ne, 5, kb, PF.KBMODE);
  o.stock?.(st);
  for (const [off, v] of o.perf ?? []) tp(ne, 5, v, off);
  tp(ne, 4);
  press(st, 'call_r', ...digits(1)); tp(ne, 1, 1, 0);
  if (kb) { press(st, 'call_l', ...digits(2)); tp(ne, 1, 2, 1); }
  st.run(400); ne.run(400);
  return { st, ne };
}

describe.skipIf(!hasStock)('engine parity: LFOs', () => {
  let S: Record<string, number>;
  beforeAll(() => { buildFirmware(BUILD, ['STOCK_TABLES', 'STUB_UI', 'STUB_TUNE']); S = neoSymbols(BUILD); });

  /** keys: [ms, note, down]; the S&H LFSR is seeded identically 40 ms after the first key; returns the traces. */
  function run(st: MachineBackend, ne: MachineBackend, keys: [number, number, boolean][], n: number) {
    const ev = new Map<number, () => void>();
    ev.set(Math.round((keys[0][0] + 40) / 2), () => { st.machine.ram[0x28] = 0x5a; ne.machine.ram[S.lfo_rnd] = 0x5a; });
    for (const [ms, note, d] of keys) {
      const i = Math.round(ms / 2), prev = ev.get(i);
      ev.set(i, () => { prev?.(); keyPairSync(st, ne, note, d, 127, 0xb053, S.vx_tick); });
    }
    return recordPair(st, ne, n, 2, ev);
  }
  /** samples before the retrigger (first key + latency) are not comparable */
  const after = (t: number[][], from: number) => t.slice(from);

  const W = 10; // samples of 2 ms (see fw-eng-env.test.ts: main-loop latency of the retriggering key + 6 ms update)
  const waves = ['sine', 'triangle', 'saw', 'S&H'];
  // (the S&H LFOs share one random generator: one S&H LFO per test, so both ROMs draw in the same order)
  for (const [w1, w2, l1, l2] of [[0, 1, 1, 0], [1, 2, 2, 1], [2, 3, 2, 0], [3, 0, 0, 1], [0, 0, 0, 0], [2, 2, 2, 2], [1, 0, 3, 1]]) {
    it(`SPLIT: RIGHT LFO1 ${waves[w1]} / LFO2 ${waves[w2]}, LEFT ${waves[l1]} / ${waves[l2]}`, () => {
      const { st, ne } = pair([lfoProgram(1, { w1, w2, r1: 40, r2: 52 }), lfoProgram(11, { w1, w2, r1: 40, r2: 52 }), lfoProgram(12, { w1: l1, w2: l2, r1: 58, r2: 33 })], 'split');
      const { a, b } = run(st, ne, [[10, 72, true], [14, 40, true], [2000, 72, false], [2000, 40, false]], 1500);
      expect(traceDiff(after(a, 40), after(b, 40), LFO_SLOTS, W, 0.004, 'range')).toEqual([]);
    });
  }

  it('LFO1 delay fade-in (multiplier of $79/$78) and its restart with the next first key', () => {
    const { st, ne } = pair([lfoProgram(2, { w1: 1, w2: 0, r1: 50, r2: 45, delay: 6 }), lfoProgram(2, { w1: 1, w2: 0, r1: 50, r2: 45, delay: 6 }), lfoProgram(3, { w1: 0, w2: 2, r1: 44, r2: 40, delay: 11 })], 'split');
    const { a, b } = run(st, ne, [[10, 72, true], [12, 40, true], [1500, 72, false], [1500, 40, false], [2000, 74, true], [2004, 42, true]], 1800);
    // around the second retrigger (2000 ms) one ROM may still take one more LFO step before restarting: skip it
    expect(traceDiff(a.slice(40, 995), b.slice(40, 995), LFO_SLOTS, W, 0.004, 'range')).toEqual([]);
    expect(traceDiff(a.slice(1030), b.slice(1030), LFO_SLOTS, W, 0.004, 'range')).toEqual([]);
  });

  for (const [t1, t2] of [[1, 2], [2, 1]] as [1 | 2, 1 | 2][]) {
    it(`keyboard rate tracking LFO1 ${t1 === 1 ? 'full' : 'half'}, LFO2 ${t2 === 1 ? 'full' : 'half'} (follows the side's keyboard CV)`, () => {
      const p = lfoProgram(4, { w1: 1, w2: 1, r1: 30, r2: 36, trk1: t1, trk2: t2 });
      const { st, ne } = pair([p, p, lfoProgram(5, { w1: 0, w2: 1, r1: 25, r2: 40, trk1: t2, trk2: t1 })], 'split');
      const { a, b } = run(st, ne, [[10, 60, true], [12, 38, true], [1000, 70, true], [1000, 46, true], [2000, 70, false], [2000, 60, false], [2002, 46, false], [2002, 38, false]], 1600);
      // Up to the second keys: same waveforms. After them the rates change: a change landing one LFO update apart
      // puts the phases on a different grid, and the original's bounce (high byte complemented, low byte negated)
      // then makes the periods differ slightly - so the new increments are compared instead of the traces.
      expect(traceDiff(a.slice(40, 495), b.slice(40, 495), LFO_SLOTS, W, 0.004, 'range')).toEqual([]);
      const inc = (r: Uint8Array, hi: number, lo: number) => [0, 1, 2, 3].map((x) => (r[hi + x] << 8) | r[lo + x]);
      // direction may differ: magnitudes (a negative increment is a one's or two's complement depending on its history)
      const abs16 = (v: number) => (v & 0x8000 ? (~v & 0xffff) : v);
      const ia = inc(st.machine.ram, 0x888, 0x88c).map(abs16), ib = inc(ne.machine.ram, S.lfo_ihi, S.lfo_ilo).map(abs16);
      ia.forEach((v, x) => expect(Math.abs(v - ib[x]), `LFO ${x} increment`).toBeLessThanOrEqual(1));
    });
  }

  for (const sync of [1, 2, 3]) {
    it(`L-R sync ${sync & 1 ? 'LFO1 ' : ''}${sync & 2 ? 'LFO2' : ''}: the LEFT LFO follows the RIGHT phase`, () => {
      const p = lfoProgram(6, { w1: 1, w2: 2, r1: 45, r2: 50 });
      const pl = lfoProgram(7, { w1: 3, w2: 1, r1: 20, r2: 60, retrig: false });
      const { st, ne } = pair([p, p, pl], 'split', {
        stock: (s) => { if (sync & 1) s.machine.ram[0x89c] = 0xff; if (sync & 2) s.machine.ram[0x89d] = 0xff; },
        perf: [[PF.LFOSYNC, sync]],
      });
      const { a, b } = run(st, ne, [[10, 72, true], [1500, 72, false]], 1200);
      const slots = [0x78, 0x79, 0x7a, ...(sync & 1 ? [0x7c, 0x7d] : []), ...(sync & 2 ? [0x7e] : [])];
      expect(traceDiff(after(a, 40), after(b, 40), slots, W, 0.004, 'range')).toEqual([]);
    });
  }

  it('WHOLE 8: LEFT LFO outputs copy the RIGHT LFOs', () => {
    const p = lfoProgram(8, { w1: 2, w2: 3, r1: 42, r2: 48, delay: 4 });
    const { st, ne } = pair([p, p], 'whole');
    const { a, b } = run(st, ne, [[10, 60, true], [1600, 60, false]], 1300);
    expect(traceDiff(after(a, 40), after(b, 40), LFO_SLOTS, W, 0.004, 'range')).toEqual([]);
  });

  for (const src of [0, 1]) {
    it(`LFO${src + 1} -> PWM of both VCOs, both sides`, () => {
      const p = lfoProgram(9, { w1: 1, w2: 0, r1: 40, r2: 45, pwm: src });
      const { st, ne } = pair([p, p, lfoProgram(10, { w1: 2, w2: 1, r1: 47, r2: 38, pwm: src })], 'split');
      const { a, b } = run(st, ne, [[10, 72, true], [12, 40, true], [1500, 72, false], [1500, 40, false]], 1200);
      const pwm = Array.from({ length: 8 }, (_, v) => [8 * v + 1, 8 * v + 5]).flat();
      expect(traceDiff(after(a, 40), after(b, 40), [...LFO_SLOTS, ...pwm], W, 0.006, 'range')).toEqual([]);
    });
  }

  it('LFO1 square latches $6305/$6306 follow the LFO1 direction', () => {
    const p = lfoProgram(13, { w1: 1, w2: 0, r1: 55, r2: 40 });
    const { st, ne } = pair([p, p, lfoProgram(14, { w1: 1, w2: 2, r1: 60, r2: 40 })], 'split');
    run(st, ne, [[10, 72, true], [12, 40, true]], 50);
    // edges of each latch bit (RIGHT = Q5, LEFT = Q6): same levels, times within 20 ms
    const edges = (b: MachineBackend) => {
      const out: string[][] = [[], []];
      let prev = b.machine.ctl.ic3;
      for (let t = 0; t < 1200; t += 2) {
        b.run(2);
        const v = b.machine.ctl.ic3;
        for (const k of [0, 1]) if (((v ^ prev) >> (5 + k)) & 1) out[k].push(`${(v >> (5 + k)) & 1}@${t}`);
        prev = v;
      }
      return out;
    };
    const ea = edges(st), eb = edges(ne);
    for (const k of [0, 1]) {
      expect(ea[k].length).toBeGreaterThan(4);
      const n = Math.min(ea[k].length, eb[k].length) - 1;
      expect(eb[k].slice(0, n).map((e) => e.split('@')[0])).toEqual(ea[k].slice(0, n).map((e) => e.split('@')[0]));
      for (let i = 0; i < n; i++) expect(Math.abs(Number(ea[k][i].split('@')[1]) - Number(eb[k][i].split('@')[1]))).toBeLessThanOrEqual(20);
    }
  });
});
