//! NMOS 6502 core (SY6502A), cycle-counted, documented opcodes + decimal mode.
//! Port of `sim/src/machine/cpu6502.ts`: same cycle accounting (cycles are added before the operand access),
//! same bus access order (read-modify-write does a dummy write), same quirks. Undocumented opcodes run as NOPs
//! of the right length and are counted in `illegal`.

pub trait Bus {
    fn read(&mut self, addr: u16) -> u8;
    fn write(&mut self, addr: u16, v: u8);
    /// The CPU's cycle count as seen by the instruction's operand access (TS: `cpu.cycles` read by the board
    /// during a bus access). Called after the instruction's cycles (and page penalty) are added.
    fn set_now(&mut self, _cycles: u64) {}
}

const C: u8 = 0x01;
const Z: u8 = 0x02;
const I: u8 = 0x04;
const D: u8 = 0x08;
const B: u8 = 0x10;
const U: u8 = 0x20;
const V: u8 = 0x40;
const N: u8 = 0x80;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Mode { Imp, Acc, Imm, Zp, Zpx, Zpy, Abs, Abx, Aby, Ind, Izx, Izy, Rel }

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Name {
    Adc, And, Asl, Bcc, Bcs, Beq, Bmi, Bne, Bpl, Bvc, Bvs, Bit, Brk, Clc, Cld, Cli, Clv, Cmp, Cpx, Cpy, Dec, Dex,
    Dey, Eor, Inc, Inx, Iny, Jmp, Jsr, Lda, Ldx, Ldy, Lsr, Nop, Ora, Pha, Php, Pla, Plp, Rol, Ror, Rti, Rts, Sbc,
    Sec, Sed, Sei, Sta, Stx, Sty, Tax, Tay, Tsx, Txa, Txs, Tya,
}

#[derive(Clone, Copy, Debug)]
struct Op { name: Name, mode: Mode, cycles: u8, page_penalty: bool }

const fn len(m: Mode) -> u16 {
    match m {
        Mode::Imp | Mode::Acc => 1,
        Mode::Abs | Mode::Abx | Mode::Aby | Mode::Ind => 3,
        _ => 2,
    }
}

