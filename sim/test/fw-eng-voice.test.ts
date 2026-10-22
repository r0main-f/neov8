// Engine parity, voices: key assignment (WHOLE 8 / SPLIT / LAYER, assign modes 0-3, unison, hold, voice
// disable), note-on CVs (pitch, VCF tracking, velocity, keyboard gate/CV), glide/gliss, arpeggiator.
// Both ROMs boot on the same battery RAM and receive the same physical VPK-5 key events; the stock is set up
// with panel buttons (and a few RAM pokes for Alternate/SET-page settings), NeoV8 through the test port (PERF).
import { describe, it, expect, beforeAll } from 'vitest';
import { MachineBackend } from '../src/machine/backend';
import { randomProgram, bramWith, recordPair, traceDiff, keyPair } from '../src/machine/parity';
import { loadStockRom, loadNeoRomFrom, buildFirmware, hasStock, neoSymbols, tp } from './helpers';
import type { ButtonId } from '../src/types';

const BUILD = 'build-eng-voice';
const PF = { KBMODE: 3, UNISON: 5, OCT_R: 6, OCT_L: 7, HOLD: 8, ARP_ON: 11, ARP_MODE_R: 12, ARP_MODE_L: 13, ARP_SPEED: 15, ARP_AUTOOCT: 16, ASSIGN_R: 17, ASSIGN_L: 18, ARP_RETRIG: 23, ARP_CLK_L: 24, KBDGATE: 25, VOICEMASK: 27 };
type Mode = 'whole' | 'split' | 'layer';
const KB: Record<Mode, number> = { whole: 0, split: 1, layer: 2 };
const MODE_BTN: Record<Mode, ButtonId> = { whole: 'kb_whole', split: 'kb_split', layer: 'kb_layer' };
const hex = (n: number) => n.toString(16).padStart(2, '0');

function press(b: MachineBackend, ...ids: ButtonId[]) {
  for (const id of ids) { b.button(id, true); b.run(30); b.button(id, false); b.run(50); }
}
const digits = (n: number) => [`k${Math.floor(n / 10)}`, `k${n % 10}`] as ButtonId[];

interface Setup {
  mode: Mode; progR: number; progL?: number;
  /** stock-side setup after the mode button (buttons, RAM pokes) */
  stock?: (st: MachineBackend) => void;
  /** NeoV8 PERF bytes [offset, value] set before the PERF apply */
  perf?: [number, number][];
  settle?: number;
}
/** Both machines booted on `programs`, in the same keyboard mode with the same programs. */
function pair(programs: Uint8Array[], o: Setup) {
  const bram = bramWith(programs);
  const st = new MachineBackend('stock', loadStockRom(), bram);
  const ne = new MachineBackend('neo', loadNeoRomFrom(BUILD), bram);
  st.run(1500); ne.run(1500);
  // the stock boots on step 0 (zeroed): LAYER, programs 0 / 0, octaves state 0
  tp(ne, 5, 2, PF.KBMODE); tp(ne, 5, 0, PF.OCT_R); tp(ne, 5, 0, PF.OCT_L); tp(ne, 4);
  tp(ne, 1, 0, 0); tp(ne, 1, 0, 1);
  press(st, MODE_BTN[o.mode]);
  tp(ne, 5, KB[o.mode], PF.KBMODE);
  o.stock?.(st);
  for (const [off, v] of o.perf ?? []) tp(ne, 5, v, off);
  tp(ne, 4);
  press(st, 'call_r', ...digits(o.progR)); tp(ne, 1, o.progR, 0);
  if (o.mode !== 'whole') { press(st, 'call_l', ...digits(o.progL ?? o.progR)); tp(ne, 1, o.progL ?? o.progR, 1); }
  st.run(o.settle ?? 500); ne.run(o.settle ?? 500);
  return { st, ne };
}

