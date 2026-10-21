// NMOS 6502 core (SY6502A), cycle-counted, documented opcodes + decimal mode.
// Undocumented opcodes are executed as NOPs of the right length and counted in `illegal` so traces show them.

export interface Bus {
  read(addr: number): number;
  write(addr: number, v: number): void;
}

const C = 0x01, Z = 0x02, I = 0x04, D = 0x08, B = 0x10, U = 0x20, V = 0x40, N = 0x80;

type Mode = 'imp' | 'acc' | 'imm' | 'zp' | 'zpx' | 'zpy' | 'abs' | 'abx' | 'aby' | 'ind' | 'izx' | 'izy' | 'rel';
interface Op { name: string; mode: Mode; cycles: number; pagePenalty: boolean }

const OPS: (Op | null)[] = new Array(256).fill(null);
function def(code: number, name: string, mode: Mode, cycles: number, pagePenalty = false) {
  OPS[code] = { name, mode, cycles, pagePenalty };
}
// prettier-ignore
{
  const g = (name: string, list: [number, Mode, number, boolean?][]) => list.forEach(([c, m, cy, p]) => def(c, name, m, cy, !!p));
  g('ADC', [[0x69,'imm',2],[0x65,'zp',3],[0x75,'zpx',4],[0x6d,'abs',4],[0x7d,'abx',4,true],[0x79,'aby',4,true],[0x61,'izx',6],[0x71,'izy',5,true]]);
  g('AND', [[0x29,'imm',2],[0x25,'zp',3],[0x35,'zpx',4],[0x2d,'abs',4],[0x3d,'abx',4,true],[0x39,'aby',4,true],[0x21,'izx',6],[0x31,'izy',5,true]]);
  g('ASL', [[0x0a,'acc',2],[0x06,'zp',5],[0x16,'zpx',6],[0x0e,'abs',6],[0x1e,'abx',7]]);
  g('BCC', [[0x90,'rel',2]]); g('BCS', [[0xb0,'rel',2]]); g('BEQ', [[0xf0,'rel',2]]); g('BMI', [[0x30,'rel',2]]);
  g('BNE', [[0xd0,'rel',2]]); g('BPL', [[0x10,'rel',2]]); g('BVC', [[0x50,'rel',2]]); g('BVS', [[0x70,'rel',2]]);
  g('BIT', [[0x24,'zp',3],[0x2c,'abs',4]]);
  g('BRK', [[0x00,'imp',7]]);
  g('CLC', [[0x18,'imp',2]]); g('CLD', [[0xd8,'imp',2]]); g('CLI', [[0x58,'imp',2]]); g('CLV', [[0xb8,'imp',2]]);
  g('CMP', [[0xc9,'imm',2],[0xc5,'zp',3],[0xd5,'zpx',4],[0xcd,'abs',4],[0xdd,'abx',4,true],[0xd9,'aby',4,true],[0xc1,'izx',6],[0xd1,'izy',5,true]]);
  g('CPX', [[0xe0,'imm',2],[0xe4,'zp',3],[0xec,'abs',4]]);
  g('CPY', [[0xc0,'imm',2],[0xc4,'zp',3],[0xcc,'abs',4]]);
  g('DEC', [[0xc6,'zp',5],[0xd6,'zpx',6],[0xce,'abs',6],[0xde,'abx',7]]);
  g('DEX', [[0xca,'imp',2]]); g('DEY', [[0x88,'imp',2]]);
  g('EOR', [[0x49,'imm',2],[0x45,'zp',3],[0x55,'zpx',4],[0x4d,'abs',4],[0x5d,'abx',4,true],[0x59,'aby',4,true],[0x41,'izx',6],[0x51,'izy',5,true]]);
  g('INC', [[0xe6,'zp',5],[0xf6,'zpx',6],[0xee,'abs',6],[0xfe,'abx',7]]);
  g('INX', [[0xe8,'imp',2]]); g('INY', [[0xc8,'imp',2]]);
  g('JMP', [[0x4c,'abs',3],[0x6c,'ind',5]]);
  g('JSR', [[0x20,'abs',6]]);
  g('LDA', [[0xa9,'imm',2],[0xa5,'zp',3],[0xb5,'zpx',4],[0xad,'abs',4],[0xbd,'abx',4,true],[0xb9,'aby',4,true],[0xa1,'izx',6],[0xb1,'izy',5,true]]);
  g('LDX', [[0xa2,'imm',2],[0xa6,'zp',3],[0xb6,'zpy',4],[0xae,'abs',4],[0xbe,'aby',4,true]]);
  g('LDY', [[0xa0,'imm',2],[0xa4,'zp',3],[0xb4,'zpx',4],[0xac,'abs',4],[0xbc,'abx',4,true]]);
  g('LSR', [[0x4a,'acc',2],[0x46,'zp',5],[0x56,'zpx',6],[0x4e,'abs',6],[0x5e,'abx',7]]);
  g('NOP', [[0xea,'imp',2]]);
  g('ORA', [[0x09,'imm',2],[0x05,'zp',3],[0x15,'zpx',4],[0x0d,'abs',4],[0x1d,'abx',4,true],[0x19,'aby',4,true],[0x01,'izx',6],[0x11,'izy',5,true]]);
  g('PHA', [[0x48,'imp',3]]); g('PHP', [[0x08,'imp',3]]); g('PLA', [[0x68,'imp',4]]); g('PLP', [[0x28,'imp',4]]);
  g('ROL', [[0x2a,'acc',2],[0x26,'zp',5],[0x36,'zpx',6],[0x2e,'abs',6],[0x3e,'abx',7]]);
  g('ROR', [[0x6a,'acc',2],[0x66,'zp',5],[0x76,'zpx',6],[0x6e,'abs',6],[0x7e,'abx',7]]);
  g('RTI', [[0x40,'imp',6]]); g('RTS', [[0x60,'imp',6]]);
  g('SBC', [[0xe9,'imm',2],[0xe5,'zp',3],[0xf5,'zpx',4],[0xed,'abs',4],[0xfd,'abx',4,true],[0xf9,'aby',4,true],[0xe1,'izx',6],[0xf1,'izy',5,true]]);
  g('SEC', [[0x38,'imp',2]]); g('SED', [[0xf8,'imp',2]]); g('SEI', [[0x78,'imp',2]]);
  g('STA', [[0x85,'zp',3],[0x95,'zpx',4],[0x8d,'abs',4],[0x9d,'abx',5],[0x99,'aby',5],[0x81,'izx',6],[0x91,'izy',6]]);
  g('STX', [[0x86,'zp',3],[0x96,'zpy',4],[0x8e,'abs',4]]);
  g('STY', [[0x84,'zp',3],[0x94,'zpx',4],[0x8c,'abs',4]]);
  g('TAX', [[0xaa,'imp',2]]); g('TAY', [[0xa8,'imp',2]]); g('TSX', [[0xba,'imp',2]]); g('TXA', [[0x8a,'imp',2]]);
  g('TXS', [[0x9a,'imp',2]]); g('TYA', [[0x98,'imp',2]]);
}
export const OPCODES = OPS;

