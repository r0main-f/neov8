//! Modulation banks (4 per side): which source, controllers and destinations each bank uses, read from the ANA I
//! crosspoint switches ($65xx, `Ctl::xpoint` = closed) and the DIGIMOD 74LS670 words ($66xx/$67xx).
//!
//! Switch map (ANA I, S p18; docs/audio-model.md §5). `S` = 0 for side 0 (the RIGHT program, voices 0-3; the
//! schematic's "L" hardware), $90 for side 1. Bank b = 0..3 (A-D).
//! - `S + b*4 + x`: mono source X0 DC, X1 / X2 the LFOs (see `src`), X3 LFO1 square -> bank b's VCA input;
//! - `S + $10 + b*4 + x`: poly source X0 VCO1, X1 VCO2, X2 ADSR1, X3 ADSR2;
//! - `S + $20 + b*4 + x`: controller ("VEL") inputs X0 velocity / keyboard CV, X1 unity (+12.5 V, "no
//!   controller"), X2 LF noise, X3 ADSR1;
//! - `S + $30 + b*16 + d*4 + x`, destination d (0 VCO1, 1 VCO2, 2 Fc, 3 Q): x0 = the bank VCA's "+" output, x2 its
//!   "−" output (the destination summers invert, so x2 is the in-phase choice), x1/x3 ground (off).
//!
//! The mono controllers come through the LS670 word `3 − b` (RIGHT chip $67 for side 0, LEFT $66 for side 1):
//! D6 +X, D5 −X, D4 pressure, D7 Fc pedal (1 = on).

/// One bank's routing.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Bank {
    /// physical source: 0 DC, 1 / 2 the LFOs, 3 LFO1 square, 4 VCO1, 5 VCO2, 6 ADSR1, 7 ADSR2 (= the program's
    /// source code, which the ROM writes straight to the switch address). Rev4 units: 1 = LFO1, 2 = LFO2 (user
    /// manual p.60: "prior to September 1983, 1 selects LFO2"; the schematic shows the earlier wiring)
    pub src: u8,
    pub invert: bool,
    /// destinations: bit 0 VCO1, 1 VCO2, 2 Fc, 3 Q
    pub dest: u8,
    /// controller ("VEL") chip inputs
    pub vel: bool,
    pub unity: bool,
    pub lf_noise: bool,
    pub adsr1: bool,
    /// mono controllers (LS670)
    pub plus_x: bool,
    pub minus_x: bool,
    pub pressure: bool,
    pub pedal: bool,
}

/// Decode the 4 banks of `side` from the closed crosspoints and the LS670 words.
pub fn decode(xpoint: &[u8; 256], ls670: &[u8; 8], side: usize) -> [Bank; 4] {
    let s = if side == 0 { 0 } else { 0x90 };
    let on = |a: usize| xpoint[a] != 0;
    let mut banks = [Bank::default(); 4];
    for (b, bank) in banks.iter_mut().enumerate() {
        if let Some(x) = (0..8usize).find(|&k| on(s + (k >> 2) * 0x10 + b * 4 + (k & 3))) {
            bank.src = x as u8;
        }
        let mut inverted = false;
        for d in 0..4 {
            let base = s + 0x30 + b * 16 + d * 4;
            if on(base) { bank.dest |= 1 << d; inverted = true; }
            if on(base + 2) { bank.dest |= 1 << d; }
            if on(base + 1) { inverted = true; } // grounded on the inverted side (no effect on the sound)
        }
        bank.invert = inverted;
        let c = s + 0x20 + b * 4;
        bank.vel = on(c);
        bank.unity = on(c + 1);
        bank.lf_noise = on(c + 2);
        bank.adsr1 = on(c + 3);
        let word = ls670[if side == 0 { 4 } else { 0 } + (3 - b)];
        bank.plus_x = word & 0x4 != 0;
        bank.minus_x = word & 0x2 != 0;
        bank.pressure = word & 0x1 != 0;
        bank.pedal = word & 0x8 != 0;
    }
    banks
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_the_closed_switches() {
        let (mut x, mut ls) = ([0u8; 256], [0u8; 8]);
        // side 1, bank C: ADSR1 source, -> VCO2 (in phase) and Q (in phase), velocity + pressure
        let s = 0x90;
        x[s + 0x10 + 2 * 4 + 2] = 1;
        x[s + 0x30 + 2 * 16 + 4 + 2] = 1;
        x[s + 0x30 + 2 * 16 + 12 + 2] = 1;
        x[s + 0x30 + 2 * 16 + 3] = 1; // VCO1 grounded (non-inverted side)
        x[s + 0x30 + 2 * 16 + 8 + 3] = 1; // Fc grounded
        x[s + 0x20 + 2 * 4] = 1;
        ls[1] = 0x1; // LEFT chip ($66), word 1 = bank C
        let b = decode(&x, &ls, 1)[2];
        assert_eq!(b, Bank { src: 6, invert: false, dest: 0b1010, vel: true, pressure: true, ..Bank::default() });
        // side 0, bank A: DC (X0, address 0), inverted to Fc, unity controller
        let (mut x, ls) = ([0u8; 256], [0u8; 8]);
        x[0] = 1;
        x[0x30 + 8] = 1;
        x[0x21] = 1;
        let b = decode(&x, &ls, 0)[0];
        assert_eq!(b, Bank { src: 0, invert: true, dest: 0b0100, unity: true, ..Bank::default() });
    }
}
