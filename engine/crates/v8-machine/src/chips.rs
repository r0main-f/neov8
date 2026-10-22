//! Datasheet-level models of the Voyetra's support chips. Ports of `sim/src/machine/{pia6821,i8279,ptm6840,
//! acia6850}.ts`, kept behaviour-identical (including the PTM's fractional timer-3 prescaler arithmetic).
//! Board wiring lives in machine.rs.

// ------------------------------------------------------------------ Motorola 6821 PIA
#[derive(Default, Clone)]
pub struct Pia6821 {
    pub ora: u8,
    pub orb: u8,
    pub ddra: u8,
    pub ddrb: u8,
    pub cra: u8,
    pub crb: u8,
    /// input pin levels supplied by the board
    pub in_a: u8,
    pub in_b: u8,
}

impl Pia6821 {
    pub fn new() -> Self { Pia6821 { in_a: 0xff, in_b: 0xff, ..Default::default() } }
    fn irq_of(cr: u8) -> bool { (cr & 0x80 != 0 && cr & 1 != 0) || (cr & 0x40 != 0 && cr & 0x08 != 0 && cr & 0x20 == 0) }
    pub fn irq_a(&self) -> bool { Self::irq_of(self.cra) }
    pub fn irq_b(&self) -> bool { Self::irq_of(self.crb) }

    pub fn read(&mut self, rs: u16) -> u8 {
        match rs & 3 {
            0 => {
                if self.cra & 4 == 0 { return self.ddra; }
                self.cra &= 0x3f; // reading port A clears the flags
                (self.ora & self.ddra) | (self.in_a & !self.ddra)
            }
            1 => self.cra,
            2 => {
                if self.crb & 4 == 0 { return self.ddrb; }
                self.crb &= 0x3f;
                (self.orb & self.ddrb) | (self.in_b & !self.ddrb)
            }
            _ => self.crb,
        }
    }
    pub fn write(&mut self, rs: u16, v: u8) {
        match rs & 3 {
            0 => { if self.cra & 4 != 0 { self.ora = v } else { self.ddra = v } }
            1 => self.cra = (self.cra & 0xc0) | (v & 0x3f),
            2 => { if self.crb & 4 != 0 { self.orb = v } else { self.ddrb = v } }
            _ => self.crb = (self.crb & 0xc0) | (v & 0x3f),
        }
    }
    pub fn ca1(&mut self) { self.cra |= 0x80; }
    pub fn cb1(&mut self) { self.crb |= 0x80; }
    /// Effective output levels on the port pins
    pub fn port_a(&self) -> u8 { (self.ora & self.ddra) | (self.in_a & !self.ddra) }
    pub fn port_b(&self) -> u8 { (self.orb & self.ddrb) | (self.in_b & !self.ddrb) }
}

// ------------------------------------------------------------------ Intel 8279 keyboard/display
#[derive(Clone)]
pub struct I8279 {
    /// display RAM as written by the CPU
    pub display: [u8; 16],
    fifo: [u8; 8],
    fifo_n: usize,
    overrun: bool,
    ram_addr: usize,
    auto_inc: bool,
    read_display: bool,
    pub mode: u8,
    pub prescaler: u8,
    pub irq: bool,
}

impl Default for I8279 {
    fn default() -> Self {
        I8279 { display: [0; 16], fifo: [0; 8], fifo_n: 0, overrun: false, ram_addr: 0, auto_inc: false, read_display: false, mode: 0, prescaler: 31, irq: false }
    }
}

impl I8279 {
    /// A0=1: command/status, A0=0: data
    pub fn read(&mut self, a0: u16) -> u8 {
        if a0 != 0 {
            let n = self.fifo_n as u8;
            return (n & 7) | if n >= 8 { 8 } else { 0 } | if self.overrun { 0x20 } else { 0 };
        }
        if self.read_display {
            let v = self.display[self.ram_addr];
            if self.auto_inc { self.ram_addr = (self.ram_addr + 1) & 15; }
            return v;
        }
        let v = if self.fifo_n > 0 {
            let v = self.fifo[0];
            self.fifo.copy_within(1..self.fifo_n, 0);
            self.fifo_n -= 1;
            v
        } else { 0 };
        self.irq = self.fifo_n > 0;
        v
    }