fn table() -> [Option<Op>; 256] {
    use Mode::*;
    use Name::*;
    let mut t: [Option<Op>; 256] = [None; 256];
    let mut g = |name: Name, list: &[(u8, Mode, u8, bool)]| {
        for &(c, m, cy, p) in list {
            t[c as usize] = Some(Op { name, mode: m, cycles: cy, page_penalty: p });
        }
    };
    g(Adc, &[(0x69, Imm, 2, false), (0x65, Zp, 3, false), (0x75, Zpx, 4, false), (0x6d, Abs, 4, false), (0x7d, Abx, 4, true), (0x79, Aby, 4, true), (0x61, Izx, 6, false), (0x71, Izy, 5, true)]);
    g(And, &[(0x29, Imm, 2, false), (0x25, Zp, 3, false), (0x35, Zpx, 4, false), (0x2d, Abs, 4, false), (0x3d, Abx, 4, true), (0x39, Aby, 4, true), (0x21, Izx, 6, false), (0x31, Izy, 5, true)]);
    g(Asl, &[(0x0a, Acc, 2, false), (0x06, Zp, 5, false), (0x16, Zpx, 6, false), (0x0e, Abs, 6, false), (0x1e, Abx, 7, false)]);
    g(Bcc, &[(0x90, Rel, 2, false)]);
    g(Bcs, &[(0xb0, Rel, 2, false)]);
    g(Beq, &[(0xf0, Rel, 2, false)]);
    g(Bmi, &[(0x30, Rel, 2, false)]);
    g(Bne, &[(0xd0, Rel, 2, false)]);
    g(Bpl, &[(0x10, Rel, 2, false)]);
    g(Bvc, &[(0x50, Rel, 2, false)]);
    g(Bvs, &[(0x70, Rel, 2, false)]);
    g(Bit, &[(0x24, Zp, 3, false), (0x2c, Abs, 4, false)]);
    g(Brk, &[(0x00, Imp, 7, false)]);
    g(Clc, &[(0x18, Imp, 2, false)]);
    g(Cld, &[(0xd8, Imp, 2, false)]);
    g(Cli, &[(0x58, Imp, 2, false)]);
    g(Clv, &[(0xb8, Imp, 2, false)]);
    g(Cmp, &[(0xc9, Imm, 2, false), (0xc5, Zp, 3, false), (0xd5, Zpx, 4, false), (0xcd, Abs, 4, false), (0xdd, Abx, 4, true), (0xd9, Aby, 4, true), (0xc1, Izx, 6, false), (0xd1, Izy, 5, true)]);
    g(Cpx, &[(0xe0, Imm, 2, false), (0xe4, Zp, 3, false), (0xec, Abs, 4, false)]);
    g(Cpy, &[(0xc0, Imm, 2, false), (0xc4, Zp, 3, false), (0xcc, Abs, 4, false)]);
    g(Dec, &[(0xc6, Zp, 5, false), (0xd6, Zpx, 6, false), (0xce, Abs, 6, false), (0xde, Abx, 7, false)]);
    g(Dex, &[(0xca, Imp, 2, false)]);
    g(Dey, &[(0x88, Imp, 2, false)]);
    g(Eor, &[(0x49, Imm, 2, false), (0x45, Zp, 3, false), (0x55, Zpx, 4, false), (0x4d, Abs, 4, false), (0x5d, Abx, 4, true), (0x59, Aby, 4, true), (0x41, Izx, 6, false), (0x51, Izy, 5, true)]);
    g(Inc, &[(0xe6, Zp, 5, false), (0xf6, Zpx, 6, false), (0xee, Abs, 6, false), (0xfe, Abx, 7, false)]);
    g(Inx, &[(0xe8, Imp, 2, false)]);
    g(Iny, &[(0xc8, Imp, 2, false)]);
    g(Jmp, &[(0x4c, Abs, 3, false), (0x6c, Ind, 5, false)]);
    g(Jsr, &[(0x20, Abs, 6, false)]);
    g(Lda, &[(0xa9, Imm, 2, false), (0xa5, Zp, 3, false), (0xb5, Zpx, 4, false), (0xad, Abs, 4, false), (0xbd, Abx, 4, true), (0xb9, Aby, 4, true), (0xa1, Izx, 6, false), (0xb1, Izy, 5, true)]);
    g(Ldx, &[(0xa2, Imm, 2, false), (0xa6, Zp, 3, false), (0xb6, Zpy, 4, false), (0xae, Abs, 4, false), (0xbe, Aby, 4, true)]);
    g(Ldy, &[(0xa0, Imm, 2, false), (0xa4, Zp, 3, false), (0xb4, Zpx, 4, false), (0xac, Abs, 4, false), (0xbc, Abx, 4, true)]);
    g(Lsr, &[(0x4a, Acc, 2, false), (0x46, Zp, 5, false), (0x56, Zpx, 6, false), (0x4e, Abs, 6, false), (0x5e, Abx, 7, false)]);
    g(Nop, &[(0xea, Imp, 2, false)]);
    g(Ora, &[(0x09, Imm, 2, false), (0x05, Zp, 3, false), (0x15, Zpx, 4, false), (0x0d, Abs, 4, false), (0x1d, Abx, 4, true), (0x19, Aby, 4, true), (0x01, Izx, 6, false), (0x11, Izy, 5, true)]);
    g(Pha, &[(0x48, Imp, 3, false)]);
    g(Php, &[(0x08, Imp, 3, false)]);
    g(Pla, &[(0x68, Imp, 4, false)]);
    g(Plp, &[(0x28, Imp, 4, false)]);
    g(Rol, &[(0x2a, Acc, 2, false), (0x26, Zp, 5, false), (0x36, Zpx, 6, false), (0x2e, Abs, 6, false), (0x3e, Abx, 7, false)]);
    g(Ror, &[(0x6a, Acc, 2, false), (0x66, Zp, 5, false), (0x76, Zpx, 6, false), (0x6e, Abs, 6, false), (0x7e, Abx, 7, false)]);
    g(Rti, &[(0x40, Imp, 6, false)]);
    g(Rts, &[(0x60, Imp, 6, false)]);
    g(Sbc, &[(0xe9, Imm, 2, false), (0xe5, Zp, 3, false), (0xf5, Zpx, 4, false), (0xed, Abs, 4, false), (0xfd, Abx, 4, true), (0xf9, Aby, 4, true), (0xe1, Izx, 6, false), (0xf1, Izy, 5, true)]);
    g(Sec, &[(0x38, Imp, 2, false)]);
    g(Sed, &[(0xf8, Imp, 2, false)]);
    g(Sei, &[(0x78, Imp, 2, false)]);
    g(Sta, &[(0x85, Zp, 3, false), (0x95, Zpx, 4, false), (0x8d, Abs, 4, false), (0x9d, Abx, 5, false), (0x99, Aby, 5, false), (0x81, Izx, 6, false), (0x91, Izy, 6, false)]);
    g(Stx, &[(0x86, Zp, 3, false), (0x96, Zpy, 4, false), (0x8e, Abs, 4, false)]);
    g(Sty, &[(0x84, Zp, 3, false), (0x94, Zpx, 4, false), (0x8c, Abs, 4, false)]);
    g(Tax, &[(0xaa, Imp, 2, false)]);
    g(Tay, &[(0xa8, Imp, 2, false)]);
    g(Tsx, &[(0xba, Imp, 2, false)]);
    g(Txa, &[(0x8a, Imp, 2, false)]);
    g(Txs, &[(0x9a, Imp, 2, false)]);
    g(Tya, &[(0x98, Imp, 2, false)]);
    t
}