const LEN: Record<Mode, number> = { imp: 1, acc: 1, imm: 2, zp: 2, zpx: 2, zpy: 2, rel: 2, izx: 2, izy: 2, abs: 3, abx: 3, aby: 3, ind: 3 };

export class Cpu6502 {
  a = 0; x = 0; y = 0; s = 0xfd; p = I | U; pc = 0;
  cycles = 0;
  illegal = 0;
  private nmiPending = false;
  private nmiLine = false;
  irqLine = false; // level-triggered, asserted by peripherals
  /** optional hook called before each instruction (tracing, breakpoints) */
  onStep?: (pc: number) => void;

  constructor(private bus: Bus) {}

  reset() {
    this.s = 0xfd;
    this.p = I | U;
    this.pc = this.read16(0xfffc);
    this.cycles += 7;
  }
  /** NMI is edge-triggered on the falling edge of /NMI; pass the asserted state of the line. */
  setNmi(asserted: boolean) {
    if (asserted && !this.nmiLine) this.nmiPending = true;
    this.nmiLine = asserted;
  }

  private read(a: number) { return this.bus.read(a & 0xffff); }
  private write(a: number, v: number) { this.bus.write(a & 0xffff, v & 0xff); }
  private read16(a: number) { return this.read(a) | (this.read(a + 1) << 8); }
  private read16zp(a: number) { return this.read(a & 0xff) | (this.read((a + 1) & 0xff) << 8); }
  private push(v: number) { this.write(0x100 | this.s, v); this.s = (this.s - 1) & 0xff; }
  private pull() { this.s = (this.s + 1) & 0xff; return this.read(0x100 | this.s); }
  private nz(v: number) { this.p = (this.p & ~(N | Z)) | (v & N) | (v & 0xff ? 0 : Z); return v & 0xff; }
  private flag(f: number, on: boolean) { this.p = on ? this.p | f : this.p & ~f; }

  private interrupt(vector: number, brk: boolean) {
    this.push(this.pc >> 8);
    this.push(this.pc & 0xff);
    this.push((this.p | U | (brk ? B : 0)) & ~(brk ? 0 : B));
    this.p |= I;
    this.pc = this.read16(vector);
    this.cycles += 7;
  }