/** Voice state (stock $0318 keys, $40 sounding notes, $0308 bit 7 "not assignable") vs NeoV8. */
function voiceState(st: MachineBackend, ne: MachineBackend, S: Record<string, number>) {
  const sr = st.machine.ram, nr = ne.machine.ram;
  const row = (r: Uint8Array, a: number, m = 0xff) => [...r.slice(a, a + 8)].map((x) => hex(x & m)).join(' ');
  return {
    stock: `key ${row(sr, 0x318)} note ${row(sr, 0x40)} lock ${row(sr, 0x308, 0x80)}`,
    neo: `key ${row(nr, S.vx_key)} note ${row(nr, S.vx_note)} lock ${row(nr, S.vx_dis, 0x80)}`,
  };
}

/** Deterministic key sequence: up to 10 keys held, events `gap` ms apart, velocities 60-119. */
function keySeq(seed: number, n: number) {
  let x = seed;
  const rnd = () => { x = (x * 1103515245 + 12345) & 0x7fffffff; return x; };
  const held = new Set<number>();
  const out: [number, boolean, number][] = [];
  for (let i = 0; i < n; i++) {
    let note: number, down: boolean;
    if (held.size && (held.size > 9 || rnd() % 3 === 0)) { note = [...held][rnd() % held.size]; down = false; held.delete(note); }
    else { do { note = 36 + (rnd() % 61); } while (held.has(note)); down = true; held.add(note); }
    out.push([note, down, 60 + (rnd() % 60)]);
  }
  for (const note of held) out.push([note, false, 0]);
  return out;
}

const glideOff = (p: Uint8Array) => { p[0x0a] &= 0x80; return p; };

