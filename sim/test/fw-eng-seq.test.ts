// Engine parity, polysequencer (eng/seq.asm): both ROMs record the same performance played on the emulated
// VPK-5 (identical event memory: same 3-byte format), then play it back (voice pitch / envelope timelines
// compared with a time window), in every stock mode; plus the NeoV8 additions (MIDI clock, SysEx dump / load).
// The stock is driven with its sequencer page buttons, NeoV8 through the api.inc variables + test port 8-12.
import { describe, it, expect, beforeAll } from 'vitest';
import { MachineBackend } from '../src/machine/backend';
import { bramWith, recordPair, traceDiff, keyPairSync } from '../src/machine/parity';
import { loadStockRom, loadNeoRomFrom, buildFirmware, hasStock, neoSymbols, tp } from './helpers';
import type { ButtonId } from '../src/types';

const BUILD = 'build-eng-seq';
const PF = { KBMODE: 3, OCT_R: 6, OCT_L: 7 };
let S: Record<string, number> = {};

function press(b: MachineBackend, ...ids: ButtonId[]) {
  for (const id of ids) { b.button(id, true); b.run(30); b.button(id, false); b.run(50); }
}
const digits = (n: number) => [`k${Math.floor(n / 10)}`, `k${n % 10}`] as ButtonId[];

/** Null program (stock $F068) with a short envelope: notes are easy to see on the VCA envelopes. */
const NULLP = [0xAF, 0xAF, 0xAF, 0xAF, 0xFF, 0xFF, 0x00, 0x00, 0x00, 0x00, 0x80, 0x90, 0x80, 0xC8, 0xC8, 0xC0, 0xC0, 0xC0, 0x80, 0xFF, 0x80, 0x80, 0x00, 0x80, 0xFF, 0x80, 0x00, 0x80, 0xFF, 0x80, 0xF0, 0xFF, 0x80, 0xFF, 0xC0, 0x96, 0xFF, 0x00, 0xC0, 0xF8];
function prog() {
  const p = new Uint8Array(NULLP);
  const set = (b: number, v: number) => { p[b] = (p[b] & 0x80) | (v & 0x7f); };
  set(0x15, 20); set(0x16, 50); set(0x18, 100); set(0x17, 30); // ADSR2 fast
  set(0x0a, 0);
  return p;
}

/** Both machines booted, WHOLE 8 (or `mode`), program 1; the stock on its sequencer page. */
function pair(mode: 'whole' | 'split' | 'layer' = 'whole') {
  const bram = bramWith(Array.from({ length: 4 }, prog));
  const st = new MachineBackend('stock', loadStockRom(), bram);
  const ne = new MachineBackend('neo', loadNeoRomFrom(BUILD), bram);
  // Old empty takes in the stock's event RAM: its quantize pass ($A0ED) reads past the end marker of a take
  // ended by a group, up to the next thing that looks like an end marker (zeroed RAM: ~0.5 s, through I/O).
  for (const [from, to] of [[0x0c00, 0x15f8], [0x1600, 0x1ff8]]) for (let a = from; a + 2 < to; a += 3) st.machine.ram.set([0, 0x0f, 0], a);
  st.run(1500); ne.run(1500);
  tp(ne, 5, 0, PF.OCT_R); tp(ne, 5, 0, PF.OCT_L);
  const kb = mode === 'whole' ? 0 : mode === 'split' ? 1 : 2;
  press(st, mode === 'whole' ? 'kb_whole' : mode === 'split' ? 'kb_split' : 'kb_layer');
  tp(ne, 5, kb, PF.KBMODE); tp(ne, 4);
  press(st, 'call_r', ...digits(1)); tp(ne, 1, 1, 0);
  if (kb) { press(st, 'call_l', ...digits(2)); tp(ne, 1, 2, 1); }
  st.button('a440', true); press(st, 'arp_right'); st.button('a440', false); // sequencer page
  st.run(300); ne.run(300);
  return { st, ne };
}

// ---- NeoV8 side: contract variables
const v = (ne: MachineBackend, name: string) => {
  const a = S[name];
  if (a === undefined) throw new Error(`symbol ${name}`);
  return a;
};
const poke = (ne: MachineBackend, name: string, val: number, off = 0) => { ne.machine.ram[v(ne, name) + off] = val; };
const peek = (ne: MachineBackend, name: string, off = 0) => ne.machine.ram[v(ne, name) + off];
const startstop = (ne: MachineBackend) => tp(ne, 8);

