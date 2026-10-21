// NeoV8 core: footswitches (stock-compatible battery config), with the UI stubbed (its calls are logged).
import { describe, it, expect, beforeAll } from 'vitest';
import { MachineBackend } from '../src/machine/backend';
import { buildFirmware, loadNeoRomFrom, readCallLog } from './helpers';

const BUILD = 'build-core';
const UI_KEY = 0x23;

describe('NeoV8 core', () => {
  beforeAll(() => buildFirmware(BUILD, ['STUB_UI', 'STUB_MIDI', 'STUB_TUNE', 'STUB_ENG']));
  const boot = () => {
    const b = new MachineBackend('neo', loadNeoRomFrom(BUILD));
    b.run(300);
    return b;
  };
  const keys = (b: MachineBackend) => readCallLog(b.machine.ram).filter((e) => e.id === UI_KEY).map((e) => e.a);

  it('initialises the footswitch block with the stock defaults and magic', () => {
    const b = boot();
    const bram = b.machine.bram;
    expect([...bram.slice(0x1a46, 0x1a58)]).toEqual([0xff, 0x30, 0x31, 0x00, 0x34, 0xff, 0xff, 0x04, 0x05, 0xff, 0x00, 0x01, 0x00, 0x12, 0xff, 0x00, 0x13, 0xff]);
    expect(bram[0x1a58]).toBe(0xa5);
  });

  it('"both edges" switch (A-L: HOLD L+R) fires on press and on release', () => {
    const b = boot();
    b.footswitch(2, true); b.run(30);
    expect(keys(b)).toEqual([0x04, 0x05]);
    b.footswitch(2, false); b.run(30);
    expect(keys(b)).toEqual([0x04, 0x05, 0x04, 0x05]);
  });

  it('single switch (B-R: ARP PAUSE) fires on release only; jack FWD/REV inject FWD/REV', () => {
    const b = boot();
    b.footswitch(1, true); b.run(30);
    expect(keys(b)).toEqual([]);
    b.footswitch(1, false); b.run(30);
    expect(keys(b)).toEqual([0x34]);
    b.footswitch(5, true); b.run(30); b.footswitch(5, false); b.run(30);
    expect(keys(b)).toEqual([0x34, 0x13]);
  });

  it('keeps a user footswitch configuration (magic present)', () => {
    const bram = new Uint8Array(0x2000);
    bram[0x0fff] = 0xaa;
    bram.set([0x00, 0x2b, 0xff], 0x1a46); // B-L: AUDIO MUTE
    bram[0x1a58] = 0xa5;
    const b = new MachineBackend('neo', loadNeoRomFrom(BUILD), bram);
    b.run(300);
    b.footswitch(0, true); b.run(30); b.footswitch(0, false); b.run(30);
    expect(keys(b)).toEqual([0x2b]);
  });
});
