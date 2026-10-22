//! Voyetra Eight Rev4 CPU card + DAC card + panel + VPK-5, at the level the firmware sees it.
//! Port of `sim/src/machine/machine.ts` (docs/hardware.md). Adds a cycle-stamped event log of every analog
//! write (S&H samples and control latches) for the sound engine; it does not change behaviour.

use crate::chips::{Acia6850, I8279, Pia6821, Ptm6840};
use crate::cpu::{Bus, Cpu};
use crate::vco::VcoBank;

pub const CPU_HZ: u32 = 2_000_000;

/// pot-mux channel of each stock pot index ($E0CB) — used to place panel pots on the mux
pub const POT_MUX_CHANNEL: [usize; 16] = [1, 9, 5, 10, 7, 13, 4, 12, 6, 15, 3, 8, 0, 11, 14, 2];

/// Decoded analog-control state (docs/hardware.md §4).
#[derive(Clone)]
pub struct Ctl {
    pub ic1: u8,
    pub ic2: u8,
    pub ic3: u8,
    pub ic22: u8,
    pub ic23: u8,
    /// ANA I CD22100 crosspoint $65aa closed (D7)
    pub xpoint: [u8; 256],
    /// DIGIMOD 74LS670: [chip*4 + word] = D4-7
    pub ls670: [u8; 8],
}

impl Default for Ctl {
    fn default() -> Self { Ctl { ic1: 0, ic2: 0, ic3: 0, ic22: 0, ic23: 0, xpoint: [0; 256], ls670: [0; 8] } }
}

impl Ctl {
    /// Apply a write to the control-latch area $6000-$67FF. `slot` = the S&H address at the time ($7F selects
    /// IC22 for $64xx). Returns true when IC22 (the pot / tune mux address) changed.
    pub fn apply(&mut self, a: u16, v: u8, slot: u8) -> bool {
        let b = (a & 7) as u8;
        let bit = |cur: u8| (cur & !(1 << b)) | (((v >> 7) & 1) << b);
        let page = a >> 8;
        match page {
            0x61 => self.ic1 = bit(self.ic1),
            0x62 => self.ic2 = bit(self.ic2),
            0x63 => self.ic3 = bit(self.ic3),
            0x64 if a & 0xf8 == 0 => {
                if slot == 0x7f { self.ic22 = bit(self.ic22); return true; }
                self.ic23 = bit(self.ic23);
            }
            0x65 => self.xpoint[(a & 0xff) as usize] = (v >> 7) & 1,
            0x66 | 0x67 => self.ls670[((page - 0x66) * 4 + ((a >> 3) & 3)) as usize] = (v >> 4) & 0x0f,
            _ => {}
        }
        false
    }
}

/// An analog write, stamped with the CPU cycle count at the moment of the write.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AnalogEvent {
    /// S&H slot sampled (0..127, 128..135 = MIDI-controller bank): 14-bit DAC word, DAC1022 multiplier
    Cv { cycle: u64, slot: u8, value: u16, mult: u8 },
    /// write to the control-latch area $6000-$67FF (CD4724s, crosspoints, LS670s); `slot` = S&H address at
    /// the time (selects IC22 vs IC23 for $64xx)
    Latch { cycle: u64, addr: u16, data: u8, slot: u8 },
}

#[derive(Clone, Copy)]
struct Vpk { t: u64, delay: u64 }

/// Everything on the bus except the CPU.
pub struct Hw {
    pub ram: Box<[u8; 0x2000]>,
    pub bram: Box<[u8; 0x2000]>,
    pub rom: Box<[u8; 0x8000]>,
    pub kd: I8279,
    pub pia1: Pia6821,
    pub pia2: Pia6821,
    pub ptm: Ptm6840,
    pub acia: Acia6850,
    pub mem_protect: bool,
    pub cv: [u16; 136],
    pub cv_mult: [u8; 136],
    pub cv_writes: [u32; 136],
    slot: u8,
    pub ctl: Ctl,
    pub mux_latch: u8,
    /// pot voltages by mux channel, 0..1023
    pub pot_by_channel: [f64; 16],
    vpk: [Option<Vpk>; 128],
    vpk_clock: u32,
    pub vpk_rev: bool,
    pub vpk_fwd: bool,
    pub vco: Option<VcoBank>,
    /// when Some, every analog write is appended here
    pub events: Option<Vec<AnalogEvent>>,
    now: u64,
}

