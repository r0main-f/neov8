// Arpeggiator clock: the tempo oscillator (tempo LED, clock-out jack) must run at the stock rate for every
// ARP SPEED; external clock and MIDI clock sync (NeoV8).
import { describe, it, expect, beforeAll } from 'vitest';
import { MachineBackend } from '../src/machine/backend';
import { bramWith, randomProgram } from '../src/machine/parity';
import { buildFirmware, loadNeoRomFrom, loadStockRom, hasStock, tp } from './helpers';
import type { ButtonId } from '../src/types';

const BUILD = 'build-clock';

/** Average time (ms) between tempo-LED toggles (display RAM 9 bit 2) over `ms`. */
function blinkHalfPeriod(b: MachineBackend, ms: number): number {
  let last = b.machine.kd.display[9] & 4;
  const toggles: number[] = [];
  for (let t = 0; t < ms; t++) {
    b.run(1);
    const v = b.machine.kd.display[9] & 4;
    if (v !== last) { toggles.push(t); last = v; }
  }
  if (toggles.length < 3) return Infinity;
  return (toggles[toggles.length - 1] - toggles[0]) / (toggles.length - 1);
}

describe.skipIf(!hasStock)('arpeggiator clock', () => {
  beforeAll(() => buildFirmware(BUILD, ['STUB_UI', 'STUB_TUNE', 'STUB_VX', 'STUB_ENV', 'STUB_LFO']));

  for (const speed of [0, 30, 64, 100, 127]) {
    it(`tempo at ARP SPEED ${speed} equals the stock`, () => {
      const bram = bramWith(Array.from({ length: 100 }, (_, i) => randomProgram(i + 7)));
      bram.set([0x80, 0, 0, 0x40, 0x40 | 36, speed], 0x1000 + 24 * 5); // step 05: WHOLE 8, octaves normal, speed
      const stock = new MachineBackend('s', loadStockRom(), bram);
      stock.run(1500);
      for (const id of ['step_enable', 'k0', 'k5'] as ButtonId[]) { stock.button(id, true); stock.run(30); stock.button(id, false); stock.run(50); }
      const neo = new MachineBackend('n', loadNeoRomFrom(BUILD), bram);
      neo.run(1500);
      tp(neo, 5, speed, 15); // PERF+PF_ARP_SPEED
      tp(neo, 4); // apply perf
      const window = speed <= 30 ? 9000 : speed > 100 ? 6000 : 2500; // slow tempos toggle every ~1.6 s
      const s = blinkHalfPeriod(stock, window);
      const n = blinkHalfPeriod(neo, window);
      expect(Number.isFinite(s)).toBe(true);
      expect(Math.abs(n - s) / s).toBeLessThan(0.03);
    });
  }

  it('external clock (PIA1 CA1) sets the phase high, MIDI clock sync follows the division', () => {
    const neo = new MachineBackend('n', loadNeoRomFrom(BUILD));
    neo.run(500);
    neo.machine.bram[0x1a80 + 11] = 1; // G_ARPCLK = external
    neo.machine.pia1.ca1();
    neo.run(20);
    expect(neo.machine.kd.display[9] & 4).toBe(4);
    neo.machine.bram[0x1a80 + 11] = 2; // MIDI clock
    neo.machine.bram[0x1a80 + 3] = 0xff;
    tp(neo, 5, 48, 15); // speed 48 -> index 3 -> 1/16 = 6 clocks per step
    neo.midiIn([0xfa]);
    neo.run(10);
    const levels: number[] = [];
    for (let i = 0; i < 12; i++) { neo.midiIn([0xf8]); neo.run(4); levels.push(neo.machine.kd.display[9] & 4 ? 1 : 0); }
    // 6 clocks per step: high for the first half, low for the second
    expect(levels).toEqual([1, 1, 0, 0, 0, 1, 1, 1, 0, 0, 0, 1]);
  });
});