/** Stock switch buttons (sequencer page, $93E7) and NeoV8 bits. */
const SW: Record<string, [ButtonId, string, number]> = {
  play1: ['reldef_l', 'seq_play', 1], play2: ['reldef_r', 'seq_play', 2],
  rec1: ['pbdef_l', 'seq_rec', 1], rec2: ['pbdef_r', 'seq_rec', 2],
  loop: ['hold_l', 'seq_loop', 1], lock: ['hold_r', 'seq_lock', 1], song: ['kb_whole', 'seq_song', 1],
};
function sw(st: MachineBackend, ne: MachineBackend, ...names: string[]) {
  for (const n of names) {
    const [btn, varName, bit] = SW[n];
    press(st, btn);
    poke(ne, varName, peek(ne, varName) ^ bit);
    ne.run(80); // (both machines stay on the same clock: T1 may already run for the metronome)
  }
}
/** Quantize index (0-9) on both. */
function quant(st: MachineBackend, ne: MachineBackend, q: number) {
  press(st, 'oct_l', `k${q}` as ButtonId);
  poke(ne, 'seq_quant', q);
  ne.run(160);
}
/** START/STOP on both at the same emulated time (stock button, NeoV8 test port 8), then 40 ms in lockstep. */
function startBoth(st: MachineBackend, ne: MachineBackend, ms = 40) { lockstep(st, ne, 'arp_pause', 8, ms); }
function lockstep(st: MachineBackend, ne: MachineBackend, btn: ButtonId, cmd: number, ms = 40, a = 0) {
  const TP = 0x0ff0, done = ne.machine.ram[TP + 4];
  st.button(btn, true); st.button(btn, false);
  ne.machine.ram[TP + 1] = a; ne.machine.ram[TP] = cmd;
  for (let t = 0; t < ms || ne.machine.ram[TP + 4] === done; t += 2) {
    st.run(2); ne.run(2);
    if (t > 200) throw new Error('test port command not executed');
  }
}

/** Events of a track: stock ch1 $0C00, ch2 $1600; NeoV8 ch1 seq_ev up, ch2 from the top down. */
function stockTrack(st: MachineBackend, ch: number) {
  const r = st.machine.ram, out: string[] = [];
  for (let a = ch ? 0x1600 : 0x0c00; a < 0x1ff8; a += 3) {
    out.push([r[a], r[a + 1], r[a + 2]].map((x) => x.toString(16).padStart(2, '0')).join(''));
    if (!(r[a] & 0x80) && (r[a + 1] & 0x0f) === 0x0f) break;
  }
  return out;
}
function neoTrack(ne: MachineBackend, ch: number) {
  const r = ne.machine.ram, out: string[] = [];
  const base = S.seq_ev, slots = (S.sq_chs !== undefined) ? 1140 : 1140;
  let a = ch ? base + (slots - 1) * 3 : base;
  for (let i = 0; i < slots; i++, a += ch ? -3 : 3) {
    out.push([r[a], r[a + 1], r[a + 2]].map((x) => x.toString(16).padStart(2, '0')).join(''));
    if (!(r[a] & 0x80) && (r[a + 1] & 0x0f) === 0x0f) break;
  }
  return out;
}

/** Same events; without quantize an event may land one clock earlier / later on one ROM (the two machines'
 *  control ticks have different phases against the clock events), and the first event (whose time is cut) too:
 *  times within `tol` clocks. */
function sameEvents(a: string[], b: string[], tol = 1) {
  if (a.length !== b.length) return [`${a.length} events vs ${b.length}`];
  const out: string[] = [];
  let ta = 0, tb = 0;
  const d = (e: string) => { const x = parseInt(e, 16); return ((x >> 18) & 0x10) << 8 | ((x >> 12) & 0xf) << 8 | (x & 0xff); };
  a.forEach((e, i) => {
    ta += d(e); tb += d(b[i]);
    if ((parseInt(e, 16) & 0xbf0f00) !== (parseInt(b[i], 16) & 0xbf0f00) || Math.abs(ta - tb) > tol) out.push(`#${i}: ${e} vs ${b[i]}`);
  });
  return out;
}

/** Key events at ms offsets, each placed just before both machines' VPK-5 scans. */
type Ev = [number, number, boolean, number?];
function keyEvents(st: MachineBackend, ne: MachineBackend, list: Ev[], ev = new Map<number, () => void>(), dt = 2) {
  for (const [ms, n, d, vel] of list) {
    const i = Math.round(ms / dt);
    const prev = ev.get(i);
    ev.set(i, () => { prev?.(); keyPairSync(st, ne, n, d, vel ?? 127, 0xb053, S.vx_tick); });
  }
  return ev;
}
function play(st: MachineBackend, ne: MachineBackend, list: Ev[], ms: number) {
  recordPair(st, ne, Math.round(ms / 2), 2, keyEvents(st, ne, list));
}