    pub fn write(&mut self, a0: u16, v: u8) {
        if a0 == 0 {
            self.display[self.ram_addr] = v;
            if self.auto_inc { self.ram_addr = (self.ram_addr + 1) & 15; }
            return;
        }
        match v >> 5 {
            0 => self.mode = v & 0x1f,
            1 => self.prescaler = v & 0x1f,
            2 => self.read_display = false,
            3 => { self.read_display = true; self.ram_addr = (v & 15) as usize; self.auto_inc = v & 0x10 != 0; }
            4 => { self.ram_addr = (v & 15) as usize; self.auto_inc = v & 0x10 != 0; }
            5 => {}
            6 => {
                if v & 2 != 0 { self.display = [if v & 0x0c == 0x0c { 0xff } else { 0 }; 16]; }
                if v & 1 != 0 { self.fifo_n = 0; self.overrun = false; self.irq = false; }
            }
            _ => self.irq = self.fifo_n > 0,
        }
    }

    /// Key code as the 8279 reports it in encoded-scan mode: SL2-0 (row) << 3 | RL2-0 (column).
    pub fn press_key(&mut self, code: u8) {
        if self.fifo_n >= 8 { self.overrun = true; return; }
        self.fifo[self.fifo_n] = code;
        self.fifo_n += 1;
        self.irq = true;
    }
    pub fn fifo_count(&self) -> usize { self.fifo_n }
}

// ------------------------------------------------------------------ Motorola 6840 PTM
/// /G1 level change inside a clock() interval: offset in E cycles from its start (may be fractional).
#[derive(Clone, Copy, Debug)]
pub struct GateEvent { pub at: f64, pub level: bool }

#[derive(Clone)]
pub struct Ptm6840 {
    pub cr: [u8; 3],
    pub latch: [u32; 3],
    /// f64 like the TypeScript model: timer 3's ÷8 prescaler counts fractional steps per call
    pub counter: [f64; 3],
    msb_buf: u8,
    lsb_buf: u8,
    pub flags: u8,
    status_read: u8,
    /// gate input levels /G1-/G3 (true = high). Default low = counting enabled.
    pub gate: [bool; 3],
    pub outputs: [bool; 3],
}

impl Default for Ptm6840 {
    fn default() -> Self {
        Ptm6840 { cr: [0; 3], latch: [0xffff; 3], counter: [65535.0; 3], msb_buf: 0, lsb_buf: 0, flags: 0, status_read: 0, gate: [false; 3], outputs: [false; 3] }
    }
}

/// JS `x | 0`-style conversion used by the TS model's bit operations on counters.
fn to_i32(x: f64) -> i32 { x as i64 as i32 }

impl Ptm6840 {
    pub fn irq(&self) -> bool { (0..3).any(|i| self.flags & (1 << i) != 0 && self.cr[i] & 0x40 != 0) }

    pub fn read(&mut self, rs: u16) -> u8 {
        match rs & 7 {
            1 => {
                self.status_read = self.flags;
                self.flags | if self.irq() { 0x80 } else { 0 }
            }
            2 | 4 | 6 => {
                let t = ((rs >> 1) - 1) as usize;
                if self.status_read & (1 << t) != 0 {
                    self.flags &= !(1 << t);
                    self.status_read &= !(1 << t);
                }
                let c = to_i32(self.counter[t]);
                self.lsb_buf = (c & 0xff) as u8;
                (c >> 8) as u8
            }
            3 | 5 | 7 => self.lsb_buf,
            _ => 0,
        }
    }

