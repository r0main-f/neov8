#!/usr/bin/env node
// NeoV8's own response curves -> firmware/src/eng/curves.inc (committed). No data from the original
// firmware: every table is computed from a formula or designed here, so a NeoV8 ROM can be shared.
// The stock tables (tools/extract-tables.mjs, from your own ROM dump) are only used by the parity tests
// (build define STOCK_TABLES) and by sim/test/curves.test.ts, which measures how close these curves are.
//
//   envelope level law      exponential, 14-bit DAC (x4)       stock: within 1 DAC step
//   inverse level curve     logarithmic                        stock: within rounding
//   parameter curve         exponential                        stock: within rounding
//   ADSR rates              3 exponential/linear segments      stock: ~0.5 % mid range, up to ~30 % at a few settings
//   tempo -> PTM T1 MSB     2 MHz timer arithmetic             stock: same values, 6 settable tempos shifted by 1 BPM
//   velocity curves/tapers  NeoV8 designs                      own shapes (same end points and intent)
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// ---- envelope level -> DAC: one exponential sampled at quarter steps (index i, fraction f = x & 3),
// 14-bit value x 4 (the DAC takes the top 14 bits of the 16-bit word), PA = high byte, PB = low byte.
const ENV_K = 0.002979;
const env16 = (x) => 4 * Math.round((8190 * (Math.exp(ENV_K * x) - 1)) / (Math.exp(ENV_K * 1023) - 1));
const envPart = (f, hi) => Array.from({ length: 256 }, (_, i) => (hi ? env16(i * 4 + f) >> 8 : env16(i * 4 + f) & 0xff));

// ---- inverse level curve (index level*2): logarithmic
const INV_C = 0.077;
const envInv = Array.from({ length: 256 }, (_, j) => Math.round((255 * Math.log(1 + INV_C * j)) / Math.log(1 + 255 * INV_C)));

// ---- convex parameter curve (glide time, program volume)
const PC_K = 0.0121;
const paramCurve = Array.from({ length: 256 }, (_, i) => Math.round((255 * (Math.exp(PC_K * i) - 1)) / (Math.exp(PC_K * 255) - 1)));

// ---- ADSR rate per time index (16 bit: bigger = faster): slow range, main range, fast range, saturated
function adsrRate(i) {
  if (i < 2) return 0;
  if (i <= 65) return Math.max(1, Math.round(24.984126 * Math.exp(0.0488 * i) - 26));
  if (i <= 112) return Math.round(812.615989 * Math.exp(0.02388 * i) - 3271.7797);
  if (i <= 122) return Math.round(11333 + ((63914 - 11333) * (i - 113)) / 9);
  return 65535;
}
const adsr = Array.from({ length: 128 }, (_, i) => clamp(adsrRate(i), 0, 65535));

// ---- tempo 20-255 BPM -> PTM T1 MSB: T1 = 1 250 000 / BPM (2 MHz, 96 clocks per beat), MSB rounded;
// a BPM whose MSB repeats the previous one is not settable ($FF), so every settable tempo has its own value.
const tempo = [];
{
  let prev = -1;
  for (let i = 0; i < 236; i++) {
    const v = Math.min(255, Math.round(1250000 / 256 / (i + 20)));
    tempo.push(v === prev ? 255 : v);
    if (v !== prev) prev = v;
  }
}

// ---- velocity (0-127, key-speed classes from the VPK-5 timer) -> multipliers / offsets: NeoV8 designs
const vel = (i) => clamp(i, 0, 118) / 118; // 118 and above = hardest
const velVca = Array.from({ length: 128 }, (_, i) => (i === 0 ? 0 : clamp(Math.round(6 * Math.pow(254 / 6, (Math.min(i, 110) - 1) / 109)), 0, 254)));
const velMod = Array.from({ length: 128 }, (_, i) => Math.round(127 * vel(i)));
const velAtt = Array.from({ length: 128 }, (_, i) => (i < 16 ? 0 : Math.round((127 * (Math.min(i, 118) - 16)) / 102)));
// factory tapers: key speed 0-31 -> velocity 118 (fast) .. 16 (slow); 1 linear, 2 steep, 3 medium
const taper = (p) => Array.from({ length: 32 }, (_, s) => Math.round(16 + 102 * Math.pow(1 - clamp((s - 2) / 21, 0, 1), p)));
const tapers = [...taper(1), ...taper(3), ...taper(1.6)];

// ---- waveform-mix level compensation steps (3 small calibration constants of the voice card levels)
const waveComp = [9, 21, 23];

export const CURVES = [
  ['tb_env_pa0', envPart(0, true), 'envelope level -> 14-bit DAC curve, PA byte, fraction 00'],
  ['tb_env_pb0', envPart(0, false), '... PB byte, fraction 00'],
  ['tb_env_pa1', envPart(1, true), 'fraction 01'],
  ['tb_env_pb1', envPart(1, false), ''],
  ['tb_env_pa2', envPart(2, true), 'fraction 10'],
  ['tb_env_pb2', envPart(2, false), ''],
  ['tb_env_pa3', envPart(3, true), 'fraction 11'],
  ['tb_env_pb3', envPart(3, false), ''],
  ['tb_env_inv', envInv, 'inverse envelope curve (index level*2)'],
  ['tb_param_curve', paramCurve, 'convex 0..255 parameter curve (index param*2): glide, program volume'],
  ['tb_adsr_rate_hi', adsr.map((v) => v >> 8), 'ADSR rate, high byte, per 7-bit time parameter'],
  ['tb_adsr_rate_lo', adsr.map((v) => v & 0xff), 'ADSR rate, low byte'],
  ['tb_wave_comp', waveComp, 'waveform-mix level compensation steps'],
  ['tb_tempo_t1', tempo, 'tempo -> PTM T1 MSB ($FF: tempo not settable)'],
  ['tb_taper_fact', tapers, 'factory velocity tapers 1-3 (32 key speeds each)'],
  ['tb_vel_vca', velVca, 'velocity -> VCA multiplier curve'],
  ['tb_vel_mod', velMod, 'velocity -> modulation velocity curve'],
  ['tb_vel_att', velAtt, 'velocity -> attack-rate offset curve'],
];

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  let out = `; GENERATED by tools/gen-curves.mjs (NeoV8's own response curves, formulas and designs). Do not edit.\n`;
  for (const [label, data, comment] of CURVES) {
    for (const b of data) if (!Number.isInteger(b) || b < 0 || b > 255) throw new Error(`${label}: byte out of range ${b}`);
    const page = data.length === 256; // page-aligned (segment PAGE, v8.cfg): constant cycle cost of indexed reads
    out += `\n; ${comment} (${data.length} bytes)\n`;
    if (page) out += `        .pushseg\n        .segment "PAGE"\n`;
    out += `${label}:\n`;
    for (let i = 0; i < data.length; i += 16) out += `        .byte ${data.slice(i, i + 16).map((b) => '$' + b.toString(16).padStart(2, '0')).join(',')}\n`;
    if (page) out += `        .popseg\n`;
  }
  writeFileSync(join(root, 'firmware/src/eng/curves.inc'), out);
  console.log(`gen-curves: ${CURVES.length} tables -> firmware/src/eng/curves.inc`);
}