// A performance: chords and single notes away from 16th-note grid boundaries at 118 BPM (126 ms grid; a key-down
// registers when its second contact closes: velocity 64 about 43 ms after the press, velocity 1 about 84 ms).
const PERF: Ev[] = [
  [100, 60, true, 64], [160, 64, true, 64], [170, 67, true, 64], [440, 60, false], [450, 64, false], [460, 67, false],
  [560, 72, true, 1], [700, 72, false], [820, 48, true, 64], [830, 55, true, 64], [1330, 48, false], [1340, 55, false],
  [1450, 62, true, 64], [1460, 65, true, 64], [1470, 69, true, 64], [1950, 62, false], [1960, 65, false], [1970, 69, false],
];

const VOICE_SLOTS = Array.from({ length: 8 }, (_, i) => [8 * i + 3, 8 * i + 7]).flat();
const ENV_SLOTS = Array.from({ length: 8 }, (_, i) => 0x68 + i);

/** A take on both machines: START, the keys, STOP; then a pause (the stock's quantize pass runs in its main loop). */
function take(st: MachineBackend, ne: MachineBackend, perf: Ev[], ms: number) {
  startBoth(st, ne);
  play(st, ne, perf, ms);
  startBoth(st, ne);
  st.run(300); ne.run(300);
}
/** Playback timelines (pitch of every voice, VCA envelopes) for `ms` from now. */
/** `win`: samples (2 ms) each side in which a NeoV8 voice key must match a stock one (default 10 ms). */
function sameSound(st: MachineBackend, ne: MachineBackend, ms: number, ev?: Map<number, () => void>, env = true, win = 5) {
  const n = Math.round(ms / 2);
  const ka: number[][] = [], kb: number[][] = [];
  const evk = new Map<number, () => void>();
  for (let i = 0; i < n; i++) evk.set(i, () => { ev?.get(i)?.(); ka.push([...st.machine.ram.slice(0x318, 0x320)]); kb.push([...ne.machine.ram.slice(S.vx_key, S.vx_key + 8)]); });
  const { a, b } = recordPair(st, ne, n, 2, evk);
  // voice keys (note | key down), per voice: every NeoV8 value is a stock value of that voice within 10 ms
  const kd: string[] = [];
  for (let v = 0; v < 8; v++) {
    for (let i = win; i < n - win && kd.length < 3; i++) {
      if (!ka.slice(i - win, i + win + 1).some((k) => k[v] === kb[i][v])) kd.push(`voice ${v} key @${i * 2} ms: neo ${kb[i][v].toString(16)}, stock ${ka[i][v].toString(16)}`);
    }
  }
  return [...kd, ...traceDiff(a, b, VOICE_SLOTS, 10, 0.002), ...(env ? traceDiff(a, b, ENV_SLOTS, 10, 0.004, 'range') : [])];
}
const shift = (list: Ev[], dt: number): Ev[] => list.map(([t, n, d, v]) => [t + dt, n, d, v]);
const PERF2: Ev[] = [
  [130, 76, true, 64], [600, 76, false], [630, 74, true, 1], [640, 79, true, 1], [1100, 74, false], [1120, 79, false],
];

