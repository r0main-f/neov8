import { describe, it, expect } from 'vitest';
import { Cpu6502 } from '../src/machine/cpu6502';

function machine(code: number[], at = 0x0200) {
  const mem = new Uint8Array(0x10000);
  mem.set(code, at);
  mem[0xfffc] = at & 0xff;
  mem[0xfffd] = at >> 8;
  const cpu = new Cpu6502({ read: (a) => mem[a], write: (a, v) => (mem[a] = v) });
  cpu.reset();
  return { cpu, mem, run: (n: number) => { for (let i = 0; i < n; i++) cpu.step(); } };
}

describe('6502 core', () => {
  it('loads, stores and sets flags', () => {
    const m = machine([0xa9, 0x00, 0x85, 0x10, 0xa2, 0x80, 0x86, 0x11]); // LDA #0; STA $10; LDX #$80; STX $11
    m.run(2);
    expect(m.cpu.p & 0x02).toBe(2); // Z
    m.run(2);
    expect(m.mem[0x11]).toBe(0x80);
    expect(m.cpu.p & 0x80).toBe(0x80); // N
  });

  it('adds with carry and overflow (binary)', () => {
    const m = machine([0x18, 0xa9, 0x50, 0x69, 0x50]); // CLC; LDA #$50; ADC #$50
    m.run(3);
    expect(m.cpu.a).toBe(0xa0);
    expect(m.cpu.p & 0x40).toBe(0x40); // V
    expect(m.cpu.p & 0x01).toBe(0); // C
  });

  it('adds and subtracts in decimal mode', () => {
    const m = machine([0xf8, 0x18, 0xa9, 0x19, 0x69, 0x28, 0x38, 0xe9, 0x09]); // SED; CLC; LDA #$19; ADC #$28 -> $47; SEC; SBC #$09 -> $38
    m.run(4);
    expect(m.cpu.a).toBe(0x47);
    m.run(2);
    expect(m.cpu.a).toBe(0x38);
  });

  it('calls and returns, branches with cycle penalties', () => {
    // JSR $0210 ; LDY #1 ; ... $0210: LDX #3 ; DEX ; BNE -3 ; RTS
    const m = machine([0x20, 0x10, 0x02, 0xa0, 0x01]);
    m.mem.set([0xa2, 0x03, 0xca, 0xd0, 0xfd, 0x60], 0x210);
    m.run(1 + 1 + 3 * 2 + 1 + 1);
    expect(m.cpu.x).toBe(0);
    expect(m.cpu.y).toBe(1);
    expect(m.cpu.pc).toBe(0x205);
  });

  it('JMP indirect has the NMOS page-wrap bug', () => {
    const m = machine([0x6c, 0xff, 0x10]);
    m.mem[0x10ff] = 0x34; m.mem[0x1000] = 0x12; m.mem[0x1100] = 0x99;
    m.run(1);
    expect(m.cpu.pc).toBe(0x1234);
  });

  it('takes IRQ only when I is clear, NMI on an edge', () => {
    const m = machine([0x58, 0xea, 0xea, 0xea]); // CLI; NOP...
    m.mem[0xfffe] = 0x00; m.mem[0xffff] = 0x30;
    m.mem[0xfffa] = 0x00; m.mem[0xfffb] = 0x40;
    m.cpu.irqLine = true;
    m.run(1); // SEI from reset still set? reset sets I -> CLI clears it
    m.run(1);
    expect(m.cpu.pc).toBe(0x3000);
    m.cpu.setNmi(true);
    m.run(1);
    expect(m.cpu.pc).toBe(0x4000);
    m.cpu.setNmi(true); // still asserted: no new edge
    m.mem[0x4000] = 0xea;
    m.run(1);
    expect(m.cpu.pc).toBe(0x4001);
  });

  it('counts cycles including page crossing', () => {
    const m = machine([0xa2, 0xff, 0xbd, 0x01, 0x10]); // LDX #$FF; LDA $1001,X -> crosses
    const c0 = m.cpu.cycles;
    m.run(2);
    expect(m.cpu.cycles - c0).toBe(2 + 5);
  });
});