/// Length of undocumented NMOS opcodes (same table as the TypeScript core, quirks included).
fn illegal_len(op: u8) -> u16 {
    let lo = op & 0x1f;
    if [0x0b, 0x2b, 0x4b, 0x6b, 0x8b, 0xab, 0xcb, 0xeb].contains(&op) {
        return 2;
    }
    if [0x02, 0x12, 0x22, 0x32, 0x42, 0x52, 0x62, 0x72, 0x92, 0xb2, 0xd2, 0xf2].contains(&op) {
        return 1; // JAM
    }
    if [0x03, 0x13, 0x04, 0x14, 0x07, 0x17].contains(&lo) {
        return 2; // (the TS table also lists 0x80.. values that `op & 0x1f` can never equal)
    }
    if [0x0c, 0x1c, 0x0f, 0x1f, 0x1b].contains(&lo) {
        return 3;
    }
    1
}

pub struct Cpu {
    pub a: u8,
    pub x: u8,
    pub y: u8,
    pub s: u8,
    pub p: u8,
    pub pc: u16,
    pub cycles: u64,
    pub illegal: u32,
    nmi_pending: bool,
    nmi_line: bool,
    /// level-triggered, asserted by peripherals
    pub irq_line: bool,
    ops: [Option<Op>; 256],
}

impl Default for Cpu {
    fn default() -> Self { Self::new() }
}

impl Cpu {
    pub fn new() -> Self {
        Cpu { a: 0, x: 0, y: 0, s: 0xfd, p: I | U, pc: 0, cycles: 0, illegal: 0, nmi_pending: false, nmi_line: false, irq_line: false, ops: table() }
    }

    pub fn reset(&mut self, bus: &mut impl Bus) {
        self.s = 0xfd;
        self.p = I | U;
        self.pc = read16(bus, 0xfffc);
        self.cycles += 7;
    }

    /// NMI is edge-triggered on the falling edge of /NMI; pass the asserted state of the line.
    pub fn set_nmi(&mut self, asserted: bool) {
        if asserted && !self.nmi_line {
            self.nmi_pending = true;
        }
        self.nmi_line = asserted;
    }