describe.skipIf(!hasStock)('polysequencer', () => {
  beforeAll(() => { buildFirmware(BUILD, ['STOCK_TABLES', 'STUB_UI', 'STUB_TUNE']); S = neoSymbols(BUILD); });

  it('records channel 1 like the stock (quantize 16th) and plays it back', () => {
    const { st, ne } = pair();
    quant(st, ne, 5);
    sw(st, ne, 'rec1');
    startBoth(st, ne);
    play(st, ne, PERF, 2200);
    startBoth(st, ne);
    st.run(200); ne.run(200);
    const a = stockTrack(st, 0), b = neoTrack(ne, 0);
    expect(b).toEqual(a);
    expect(peek(ne, 'seq_rec')).toBe(0); // REC off after the take (stock)
    expect(peek(ne, 'seq_len')).toBe(a.length - 1);
    // playback
    sw(st, ne, 'play1');
    startBoth(st, ne);
    const { a: ta, b: tb } = recordPair(st, ne, 1400, 2);
    expect(traceDiff(ta, tb, VOICE_SLOTS, 10, 0.002)).toEqual([]);
    expect(traceDiff(ta, tb, ENV_SLOTS, 10, 0.004, 'range')).toEqual([]);
  });

  it('channel 2 (stored downwards), no quantize: same events, same playback', () => {
    const { st, ne } = pair();
    quant(st, ne, 0);
    sw(st, ne, 'rec2');
    take(st, ne, PERF, 2200);
    expect(sameEvents(stockTrack(st, 1), neoTrack(ne, 1), 2)).toEqual([]);
    expect(peek(ne, 'seq_len', 2)).toBe(PERF.length);
    sw(st, ne, 'play2');
    startBoth(st, ne);
    // the two takes may differ by 2 clocks (10.6 ms at 118 BPM, no quantize), so their playbacks by as much
    expect(sameSound(st, ne, 2200, undefined, true, 7)).toEqual([]);
  });

  it('instant record with the metronome: start on the beat, nothing cut, same clicks (PIA2 CB2)', () => {
    const { st, ne } = pair();
    quant(st, ne, 3);
    // metronome on (stock EDIT, NeoV8 seq_metro) at the same time: T1 starts for the clicks
    st.button('edit', true); poke(ne, 'seq_metro', 1);
    for (let t = 0; t < 40; t += 2) { st.run(2); ne.run(2); }
    const cb2: [number[], number[]] = [[], []]; // clicks: PIA2 CB2 rising edges (the arp clock no longer drives it)
    [st, ne].forEach((m, k) => { m.machine.pia2.onCb2 = (l) => { if (l) cb2[k].push(m.machine.cpu.cycles); }; });
    press(st, 'arp_down'); poke(ne, 'seq_inst', 1); ne.run(80);
    sw(st, ne, 'rec1');
    const c0 = [st.machine.cpu.cycles, ne.machine.cpu.cycles];
    startBoth(st, ne, 20);
    expect(peek(ne, 'seq_mode') & 4).toBe(4); // waits for the beat
    play(st, ne, shift(PERF, 600), 2900);
    startBoth(st, ne);
    st.run(300); ne.run(300);
    const a = stockTrack(st, 0), b = neoTrack(ne, 0);
    expect(b[0]).toBe(a[0]); // first event: the time from the beat (nothing cut)
    expect(sameEvents(a, b, 12)).toEqual([]); // (an event on a grid boundary may round the other way)
    const rel = cb2.map((l, k) => l.filter((c) => c > c0[k]).map((c) => c - c0[k]));
    const n = Math.min(rel[0].length, rel[1].length);
    expect(n).toBeGreaterThan(5);
    for (let i = 0; i < n; i++) expect(Math.abs(rel[0][i] - rel[1][i]), `click ${i}`).toBeLessThan(2 * 4097); // (T1 started by each main loop: phases ~2 ms apart)
  });

  it('REC + PLAY on one channel: the take plays back at STOP; LOOP + STOP stops at the end of the loop', () => {
    const { st, ne } = pair();
    quant(st, ne, 5);
    sw(st, ne, 'rec1', 'play1', 'loop');
    startBoth(st, ne);
    play(st, ne, PERF, 2200);
    startBoth(st, ne, 2); // STOP: plays the take now (REC off)
    expect(sameSound(st, ne, 3000)).toEqual([]);
    expect(peek(ne, 'seq_rec')).toBe(0);
    expect(peek(ne, 'seq_run')).not.toBe(0);
    startBoth(st, ne, 2); // STOP while looping: at the end of the loop
    expect(peek(ne, 'seq_run')).not.toBe(0);
    expect(sameSound(st, ne, 2500)).toEqual([]);
    expect(peek(ne, 'seq_run')).toBe(0);
    expect(st.machine.ram[0x9c9]).toBe(0);
  });

  it('overdub: PLAY 1 + REC 2 merges channel 1 into the take; PLAY 1 goes off at its end', () => {
    const { st, ne } = pair();
    quant(st, ne, 5);
    sw(st, ne, 'rec1');
    take(st, ne, PERF, 2200);
    sw(st, ne, 'play1', 'rec2');
    startBoth(st, ne, 2);
    const ev = keyEvents(st, ne, PERF2);
    expect(sameSound(st, ne, 3200, ev)).toEqual([]);
    expect(peek(ne, 'seq_play')).toBe(st.machine.ram[0x8d2] ? 1 : 0);
    startBoth(st, ne);
    st.run(300); ne.run(300);
    expect(neoTrack(ne, 1)).toEqual(stockTrack(st, 1));
    expect(neoTrack(ne, 0)).toEqual(stockTrack(st, 0));
  });

  it('continuous overdub (LOCK): the channels bounce at each end; STOP turns LOCK into LOOP, STOP again stops', () => {
    const { st, ne } = pair();
    quant(st, ne, 5);
    sw(st, ne, 'rec1');
    take(st, ne, PERF.slice(0, 6), 900);
    sw(st, ne, 'play1', 'rec2', 'lock');
    startBoth(st, ne, 2);
    // (envelopes not compared here: the bounces make 20 ms notes, released during their attack - the envelopes'
    // 6 ms update phase differs between the ROMs, eng/ENGINE.md "Parity"; the key events are compared instead)
    const ev = keyEvents(st, ne, [...PERF2.slice(0, 2), ...shift(PERF2.slice(0, 2), 1700)]);
    expect(sameSound(st, ne, 4000, ev, false)).toEqual([]);
    const swState = (m: Uint8Array) => [m[0x8d2] ? 1 : 0, m[0x8d3] ? 2 : 0, m[0x8d4] ? 1 : 0, m[0x8d5] ? 2 : 0];
    const s1 = swState(st.machine.ram);
    expect([peek(ne, 'seq_play'), peek(ne, 'seq_rec')]).toEqual([s1[0] | s1[1], s1[2] | s1[3]]);
    const p0 = peek(ne, 'seq_play'); // STOP mid-pass, not on a bounce point: 300 ms after the next bounce
    for (let t = 0; t < 3000 && peek(ne, 'seq_play') === p0; t += 2) { st.run(2); ne.run(2); }
    st.run(300); ne.run(300);
    startBoth(st, ne, 2); // STOP: LOCK off, LOOP on (stock)
    expect([peek(ne, 'seq_lock'), peek(ne, 'seq_loop') ? 1 : 0]).toEqual([0, 1]);
    expect(sameSound(st, ne, 1500)).toEqual([]);
    expect(st.machine.ram[0x8d7]).toBe(0);
    startBoth(st, ne);
    st.run(300); ne.run(300);
    expect(neoTrack(ne, 0)).toEqual(stockTrack(st, 0));
    expect(neoTrack(ne, 1)).toEqual(stockTrack(st, 1));
  });

  it('song: channel 1 twice, channel 2 once, then stop', () => {
    const { st, ne } = pair();
    quant(st, ne, 5);
    sw(st, ne, 'rec1');
    take(st, ne, PERF.slice(0, 6), 900);
    sw(st, ne, 'rec2');
    take(st, ne, PERF2, 1300);
    press(st, 'kb_split', 'k0', 'k2', 'k0', 'k1', 'kb_split'); // song page: repeats 02 / 01
    poke(ne, 'seq_reps', 2); poke(ne, 'seq_reps', 1, 1); ne.run(480);
    sw(st, ne, 'song', 'play1');
    startBoth(st, ne, 2);
    expect(peek(ne, 'seq_mode') & 8).toBe(8);
    expect(sameSound(st, ne, 3800)).toEqual([]);
    expect(peek(ne, 'seq_run')).toBe(0);
    expect(st.machine.ram[0x9c9]).toBe(0);
    expect(peek(ne, 'seq_play')).toBe((st.machine.ram[0x8d2] ? 1 : 0) | (st.machine.ram[0x8d3] ? 2 : 0));
  });

  it('double channel (REC 1 + REC 2): one take over the whole memory, played by PLAY 1', () => {
    const { st, ne } = pair();
    quant(st, ne, 5);
    sw(st, ne, 'rec1', 'rec2');
    expect(peek(ne, 'seq_free') + 256 * peek(ne, 'seq_free', 1)).toBeGreaterThan(1000);
    take(st, ne, PERF, 2200);
    expect(neoTrack(ne, 0)).toEqual(stockTrack(st, 0));
    expect(peek(ne, 'seq_len', 2)).toBe(0);
    sw(st, ne, 'play1');
    startBoth(st, ne, 2);
    expect(sameSound(st, ne, 2200)).toEqual([]);
  });

  it('external clock SEQ CK IN at 48 ppqn (PIA2 CA1): same take, same playback', () => {
    const { st, ne } = pair();
    quant(st, ne, 0);
    press(st, 'arp_up', 'uni_l'); poke(ne, 'seq_clk', 1); poke(ne, 'seq_extrate', 1); ne.run(160);
    sw(st, ne, 'rec1');
    const pulses = (from: number, ms: number) => { // 48 ppqn at 125 BPM: every 10 ms
      const ev = new Map<number, () => void>();
      for (let t = from; t < ms; t += 10) ev.set(t / 2, () => { st.machine.pia2.ca1(); ne.machine.pia2.ca1(); });
      return ev;
    };
    startBoth(st, ne);
    recordPair(st, ne, 1100, 2, keyEvents(st, ne, PERF, pulses(0, 2200)));
    startBoth(st, ne);
    st.run(300); ne.run(300);
    const a = stockTrack(st, 0);
    expect(sameEvents(a, neoTrack(ne, 0), 4)).toEqual([]); // (one pulse = 2 clocks)
    // playback of the same data (the stock's take copied into NeoV8)
    a.forEach((e, i) => ne.machine.ram.set([parseInt(e.slice(0, 2), 16), parseInt(e.slice(2, 4), 16), parseInt(e.slice(4), 16)], S.seq_ev + 3 * i));
    sw(st, ne, 'play1');
    startBoth(st, ne); // (both have handled START before the first pulse)
    expect(sameSound(st, ne, 2200, pulses(0, 2200))).toEqual([]);
  });

  it('tempo: the T1 period of every tempo 20-255 is the stock one', () => {
    const { st, ne } = pair();
    for (const bpm of [20, 47, 77, 78, 119, 120, 121, 200, 251, 255]) {
      press(st, 'oct_r', `k${Math.floor(bpm / 100)}` as ButtonId, `k${Math.floor(bpm / 10) % 10}` as ButtonId, `k${bpm % 10}` as ButtonId);
      tp(ne, 10, bpm);
      expect(ne.machine.ptm.latch[0], `${bpm} BPM`).toBe(st.machine.ptm.latch[0]);
    }
  });

  it('Stevenson (PLAY + REC + LOOP + LOCK on one channel): take, loop, STOP = a new take at the loop end', () => {
    const { st, ne } = pair();
    quant(st, ne, 5);
    sw(st, ne, 'rec1', 'play1', 'loop', 'lock');
    startBoth(st, ne);
    play(st, ne, PERF.slice(0, 6), 900);
    startBoth(st, ne, 2); // the take loops
    expect(sameSound(st, ne, 1600)).toEqual([]);
    startBoth(st, ne, 2); // a new take starts at the end of the loop
    expect(sameSound(st, ne, 1600, keyEvents(st, ne, PERF2.slice(0, 2)))).toEqual([]);
    expect(peek(ne, 'seq_mode') & 2).toBe(2);
    expect(st.machine.ram[0x9d6]).toBe(0xff);
    startBoth(st, ne);
    st.run(300); ne.run(300);
    expect(neoTrack(ne, 0)).toEqual(stockTrack(st, 0));
  });
});