    pub fn write(&mut self, rs: u16, v: u8) {
        match rs & 7 {
            0 => { if self.cr[1] & 1 != 0 { self.cr[0] = v } else { self.cr[2] = v } }
            1 => self.cr[1] = v,
            2 | 4 | 6 => self.msb_buf = v,
            _ => {
                let t = ((rs >> 1) - 1) as usize;
                self.latch[t] = (self.msb_buf as u32) << 8 | v as u32;
                self.flags &= !(1 << t);
                if self.cr[t] & 0x10 == 0 { self.counter[t] = self.latch[t] as f64; }
            }
        }
    }

    fn gated(&self, t: usize) -> bool { self.cr[t] & 0x08 == 0 }

    /// Advance the timers by `cycles` E cycles (internal clock only). `g1` = /G1 level changes inside this
    /// interval, sorted by `at`.
    pub fn clock(&mut self, cycles: u32, g1: &[GateEvent]) {
        if self.cr[0] & 1 != 0 {
            for t in 0..3 { self.counter[t] = self.latch[t] as f64; }
            for e in g1 { self.gate[0] = e.level; }
            return;
        }
        let cyc = cycles as f64;
        for t in 0..3 {
            if self.cr[t] & 2 == 0 { continue; }
            if t == 0 && !g1.is_empty() {
                let mut a = 0.0f64;
                for e in g1 {
                    let b = e.at.max(a).min(cyc);
                    if !self.gate[0] || !self.gated(0) { self.count(0, b.floor() - a.floor()); }
                    if self.gate[0] && !e.level && self.gated(0) { self.counter[0] = self.latch[0] as f64; }
                    self.gate[0] = e.level;
                    a = b;
                }
                if !self.gate[0] || !self.gated(0) { self.count(0, cyc - a.floor()); }
                continue;
            }
            if self.gate[t] && self.gated(t) { continue; }
            self.count(t, cyc);
        }
    }

    fn count(&mut self, t: usize, cycles: f64) {
        if cycles <= 0.0 { return; }
        let mut n = cycles;
        if t == 2 && self.cr[2] & 1 != 0 { n = cycles / 8.0; }
        let dual8 = self.cr[t] & 4 != 0;
        if !dual8 {
            let mut c = self.counter[t] - n;
            while c < 0.0 {
                self.flags |= 1 << t;
                c += self.latch[t] as f64 + 1.0;
            }
            self.counter[t] = c.floor();
        } else {
            let lsb_l = (self.latch[t] & 0xff) as f64;
            let msb_l = (self.latch[t] >> 8) as f64;
            let ci = to_i32(self.counter[t]);
            let mut lsb = (ci & 0xff) as f64;
            let mut msb = (ci >> 8) as f64;
            let mut left = n;
            while left > 0.0 {
                let step = left.min(lsb + 1.0);
                lsb -= step;
                left -= step;
                if lsb < 0.0 {
                    lsb = lsb_l;
                    if msb == 0.0 {
                        self.flags |= 1 << t;
                        msb = msb_l;
                        self.outputs[t] = !self.outputs[t];
                    } else {
                        msb -= 1.0;
                    }
                }
            }
            self.counter[t] = ((to_i32(msb) << 8) | to_i32(lsb)) as f64;
        }
    }
}

// ------------------------------------------------------------------ Motorola 6850 ACIA
#[derive(Clone)]
pub struct Acia6850 {
    pub control: u8,
    rx: std::collections::VecDeque<u8>,
    rdr: u8,
    rdrf: bool,
    overrun: bool,
    framing: bool,
    in_reset: bool,
    tdr: u8,
    tdr_full: bool,
    /// cycles left for the byte in the shift register; 0 = idle (f64: the TS model decrements by cycles)
    shift_busy: f64,
    rx_timer: f64,
    /// bytes put on MIDI OUT (when they start shifting)
    pub tx_out: Vec<u8>,
    pub rx_lost: u32,
    pub rx_framing_errors: u32,
    pub tx_overwrites: u32,
}

