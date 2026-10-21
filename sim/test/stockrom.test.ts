// Boots the stock Rev4 ROM in the machine model (headless) and checks it runs sanely.
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { Machine, CPU_HZ } from '../src/machine/machine';
import { loadStockRom, STOCK_ZIP } from './helpers';

const ZIP = STOCK_ZIP;

describe.skipIf(!existsSync(ZIP))('stock Rev4 ROM in the machine model', () => {
  it('boots: valid vectors, no illegal opcodes, IRQs running, display and CVs written', () => {
    const m = new Machine(loadStockRom());
    m.reset();
    expect(m.cpu.pc).toBe(0xe80e);
    m.run(CPU_HZ); // one second
    expect(m.cpu.illegal).toBe(0);
    expect(m.cpu.pc).toBeGreaterThanOrEqual(0x8000);
    const slots = [...m.cvWrites].filter((n) => n > 0).length;
    console.log({
      pc: m.cpu.pc.toString(16), irqs: m.irqCount, nmis: m.nmiCount, slotsWritten: slots,
      display: [...m.kd.display].map((b) => b.toString(16).padStart(2, '0')).join(' '),
      ptm: { cr: m.ptm.cr.map((x) => x.toString(16)), latch: m.ptm.latch.map((x) => x.toString(16)) },
      io: [...m.io.entries()].map(([a, s]) => `${a.toString(16)}:r${s.reads}/w${s.writes}`).join(' '),
    });
    expect(m.irqCount).toBeGreaterThan(10);
    expect(slots).toBeGreaterThan(16);
  });
});

import { MachineBackend, HW_KEYTAB } from '../src/machine/backend';
import { segToChar } from '../src/font7';

function text(b: MachineBackend) {
  return b.frame().segments.map((s) => segToChar(s) + (s & 128 ? '.' : '')).join('');
}
function press(b: MachineBackend, ...ids: Parameters<MachineBackend['button']>[0][]) {
  for (const id of ids) { b.button(id, true); b.run(40); b.button(id, false); b.run(60); }
}

describe.skipIf(!existsSync(ZIP))('stock Rev4 ROM driven from the panel', () => {
  it('CALL R + 4 2 recalls program 42 and shows it in the RIGHT window', () => {
    const b = new MachineBackend('stock', loadStockRom());
    b.run(1000);
    press(b, 'call_r', 'k4', 'k2');
    b.run(200);
    expect(b.machine.ram[0x50]).toBe(42);
    expect(text(b).replace(/\./g, '').slice(2, 4)).toBe('42');
  });

  it('CALL L + 0 7 recalls program 7 on the left', () => {
    const b = new MachineBackend('stock', loadStockRom());
    b.run(1000);
    press(b, 'call_l', 'k0', 'k7');
    b.run(200);
    expect(b.machine.ram[0x51]).toBe(7);
    expect(text(b).replace(/\./g, '').slice(0, 2)).toBe('07');
  });

  it('a VPK-5 key press is seen by the key scan (note on, then off)', () => {
    const b = new MachineBackend('stock', loadStockRom());
    b.run(1000);
    const x = (60 - 0x21) ^ 0x3f;
    b.key(60, true, 100);
    b.run(100);
    expect(b.machine.ram[0x0200 + x] & 0x80).toBe(0x80);
    b.key(60, false, 0);
    b.run(100);
    expect(b.machine.ram[0x0200 + x] & 0x80).toBe(0);
  });

  it('pots are read through the software ADC (value lands in $0710+index)', () => {
    const b = new MachineBackend('stock', loadStockRom());
    b.run(1000);
    b.pot('arp_speed', 1023);
    b.run(600);
    expect(b.machine.ram[0x0710 + 14]).toBeGreaterThan(120);
    b.pot('arp_speed', 0);
    b.run(600);
    expect(b.machine.ram[0x0710 + 14]).toBeLessThan(8);
  });

  it('EDIT enters edit page 1 (vPage $060A = 1)', () => {
    const b = new MachineBackend('stock', loadStockRom());
    b.run(1000);
    press(b, 'edit');
    b.run(100);
    expect(b.machine.ram[0x060a]).toBe(1);
  });
});

describe.skipIf(!existsSync(ZIP))('panel wiring', () => {
  it('HW_KEYTAB equals the stock ROM KEYTAB at $A0BD', () => {
    const rom = loadStockRom();
    expect([...rom.slice(0xa0bd - 0x8000, 0xa0bd - 0x8000 + 48)]).toEqual(HW_KEYTAB);
  });
});