pub struct Machine {
    pub cpu: Cpu,
    pub hw: Hw,
    pub irq_count: u64,
    pub nmi_count: u64,
    nmi_line: bool,
}

impl Machine {
    pub fn new(rom: &[u8]) -> Self {
        let mut r = Box::new([0u8; 0x8000]);
        let n = rom.len().min(0x8000);
        r[..n].copy_from_slice(&rom[..n]);
        let mut hw = Hw {
            ram: Box::new([0; 0x2000]),
            bram: Box::new([0; 0x2000]),
            rom: r,
            kd: I8279::default(),
            pia1: Pia6821::new(),
            pia2: Pia6821::new(),
            ptm: Ptm6840::default(),
            acia: Acia6850::default(),
            mem_protect: false,
            cv: [0; 136],
            cv_mult: [0; 136],
            cv_writes: [0; 136],
            slot: 0,
            ctl: Ctl::default(),
            mux_latch: 0,
            pot_by_channel: [512.0; 16],
            vpk: [None; 128],
            vpk_clock: 0,
            vpk_rev: false,
            vpk_fwd: false,
            vco: None,
            events: None,
            now: 0,
        };
        hw.bram[0x0fff] = 0xaa; // $4FFF sentinel the stock ROM waits for at boot
        hw.pia1.in_a = 0x00;
        hw.pia1.in_b = 0x00;
        hw.pia2.in_b = 0x3f; // footswitches open, cassette low
        Machine { cpu: Cpu::new(), hw, irq_count: 0, nmi_count: 0, nmi_line: false }
    }

    pub fn reset(&mut self) { self.cpu.reset(&mut self.hw); }

    pub fn set_bram(&mut self, bram: &[u8]) {
        let n = bram.len().min(0x2000);
        self.hw.bram[..n].copy_from_slice(&bram[..n]);
    }

    /// velocity 1..127 -> time between the two contacts (fast strike = short)
    pub fn key_down(&mut self, note: u8, velocity: u8) {
        if !(36..=96).contains(&note) { return; }
        let v = velocity.clamp(1, 127) as f64;
        let ticks = 1.0 + (((127.0 - v) / 126.0) * 40.0).round();
        let delay = ((ticks - 0.5) * 4097.0).round() as u64;
        self.hw.vpk[note as usize] = Some(Vpk { t: self.cpu.cycles, delay });
    }
    pub fn key_up(&mut self, note: u8) { self.hw.vpk[note as usize & 127] = None; }

    pub fn run(&mut self, cycles: u64) {
        let end = self.cpu.cycles + cycles;
        while self.cpu.cycles < end {
            let used = self.cpu.step(&mut self.hw);
            let hw = &mut self.hw;
            if let Some(vco) = hw.vco.as_mut() {
                let t0 = (self.cpu.cycles - used as u64) as f64;
                vco.clock(t0, used, &hw.pia1, &hw.ctl, &hw.cv, &hw.cv_mult, &mut hw.ptm);
            } else {
                hw.ptm.clock(used, &[]);
            }
            hw.acia.clock(used);
            let irq = hw.pia1.irq_a() || hw.pia1.irq_b() || hw.pia2.irq_a() || hw.pia2.irq_b() || hw.ptm.irq();
            if irq && !self.cpu.irq_line { self.irq_count += 1; }
            self.cpu.irq_line = irq;
            let nmi = hw.acia.irq();
            if nmi && !self.nmi_line { self.nmi_count += 1; }
            self.nmi_line = nmi;
            self.cpu.set_nmi(nmi);
        }
    }
}

impl Hw {
    fn decode_ctl(&mut self, a: u16, v: u8) {
        if self.ctl.apply(a, v, self.slot) { self.mux_latch = self.ctl.ic22; }
    }

    fn pot_panel(&mut self, n: u16, is_write: bool) -> u8 {
        match n {
            0 => { self.vpk_clock += 1; 0 }
            1 => { self.vpk_clock = 0; 0 }
            4 => { if is_write { self.sample(self.slot & 0x7f); } 0 }
            5 => self.vpk_line(false),
            6 => self.vpk_line(true),
            _ => 0,
        }
    }

    fn sample(&mut self, slot: u8) {
        let s = slot as usize;
        let value = (((self.pia1.port_a() & 0x7f) as u16) << 7) | (self.pia1.port_b() >> 1) as u16;
        let mult = self.pia2.port_a();
        self.cv[s] = value;
        self.cv_mult[s] = mult;
        self.cv_writes[s] = self.cv_writes[s].wrapping_add(1);
        if let Some(ev) = self.events.as_mut() { ev.push(AnalogEvent::Cv { cycle: self.now, slot, value, mult }); }
    }