impl Default for Acia6850 {
    fn default() -> Self {
        Acia6850 { control: 0, rx: Default::default(), rdr: 0, rdrf: false, overrun: false, framing: false, in_reset: true, tdr: 0, tdr_full: false, shift_busy: 0.0, rx_timer: 0.0, tx_out: Vec::new(), rx_lost: 0, rx_framing_errors: 0, tx_overwrites: 0 }
    }
}

impl Acia6850 {
    /// 10 bits per MIDI byte at 31250 baud = 320 us = 640 cycles at 2 MHz
    pub const BYTE_CYCLES: f64 = 640.0;

    pub fn tdre(&self) -> bool { !self.tdr_full && !self.in_reset }

    pub fn irq(&self) -> bool {
        if self.in_reset { return false; }
        let rie = self.control & 0x80 != 0;
        let tie = self.control & 0x60 == 0x20;
        (rie && (self.rdrf || self.overrun)) || (tie && self.tdre())
    }

    fn byte_cycles(&self) -> f64 {
        let div = [1.0, 16.0, 64.0, 16.0][(self.control & 3) as usize];
        let ws = ((self.control >> 2) & 7) as usize;
        let bits = [11.0, 11.0, 10.0, 10.0, 11.0, 10.0, 11.0, 11.0][ws];
        ((bits * div * 2_000_000.0) / 500_000.0f64).round()
    }

    pub fn read(&mut self, rs: u16) -> u8 {
        if rs & 1 != 0 {
            let v = self.rdr;
            self.rdrf = false;
            self.overrun = false;
            self.framing = false;
            return v;
        }
        (self.rdrf as u8) | (self.tdre() as u8) << 1 | (self.framing as u8) << 4 | (self.overrun as u8) << 5 | (self.irq() as u8) << 7
    }

    pub fn write(&mut self, rs: u16, v: u8) {
        if rs & 1 != 0 {
            if self.in_reset { return; }
            if self.tdr_full { self.tx_overwrites += 1; }
            self.tdr = v;
            self.tdr_full = true;
            self.start_shift();
            return;
        }
        self.control = v;
        if v & 3 == 3 {
            self.in_reset = true;
            self.rdrf = false;
            self.overrun = false;
            self.framing = false;
            self.tdr_full = false;
            self.shift_busy = 0.0;
        } else {
            self.in_reset = false;
        }
    }

    fn start_shift(&mut self) {
        if self.shift_busy > 0.0 || !self.tdr_full { return; }
        self.tx_out.push(self.tdr);
        self.tdr_full = false;
        self.shift_busy = self.byte_cycles();
    }

    /// queue bytes arriving on MIDI IN; they are delivered one per byte time (back to back at 31250 baud)
    pub fn receive(&mut self, bytes: &[u8]) { self.rx.extend(bytes.iter().copied()); }

    pub fn clock(&mut self, cycles: u32) {
        let c = cycles as f64;
        if self.shift_busy > 0.0 {
            self.shift_busy -= c;
            if self.shift_busy <= 0.0 {
                self.shift_busy = 0.0;
                self.start_shift();
            }
        }
        if !self.rx.is_empty() {
            self.rx_timer -= c;
            if self.rx_timer <= 0.0 {
                self.rx_timer += Self::BYTE_CYCLES;
                if self.rx_timer <= 0.0 { self.rx_timer = Self::BYTE_CYCLES; }
                let b = self.rx.pop_front().unwrap();
                if self.in_reset { return; }
                if self.control & 3 != 1 { self.rx_framing_errors += 1; self.framing = true; return; }
                if self.rdrf { self.overrun = true; self.rx_lost += 1; return; }
                self.rdr = b;
                self.rdrf = true;
            }
        } else if self.rx_timer < 0.0 {
            self.rx_timer = 0.0;
        }
    }
}