    fn push(&mut self, bus: &mut impl Bus, v: u8) {
        bus.write(0x100 | self.s as u16, v);
        self.s = self.s.wrapping_sub(1);
    }
    fn pull(&mut self, bus: &mut impl Bus) -> u8 {
        self.s = self.s.wrapping_add(1);
        bus.read(0x100 | self.s as u16)
    }
    fn nz(&mut self, v: u8) -> u8 {
        self.p = (self.p & !(N | Z)) | (v & N) | if v == 0 { Z } else { 0 };
        v
    }
    fn flag(&mut self, f: u8, on: bool) {
        if on { self.p |= f } else { self.p &= !f }
    }

    fn interrupt(&mut self, bus: &mut impl Bus, vector: u16, brk: bool) {
        self.push(bus, (self.pc >> 8) as u8);
        self.push(bus, self.pc as u8);
        let pv = (self.p | U | if brk { B } else { 0 }) & !(if brk { 0 } else { B });
        self.push(bus, pv);
        self.p |= I;
        self.pc = read16(bus, vector);
        self.cycles += 7;
    }

    /// Executes one instruction (or takes a pending interrupt). Returns the cycles used.
    pub fn step(&mut self, bus: &mut impl Bus) -> u32 {
        let start = self.cycles;
        if self.nmi_pending {
            self.nmi_pending = false;
            self.interrupt(bus, 0xfffa, false);
            return (self.cycles - start) as u32;
        }
        if self.irq_line && self.p & I == 0 {
            self.interrupt(bus, 0xfffe, false);
            return (self.cycles - start) as u32;
        }
        let opc = bus.read(self.pc);
        let Some(op) = self.ops[opc as usize] else {
            self.illegal += 1;
            self.pc = self.pc.wrapping_add(illegal_len(opc));
            self.cycles += 2;
            return 2;
        };
        let pc0 = self.pc;
        self.pc = self.pc.wrapping_add(len(op.mode));
        self.cycles += op.cycles as u64;
        bus.set_now(self.cycles);
        let mut addr: u16 = 0;
        let mut crossed = false;
        match op.mode {
            Mode::Imm => addr = pc0.wrapping_add(1),
            Mode::Zp => addr = bus.read(pc0.wrapping_add(1)) as u16,
            Mode::Zpx => addr = bus.read(pc0.wrapping_add(1)).wrapping_add(self.x) as u16,
            Mode::Zpy => addr = bus.read(pc0.wrapping_add(1)).wrapping_add(self.y) as u16,
            Mode::Abs => addr = read16(bus, pc0.wrapping_add(1)),
            Mode::Abx => {
                let b = read16(bus, pc0.wrapping_add(1));
                addr = b.wrapping_add(self.x as u16);
                crossed = b & 0xff00 != addr & 0xff00;
            }
            Mode::Aby => {
                let b = read16(bus, pc0.wrapping_add(1));
                addr = b.wrapping_add(self.y as u16);
                crossed = b & 0xff00 != addr & 0xff00;
            }
            Mode::Ind => {
                let ptr = read16(bus, pc0.wrapping_add(1));
                let lo = bus.read(ptr) as u16;
                let hi = bus.read((ptr & 0xff00) | (ptr.wrapping_add(1) & 0xff)) as u16; // NMOS page-wrap bug
                addr = lo | hi << 8;
            }
            Mode::Izx => {
                let z = bus.read(pc0.wrapping_add(1)).wrapping_add(self.x);
                addr = read16zp(bus, z);
            }
            Mode::Izy => {
                let z = bus.read(pc0.wrapping_add(1));
                let b = read16zp(bus, z);
                addr = b.wrapping_add(self.y as u16);
                crossed = b & 0xff00 != addr & 0xff00;
            }
            Mode::Rel => {
                let o = bus.read(pc0.wrapping_add(1)) as i8;
                addr = self.pc.wrapping_add(o as i16 as u16);
            }
            Mode::Imp | Mode::Acc => {}
        }
        if crossed && op.page_penalty {
            self.cycles += 1;
            bus.set_now(self.cycles);
        }
        self.exec(bus, op, addr, pc0);
        (self.cycles - start) as u32
    }