  /** Executes one instruction (or takes a pending interrupt). Returns cycles used. */
  step(): number {
    const start = this.cycles;
    if (this.nmiPending) {
      this.nmiPending = false;
      this.interrupt(0xfffa, false);
      return this.cycles - start;
    }
    if (this.irqLine && !(this.p & I)) {
      this.interrupt(0xfffe, false);
      return this.cycles - start;
    }
    this.onStep?.(this.pc);
    const opc = this.read(this.pc);
    const op = OPS[opc];
    if (!op) {
      this.illegal++;
      this.pc = (this.pc + illegalLen(opc)) & 0xffff;
      this.cycles += 2;
      return 2;
    }
    const pc0 = this.pc;
    this.pc = (this.pc + LEN[op.mode]) & 0xffff;
    this.cycles += op.cycles;
    let addr = 0;
    let crossed = false;
    switch (op.mode) {
      case 'imm': addr = (pc0 + 1) & 0xffff; break;
      case 'zp': addr = this.read(pc0 + 1); break;
      case 'zpx': addr = (this.read(pc0 + 1) + this.x) & 0xff; break;
      case 'zpy': addr = (this.read(pc0 + 1) + this.y) & 0xff; break;
      case 'abs': addr = this.read16(pc0 + 1); break;
      case 'abx': { const b = this.read16(pc0 + 1); addr = (b + this.x) & 0xffff; crossed = (b & 0xff00) !== (addr & 0xff00); break; }
      case 'aby': { const b = this.read16(pc0 + 1); addr = (b + this.y) & 0xffff; crossed = (b & 0xff00) !== (addr & 0xff00); break; }
      case 'ind': { const ptr = this.read16(pc0 + 1); addr = this.read(ptr) | (this.read((ptr & 0xff00) | ((ptr + 1) & 0xff)) << 8); break; } // NMOS page-wrap bug
      case 'izx': addr = this.read16zp(this.read(pc0 + 1) + this.x); break;
      case 'izy': { const b = this.read16zp(this.read(pc0 + 1)); addr = (b + this.y) & 0xffff; crossed = (b & 0xff00) !== (addr & 0xff00); break; }
      case 'rel': { const o = this.read(pc0 + 1); addr = (this.pc + (o < 128 ? o : o - 256)) & 0xffff; break; }
    }
    if (crossed && op.pagePenalty) this.cycles++;
    this.exec(op, addr, pc0);
    return this.cycles - start;
  }

  private branch(cond: boolean, addr: number) {
    if (!cond) return;
    this.cycles += (this.pc & 0xff00) === (addr & 0xff00) ? 1 : 2;
    this.pc = addr;
  }

  private adc(v: number) {
    const c = this.p & C;
    if (this.p & D) {
      let lo = (this.a & 0x0f) + (v & 0x0f) + c;
      let hi = (this.a & 0xf0) + (v & 0xf0);
      if (lo > 9) { lo += 6; }
      if (lo > 0x0f) hi += 0x10;
      const bin = (this.a + v + c) & 0xff;
      this.flag(Z, bin === 0);
      this.flag(N, !!(hi & 0x80));
      this.flag(V, !!(~(this.a ^ v) & (this.a ^ hi) & 0x80));
      if (hi > 0x90) hi += 0x60;
      this.flag(C, hi > 0xff);
      this.a = ((hi & 0xf0) | (lo & 0x0f)) & 0xff;
    } else {
      const r = this.a + v + c;
      this.flag(V, !!(~(this.a ^ v) & (this.a ^ r) & 0x80));
      this.flag(C, r > 0xff);
      this.a = this.nz(r);
    }
  }
  private sbc(v: number) {
    const c = this.p & C;
    const r = this.a - v - (1 - c);
    this.flag(V, !!((this.a ^ v) & (this.a ^ r) & 0x80));
    this.flag(C, r >= 0);
    if (this.p & D) {
      let lo = (this.a & 0x0f) - (v & 0x0f) - (1 - c);
      let hi = (this.a & 0xf0) - (v & 0xf0);
      if (lo & 0x10) { lo -= 6; hi -= 0x10; }
      if (hi & 0x100) hi -= 0x60;
      this.nz(r & 0xff);
      this.a = ((hi & 0xf0) | (lo & 0x0f)) & 0xff;
    } else this.a = this.nz(r);
  }
  private cmp(reg: number, v: number) {
    const r = reg - v;
    this.flag(C, r >= 0);
    this.nz(r & 0xff);
  }