// ------------------------------------------------------------------ NeoV8 only
function neo() {
  const ne = new MachineBackend('neo', loadNeoRomFrom(BUILD), bramWith(Array.from({ length: 4 }, prog)));
  ne.run(1500);
  tp(ne, 5, 0, PF.KBMODE); tp(ne, 4); tp(ne, 1, 1, 0);
  ne.machine.bram[0x1a80 + 3] |= 0x08; // NV_GLOBALS G_RX: SysEx on
  ne.run(100);
  return ne;
}
const keysDown = (ne: MachineBackend) => [...ne.machine.ram.slice(S.vx_key, S.vx_key + 8)].filter((k) => k & 0x80).map((k) => k & 0x7f).sort();

describe('polysequencer, NeoV8 additions', () => {
  beforeAll(() => { if (!S.seq_ev) { buildFirmware(BUILD, ['STOCK_TABLES', 'STUB_UI', 'STUB_TUNE']); S = neoSymbols(BUILD); } });

  it('start checks: nothing selected, nothing to play, song needs both channels, song with REC, memory full', () => {
    const ne = neo();
    const st = (bits: [string, number][]) => {
      for (const n of ['seq_play', 'seq_rec', 'seq_loop', 'seq_lock', 'seq_song']) poke(ne, n, 0);
      for (const [n, x] of bits) poke(ne, n, x);
      startstop(ne);
      const r = peek(ne, 'seq_status');
      if (peek(ne, 'seq_run')) startstop(ne);
      ne.run(50);
      return r;
    };
    expect(st([])).toBe(2);
    expect(st([['seq_play', 1]])).toBe(1);
    expect(st([['seq_rec', 1], ['seq_lock', 1], ['seq_loop', 1]])).toBe(2); // LOCK + LOOP: REC = PLAY channel
    expect(st([['seq_rec', 3], ['seq_play', 1]])).toBe(2);
    expect(st([['seq_rec', 1]])).toBe(0); // (an empty take: 0 events)
    poke(ne, 'seq_rec', 1); startstop(ne); ne.key(60, true, 64); ne.run(150); ne.key(60, false, 0); ne.run(150); startstop(ne);
    expect(peek(ne, 'seq_len')).toBe(2);
    expect(st([['seq_play', 1]])).toBe(0);
    expect(st([['seq_play', 1], ['seq_song', 1]])).toBe(3);
    expect(st([['seq_play', 1], ['seq_rec', 2], ['seq_song', 1]])).toBe(4);
    // channel 1 holds 1138 - 10 events: channel 2 has room for 10
    poke(ne, 'seq_len', (1138 - 10) & 0xff); poke(ne, 'seq_len', (1138 - 10) >> 8, 1);
    expect(st([['seq_rec', 2]])).toBe(0);
    expect(peek(ne, 'seq_free') + 256 * peek(ne, 'seq_free', 1)).toBe(10);
    poke(ne, 'seq_len', 1138 & 0xff); poke(ne, 'seq_len', 1138 >> 8, 1);
    expect(st([['seq_rec', 2]])).toBe(5);
  });

  it('MIDI clock: 24 ppqn drives the sequencer (4 clocks each); start / stop / continue', () => {
    const ne = neo();
    poke(ne, 'seq_clk', 2); poke(ne, 'seq_rec', 1);
    const clocks = (n: number, ms = 20) => { for (let i = 0; i < n; i++) { ne.midiIn([0xf8]); ne.run(ms); } };
    ne.midiIn([0xfa]); ne.run(20); // Start
    expect(peek(ne, 'seq_run')).not.toBe(0);
    clocks(5);
    ne.key(60, true, 1); clocks(30); // (velocity 1: the key registers ~84 ms later)
    ne.key(64, true, 64); clocks(10);
    ne.key(60, false, 0); ne.key(64, false, 0); clocks(10);
    ne.midiIn([0xfc]); ne.run(30); // Stop
    expect(peek(ne, 'seq_run')).toBe(0);
    const t = neoTrack(ne, 0);
    const delta = (e: string) => { const x = parseInt(e, 16); return ((x >> 18) & 0x10) << 8 | ((x >> 12) & 0xf) << 8 | (x & 0xff); };
    expect(t.length).toBe(5);
    expect(delta(t[0])).toBe(0); // (not instant: the time before the first key is dropped)
    expect(Math.abs(delta(t[1]) - (30 * 4 - 16))).toBeLessThanOrEqual(8); // 64 down ~26 MIDI clocks after 60 down
    expect(delta(t[1]) % 4).toBe(0);
    // playback: nothing moves without clocks; Continue = start from the beginning
    poke(ne, 'seq_play', 1);
    ne.midiIn([0xfb]); ne.run(50);
    expect(peek(ne, 'seq_run')).not.toBe(0);
    ne.run(500);
    expect(keysDown(ne)).toEqual([]);
    clocks(1); ne.run(20);
    expect(keysDown(ne)).toEqual([60]);
    clocks(Math.floor(delta(t[1]) / 4) - 1); ne.run(20);
    expect(keysDown(ne)).toEqual([60]);
    clocks(1); ne.run(20);
    expect(keysDown(ne)).toEqual([60, 64]);
    ne.midiIn([0xfc]); ne.run(50);
    expect(peek(ne, 'seq_run')).toBe(0);
    expect(keysDown(ne)).toEqual([]); // the sequence's keys go up at stop
    // the arpeggiator clock still sees MIDI start (its own flag)
    expect(ne.machine.ram[S.midi_rtflags] & 1).toBe(1);
  });

  it('SysEx dump of the sequence data, loaded into another NeoV8: same tracks, same lengths', () => {
    const a = neo();
    poke(a, 'seq_quant', 5);
    for (const [ch, keys] of [[1, [60, 64, 67]], [2, [50, 53]]] as [number, number[]][]) {
      poke(a, 'seq_rec', ch); startstop(a);
      for (const k of keys) { a.key(k, true, 64); a.run(170); }
      for (const k of keys) { a.key(k, false, 0); a.run(130); }
      startstop(a); a.run(100);
    }
    a.drainMidiOut();
    tp(a, 12);
    a.run(3500);
    const out = a.drainMidiOut();
    expect(out.length).toBe(76 * 95 + 4); // F0 03 24 bb <90 nibbles> F7, then F0 03 25 F7
    expect(out.slice(0, 4)).toEqual([0xf0, 0x03, 0x24, 0x00]);
    expect(out.slice(-4)).toEqual([0xf0, 0x03, 0x25, 0xf7]);
    const b = neo();
    b.machine.ram[S.midi_rxall] = 1;
    b.midiIn(out);
    b.run(3500);
    for (const ch of [0, 1]) expect(neoTrack(b, ch)).toEqual(neoTrack(a, ch));
    expect([...b.machine.ram.slice(S.seq_len, S.seq_len + 4)]).toEqual([...a.machine.ram.slice(S.seq_len, S.seq_len + 4)]);
    expect(peek(b, 'seq_len')).toBe(6);
    expect(peek(b, 'seq_len', 2)).toBe(4);
  });

  it('every T1 underflow becomes one clock event, also with keys played during a long take', () => {
    const ne = neo();
    const ptm = ne.machine.ptm as any;
    let under = 0;
    const orig = ptm.count.bind(ptm);
    ptm.count = (t: number, cycles: number) => {
      if (t === 0 && cycles > 0 && !(ptm.cr[0] & 4)) {
        const c = ptm.counter[0] - cycles;
        if (c < 0) under += Math.floor((-c - 1) / (ptm.latch[0] + 1)) + 1;
      }
      orig(t, cycles);
    };
    let clocks = 0;
    ne.machine.cpu.onStep = (pc: number) => { if (pc === S.seq_clock) clocks++; };
    poke(ne, 'seq_rec', 2); poke(ne, 'seq_inst', 1); startstop(ne);
    const u0 = under, c0 = clocks;
    for (let i = 0; i < 40; i++) { ne.key(48 + (i % 12), true, 30 + (i * 7) % 90); ne.run(37); ne.key(48 + (i % 12), false, 0); ne.run(18); }
    expect(under - u0).toBeGreaterThan(400);
    expect(clocks - c0 + peek(ne, 'seq_cpend')).toBe(under - u0);
  });

  it('a loaded track of zero length does not hang the IRQ: the sequencer stops', () => {
    const ne = neo();
    const ev = S.seq_ev;
    ne.machine.ram.set([0xa4, 0x0d, 0x00, 0x24, 0x00, 0x00, 0x00, 0x0f, 0x00], ev); // all deltas 0
    ne.machine.ram[S.seq_len] = 2;
    poke(ne, 'seq_play', 1); poke(ne, 'seq_loop', 1);
    startstop(ne);
    ne.run(200);
    expect(peek(ne, 'seq_run')).toBe(0);
    tp(ne, 5, 0, PF.OCT_R); // the main loop still runs
  });

  it('autotune puts the sequencer timer back (main.s autotune -> seq_retune)', () => {
    const ne = neo();
    poke(ne, 'seq_metro', 1); ne.run(50);
    expect(ne.machine.ptm.cr[0]).toBe(0x42);
    const latch = ne.machine.ptm.latch[0];
    ne.machine.ptm.cr[0] = 0x92; ne.machine.ptm.latch[0] = 0xffff; // what the tuner leaves (the bench's tune is a stub)
    tp(ne, 6);
    expect(ne.machine.ptm.cr[0]).toBe(0x42);
    expect(ne.machine.ptm.latch[0]).toBe(latch);
  });

  it('IRQ cost: clock event + control tick with 8-note chords playing', () => {
    const ne = neo();
    poke(ne, 'seq_rec', 1); poke(ne, 'seq_inst', 1); startstop(ne);
    const notes = [48, 52, 55, 59, 62, 65, 69, 72];
    for (let r = 0; r < 4; r++) {
      for (const n of notes) ne.key(n + r, true, 127);
      ne.run(120);
      for (const n of notes) ne.key(n + r, false, 0);
      ne.run(120);
    }
    startstop(ne); ne.run(100);
    poke(ne, 'seq_rec', 0); poke(ne, 'seq_play', 1); poke(ne, 'seq_loop', 1);
    tp(ne, 10, 251); // fastest tempo
    startstop(ne);
    ne.run(200);
    const m = ne.machine, cpu = m.cpu;
    const clk: number[] = [], all: number[] = [], pend: number[] = [];
    let t0 = 0, ret = -1, sp = 0, r0 = 0, rret = -1, rsp = 0;
    cpu.onStep = (pc: number) => {
      if (ret >= 0 && pc === ret && cpu.s === ((sp + 2) & 0xff)) { clk.push(cpu.cycles - t0); ret = -1; }
      if (rret >= 0 && pc === rret && cpu.s === ((rsp + 2) & 0xff)) { all.push(cpu.cycles - r0); rret = -1; }
      if (pc === S.seq_clock && ret < 0) { t0 = cpu.cycles; sp = cpu.s; ret = ((m.read(0x100 + ((sp + 2) & 0xff)) << 8) | m.read(0x100 + ((sp + 1) & 0xff))) + 1; }
      if (pc === S.run_ticks && rret < 0) { pend.push(m.ram[S.tickPend] + 100 * m.ram[S.seq_cpend]); r0 = cpu.cycles; rsp = cpu.s; rret = ((m.read(0x100 + ((rsp + 2) & 0xff)) << 8) | m.read(0x100 + ((rsp + 1) & 0xff))) + 1; }
    };
    ne.run(1500);
    cpu.onStep = undefined;
    const max = (a: number[]) => Math.max(...a);
    const avg = (a: number[]) => Math.round(a.reduce((x, y) => x + y, 0) / a.length);
    console.log(`seq clock event (8-note chords, loop end): avg ${avg(clk)} max ${max(clk)} cycles; one IRQ's work (clock events + ticks, incl. catch-up): avg ${avg(all)} max ${max(all)}; pending at entry max ${max(pend)}`);
    expect(peek(ne, 'seq_run')).not.toBe(0);
    // (the IRQ work also catches up ticks deferred while the main loop holds the DAC for 8 note-ons: voice module)
    expect(max(clk)).toBeLessThan(3000);
  });
});