    fn branch(&mut self, cond: bool, addr: u16) {
        if !cond {
            return;
        }
        self.cycles += if self.pc & 0xff00 == addr & 0xff00 { 1 } else { 2 };
        self.pc = addr;
    }

    fn adc(&mut self, v: u8) {
        let c = (self.p & C) as i32;
        let (a, vi) = (self.a as i32, v as i32);
        if self.p & D != 0 {
            let mut lo = (a & 0x0f) + (vi & 0x0f) + c;
            let mut hi = (a & 0xf0) + (vi & 0xf0);
            if lo > 9 {
                lo += 6;
            }
            if lo > 0x0f {
                hi += 0x10;
            }
            let bin = (a + vi + c) & 0xff;
            self.flag(Z, bin == 0);
            self.flag(N, hi & 0x80 != 0);
            self.flag(V, !(a ^ vi) & (a ^ hi) & 0x80 != 0);
            if hi > 0x90 {
                hi += 0x60;
            }
            self.flag(C, hi > 0xff);
            self.a = (((hi & 0xf0) | (lo & 0x0f)) & 0xff) as u8;
        } else {
            let r = a + vi + c;
            self.flag(V, !(a ^ vi) & (a ^ r) & 0x80 != 0);
            self.flag(C, r > 0xff);
            self.a = self.nz(r as u8);
        }
    }

    fn sbc(&mut self, v: u8) {
        let c = (self.p & C) as i32;
        let (a, vi) = (self.a as i32, v as i32);
        let r = a - vi - (1 - c);
        self.flag(V, (a ^ vi) & (a ^ r) & 0x80 != 0);
        self.flag(C, r >= 0);
        if self.p & D != 0 {
            let mut lo = (a & 0x0f) - (vi & 0x0f) - (1 - c);
            let mut hi = (a & 0xf0) - (vi & 0xf0);
            if lo & 0x10 != 0 {
                lo -= 6;
                hi -= 0x10;
            }
            if hi & 0x100 != 0 {
                hi -= 0x60;
            }
            self.nz((r & 0xff) as u8);
            self.a = (((hi & 0xf0) | (lo & 0x0f)) & 0xff) as u8;
        } else {
            self.a = self.nz(r as u8);
        }
    }

    fn cmp(&mut self, reg: u8, v: u8) {
        let r = reg as i32 - v as i32;
        self.flag(C, r >= 0);
        self.nz((r & 0xff) as u8);
    }

    fn rmw(&mut self, bus: &mut impl Bus, mode: Mode, addr: u16, f: impl Fn(&mut Self, u8) -> u8) {
        if mode == Mode::Acc {
            let a = self.a;
            self.a = f(self, a);
            return;
        }
        let v = bus.read(addr);
        bus.write(addr, v); // NMOS dummy write
        let r = f(self, v);
        bus.write(addr, r);
    }

