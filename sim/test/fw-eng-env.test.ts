// Engine parity, envelopes: ADSR2 -> VCA ($68-$6F, x velocity multiplier), ADSR1 -> VCF ($70-$77, x depth),
// the 4 envelope modes, velocity -> attack, keyboard decay/release tracking, release defeat (cut / gets decay),
// retrigger and legato, ADSR -> PWM, program-volume gate ($53/$57). Also the control-tick cost.
//
// Comparison: S&H levels sampled every 2 ms for several seconds; every NeoV8 sample must equal a stock sample
// within +-W samples. W covers (a) the 3-tick envelope period (6.1 ms) and (b) the main-loop latency of key
// events: both ROMs handle key events in their main loops, whose phase against the control tick differs
// (measured key -> gate latency: stock 3-5 ms, NeoV8 3-12 ms). Events are placed where a segment has reached a
// stable value (or where the next segment is a pure time shift of the curve) so that a latency difference is
// a time offset, not a level difference.
import { describe, it, expect, beforeAll } from 'vitest';
import { MachineBackend } from '../src/machine/backend';
import { bramWith, recordPair, traceDiff, keyPairSync } from '../src/machine/parity';
import { loadStockRom, loadNeoRomFrom, buildFirmware, hasStock, neoSymbols, tp } from './helpers';
import type { ButtonId } from '../src/types';

const BUILD = 'build-eng-env';
const W = 10; // samples of 2 ms
const TOL = 0.004;
const PF = { KBMODE: 3, UNISON: 5, OCT_R: 6, OCT_L: 7, RELDEF: 9, ASSIGN_R: 17 };

function press(b: MachineBackend, ...ids: ButtonId[]) {
  for (const id of ids) { b.button(id, true); b.run(30); b.button(id, false); b.run(50); }
}
const digits = (n: number) => [`k${Math.floor(n / 10)}`, `k${n % 10}`] as ButtonId[];