describe.skipIf(!hasStock)('engine parity: voices', () => {
  let S: Record<string, number>;
  beforeAll(() => { buildFirmware(BUILD, ['STOCK_TABLES', 'STUB_UI', 'STUB_TUNE']); S = neoSymbols(BUILD); });

  /** Plays a sequence (90 ms between events: every velocity timing has completed) and compares voice states. */
  function playCompare(st: MachineBackend, ne: MachineBackend, seq: [number, boolean, number][], gap = 90) {
    const bad: string[] = [];
    for (const [n, d, v] of seq) {
      keyPair(st, ne, n, d, v);
      st.run(gap); ne.run(gap);
      const s = voiceState(st, ne, S);
      if (s.stock !== s.neo && bad.length < 5) bad.push(`after ${n}${d ? '+' : '-'}: stock ${s.stock} | neo ${s.neo}`);
    }
    return bad;
  }

  for (const mode of ['whole', 'split', 'layer'] as Mode[]) {
    for (const asg of [0, 1, 2, 3]) {
      it(`assignment ${mode}, assign mode R ${asg} / L ${(asg + 1) & 3}`, () => {
        const progs = Array.from({ length: 20 }, (_, i) => glideOff(randomProgram(100 + i)));
        const { st, ne } = pair(progs, {
          mode, progR: 3, progL: 7,
          stock: (s) => { s.machine.ram[0x79a] = asg; s.machine.ram[0x79b] = (asg + 1) & 3; },
          perf: [[PF.ASSIGN_R, asg], [PF.ASSIGN_L, (asg + 1) & 3]],
        });
        expect(playCompare(st, ne, keySeq(17 + asg * 31 + KB[mode], 60))).toEqual([]);
      });
    }
  }

  for (const [mode, uni] of [['split', 1], ['split', 2], ['split', 3], ['whole', 1], ['layer', 1]] as [Mode, number][]) {
    it(`unison ${mode} ${uni & 1 ? 'R' : ''}${uni & 2 ? 'L' : ''}, assign modes 1 / 0`, () => {
      const progs = Array.from({ length: 20 }, (_, i) => glideOff(randomProgram(200 + i)));
      const { st, ne } = pair(progs, {
        mode, progR: 4, progL: 9,
        stock: (s) => { if (uni & 1) press(s, 'uni_r'); if (uni & 2) press(s, 'uni_l'); s.machine.ram[0x79a] = 1; },
        perf: [[PF.UNISON, uni], [PF.ASSIGN_R, 1]],
      });
      expect(playCompare(st, ne, keySeq(5 + uni, 50))).toEqual([]);
    });
  }

  for (const [mode, uni] of [['whole', 0], ['split', 0], ['layer', 0], ['split', 3], ['whole', 1]] as [Mode, number][]) {
    it(`hold ${mode}${uni ? ' unison' : ''}`, () => {
      const progs = Array.from({ length: 20 }, (_, i) => glideOff(randomProgram(300 + i)));
      const { st, ne } = pair(progs, {
        mode, progR: 3, progL: 7,
        stock: (s) => { if (uni & 1) press(s, 'uni_r'); if (uni & 2) press(s, 'uni_l'); },
        perf: [[PF.UNISON, uni]],
      });
      let hold = 0;
      const bad: string[] = [];
      const key = (n: number, d: boolean) => bad.push(...playCompare(st, ne, [[n, d, 100]], 80));
      const hb = (side: number) => {
        press(st, side ? 'hold_l' : 'hold_r'); hold ^= 1 << side;
        tp(ne, 5, hold, PF.HOLD); tp(ne, 4);
        st.run(100); ne.run(100);
        const s = voiceState(st, ne, S);
        if (s.stock !== s.neo) bad.push(`hold ${hold}: stock ${s.stock} | neo ${s.neo}`);
      };
      key(48, true); key(52, true); key(55, true); hb(0); key(48, false); key(52, false); key(60, true); key(64, true);
      key(67, true); key(72, true); key(60, false); hb(0); key(55, false); key(64, false); key(40, true); key(76, true);
      if (mode === 'split') { hb(1); key(40, false); key(42, true); key(44, true); key(76, false); hb(1); key(42, false); }
      key(67, false); key(72, false); key(76, false); key(40, false); key(44, false);
      expect(bad).toEqual([]);
    });
  }

  /** Calls a NeoV8 routine (JSR) between two instructions, interrupts masked; returns A. */
  function call(b: MachineBackend, addr: number, a = 0, x = 0, y = 0) {
    const cpu = b.machine.cpu as unknown as { pc: number; s: number; p: number; a: number; x: number; y: number };
    const save = { pc: cpu.pc, s: cpu.s, p: cpu.p, a: cpu.a, x: cpu.x, y: cpu.y };
    const magic = 0xfff0; // never executed: the call stops when the routine returns there
    b.machine.write(0x100 + cpu.s, (magic - 1) >> 8); cpu.s = (cpu.s - 1) & 0xff;
    b.machine.write(0x100 + cpu.s, (magic - 1) & 0xff); cpu.s = (cpu.s - 1) & 0xff;
    cpu.p |= 0x04; cpu.pc = addr; cpu.a = a; cpu.x = x; cpu.y = y;
    for (let i = 0; i < 100000 && cpu.pc !== magic; i++) b.machine.run(1);
    const r = cpu.a;
    Object.assign(cpu, save);
    return r;
  }

  it('eng_lowest_held: lowest key held on the VPK-5 (MIDI note), $FF when none', () => {
    const ne = new MachineBackend('neo', loadNeoRomFrom(BUILD), bramWith([]));
    ne.run(1500);
    expect(call(ne, S.eng_lowest_held)).toBe(0xff);
    for (const n of [67, 41, 90]) { ne.key(n, true, 127); ne.run(20); }
    expect(call(ne, S.eng_lowest_held)).toBe(41);
    ne.key(41, false, 0); ne.run(20);
    expect(call(ne, S.eng_lowest_held)).toBe(67);
    tp(ne, 2, 50, 0, 100); // eng_key_on counts too
    expect(call(ne, S.eng_lowest_held)).toBe(50);
  });

  it('MIDI entry points: eng_side_on/off per side (SPLIT), unknown note-off ignored, raw velocity', () => {
    const progs = Array.from({ length: 4 }, (_, i) => glideOff(randomProgram(900 + i)));
    const ne = new MachineBackend('neo', loadNeoRomFrom(BUILD), bramWith(progs));
    ne.run(1500);
    tp(ne, 5, 1, PF.KBMODE); tp(ne, 4); tp(ne, 1, 1, 0); tp(ne, 1, 2, 1); ne.run(100);
    const r = ne.machine.ram;
    const notes = () => [...r.slice(S.vx_note, S.vx_note + 8)];
    tp(ne, 7, 80, 0, 90); tp(ne, 7, 30, 1, 64); ne.run(50);
    expect(notes().slice(0, 4).filter((n) => n === (80 | 0x80))).toHaveLength(1);
    expect(notes().slice(4).filter((n) => n === (30 | 0x80))).toHaveLength(1);
    const v = notes().indexOf(30 | 0x80);
    expect(r[S.vx_vel + v]).toBe(64); // MIDI velocity goes to the voice as is (no taper), like the stock
    const before = notes().join();
    call(ne, S.eng_side_off, 81, 0); // MIDI note-off of a note not playing on that side: ignored
    call(ne, S.eng_side_off, 80, 1);
    tp(ne, 3, 99); // keyboard-routed key-off of an unplayed note
    ne.run(50);
    expect(notes().join()).toBe(before);
    tp(ne, 3, 80); ne.run(50); // keyboard-routed key-off (80 >= split point -> RIGHT)
    expect(notes().filter((n) => n === (80 | 0x80))).toHaveLength(0);
  });

  it('voice disable mask (SET page) and autotune-failed voices are skipped', () => {
    const progs = Array.from({ length: 20 }, (_, i) => glideOff(randomProgram(400 + i)));
    const { st, ne } = pair(progs, {
      mode: 'whole', progR: 5,
      stock: (s) => { s.machine.ram[0x759] = 0x29; press(s, 'kb_whole'); },
      perf: [[PF.VOICEMASK, 0x29]],
    });
    expect(playCompare(st, ne, keySeq(99, 40))).toEqual([]);
  });

  // Note-on CVs: pitch (VCO2 ch3, VCO1 ch7 tracked / fixed), VCF Fc tracking, velocity slots, kbd gate / CV,
  // with random programs (every flag combination) and octave settings. Glide off here.
  for (const [mode, oct] of [['whole', [0, 0]], ['whole', [2, 0]], ['split', [1, 2]], ['layer', [0, 1]]] as [Mode, number[]][]) {
    for (const seed of [1, 2, 3]) {
      it(`note-on CVs ${mode}, octaves ${oct.join('/')}, programs seed ${seed}`, () => {
        const progs = Array.from({ length: 20 }, (_, i) => glideOff(randomProgram(seed * 1000 + i)));
        progs[0][0x0e] |= 0x80; // see "known differences": the stock leaves a fixed VCO1 pitch on the old octave
        const { st, ne } = pair(progs, {
          mode, progR: 3, progL: 7,
          stock: (s) => { for (let i = 0; i < oct[0]; i++) press(s, 'oct_r'); for (let i = 0; i < oct[1]; i++) press(s, 'oct_l'); },
          perf: [[PF.OCT_R, oct[0]], [PF.OCT_L, oct[1]]],
        });
        const ev = new Map<number, () => void>();
        const seq = keySeq(seed * 7, 30);
        seq.forEach(([n, d, v], i) => ev.set(5 + i * 40, () => keyPair(st, ne, n, d, v)));
        const { a, b } = recordPair(st, ne, seq.length * 40 + 100, 2, ev);
        const slots: number[] = [0x55];
        for (let v = 0; v < 8; v++) slots.push(8 * v + 3, 8 * v + 7, 0x58 + v, v < 4 ? 0x40 + v : 0x44 + v);
        expect(traceDiff(a, b, slots, 10, 0.002)).toEqual([]);
        // keyboard gate: PA only (the original leaves the previous DAC low byte), and one main-loop pass more
        expect(traceDiff(a, b, [0x50], 14, 0.008)).toEqual([]);
      });
    }
  }

  // Glide / glissando: the pitch slots move over time (rate from program byte $0A, mode byte $1F bit 4).
  for (const [mode, gl, gliss] of [['whole', 0x30, false], ['whole', 0x50, true], ['split', 0x40, false], ['layer', 0x38, true]] as [Mode, number, boolean][]) {
    it(`${gliss ? 'glissando' : 'glide'} ${mode}, time $${hex(gl)}`, () => {
      const progs = Array.from({ length: 20 }, (_, i) => {
        const p = randomProgram(500 + i);
        p[0x0a] = (p[0x0a] & 0x80) | gl;
        p[0x1f] = gliss ? p[0x1f] & ~0x10 : p[0x1f] | 0x10;
        p[0x0d] = (p[0x0d] & 0x80) | 0x40; p[0x0e] = 0x80 | 0x40; // frequencies centred, VCO1 tracked
        return p;
      });
      const { st, ne } = pair(progs, { mode, progR: 3, progL: 7, settle: 500 });
      // warm-up: every voice glides to a note and stops there (aligns the glide fractions of both ROMs)
      const warm = mode === 'split' ? [40, 43, 46, 50, 62, 65, 69, 74] : mode === 'layer' ? [48, 52, 55, 59] : [48, 50, 52, 53, 55, 57, 59, 60];
      for (const n of warm) { keyPair(st, ne, n, true, 110); st.run(30); ne.run(30); }
      st.run(12000); ne.run(12000);
      for (const n of warm) keyPair(st, ne, n, false);
      st.run(500); ne.run(500);
      const ev = new Map<number, () => void>();
      const seq: [number, boolean][] = [[48, true], [72, true], [48, false], [84, true], [72, false], [36, true], [84, false], [36, false]];
      seq.forEach(([n, d], i) => ev.set(5 + i * 150, () => keyPair(st, ne, n, d, 110)));
      const { a, b } = recordPair(st, ne, seq.length * 150 + 300, 2, ev);
      const slots: number[] = [];
      for (let v = 0; v < 8; v++) slots.push(8 * v + 3, 8 * v + 7);
      expect(traceDiff(a, b, slots, 10, 0.002)).toEqual([]);
    });
  }

  // Arpeggiator: same clock (ARP RETRIGGER restarts both clocks at the first key), same notes on the same voices.
  function arpRun(o: { mode: Mode; arpR: number; arpL?: number; speed: number; extra?: [number, number][]; stock?: (s: MachineBackend) => void; notes: number[]; ms: number }) {
    const progs = Array.from({ length: 20 }, (_, i) => glideOff(randomProgram(700 + i)));
    const btn = ['arp_down', 'arp_random', 'arp_up'] as ButtonId[];
    const { st, ne } = pair(progs, {
      mode: o.mode, progR: 3, progL: 7, settle: 300,
      stock: (s) => {
        if (o.arpR === 3) press(s, 'arp_up', 'arp_down'); else press(s, btn[o.arpR]);
        press(s, 'arp_right');
        if (o.arpL !== undefined) { press(s, 'arp_left'); s.machine.ram[0x8ab] = o.arpL; }
        s.machine.ram[0x8ff] = o.speed; s.machine.ram[0x8a4] = 0xff;
        o.stock?.(s);
      },
      perf: [[PF.ARP_ON, o.arpL !== undefined ? 3 : 1], [PF.ARP_MODE_R, o.arpR], [PF.ARP_MODE_L, o.arpL ?? 0], [PF.ARP_SPEED, o.speed], [PF.ARP_RETRIG, 1], ...(o.extra ?? [])],
    });
    st.machine.ram[0x28] = 0x37; ne.machine.ram[S.lfo_rnd] = 0x37; // same LFSR state (random mode)
    const evs = (r: Uint8Array, base: number, prev: number[], t: number, out: string[]) => {
      for (let v = 0; v < 8; v++) { const x = r[base + v]; if ((x & 0x80) && !(prev[v] & 0x80)) out.push(`v${v}=${x & 0x7f}@${t}`); prev[v] = x; }
    };
    const ea: string[] = [], eb: string[] = [], pa = Array(8).fill(0), pb = Array(8).fill(0);
    for (const n of o.notes) { keyPair(st, ne, n, true, 100); st.run(20); ne.run(20); }
    for (let t = 0; t < o.ms; t += 2) { st.run(2); ne.run(2); evs(st.machine.ram, 0x40, pa, t, ea); evs(ne.machine.ram, S.vx_note, pb, t, eb); }
    return { ea, eb, st, ne };
  }
  /** Same note-on sequence per side (voices 0-3 / 4-7); times may differ by up to `w` ms (main-loop latency).
   *  The last steps may fall on either side of the recording end, so the shorter list minus one step is compared. */
  function sameSeq(ea: string[], eb: string[], w = 24) {
    for (const side of [0, 1]) {
      const pick = (e: string[]) => e.filter((x) => (Number(x.split('=')[0].slice(1)) >> 2) === side);
      const a = pick(ea), b = pick(eb);
      const n = Math.max(0, Math.min(a.length, b.length) - 1);
      expect(Math.abs(a.length - b.length)).toBeLessThanOrEqual(1);
      const strip = (e: string) => e.split('@')[0];
      expect(b.slice(0, n).map(strip)).toEqual(a.slice(0, n).map(strip));
      for (let i = 0; i < n; i++) expect(Math.abs(Number(a[i].split('@')[1]) - Number(b[i].split('@')[1]))).toBeLessThanOrEqual(w);
    }
  }

  for (const [m, name] of [[2, 'up'], [0, 'down'], [3, 'up/down'], [1, 'random']] as [number, string][]) {
    it(`arpeggiator ${name}, WHOLE 8`, () => {
      const { ea, eb } = arpRun({ mode: 'whole', arpR: m, speed: 110, notes: [48, 52, 55, 60, 64], ms: 3000 });
      expect(ea.length).toBeGreaterThan(8);
      sameSeq(ea, eb);
    });
  }
  it('arpeggiator up/down with auto-octave (octave state follows)', () => {
    const { ea, eb, st, ne } = arpRun({ mode: 'whole', arpR: 3, speed: 110, notes: [48, 55, 60], ms: 3000, stock: (s) => { s.machine.ram[0x1e] = 0xff; }, extra: [[PF.ARP_AUTOOCT, 1]] });
    sameSeq(ea, eb);
    expect(ne.machine.ram[0x880 + PF.OCT_R]).toBe(st.machine.ram[0x15]);
  });
  it('arpeggiator random with auto-octave', () => {
    const { ea, eb } = arpRun({ mode: 'whole', arpR: 1, speed: 100, notes: [50, 57, 62, 69], ms: 3000, stock: (s) => { s.machine.ram[0x1e] = 0xff; }, extra: [[PF.ARP_AUTOOCT, 1]] });
    sameSeq(ea, eb);
  });
  it('arpeggiator keyboard gate (held chord gated by the clock)', () => {
    const { ea, eb } = arpRun({ mode: 'whole', arpR: 2, speed: 100, notes: [48, 52, 55], ms: 2000, stock: (s) => { s.machine.ram[0x798] = 0xff; }, extra: [[PF.KBDGATE, 1]] });
    expect(ea.length).toBeGreaterThan(6);
    // all chord voices gate together on each clock: compare as sets per step
    const steps = (e: string[]) => e.map((x) => x.split('@')[0]).sort().join(' ');
    expect(steps(eb)).toEqual(steps(ea));
  });
  it('arpeggiator LAYER (both programs follow)', () => {
    const { ea, eb } = arpRun({ mode: 'layer', arpR: 2, speed: 110, notes: [48, 52, 55, 59], ms: 2500 });
    sameSeq(ea, eb);
  });
  it('arpeggiator SPLIT: RIGHT up on the tempo clock, LEFT down', () => {
    const { ea, eb } = arpRun({ mode: 'split', arpR: 2, arpL: 0, speed: 110, notes: [40, 45, 49, 64, 67, 71], ms: 2500 });
    sameSeq(ea, eb, 40); // both sides step on the same edge: the second one waits for the first one's note-on
  });
});

