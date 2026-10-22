//! The modulation-bank decode (v8_voice::modmatrix) against both ROMs: programs with random routings are
//! recalled from the panel in LAYER mode, and the banks read from the closed crosspoints (`$6405` = DATA, written
//! while `$6307` = 0) and the LS670 words must be the programs' own settings. This also checks that each ROM
//! closes the switches at all (NeoV8 before v0.8.4 left `$6405` at 0 and closed none). Skipped for a ROM that is not built / not present.

use v8_core::Instrument;
use v8_voice::modmatrix::{decode, Bank};

const SR: f64 = 48_000.0;
// panel FIFO bytes (sim/src/machine/backend.ts fifoCodes)
const KB_LAYER: u8 = 69;
const CALL_R: u8 = 75;
const CALL_L: u8 = 91;
const DIGIT: [u8; 10] = [68, 88, 72, 89, 104, 120, 105, 80, 64, 96];
/// the init program image (stock ROM $F068, docs/rev4-ram-map.md)
const INIT: [u8; 40] = [
    0xAF, 0xAF, 0xAF, 0xAF, 0xFF, 0xFF, 0x00, 0x00, 0x00, 0x00, 0x80, 0x90, 0x80, 0xC8, 0xC8, 0xC0, 0xC0, 0xC0, 0x80,
    0xFF, 0x80, 0x80, 0x00, 0x80, 0xFF, 0x80, 0x00, 0x80, 0xFF, 0x80, 0xF0, 0xFF, 0x80, 0xFF, 0xC0, 0x96, 0xFF, 0x00,
    0xC0, 0xF8,
];

fn roms() -> Vec<(&'static str, Vec<u8>)> {
    let root = concat!(env!("CARGO_MANIFEST_DIR"), "/../../..");
    [("NeoV8", "firmware/build/neov8.bin"), ("stock", "tools/rom/build/rev4.bin")]
        .iter()
        .filter_map(|(n, p)| std::fs::read(format!("{root}/{p}")).ok().map(|r| (*n, r)))
        .collect()
}

struct Rng(u32);
impl Rng {
    fn next(&mut self) -> u8 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 17;
        self.0 ^= self.0 << 5;
        (self.0 >> 8) as u8
    }
}

fn bank_from_program(p: &[u8], b: usize) -> Bank {
    let byte = p[b];
    let ctl = !byte & 0x0f;
    let dn = if b.is_multiple_of(2) { p[4 + b / 2] >> 4 } else { p[4 + b / 2] } & 0x0f;
    let repl = p[0x1e] & (0x80 >> b) == 0;
    Bank {
        src: (byte >> 4) & 7,
        invert: byte & 0x80 == 0,
        dest: !dn & 0x0f,
        vel: ctl & 8 != 0 && !(repl && b < 3),
        unity: ctl == 0 && !repl,
        lf_noise: repl && b == 2,
        adsr1: repl && b < 2,
        plus_x: ctl & 4 != 0,
        minus_x: ctl & 2 != 0,
        pressure: ctl & 1 != 0,
        pedal: repl && b == 3,
    }
}

fn key(i: &mut Instrument, k: u8) {
    i.panel_key(k);
    i.skip((0.06 * SR) as u64);
}

#[test]
fn decoded_banks_are_the_recalled_programs() {
    for (name, rom) in roms() {
        let mut rng = Rng(0x1234_5678);
        let mut bram = vec![0u8; 0x2000];
        let mut progs = Vec::new();
        for n in 0..100 {
            let mut p = INIT;
            for v in p.iter_mut().take(6) { *v = rng.next(); }
            p[0x1e] = (p[0x1e] & 0x0f) | (rng.next() & 0xf0);
            bram[40 * n..40 * n + 40].copy_from_slice(&p);
            progs.push(p);
        }
        bram[0x0fff] = 0xaa; // $4FFF sentinel the stock ROM waits for
        bram[0x1a58] = 0xa5;
        let mut i = Instrument::new(&rom, Some(&bram), SR, 7);
        i.skip((1.5 * SR) as u64);
        key(&mut i, KB_LAYER);
        let mut checked = 0;
        for &(r, l) in &[(3usize, 17usize), (42, 8), (77, 61), (5, 5), (90, 33), (12, 99)] {
            for (k, n) in [(CALL_R, r), (CALL_L, l)] {
                key(&mut i, k);
                key(&mut i, DIGIT[n / 10]);
                key(&mut i, DIGIT[n % 10]);
            }
            i.skip((0.3 * SR) as u64);
            let st = &i.engine.state;
            for (side, n) in [(0usize, r), (1, l)] {
                let got = decode(&st.ctl.xpoint, &st.ctl.ls670, side);
                for (b, g) in got.iter().enumerate() {
                    assert_eq!(*g, bank_from_program(&progs[n], b), "{name}: side {side} program {n} bank {b}");
                    checked += 1;
                }
            }
        }
        eprintln!("{name}: {checked} banks decoded");
    }
}
