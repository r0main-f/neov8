//! Modulation banks (4 per side): which source, controllers and destinations each bank uses, read back from the
//! CPU's writes to the ANA I crosspoints ($65xx) and the DIGIMOD 74LS670s ($66xx/$67xx).
//!
//! The decode follows the write protocol of the stock Rev4 ROM, which NeoV8 reproduces switch for switch
//! (firmware/src/eng/apply.asm `ap_xpt`, `ap_xpt_repl`, `ap_ls670`; sim/test/fw-eng-apply.test.ts):
//! - matrix cleared (every $65xx written 0) before each reprogramming;
//! - source k (program byte bits 6-4) of bank b, side s: one write to `off + b*4 + (k>>2)*16 + (k&3)` with the
//!   address byte as data (`off` = 0 for side 0, $90 for side 1);
//! - destination d (0 VCO1, 1 VCO2, 2 Fc, 3 Q): one $FF write to `off + $30 + b*16 + d*4 + n*2 + o`, with n = 1 when
//!   the source is NOT inverted and o = 1 when the destination is off;
//! - velocity controller: $80 to `off + $20 + b*4`; replacement (ADSR1 for banks A/B, LF noise for C): one write
//!   to `off + $20 + b*4 + {3, 3, 2}` with that address minus $20 as data (`sta $6520,x` with A = X);
//! - mono controllers (+X, −X, pressure; Fc pedal for bank D): LS670 word `3 − b`, RIGHT chip ($67) for side 0,
//!   LEFT chip ($66) for side 1, data D6 +X, D5 −X, D4 pressure, D7 pedal (1 = on).
//!
//! The physical meaning of each switch (which wire it joins) is in docs/audio-model.md §5.

/// One bank's routing.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Bank {
    /// 0 DC, 1 LFO1, 2 LFO2, 3 LFO1 square, 4 VCO1, 5 VCO2, 6 ADSR1, 7 ADSR2 (Rev4 numbering, user manual p.60)
    pub src: u8,
    pub invert: bool,
    /// destinations: bit 0 VCO1, 1 VCO2, 2 Fc, 3 Q
    pub dest: u8,
    pub vel: bool,
    pub plus_x: bool,
    pub minus_x: bool,
    pub pressure: bool,
    /// the bank's replacement controller: ADSR1 (banks A, B), LF noise (C), Fc pedal (D)
    pub repl: bool,
}

impl Bank {
    /// no controller selected: the controller VCA is fully open (user manual p.63)
    pub fn has_controller(&self) -> bool { self.vel || self.plus_x || self.minus_x || self.pressure || self.repl }
}

const REPL_OFS: [usize; 3] = [3, 3, 2];

/// Decode the 4 banks of `side` from the last data written to each crosspoint and the LS670 words.
pub fn decode(xdata: &[u8; 256], ls670: &[u8; 8], side: usize) -> [Bank; 4] {
    let off = if side == 0 { 0 } else { 0x90 };
    let mut banks = [Bank::default(); 4];
    for (b, bank) in banks.iter_mut().enumerate() {
        // source: the switch written with its own address (source 0 of bank A, side 0 is address 0: the default)
        for k in 0..8usize {
            let a = off + b * 4 + (k >> 2) * 16 + (k & 3);
            if a != 0 && xdata[a] as usize == a {
                bank.src = k as u8;
            }
        }
        // destinations and invert
        let mut noninv = true;
        for d in 0..4 {
            let base = off + 0x30 + b * 16 + d * 4;
            if let Some(o) = (0..4).find(|&o| xdata[base + o] == 0xff) {
                noninv = o & 2 != 0;
                if o & 1 == 0 { bank.dest |= 1 << d; }
            }
        }
        bank.invert = !noninv;
        // controllers
        let vel_a = off + 0x20 + b * 4;
        bank.vel = xdata[vel_a] == 0x80;
        if b < 3 {
            let ra = vel_a + REPL_OFS[b];
            bank.repl = xdata[ra] as usize == ra - 0x20;
        }
        let word = ls670[if side == 0 { 4 } else { 0 } + (3 - b)];
        bank.plus_x = word & 0x4 != 0;
        bank.minus_x = word & 0x2 != 0;
        bank.pressure = word & 0x1 != 0;
        if b == 3 { bank.repl = word & 0x8 != 0; }
    }
    banks
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Writes as firmware/src/eng/apply.asm makes them, for one bank of program bytes (active-low flags).
    fn program(xd: &mut [u8; 256], ls: &mut [u8; 8], side: usize, b: usize, byte: u8, dest_nibble: u8, repl_on: bool) {
        let off = if side == 0 { 0 } else { 0x90 };
        let src = ((byte >> 4) & 7) as usize;
        let a = off + b * 4 + (src >> 2) * 16 + (src & 3);
        xd[a] = a as u8;
        let ctl = !byte & 0x0f; // 1 = on: bit 3 vel, 2 +X, 1 −X, 0 pressure
        let noninv = byte & 0x80 != 0;
        for d in 0..4 {
            let on = !dest_nibble & (1 << d) != 0;
            xd[off + 0x30 + b * 16 + d * 4 + if noninv { 2 } else { 0 } + if on { 0 } else { 1 }] = 0xff;
        }
        let vel_a = off + 0x20 + b * 4;
        if repl_on && b < 3 {
            xd[vel_a + REPL_OFS[b]] = (vel_a + REPL_OFS[b] - 0x20) as u8;
        } else if ctl & 8 != 0 {
            xd[vel_a] = 0x80;
        }
        ls[if side == 0 { 4 } else { 0 } + (3 - b)] = (ctl & 7) | if b == 3 && repl_on { 8 } else { 0 };
    }

    #[test]
    fn decodes_what_the_rom_writes() {
        let cases: [(usize, usize, u8, u8, bool); 6] = [
            (0, 0, 0x8f, 0x0, false), // side 0 bank A: DC, not inverted, no controller, all destinations
            (0, 1, 0x17, 0xe, false), // LFO1 inverted, velocity, VCO1 only
            (0, 2, 0xab, 0xb, false), // LFO2, +X & press... (bits 2,0 low), VCO1+VCO2+Q
            (1, 3, 0xf0, 0x7, true),  // side 1 bank D: ADSR2, all controllers, Q only, pedal
            (1, 0, 0xcf, 0xd, true),  // VCO1 source, ADSR1 replacement, VCO2 only
            (1, 2, 0x5f, 0x3, true),  // VCO2 inverted, LF noise replacement, Fc + Q
        ];
        for &(side, b, byte, dn, repl) in &cases {
            let (mut xd, mut ls) = ([0u8; 256], [0u8; 8]);
            program(&mut xd, &mut ls, side, b, byte, dn, repl);
            let got = decode(&xd, &ls, side)[b];
            let ctl = !byte & 0x0f;
            let want = Bank {
                src: (byte >> 4) & 7,
                invert: byte & 0x80 == 0,
                dest: !dn & 0x0f,
                vel: ctl & 8 != 0 && !(repl && b < 3),
                plus_x: ctl & 4 != 0,
                minus_x: ctl & 2 != 0,
                pressure: ctl & 1 != 0,
                repl,
            };
            assert_eq!(got, want, "side {side} bank {b} byte {byte:02x}");
        }
    }
}
