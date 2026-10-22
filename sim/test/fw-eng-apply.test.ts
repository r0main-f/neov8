// Engine parity, program apply: after a program recall (no notes playing), NeoV8 must put exactly the same
// static voltages, waveform latches, mod crosspoints and LS670 routing on the analog side as the stock ROM.
import { describe, it, expect, beforeAll } from 'vitest';
import { MachineBackend } from '../src/machine/backend';
import { snapshot, diff, randomProgram, bramWith } from '../src/machine/parity';
import { loadStockRom, loadNeoRomFrom, buildFirmware, hasStock, tp } from './helpers';
import type { ButtonId } from '../src/types';

const BUILD = 'build-apply';

function press(b: MachineBackend, ...ids: ButtonId[]) {
  for (const id of ids) { b.button(id, true); b.run(30); b.button(id, false); b.run(50); }
}
const digits = (n: number) => [`k${Math.floor(n / 10)}`, `k${n % 10}`] as ButtonId[];

/** Static slots owned by the apply layer for programs p (RIGHT) and q (LEFT). */
function staticSlots(progR: Uint8Array, progL: Uint8Array, whole: boolean): number[] {
  const out: number[] = [];
  const sides = whole ? [progR, progR] : [progR, progL];
  for (let v = 0; v < 8; v++) out.push(8 * v + 2, 8 * v + 6); // pulse widths
  sides.forEach((p, s) => {
    if (p[0x13] & 0x80) for (let i = 0; i < 4; i++) out.push(0x40 + 8 * s + i); // Fc when not tracked
    out.push(0x44 + 8 * s, 0x45 + 8 * s, 0x46 + 8 * s, 0x52 + 4 * s, 0x7b + 4 * s);
    for (let k = 0; k < 4; k++) out.push(0x60 + 4 * s + k);
  });
  return out;
}

describe.skipIf(!hasStock)('engine parity: program apply', () => {
  const programs = Array.from({ length: 100 }, (_, i) => randomProgram(1000 + i));
  const bram = bramWith(programs);
  // realistic autotune tables (as the stock tuner writes them: PW calibration negative, $F0-$FF)
  for (let i = 0; i < 16; i++) {
    bram[0x1980 + i] = 0x30; bram[0x1990 + i] = 0x80; // pitch offset
    bram[0x19a0 + i] = 0x40; bram[0x19b0 + i] = 0x00; // scale trim
    bram[0x19c0 + i] = 0xf0 + (i % 16); bram[0x19d0 + i] = (i * 37) & 0xfe; // PW calibration
  }
  beforeAll(() => buildFirmware(BUILD, ['STOCK_TABLES', 'STUB_UI', 'STUB_MIDI', 'STUB_VX', 'STUB_ENV', 'STUB_LFO']));

  function boot(rom: Uint8Array) {
    const b = new MachineBackend('x', rom, bram);
    b.run(1500);
    return b;
  }

  for (const [mode, progs] of [['whole', [[3], [17], [42], [88]]], ['split', [[5, 9], [23, 61], [77, 12]]], ['layer', [[30, 31], [64, 2]]]] as const) {
    for (const pp of progs) {
      it(`${mode}: programs ${pp.join(' / ')}`, () => {
        const stock = boot(loadStockRom());
        const neo = boot(loadNeoRomFrom(BUILD));
        const kb = mode === 'whole' ? 0 : mode === 'split' ? 1 : 2;
        press(stock, mode === 'whole' ? 'kb_whole' : mode === 'split' ? 'kb_split' : 'kb_layer');
        tp(neo, 5, kb, 3); // PERF[PF_KBMODE] = kb
        press(stock, 'call_r', ...digits(pp[0]));
        tp(neo, 1, pp[0], 0);
        if (pp.length > 1) {
          press(stock, "call_l", ...digits(pp[1]!));
          tp(neo, 1, pp[1]!, 1);
        }
        stock.run(200); neo.run(200);
        const slots = staticSlots(programs[pp[0]], programs[pp[1] ?? pp[0]], kb === 0);
        const d = diff(snapshot(stock.machine), snapshot(neo.machine), { slots, ic3Mask: 0xfc });
        expect(d).toEqual([]);
      });
    }
  }

  it('never-tuned unit (blank tables): NeoV8 keeps the program pulse width (the stock zeroed it)', () => {
    const blank = bramWith(programs);
    const neo = new MachineBackend('n', loadNeoRomFrom(BUILD), blank);
    neo.run(1500);
    tp(neo, 5, 0, 3);
    tp(neo, 1, 3, 0);
    const p = programs[3];
    if (!(p[0x11] & 0x80)) expect(neo.machine.cv[6] >> 7).toBe(p[0x0f] & 0x7f); // VCO1 PW of voice 0
    if (!(p[0x12] & 0x80)) expect(neo.machine.cv[2] >> 7).toBe(p[0x26] & 0x7f); // VCO2 PW of voice 0
  });
});
