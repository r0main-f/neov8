// Autotune (firmware/src/tune.asm) on the VCO bank model (sim/src/machine/vco.ts), checked against the
// stock Rev4 autotune running on the same model. docs/autotune.md.
import { describe, it, expect, beforeAll } from 'vitest';
import { MachineBackend } from '../src/machine/backend';
import { attachVcoBank, VcoBank, REF_PERIOD, type VcoFault } from '../src/machine/vco';
import { segToChar } from '../src/font7';
import { buildFirmware, hasStock, loadNeoRomFrom, loadStockRom, neoSymbols, readCallLog } from './helpers';

const BUILD = 'build-tune';
const CAL = 0x0900; // api.inc
const BCAL = 0x1980; // BRAM_CAL - $4000
const TP_CMD = 0x0ff0, TP_DONE = 0x0ff4;
const LETTER: Record<number, string> = { 0xfa: 'A', 0x6e: 'b', 0xac: 'C', 0x5e: 'd' }; // 8279 glyphs (stock SEGFONT)

/** battery RAM with a plausible previous calibration (offset $30, trim mid, PW cal $F8) */
function seededBram(): Uint8Array {
  const b = new Uint8Array(0x2000);
  b[0x0fff] = 0xaa;
  for (let i = 0; i < 16; i++) { b[BCAL + i] = 0x30; b[BCAL + 0x20 + i] = 0x40; b[BCAL + 0x40 + i] = 0xf8; }
  return b;
}

interface Run {
  b: MachineBackend;
  vco: VcoBank;
  /** 96-byte table (stock layout) */
  table: Uint8Array;
  /** error letter per oscillator ('' = ok) */
  letters: string[];
  /** failed-voice mask */
  failed: number;
  seconds: number;
}

type Faults = Record<number, VcoFault>;

function runStock(seed: number, faults: Faults = {}, bram = seededBram()): Run {
  const b = new MachineBackend('stock', loadStockRom(), bram);
  const m = b.machine;
  const vco = attachVcoBank(m, { seed });
  for (const [i, f] of Object.entries(faults)) vco.osc[+i].fault = f;
  b.run(1500);
  b.button('autotune', true); b.run(5); b.button('autotune', false);
  const t0 = m.cpu.cycles;
  const letters = Array<string>(16).fill('');
  let lastSeg = m.kd.display[4];
  // poll every 0.5 ms: the stock moves to the next oscillator >= 2 ms after showing a letter
  for (let k = 0; k < 80000 && m.ram[0x047a] !== 0xff; k++) {
    b.run(0.5);
    const s = m.kd.display[4];
    if (s !== lastSeg && LETTER[s]) letters[m.ram[0x047a]] = LETTER[s]; // stock $C28D: letter -> display RAM 4
    lastSeg = s;
  }
  expect(m.ram[0x047a]).toBe(0xff); // last oscillator done
  const seconds = (m.cpu.cycles - t0) / 2e6;
  b.run(100); // $C14F: battery save, PTM restore
  return { b, vco, table: m.bram.slice(BCAL, BCAL + 0x60), letters, failed: m.ram[0xf3], seconds };
}

function bootNeo(seed: number, faults: Faults = {}, bram = seededBram()) {
  const b = new MachineBackend('neo', loadNeoRomFrom(BUILD), bram);
  const vco = attachVcoBank(b.machine, { seed });
  for (const [i, f] of Object.entries(faults)) vco.osc[+i].fault = f;
  b.run(300);
  return { b, vco };
}

function runNeo(seed: number, faults: Faults = {}, bram = seededBram(), protect = false): Run & { sym: Record<string, number> } {
  const { b, vco } = bootNeo(seed, faults, bram);
  const m = b.machine;
  const sym = neoSymbols(BUILD);
  b.setProtect(protect);
  const done = m.ram[TP_DONE];
  m.ram[TP_CMD] = 6;
  const t0 = m.cpu.cycles;
  for (let k = 0; k < 600 && m.ram[TP_DONE] === done; k++) b.run(100);
  expect(m.ram[TP_DONE]).toBe((done + 1) & 0xff);
  const seconds = (m.cpu.cycles - t0) / 2e6;
  const letters = [...m.ram.slice(sym.tune_res, sym.tune_res + 16)].map((c) => (c ? String.fromCharCode(c) : ''));
  return { b, vco, sym, table: m.ram.slice(CAL, CAL + 0x60), letters, failed: m.ram[CAL + 0x60], seconds };
}

const text = (b: MachineBackend) => b.frame().segments.map((s) => segToChar(s & 127)).join('');
const w16 = (t: Uint8Array, hi: number, lo: number, i: number) => (t[hi + i] << 8) | t[lo + i];