    fn exec(&mut self, bus: &mut impl Bus, op: Op, addr: u16, pc0: u16) {
        use Name::*;
        let m = op.mode;
        match op.name {
            Adc => { let v = bus.read(addr); self.adc(v) }
            Sbc => { let v = bus.read(addr); self.sbc(v) }
            And => { let v = bus.read(addr); self.a = self.nz(self.a & v) }
            Ora => { let v = bus.read(addr); self.a = self.nz(self.a | v) }
            Eor => { let v = bus.read(addr); self.a = self.nz(self.a ^ v) }
            Asl => self.rmw(bus, m, addr, |s, v| { s.flag(C, v & 0x80 != 0); s.nz(v << 1) }),
            Lsr => self.rmw(bus, m, addr, |s, v| { s.flag(C, v & 1 != 0); s.nz(v >> 1) }),
            Rol => self.rmw(bus, m, addr, |s, v| { let c = s.p & C; s.flag(C, v & 0x80 != 0); s.nz((v << 1) | c) }),
            Ror => self.rmw(bus, m, addr, |s, v| { let c = s.p & C; s.flag(C, v & 1 != 0); s.nz((v >> 1) | (c << 7)) }),
            Inc => self.rmw(bus, m, addr, |s, v| s.nz(v.wrapping_add(1))),
            Dec => self.rmw(bus, m, addr, |s, v| s.nz(v.wrapping_sub(1))),
            Bit => {
                let v = bus.read(addr);
                self.flag(Z, self.a & v == 0);
                self.flag(N, v & N != 0);
                self.flag(V, v & V != 0);
            }
            Bcc => self.branch(self.p & C == 0, addr),
            Bcs => self.branch(self.p & C != 0, addr),
            Beq => self.branch(self.p & Z != 0, addr),
            Bne => self.branch(self.p & Z == 0, addr),
            Bmi => self.branch(self.p & N != 0, addr),
            Bpl => self.branch(self.p & N == 0, addr),
            Bvc => self.branch(self.p & V == 0, addr),
            Bvs => self.branch(self.p & V != 0, addr),
            Brk => {
                self.pc = pc0.wrapping_add(2);
                self.cycles -= 7;
                self.interrupt(bus, 0xfffe, true);
            }
            Clc => self.p &= !C,
            Cld => self.p &= !D,
            Cli => self.p &= !I,
            Clv => self.p &= !V,
            Sec => self.p |= C,
            Sed => self.p |= D,
            Sei => self.p |= I,
            Cmp => { let v = bus.read(addr); self.cmp(self.a, v) }
            Cpx => { let v = bus.read(addr); self.cmp(self.x, v) }
            Cpy => { let v = bus.read(addr); self.cmp(self.y, v) }
            Dex => self.x = self.nz(self.x.wrapping_sub(1)),
            Dey => self.y = self.nz(self.y.wrapping_sub(1)),
            Inx => self.x = self.nz(self.x.wrapping_add(1)),
            Iny => self.y = self.nz(self.y.wrapping_add(1)),
            Jmp => self.pc = addr,
            Jsr => {
                let ret = pc0.wrapping_add(2);
                self.push(bus, (ret >> 8) as u8);
                self.push(bus, ret as u8);
                self.pc = addr;
            }
            Rts => {
                let lo = self.pull(bus) as u16;
                let hi = self.pull(bus) as u16;
                self.pc = (lo | hi << 8).wrapping_add(1);
            }
            Rti => {
                self.p = (self.pull(bus) | U) & !B;
                let lo = self.pull(bus) as u16;
                let hi = self.pull(bus) as u16;
                self.pc = lo | hi << 8;
            }
            Lda => { let v = bus.read(addr); self.a = self.nz(v) }
            Ldx => { let v = bus.read(addr); self.x = self.nz(v) }
            Ldy => { let v = bus.read(addr); self.y = self.nz(v) }
            Sta => bus.write(addr, self.a),
            Stx => bus.write(addr, self.x),
            Sty => bus.write(addr, self.y),
            Nop => {}
            Pha => self.push(bus, self.a),
            Php => self.push(bus, self.p | B | U),
            Pla => { let v = self.pull(bus); self.a = self.nz(v) }
            Plp => self.p = (self.pull(bus) | U) & !B,
            Tax => self.x = self.nz(self.a),
            Tay => self.y = self.nz(self.a),
            Tsx => self.x = self.nz(self.s),
            Txa => self.a = self.nz(self.x),
            Txs => self.s = self.x,
            Tya => self.a = self.nz(self.y),
        }
    }
}

fn read16(bus: &mut impl Bus, a: u16) -> u16 {
    bus.read(a) as u16 | (bus.read(a.wrapping_add(1)) as u16) << 8
}
fn read16zp(bus: &mut impl Bus, a: u8) -> u16 {
    bus.read(a as u16) as u16 | (bus.read(a.wrapping_add(1) as u16) as u16) << 8
}