/** Null program (stock $F068) with envelope parameters. */
const NULLP = [0xAF, 0xAF, 0xAF, 0xAF, 0xFF, 0xFF, 0x00, 0x00, 0x00, 0x00, 0x80, 0x90, 0x80, 0xC8, 0xC8, 0xC0, 0xC0, 0xC0, 0x80, 0xFF, 0x80, 0x80, 0x00, 0x80, 0xFF, 0x80, 0x00, 0x80, 0xFF, 0x80, 0xF0, 0xFF, 0x80, 0xFF, 0xC0, 0x96, 0xFF, 0x00, 0xC0, 0xF8];
interface EnvP {
  a2: number; d2: number; s2: number; r2: number; a1: number; d1: number; s1: number; r1: number; depth?: number;
  mode2?: number; mode1?: number; // 0 normal, 1 unconditional, 2 ADR, 3 reset to zero
  velAtt?: 0 | 1 | 2; kbdTrk?: 0 | 1 | 2; getsDecay?: boolean; vcaVel?: boolean; pwm?: boolean;
}
function envProgram(e: EnvP) {
  const p = new Uint8Array(NULLP);
  const set = (b: number, v: number) => { p[b] = (p[b] & 0x80) | (v & 0x7f); };
  set(0x15, e.a2); set(0x16, e.d2); set(0x18, e.s2); set(0x17, e.r2);
  set(0x19, e.a1); set(0x1a, e.d1); set(0x1c, e.s1); set(0x1b, e.r1); set(0x14, e.depth ?? 100);
  set(0x0a, 0); // glide off
  const m1 = e.mode1 ?? 0, m2 = e.mode2 ?? 0; // active-low bits: bit0 unconditional, bit1 ADR
  p[0x1f] = (p[0x1f] & 0xf0) | ((~m1 & 3) | ((~m2 & 3) << 2));
  p[0x0a] = (p[0x0a] & 0x7f) | (e.velAtt ? 0 : 0x80); p[0x0b] = (p[0x0b] & 0x7f) | (e.velAtt === 2 ? 0 : 0x80);
  p[0x0c] = (p[0x0c] & 0x7f) | (e.kbdTrk ? 0 : 0x80); p[0x0d] = (p[0x0d] & 0x7f) | (e.kbdTrk === 2 ? 0 : 0x80);
  p[0x20] = e.getsDecay ? p[0x20] & ~0x40 : p[0x20] | 0x40;
  p[0x1c] = e.vcaVel ? p[0x1c] & 0x7f : p[0x1c] | 0x80;
  if (e.pwm) { p[0x11] &= 0x7f; p[0x12] &= 0x7f; p[0x20] = (p[0x20] & ~0x1b) | 0x02 | 0x18; p[0x25] = 0xc9; } // VCO1 <- ADSR1, VCO2 <- ADSR2
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

const ENV_SLOTS = Array.from({ length: 16 }, (_, i) => 0x68 + i);
const PWM_SLOTS = Array.from({ length: 8 }, (_, v) => [8 * v + 1, 8 * v + 5]).flat();

/** ms -> events at sample indexes (2 ms). */
function events(st: MachineBackend, ne: MachineBackend, list: [number, number, boolean, number?][]) {
  const ev = new Map<number, () => void>();
  for (const [ms, n, d, v] of list) {
    const i = Math.round(ms / 2);
    const prev = ev.get(i);
    ev.set(i, () => { prev?.(); keyPairSync(st, ne, n, d, v ?? 100, 0xb053, SCAN_NEO); });
  }
  return ev;
}

let SCAN_NEO = 0;
const BASE: EnvP = { a2: 50, d2: 62, s2: 70, r2: 64, a1: 45, d1: 58, s1: 40, r1: 60 };

describe.skipIf(!hasStock)('engine parity: envelopes', () => {
  let S: Record<string, number>;
  beforeAll(() => { buildFirmware(BUILD, ['STUB_UI', 'STUB_TUNE']); S = neoSymbols(BUILD); SCAN_NEO = S.vx_tick; });

  // Poly: attack/decay/sustain/release, a re-strike of the same note while it releases (same voice: assign
  // mode 0 reuses it, envelope retriggered from its current level), other voices with other velocities.
  // Velocities 127 / 1 only: the key timer of both ROMs may differ by one frame (ticks deferred while the main
  // loop holds the DAC), the tapers are flat at both ends.
  const POLY: [number, number, boolean, number?][] = [
    [10, 60, true, 127], [1500, 60, false], [1750, 60, true, 1], [2600, 60, false],
    [3000, 72, true, 1], [3100, 43, true, 127], [4500, 72, false], [4600, 43, false],
  ];
  const variants: [string, Partial<EnvP>][] = [
    ['normal', {}],
    ['unconditional', { mode1: 1, mode2: 1 }],
    ['ADR', { mode1: 2, mode2: 2 }],
    ['reset to zero', { mode1: 3, mode2: 3 }],
    ['mixed modes ADSR1 ADR / ADSR2 reset', { mode1: 2, mode2: 3 }],
    ['velocity -> attack full', { velAtt: 1 }],
    ['velocity -> attack half', { velAtt: 2 }],
    ['keyboard decay/release tracking full', { kbdTrk: 1 }],
    ['keyboard decay/release tracking half', { kbdTrk: 2 }],
    ['VCA velocity', { vcaVel: true }],
    ['ADSR -> PWM', { pwm: true }],
    ['long attack, sustain 0', { a2: 70, s2: 0, a1: 72, s1: 0, d2: 55, d1: 50 }],
  ];
  for (const [name, v] of variants) {
    it(`poly WHOLE 8: ${name}`, () => {
      const { st, ne } = pair([envProgram({ ...BASE, ...v }), envProgram({ ...BASE, ...v })], 'whole');
      const { a, b } = recordPair(st, ne, 2900, 2, events(st, ne, POLY));
      if (process.env.DUMP) { const [f, t, sl] = process.env.DUMP.split(',').map((x) => parseInt(x, 16)); let l = ''; for (let i = f; i < t; i++) l += `${i.toString(16)}:${(a[i][sl] * 1e4).toFixed(0)}/${(b[i][sl] * 1e4).toFixed(0)} `; console.log(l); }
      expect(traceDiff(a, b, [...ENV_SLOTS, 0x53, 0x57, ...(v.pwm ? PWM_SLOTS : [])], W, TOL, 'range')).toEqual([]);
    });
  }

  it('SPLIT: two programs, different envelopes per side', () => {
    const { st, ne } = pair([envProgram(BASE), envProgram({ ...BASE, mode2: 2, velAtt: 1 }), envProgram({ a2: 40, d2: 66, s2: 30, r2: 70, a1: 55, d1: 60, s1: 90, r1: 50, mode1: 1, kbdTrk: 2 })], 'split');
    const ev = events(st, ne, [[10, 40, true, 127], [30, 70, true, 1], [1600, 40, false], [1650, 70, false], [2200, 45, true, 1], [2210, 76, true, 127], [3500, 45, false], [3510, 76, false]]);
    const { a, b } = recordPair(st, ne, 2400, 2, ev);
    expect(traceDiff(a, b, [...ENV_SLOTS, 0x53, 0x57], W, TOL, 'range')).toEqual([]);
  });

  // Release defeat: release cut (index 127) or release = decay, WHOLE 8 uses the RIGHT button for both sides.
  for (const gets of [false, true]) {
    it(`release defeat, release ${gets ? 'gets decay' : 'cut off'}`, () => {
      const p = envProgram({ ...BASE, getsDecay: gets });
      const { st, ne } = pair([p, p], 'whole', { stock: (s) => press(s, 'reldef_r'), perf: [[PF.RELDEF, 1]] });
      const { a, b } = recordPair(st, ne, 2500, 2, events(st, ne, POLY.slice(0, 6)));
      expect(traceDiff(a, b, [...ENV_SLOTS, 0x53, 0x57], W, TOL, 'range')).toEqual([]);
    });
  }

  // Unison (one voice moved by the keys): assign mode 0 retriggers on every key change, mode 1 is legato.
  for (const asg of [0, 1]) {
    for (const mode of [0, 2, 3]) {
      it(`unison retrigger / legato: assign mode ${asg}, envelope mode ${mode}`, () => {
        const p = envProgram({ ...BASE, mode1: mode, mode2: mode });
        const { st, ne } = pair([p, p], 'whole', {
          stock: (s) => { press(s, 'uni_r'); s.machine.ram[0x79a] = asg; },
          perf: [[PF.UNISON, 1], [PF.ASSIGN_R, asg]],
        });
        const ev = events(st, ne, [[10, 48, true, 127], [1400, 55, true, 127], [2500, 55, false], [3700, 48, false], [4400, 60, true, 1], [5000, 60, false]]);
        const { a, b } = recordPair(st, ne, 2700, 2, ev);
        expect(traceDiff(a, b, [...ENV_SLOTS, 0x53, 0x57], W, TOL, 'range')).toEqual([]);
      });
    }
  }

  // Control-tick cost: 16 envelopes moving (8 voices), per phase of the 3-tick cycle.
  it('control tick cost with 16 active envelopes (phase 0 < 3700 cycles, no tick longer than the period)', () => {
    const p = envProgram({ a2: 110, d2: 60, s2: 60, r2: 100, a1: 110, d1: 60, s1: 60, r1: 100 });
    const pw = envProgram({ a2: 110, d2: 60, s2: 60, r2: 100, a1: 110, d1: 60, s1: 60, r1: 100, pwm: true });
    const cost = (prog: Uint8Array, held: boolean) => {
      const ne = new MachineBackend('neo', loadNeoRomFrom(BUILD), bramWith([prog, prog]));
      ne.run(1500);
      tp(ne, 5, 0, PF.KBMODE); tp(ne, 4); tp(ne, 1, 1, 0); ne.run(300);
      for (let n = 0; n < 8; n++) { ne.key(48 + n * 3, true, 100); ne.run(7); }
      ne.run(200);
      if (!held) { for (let n = 0; n < 8; n++) ne.key(48 + n * 3, false, 0); ne.run(100); }
      const m = ne.machine, cpu = m.cpu;
      const per: number[][] = [[], [], []];
      let t0 = 0, ret = -1, sp = 0, ph = 0;
      cpu.onStep = (pc: number) => {
        if (ret >= 0 && pc === ret && cpu.s === ((sp + 2) & 0xff)) { per[ph].push(cpu.cycles - t0); ret = -1; }
        if (pc === S.eng_tick && ret < 0) {
          t0 = cpu.cycles; sp = cpu.s; ph = m.ram[S.en_phase];
          ret = ((m.read(0x100 + ((sp + 2) & 0xff)) << 8) | m.read(0x100 + ((sp + 1) & 0xff))) + 1;
        }
      };
      ne.run(600);
      cpu.onStep = undefined;
      return per.map((a) => ({ avg: Math.round(a.reduce((x, y) => x + y, 0) / a.length), max: Math.max(...a) }));
    };
    const rel = cost(p, false), held = cost(p, true), pwm = cost(pw, true);
    console.log('tick cycles per phase [env | glide+LFO2+refresh | LFO1+glide+refresh]:',
      '\n  16 env releasing, no key', JSON.stringify(rel), '\n  16 env attacking, 8 keys held', JSON.stringify(held), '\n  + 16 ADSR->PWM', JSON.stringify(pwm));
    expect(rel[0].max).toBeLessThan(3700);
    expect(held[0].max).toBeLessThan(3700);
    for (const r of [...rel, ...held, ...pwm]) expect(r.max).toBeLessThan(4600);
  });
});
