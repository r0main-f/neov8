// MIDI-controller CV bank ($3080-$3087) and damper: NeoV8 (real MIDI module) vs the stock ROM.
import { describe, it, expect, beforeAll } from 'vitest';
import { MachineBackend } from '../src/machine/backend';
import { buildFirmware, loadNeoRomFrom, loadStockRom, hasStock } from './helpers';

const BUILD = 'build-lead';

describe.skipIf(!hasStock)('MIDI controller CVs', () => {
  beforeAll(() => buildFirmware(BUILD, ['STUB_UI', 'STUB_TUNE']));
  const boot = (rom: Uint8Array, bram?: Uint8Array) => {
    const b = new MachineBackend('x', rom, bram);
    b.run(1500);
    return b;
  };
  const bank = (b: MachineBackend) => [...b.machine.cv.slice(0x80, 0x88)];

  it('boot state of the bank equals the stock (controllers 0, bends centred)', () => {
    const s = boot(loadStockRom());
    const n = boot(loadNeoRomFrom(BUILD));
    expect(bank(n)).toEqual(bank(s));
    expect([...n.machine.cvMult.slice(0x80, 0x84)]).toEqual([255, 255, 255, 255]);
  });

  it('pitch bend on the RIGHT channel drives bend R (and L outside SPLIT), scaled like the stock', () => {
    const n = boot(loadNeoRomFrom(BUILD));
    // NV globals are zero in a fresh battery (UI stubbed): RIGHT channel = 1 (index 0); enable bend/mod rx
    n.machine.bram[0x1a80 + 3] = 0xff; // G_RX: everything
    n.midiIn([0xe0, 0x00, 0x7f]); // full up
    n.run(60);
    const pa = 0x7f >> 1, pb = (0x7f & 1) << 7;
    const expected = (pa << 7) | (pb >> 1);
    expect(n.machine.cv[0x86]).toBe(expected);
    expect(n.machine.cv[0x84]).toBe(expected);
  });

  it('damper CC64 sets release defeat for the side', () => {
    const n = boot(loadNeoRomFrom(BUILD));
    n.machine.bram[0x1a80 + 3] = 0xff;
    n.midiIn([0xb0, 64, 127]);
    n.run(60);
    expect(n.machine.ram[0x0880 + 9] & 1).toBe(1); // PERF+PF_RELDEF bit0 (RIGHT)
    n.midiIn([0xb0, 64, 0]);
    n.run(60);
    expect(n.machine.ram[0x0880 + 9] & 1).toBe(0);
  });
});
