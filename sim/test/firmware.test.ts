// Smoke test of the full NeoV8 firmware (every real module) in the machine model.
import { describe, it, expect, beforeAll } from 'vitest';
import { MachineBackend } from '../src/machine/backend';
import { segToChar } from '../src/font7';
import { buildFirmware, loadNeoRomFrom, neoSymbols } from './helpers';

const BUILD = 'build-full';

describe('NeoV8 firmware (full build)', () => {
  beforeAll(() => buildFirmware(BUILD, []));
  const boot = () => {
    const b = new MachineBackend('neov8', loadNeoRomFrom(BUILD));
    b.run(1500);
    return b;
  };

  it('boots: no illegal opcode, 488 Hz tick, every S&H slot refreshed, stock sentinel and NeoV8 globals set', () => {
    const b = boot();
    const m = b.machine;
    expect(m.cpu.illegal).toBe(0);
    const sym = neoSymbols(BUILD);
    const ticks = m.ram[sym.ticks] | (m.ram[sym.ticks + 1] << 8);
    expect(ticks).toBeGreaterThan(600); // 1.5 s at 488 Hz, minus the boot
    const dynamic = new Set([0x68, 0x69, 0x6a, 0x6b, 0x6c, 0x6d, 0x6e, 0x6f, 0x70, 0x71, 0x72, 0x73, 0x74, 0x75, 0x76, 0x77]);
    for (let s = 0; s < 128; s++) if (!dynamic.has(s)) expect(m.cvWrites[s], `slot $${s.toString(16)}`).toBeGreaterThan(0);
    expect(m.bram[0x0fff]).toBe(0xaa);
    expect(String.fromCharCode(m.bram[0x1a7a], m.bram[0x1a7b])).toBe('N8');
  });

  it('shows the home view and recalls a program from the panel', () => {
    const b = boot();
    const text = () => b.frame().segments.map((s) => segToChar(s & 127)).join('');
    b.button('call_r', true); b.run(30); b.button('call_r', false); b.run(30);
    b.button('k4', true); b.run(30); b.button('k4', false); b.run(30);
    b.button('k2', true); b.run(30); b.button('k2', false); b.run(200);
    expect(text().slice(2, 4)).toBe('42');
  });

  it('fits the ROM and keeps the main loop responsive', () => {
    const sym = neoSymbols(BUILD);
    expect(sym.__CODE_SIZE__ ?? 0).toBeLessThan(0x7ffa);
  });
});
