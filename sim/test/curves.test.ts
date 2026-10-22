// NeoV8's own response curves (tools/gen-curves.mjs) vs the stock tables of your ROM dump, and a check that the
// default NeoV8 ROM carries no stock table data (so it can be shared). Parity tests build with STOCK_TABLES.
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CURVES } from '../../tools/gen-curves.mjs';
import { TABLES } from '../../tools/extract-tables.mjs';
import { ROOT, hasStock, loadStockRom, buildFirmware, loadNeoRomFrom } from './helpers';

const BUILD = 'build-curves';
const ours = Object.fromEntries((CURVES as [string, number[], string][]).map(([l, d]) => [l, d]));
let stock: Record<string, number[]> = {};
let neo: Uint8Array;

beforeAll(() => {
  buildFirmware(BUILD);
  neo = loadNeoRomFrom(BUILD);
  if (hasStock) {
    const rom = loadStockRom();
    stock = Object.fromEntries((TABLES as [string, number, number][]).map(([l, a, n]) => [l, [...rom.subarray(a - 0x8000, a - 0x8000 + n)]]));
  }
}, 120_000);

const env16 = (t: Record<string, number[]>) => Array.from({ length: 1024 }, (_, x) => t[`tb_env_pa${x & 3}`][x >> 2] * 256 + t[`tb_env_pb${x & 3}`][x >> 2]);
const adsr = (t: Record<string, number[]>) => t.tb_adsr_rate_hi.map((h, i) => h * 256 + t.tb_adsr_rate_lo[i]);

describe('NeoV8 response curves', () => {
  it('every table has the stock size and shape constraints (monotonic where the law is)', () => {
    for (const [l, , n] of TABLES as [string, number, number][]) expect(ours[l]?.length, l).toBe(n);
    const e = env16(ours);
    for (let x = 1; x < 1024; x++) expect(e[x]).toBeGreaterThanOrEqual(e[x - 1]);
    expect(e[1023]).toBe(32760);
    const a = adsr(ours);
    for (let i = 1; i < 128; i++) expect(a[i]).toBeGreaterThanOrEqual(a[i - 1]);
    for (const l of ['tb_env_inv', 'tb_param_curve', 'tb_vel_vca', 'tb_vel_mod', 'tb_vel_att'])
      for (let i = 1; i < ours[l].length; i++) expect(ours[l][i], `${l}[${i}]`).toBeGreaterThanOrEqual(ours[l][i - 1]);
    for (let k = 0; k < 3; k++) for (let s = 1; s < 32; s++) expect(ours.tb_taper_fact[32 * k + s]).toBeLessThanOrEqual(ours.tb_taper_fact[32 * k + s - 1]);
  });

  // Formula tables (envelope law, inverse/parameter curves, tempo) are the same mathematics as the stock, so they
  // share many bytes with it by construction; the hand-shaped stock tables must not appear at all.
  it('the default ROM holds none of the hand-shaped stock tables (no 32-byte stretch of them)', () => {
    if (!hasStock) return;
    const hay = Buffer.from(neo);
    // (ADSR rates: the low bytes; the high bytes of an accurate fit are the same coarse steps)
    const designed = ['tb_adsr_rate_lo', 'tb_taper_fact', 'tb_vel_vca', 'tb_vel_mod', 'tb_vel_att'];
    for (const [l, d] of Object.entries(stock).filter(([l]) => designed.includes(l))) {
      for (let i = 0; i + 32 <= d.length; i += 4) {
        const w = d.slice(i, i + 32);
        if (new Set(w).size < 8) continue; // runs of 0 / $FF / a few values occur anywhere
        expect(hay.indexOf(Buffer.from(w)), `${l} bytes ${i}-${i + 31} found in the NeoV8 ROM`).toBe(-1);
      }
    }
  });
});

describe.skipIf(!hasStock)('NeoV8 curves vs the stock tables (how close they are)', () => {
  it('envelope level law: within one 14-bit DAC step', () => {
    const a = env16(ours), b = env16(stock);
    expect(Math.max(...a.map((v, x) => Math.abs(v - b[x])))).toBeLessThanOrEqual(4);
  });
  it('inverse level curve and parameter curve: within 1', () => {
    for (const l of ['tb_env_inv', 'tb_param_curve']) expect(Math.max(...ours[l].map((v, i) => Math.abs(v - stock[l][i]))), l).toBeLessThanOrEqual(1);
  });
  it('ADSR rates: within 1 % over the main range (times 66-112), within 35 % anywhere', () => {
    const a = adsr(ours), b = adsr(stock);
    const rel = (i: number) => Math.abs(a[i] - b[i]) / Math.max(1, b[i]);
    for (let i = 66; i <= 112; i++) expect(rel(i), `rate ${i}`).toBeLessThan(0.01);
    for (let i = 0; i < 128; i++) expect(rel(i), `rate ${i}`).toBeLessThan(0.35);
    expect(a.slice(123)).toEqual(b.slice(123)); // saturated
  });
  it('tempo: the same timer values; at most 6 settable tempos moved by 1 BPM', () => {
    const vals = (t: number[]) => t.filter((v) => v !== 255);
    expect(vals(ours.tb_tempo_t1)).toEqual(vals(stock.tb_tempo_t1));
    expect(ours.tb_tempo_t1.filter((v, i) => v !== stock.tb_tempo_t1[i]).length).toBeLessThanOrEqual(12);
  });
  it('velocity curves and tapers: own designs, same end points', () => {
    for (const l of ['tb_vel_vca', 'tb_vel_mod', 'tb_vel_att']) {
      expect(ours[l][0], l).toBe(stock[l][0]);
      expect(ours[l][127], l).toBe(stock[l][127]);
    }
    for (let k = 0; k < 3; k++) {
      const o = ours.tb_taper_fact.slice(32 * k, 32 * k + 32), s = stock.tb_taper_fact.slice(32 * k, 32 * k + 32);
      expect([o[0], o[2], o[23], o[31]]).toEqual([s[0], s[2], s[23], s[31]]);
    }
  });
});

it('curves.inc is up to date with tools/gen-curves.mjs', () => {
  const inc = readFileSync(join(ROOT, 'firmware/src/eng/curves.inc'), 'utf8');
  for (const [l, d] of CURVES as [string, number[], string][]) {
    const m = new RegExp(`${l}:\\n((?:\\s+\\.byte [^\\n]+\\n)+)`).exec(inc);
    expect(m, l).not.toBeNull();
    const bytes = m![1].match(/\$[0-9a-f]{2}/g)!.map((h) => parseInt(h.slice(1), 16));
    expect(bytes, l).toEqual(d);
  }
});