// NeoV8 arpeggiator additions (no stock counterpart): octave range 2-4 (PF_ARP_OCT_R/L) and the as-played order
// (mode 6). Range 1 and modes 0-3 are covered by the parity tests above.
describe('NeoV8 arpeggiator: octave range and as-played order', () => {
  const BUILD_A = 'build-eng-arp';
  const ARP_OCT_R = 42;
  let A: Record<string, number> = {};
  beforeAll(() => { buildFirmware(BUILD_A, ['STUB_UI', 'STUB_TUNE']); A = neoSymbols(BUILD_A); }, 120_000);

  /** Sounding notes of the RIGHT side's arpeggio, in order (rising edges of vx_note bit 7). */
  function arp(o: { mode: number; range: number; notes: number[]; ms?: number; speed?: number }) {
    const progs = Array.from({ length: 8 }, (_, i) => randomProgram(900 + i));
    for (const p of progs) p[0x0a] = (p[0x0a] & 0x80) | 0; // glide time 0
    const ne = new MachineBackend('neo', loadNeoRomFrom(BUILD_A), bramWith(progs));
    ne.run(1500);
    for (const [off, v] of [[PF.KBMODE, 0], [PF.OCT_R, 1], [PF.UNISON, 0], [PF.ARP_ON, 1], [PF.ARP_MODE_R, o.mode],
      [PF.ARP_SPEED, o.speed ?? 110], [PF.ARP_RETRIG, 1], [ARP_OCT_R, o.range]] as [number, number][]) tp(ne, 5, v, off);
    tp(ne, 4);
    tp(ne, 1, 3, 0);
    ne.run(300);
    ne.machine.ram[A.lfo_rnd] = 0x37;
    for (const n of o.notes) { ne.key(n, true, 100); ne.run(20); }
    const out: number[] = [];
    const prev = Array(8).fill(0);
    for (let t = 0; t < (o.ms ?? 4000); t += 2) {
      ne.run(2);
      for (let v = 0; v < 8; v++) {
        const x = ne.machine.ram[A.vx_note + v];
        if ((x & 0x80) && !(prev[v] & 0x80)) out.push(x & 0x7f);
        prev[v] = x;
      }
    }
    expect(ne.machine.cpu.illegal).toBe(0);
    return out;
  }
  /** `seq` (after a warm-up) repeats `cycle`, starting anywhere in it. */
  function cycles(seq: number[], cycle: number[]) {
    const s = seq.slice(cycle.length); // the first steps may start while keys are still going down
    expect(s.length).toBeGreaterThan(cycle.length * 2);
    const k = cycle.indexOf(s[0]);
    expect(k, `${s.join(' ')} vs ${cycle.join(' ')}`).toBeGreaterThanOrEqual(0);
    expect(s, `cycle ${cycle.join(' ')}`).toEqual(s.map((_, i) => cycle[(k + i) % cycle.length]));
  }

  it('up, range 2: the held notes, then an octave higher', () => {
    cycles(arp({ mode: 2, range: 2, notes: [48, 52, 55] }), [48, 52, 55, 60, 64, 67]);
  });
  it('down, range 3: from the top octave down', () => {
    cycles(arp({ mode: 0, range: 3, notes: [48, 52, 55] }), [79, 76, 72, 67, 64, 60, 55, 52, 48]);
  });
  it('up/down, range 2: through both octaves, then back', () => {
    cycles(arp({ mode: 3, range: 2, notes: [48, 52, 55] }), [48, 52, 55, 60, 64, 67, 64, 60, 55, 52]);
  });
  it('range 4 stays at or below note 127 (an octave less up there)', () => {
    const s = arp({ mode: 2, range: 4, notes: [91, 96] }); // 96 + 36 = 132: plays 120
    expect(Math.max(...s)).toBeLessThanOrEqual(127);
    cycles(s, [91, 96, 103, 108, 115, 120, 127, 120]);
  });
  it('random, range 3: held notes in random octaves of the range', () => {
    const s = arp({ mode: 1, range: 3, notes: [50, 55, 59], ms: 6000 });
    const ok = new Set([50, 55, 59].flatMap((n) => [n, n + 12, n + 24]));
    expect(s.length).toBeGreaterThan(20);
    expect(s.every((n) => ok.has(n))).toBe(true);
    expect(new Set(s.map((n) => Math.floor((n - 50) / 12))).size).toBe(3);
  });
  it('as played: the order the keys went down, not their pitch', () => {
    cycles(arp({ mode: 6, range: 1, notes: [55, 48, 60, 52] }), [55, 48, 60, 52]);
  });
  it('as played, range 2', () => {
    cycles(arp({ mode: 6, range: 2, notes: [55, 48, 52] }), [55, 48, 52, 67, 60, 64]);
  });
});
