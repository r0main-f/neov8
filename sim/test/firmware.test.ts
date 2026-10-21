// The NeoV8 firmware (firmware/build/neov8.bin) running in the machine model.
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MachineBackend } from '../src/machine/backend';
import { segToChar } from '../src/font7';
import { neoSymbols } from './helpers';

const BIN = join(__dirname, '../../firmware/build/neov8.bin');
const text = (b: MachineBackend) => b.frame().segments.map((s) => segToChar(s & 127)).join('');

describe.skipIf(!existsSync(BIN))('NeoV8 firmware in the machine model', () => {
  const boot = () => {
    const b = new MachineBackend('neov8', new Uint8Array(readFileSync(BIN)));
    b.run(300);
    return b;
  };

  it('boots, takes the 488 Hz tick, refreshes all 128 CV slots and shows the splash', () => {
    const b = boot();
    const m = b.machine;
    expect(m.cpu.illegal).toBe(0);
    expect(m.bram[0x0fff]).toBe(0xaa); // stock-compatible sentinel kept
    const sym = neoSymbols();
    const ticks = m.ram[sym.ticks] | (m.ram[sym.ticks + 1] << 8);
    expect(ticks).toBeGreaterThan(120);
    expect([...m.cvWrites.slice(0, 128)].every((n) => n > 0)).toBe(true);
    expect(text(b)).toBe('nE0 01'); // O and 0 share a glyph
  });

  it('shows the internal code of a pressed button (CALL R = $20), with A440 as shift', () => {
    const b = boot();
    b.button('call_r', true); b.run(20); b.button('call_r', false); b.run(20);
    expect(text(b)).toBe('bt  20');
    b.button('a440', true); b.button('store', true); b.run(20);
    expect(text(b).slice(4)).toBe('1C');
    expect(b.frame().segments[1] & 128).toBe(128); // DP = A440 held
  });

  it('reads the pots through the software ADC', () => {
    const b = boot();
    b.pot('arp_speed', 1023);
    b.run(100);
    expect(text(b)).toBe('PE  7F'); // 7-bit, like the stock ROM
    b.pot('l_fc', 0);
    b.run(100);
    expect(text(b)).toBe('P1  00');
  });
});