/** Pitch error (cents) of osc i at `k` semitones from the offset point, using the calibration table:
 *  pitch = (($2E + k) << 8) + ofs (+ $80 for VCO1, = detune centre), trim slot = trim table. */
function cents(vco: VcoBank, t: Uint8Array, i: number, k: number): number {
  const p16 = ((0x2e + k) << 8) + w16(t, 0x00, 0x10, i) + (i & 1 ? 0x80 : 0);
  const trim14 = (t[0x20 + i] << 7) | (t[0x30 + i] >> 1);
  const f = vco.freqAt(i, p16 >> 1, trim14);
  const want = (2e6 / REF_PERIOD) * Math.pow(2, k / 12);
  return 1200 * Math.log2(f / want);
}
/** duty cycle of osc i at the calibrated PW for program PW byte $40 (stock $DD66: PA = byte + cal) */
function duty(vco: VcoBank, t: Uint8Array, i: number): number {
  const pa = (0x40 + t[0x40 + i]) & 0xff; // carry -> valid when cal is negative (stock: else PA = 0)
  return vco.dutyAt(i, (pa << 7) | (t[0x50 + i] >> 1));
}

describe.skipIf(!hasStock)('autotune (tune.asm) on the VCO model', () => {
  beforeAll(() => buildFirmware(BUILD, ['STUB_ENG', 'STUB_UI', 'STUB_MIDI']), 60000);

  it('the stock autotune converges on the model (validates the model)', () => {
    for (const seed of [1, 7]) {
      const r = runStock(seed);
      expect(r.failed).toBe(0);
      expect(r.letters.join('')).toBe('');
      for (let i = 0; i < 16; i++) {
        for (const k of [-36, -24, 0, 24]) expect(Math.abs(cents(r.vco, r.table, i, k))).toBeLessThan(3);
        expect(Math.abs(duty(r.vco, r.table, i) - 0.5)).toBeLessThan(0.004);
      }
      expect(r.seconds).toBeGreaterThan(5);
      expect(r.seconds).toBeLessThan(40);
    }
  }, 120000);

  it('NeoV8 tunes all 16 oscillators: in tune over 5 octaves, progress display, hardware handed back', () => {
    const r = runNeo(1);
    const m = r.b.machine;
    expect(m.cpu.illegal).toBe(0);
    expect(r.failed).toBe(0);
    expect(r.letters.join('')).toBe('');
    for (let i = 0; i < 16; i++) {
      for (let k = -36; k <= 24; k += 6) expect(Math.abs(cents(r.vco, r.table, i, k))).toBeLessThan(2);
      expect(Math.abs(duty(r.vco, r.table, i) - 0.5)).toBeLessThan(0.004);
    }
    expect(r.seconds).toBeLessThan(30);
    // saved to battery RAM in the stock format, and RAM CAL = battery
    expect([...m.bram.slice(BCAL, BCAL + 0x60)]).toEqual([...r.table]);
    expect(text(r.b)).toBe('tU  oH'); // "tU  oK" (K and H share a glyph)
    // engine re-applies both programs; PTM / PIA / S&H back to the engine
    const log = readCallLog(m.ram).filter((e) => e.id === 0x11);
    expect(log.map((e) => e.x)).toEqual([0, 1]);
    expect(m.ptm.cr).toEqual([0x00, 0xc2, 0x02]); // main.s ptm_init: CR2 = $C3 then $C2 (selects CR3)
    expect(m.ptm.latch[1]).toBe(0x1000);
    expect(m.pia1.cra & 0x3f).toBe(0x34);
    expect(m.pia1.crb & 0x3f).toBe(0x36);
    const t0 = m.ram[r.sym.ticks];
    r.b.run(50);
    expect((m.ram[r.sym.ticks] - t0) & 0xff).toBeGreaterThan(20); // control tick running again
    for (let i = 0; i < 16; i++) {
      const s = 4 * i;
      expect(m.ram[r.sym.cv_pa + s]).toBe(r.table[0x20 + i]); // trim slots carry the new calibration
      expect(m.cv[s]).toBe((r.table[0x20 + i] << 7) | (r.table[0x30 + i] >> 1));
    }
  }, 60000);

  it('shows "tU v.o" progress, voice 1 VCO1 first', () => {
    const { b } = bootNeo(1);
    b.machine.ram[TP_CMD] = 6;
    b.run(100);
    expect(text(b)).toBe('tU11  ');
    expect(b.frame().segments[2] & 128).toBe(128); // DP after the voice digit
    b.run(1000);
    expect(text(b)).toBe('tU12  ');
  }, 30000);

  it('NeoV8 and stock calibration tables agree (same battery format)', () => {
    for (const seed of [1, 7]) {
      const s = runStock(seed), n = runNeo(seed);
      for (let i = 0; i < 16; i++) {
        expect(Math.abs(w16(s.table, 0x00, 0x10, i) - w16(n.table, 0x00, 0x10, i))).toBeLessThanOrEqual(8); // 1/256 semitone
        expect(Math.abs(w16(s.table, 0x20, 0x30, i) - w16(n.table, 0x20, 0x30, i))).toBeLessThanOrEqual(24);
        const pw = (t: Uint8Array) => (((t[0x40 + i] + 0x40) & 0xff) << 8) | t[0x50 + i];
        expect(Math.abs(pw(s.table) - pw(n.table))).toBeLessThanOrEqual(64);
      }
    }
  }, 120000);

  it('errors: dead -> A, unstable -> C, scale -> d, stuck pitch -> b, like the stock; voices disabled', () => {
    const faults: Faults = { 3: 'dead', 8: 'unstable', 11: 'noscale', 14: 'stuck' };
    const n = runNeo(3, faults);
    const s = runStock(3, faults);
    const want = Array<string>(16).fill('');
    want[3] = 'A'; want[8] = 'C'; want[11] = 'd'; want[14] = 'b';
    expect(n.letters).toEqual(want);
    expect(s.letters).toEqual(want);
    const mask = (1 << 1) | (1 << 4) | (1 << 5) | (1 << 7);
    expect(n.failed).toBe(mask);
    expect(s.failed).toBe(mask);
    expect(text(n.b)).toBe('Er21A '); // first failure in tuning order: voice 2 VCO1 (osc 3), dead
    // the healthy oscillators are still tuned
    for (const i of [0, 1, 2, 4, 5, 6, 7, 9, 10, 12, 13, 15]) expect(Math.abs(cents(n.vco, n.table, i, 0))).toBeLessThan(2);
    // osc 11 ('d') keeps mid-scale trim and a calibrated offset point
    expect(n.table[0x20 + 11]).toBe(0x40);
    expect(Math.abs(cents(n.vco, n.table, 11, 0))).toBeLessThan(2);
  }, 120000);

  it('memory protect: PrOtEC, battery tables untouched, the new calibration is used until power-off', () => {
    const bram = seededBram();
    const n = runNeo(1, {}, bram, true);
    const m = n.b.machine;
    expect(text(n.b)).toBe('Pr0tEC'); // "PrOtEC" (O and 0 share a glyph)
    expect([...m.bram.slice(BCAL, BCAL + 0x60)]).toEqual([...bram.slice(BCAL, BCAL + 0x60)]);
    for (let i = 0; i < 16; i++) expect(Math.abs(cents(n.vco, n.table, i, 0))).toBeLessThan(2);
  }, 60000);

  it('blank battery RAM: NeoV8 starts from nominal values and converges', () => {
    const bram = new Uint8Array(0x2000);
    bram[0x0fff] = 0xaa;
    const n = runNeo(5, {}, bram);
    expect(n.failed).toBe(0);
    for (let i = 0; i < 16; i++) expect(Math.abs(cents(n.vco, n.table, i, -24))).toBeLessThan(2);
  }, 60000);

  it('tune_restore at boot: battery tables -> CAL, trim slots; swapping ROMs keeps the calibration', () => {
    const s = runStock(7);
    const bram = s.b.machine.bram.slice();
    const { b } = bootNeo(7, {}, bram);
    const m = b.machine;
    const sym = neoSymbols(BUILD);
    expect([...m.ram.slice(CAL, CAL + 0x60)]).toEqual([...s.table]);
    expect(m.ram[CAL + 0x60]).toBe(0);
    for (let i = 0; i < 16; i++) {
      expect(m.ram[sym.cv_pa + 4 * i]).toBe(s.table[0x20 + i]);
      expect(m.ram[sym.cv_pb + 4 * i]).toBe(s.table[0x30 + i]);
      expect(m.cv[4 * i]).toBe((s.table[0x20 + i] << 7) | (s.table[0x30 + i] >> 1)); // refreshed by the tick
    }
  }, 60000);

  it('MIDI NMI keeps running during the tune', () => {
    const { b } = bootNeo(1);
    const m = b.machine;
    m.ram[TP_CMD] = 6;
    b.run(200);
    const n0 = m.nmiCount;
    b.midiIn([0x90, 60, 100, 0x80, 60, 0]);
    b.run(20);
    expect(m.nmiCount).toBeGreaterThan(n0);
    expect(m.ram[TP_DONE]).toBe(0); // still tuning
  }, 30000);
});
