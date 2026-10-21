// The autotune entry point (core `autotune`): MIDI received while tuning is flushed afterwards, the parser
// restarts clean, all notes are released. Real MIDI module; engine/UI/tuner are logging stubs (the tuner stub
// keeps the CPU busy ~40 ms with interrupts off, like the real one).
import { describe, it, expect, beforeAll } from 'vitest';
import { MachineBackend } from '../src/machine/backend';
import { buildFirmware, loadNeoRomFrom, readCallLog, neoSymbols } from './helpers';

const BUILD = 'build-autotune';
const ID = { tune: 0x40, sideOn: 0x15, sideOff: 0x16, allOff: 0x17 };
const TP = 0x0ff0;

describe('autotune entry point', () => {
  beforeAll(() => buildFirmware(BUILD, ['STUB_ENG', 'STUB_UI', 'STUB_TUNE']));
  const boot = () => {
    const b = new MachineBackend('neo', loadNeoRomFrom(BUILD));
    b.run(300);
    b.machine.bram[0x1a80 + 3] = 0xff; // G_RX: notes, PC, CC, SysEx (MX), controllers
    return b;
  };
  const log = (b: MachineBackend) => readCallLog(b.machine.ram);

  it('MIDI tune request: notes that arrive during the tune are dropped, later notes play', () => {
    const b = boot();
    // F6 then, while the tuner holds the CPU, a note-on and the first half of another one
    b.midiIn([0xf6, 0x90, 60, 100, 0x90, 62]);
    b.run(80);
    const after = log(b).map((e) => e.id);
    expect(after).toContain(ID.tune);
    expect(after).toContain(ID.allOff);
    expect(after).not.toContain(ID.sideOn); // stale note dropped
    // the dangling data byte must not combine with what comes next; running status was reset
    b.midiIn([64]);
    b.run(20);
    expect(log(b).map((e) => e.id)).not.toContain(ID.sideOn);
    b.midiIn([0x90, 67, 90]);
    b.run(20);
    const on = log(b).filter((e) => e.id === ID.sideOn);
    expect(on.map((e) => e.a)).toEqual([67]);
  });

  it('test-port autotune flushes too, and RX overflow during the tune is not reported', () => {
    const b = boot();
    const sym = neoSymbols(BUILD);
    const ram = b.machine.ram;
    ram[TP] = 6; // run autotune
    b.run(1); // the tuner now blocks the CPU; flood MIDI meanwhile (more than the ring holds would need >80 ms)
    b.midiIn(Array.from({ length: 60 }, (_, i) => [0x90, 40 + (i % 20), 100]).flat());
    b.run(200);
    expect(log(b).map((e) => e.id)).toContain(ID.tune);
    expect(log(b).filter((e) => e.id === ID.sideOn).length).toBeLessThan(60); // what arrived during the tune is gone
    expect(ram[sym.midi_rxovr]).toBe(0);
  });
});