  private exec(op: Op, addr: number, pc0: number) {
    const m = op.mode;
    const rmw = (f: (v: number) => number) => {
      if (m === 'acc') { this.a = f(this.a); return; }
      const v = this.read(addr);
      this.write(addr, v); // NMOS dummy write
      this.write(addr, f(v));
    };
    switch (op.name) {
      case 'ADC': return this.adc(this.read(addr));
      case 'SBC': return this.sbc(this.read(addr));
      case 'AND': this.a = this.nz(this.a & this.read(addr)); return;
      case 'ORA': this.a = this.nz(this.a | this.read(addr)); return;
      case 'EOR': this.a = this.nz(this.a ^ this.read(addr)); return;
      case 'ASL': return rmw((v) => { this.flag(C, !!(v & 0x80)); return this.nz(v << 1); });
      case 'LSR': return rmw((v) => { this.flag(C, !!(v & 1)); return this.nz(v >> 1); });
      case 'ROL': return rmw((v) => { const c = this.p & C; this.flag(C, !!(v & 0x80)); return this.nz((v << 1) | c); });
      case 'ROR': return rmw((v) => { const c = this.p & C; this.flag(C, !!(v & 1)); return this.nz((v >> 1) | (c << 7)); });
      case 'INC': return rmw((v) => this.nz(v + 1));
      case 'DEC': return rmw((v) => this.nz(v - 1));
      case 'BIT': { const v = this.read(addr); this.flag(Z, !(this.a & v)); this.flag(N, !!(v & N)); this.flag(V, !!(v & V)); return; }
      case 'BCC': return this.branch(!(this.p & C), addr);
      case 'BCS': return this.branch(!!(this.p & C), addr);
      case 'BEQ': return this.branch(!!(this.p & Z), addr);
      case 'BNE': return this.branch(!(this.p & Z), addr);
      case 'BMI': return this.branch(!!(this.p & N), addr);
      case 'BPL': return this.branch(!(this.p & N), addr);
      case 'BVC': return this.branch(!(this.p & V), addr);
      case 'BVS': return this.branch(!!(this.p & V), addr);
      case 'BRK': this.pc = (pc0 + 2) & 0xffff; this.cycles -= 7; this.interrupt(0xfffe, true); return;
      case 'CLC': this.p &= ~C; return;
      case 'CLD': this.p &= ~D; return;
      case 'CLI': this.p &= ~I; return;
      case 'CLV': this.p &= ~V; return;
      case 'SEC': this.p |= C; return;
      case 'SED': this.p |= D; return;
      case 'SEI': this.p |= I; return;
      case 'CMP': return this.cmp(this.a, this.read(addr));
      case 'CPX': return this.cmp(this.x, this.read(addr));
      case 'CPY': return this.cmp(this.y, this.read(addr));
      case 'DEX': this.x = this.nz(this.x - 1); return;
      case 'DEY': this.y = this.nz(this.y - 1); return;
      case 'INX': this.x = this.nz(this.x + 1); return;
      case 'INY': this.y = this.nz(this.y + 1); return;
      case 'JMP': this.pc = addr; return;
      case 'JSR': { const ret = (pc0 + 2) & 0xffff; this.push(ret >> 8); this.push(ret & 0xff); this.pc = addr; return; }
      case 'RTS': this.pc = ((this.pull() | (this.pull() << 8)) + 1) & 0xffff; return;
      case 'RTI': this.p = (this.pull() | U) & ~B; this.pc = this.pull() | (this.pull() << 8); return;
      case 'LDA': this.a = this.nz(this.read(addr)); return;
      case 'LDX': this.x = this.nz(this.read(addr)); return;
      case 'LDY': this.y = this.nz(this.read(addr)); return;
      case 'STA': this.write(addr, this.a); return;
      case 'STX': this.write(addr, this.x); return;
      case 'STY': this.write(addr, this.y); return;
      case 'NOP': return;
      case 'PHA': this.push(this.a); return;
      case 'PHP': this.push(this.p | B | U); return;
      case 'PLA': this.a = this.nz(this.pull()); return;
      case 'PLP': this.p = (this.pull() | U) & ~B; return;
      case 'TAX': this.x = this.nz(this.a); return;
      case 'TAY': this.y = this.nz(this.a); return;
      case 'TSX': this.x = this.nz(this.s); return;
      case 'TXA': this.a = this.nz(this.x); return;
      case 'TXS': this.s = this.x; return;
      case 'TYA': this.a = this.nz(this.y); return;
    }
  }
}

/** Length of undocumented NMOS opcodes (so a stray one does not derail decoding). */
function illegalLen(op: number): number {
  const lo = op & 0x1f;
  if ([0x0b, 0x2b, 0x4b, 0x6b, 0x8b, 0xab, 0xcb, 0xeb].includes(op)) return 2;
  if ([0x02, 0x12, 0x22, 0x32, 0x42, 0x52, 0x62, 0x72, 0x92, 0xb2, 0xd2, 0xf2].includes(op)) return 1; // JAM
  if (lo === 0x03 || lo === 0x13 || lo === 0x04 || lo === 0x14 || lo === 0x07 || lo === 0x17 || lo === 0x80 || lo === 0x82 || lo === 0x89 || lo === 0xc2 || lo === 0xe2) return 2;
  if (lo === 0x0c || lo === 0x1c || lo === 0x0f || lo === 0x1f || lo === 0x1b) return 3;
  return 1;
}