    /// LM339: pot voltage vs DAC (8-bit SAR on PA6..0 + PB7). PB0 = 1 when the DAC is above the pot.
    fn update_comparator(&mut self) {
        let dac8 = (((self.pia1.port_a() & 0x7f) as u32) << 1) | ((self.pia1.orb >> 7) & 1) as u32;
        let pot8 = ((self.pot_by_channel[(self.mux_latch & 15) as usize] / 1023.0) * 255.0).round() as u32;
        self.pia1.in_b = (self.pia1.in_b & 0xfe) | (dac8 > pot8) as u8;
    }

    /// Header = 7 clocks after DSTR; then key X (60..0) is read before its clock: position = 7 + (60 - X).
    fn vpk_line(&mut self, line_b: bool) -> u8 {
        let pos = self.vpk_clock as i32 - 7 - line_b as i32;
        if pos < 0 {
            if !line_b && self.vpk_clock == 2 { return if self.vpk_rev { 0 } else { 0x80 }; }
            if line_b && self.vpk_clock == 3 { return if self.vpk_fwd { 0 } else { 0x80 }; }
            return 0x80;
        }
        let x = 60 - pos;
        if !(0..=60).contains(&x) { return if line_b { 0x80 } else { 0 }; }
        let note = ((x ^ 0x3f) + 0x21) as usize;
        let k = self.vpk.get(note).copied().flatten();
        if !line_b { return if k.is_some() { 0x80 } else { 0 }; }
        let closed = k.is_some_and(|k| self.now.saturating_sub(k.t) >= k.delay && self.now >= k.t);
        if closed { 0 } else { 0x80 }
    }
}

impl Bus for Hw {
    fn set_now(&mut self, cycles: u64) { self.now = cycles; }

    fn read(&mut self, a: u16) -> u8 {
        let a = a as usize;
        if a < 0x2000 { return self.ram[a]; }
        if a >= 0x8000 { return self.rom[a - 0x8000]; }
        if (0x4000..0x6000).contains(&a) { return self.bram[a - 0x4000]; }
        if a < 0x2800 { return self.kd.read((a & 1) as u16); }
        if a < 0x3000 { return self.pot_panel((a & 7) as u16, false); }
        if a < 0x3800 { return 0xff; }
        if a < 0x4000 { return self.acia.read((a & 1) as u16); }
        if (0x6800..0x6a00).contains(&a) {
            self.update_comparator();
            if let Some(vco) = self.vco.as_ref() {
                let l = vco.level_at(self.now as f64 - 1.0);
                self.pia1.in_a = (self.pia1.in_a & 0x7f) | if l { 0x80 } else { 0 };
            }
            return self.pia1.read((a & 3) as u16);
        }
        if (0x6a00..0x6c00).contains(&a) { return self.pia2.read((a & 3) as u16); }
        if (0x6c00..0x6e00).contains(&a) { return self.ptm.read((a & 7) as u16); }
        0xff
    }

    fn write(&mut self, a: u16, v: u8) {
        let ai = a as usize;
        if ai < 0x2000 { self.ram[ai] = v; return; }
        if ai >= 0x8000 { return; }
        if (0x4000..0x6000).contains(&ai) { if !self.mem_protect { self.bram[ai - 0x4000] = v; } return; }
        if ai < 0x2800 { self.kd.write(a & 1, v); return; }
        if ai < 0x3000 { self.pot_panel(a & 7, true); return; }
        if ai < 0x3800 {
            self.slot = (a & 0xff) as u8;
            if self.slot >= 0x80 { self.sample(0x80 + (self.slot & 7)); } // MIDI-controller CV bank
            return;
        }
        if ai < 0x4000 { self.acia.write(a & 1, v); return; }
        if (0x6800..0x6a00).contains(&ai) { self.pia1.write(a & 3, v); return; }
        if (0x6a00..0x6c00).contains(&ai) { self.pia2.write(a & 3, v); return; }
        if (0x6c00..0x6e00).contains(&ai) { self.ptm.write(a & 7, v); return; }
        if (0x6000..0x6800).contains(&ai) {
            if let Some(ev) = self.events.as_mut() { ev.push(AnalogEvent::Latch { cycle: self.now, addr: a, data: v, slot: self.slot }); }
            self.decode_ctl(a, v);
        }
    }
}
