//! Mod banks end to end on the NeoV8 ROM: a program with LFO1 -> VCO1 + VCO2 (bank A, no controller) must make
//! the rendered pitch swing by the amount the model predicts. Skipped when firmware/build/neov8.bin is missing.

use v8_core::Instrument;

const SR: f64 = 48_000.0;
const AUTOTUNE: u8 = 82;
const KB_WHOLE: u8 = 93;
const CALL_R: u8 = 75;
const DIGIT: [u8; 10] = [68, 88, 72, 89, 104, 120, 105, 80, 64, 96];
const INIT: [u8; 40] = [
    0xAF, 0xAF, 0xAF, 0xAF, 0xFF, 0xFF, 0x00, 0x00, 0x00, 0x00, 0x80, 0x90, 0x80, 0xC8, 0xC8, 0xC0, 0xC0, 0xC0, 0x80,
    0xFF, 0x80, 0x80, 0x00, 0x80, 0xFF, 0x80, 0x00, 0x80, 0xFF, 0x80, 0xF0, 0xFF, 0x80, 0xFF, 0xC0, 0x96, 0xFF, 0x00,
    0xC0, 0xF8,
];

fn pitch(x: &[f32]) -> f64 {
    let n = x.len();
    let mean = x.iter().map(|&v| v as f64).sum::<f64>() / n as f64;
    let y: Vec<f64> = x.iter().map(|&v| v as f64 - mean).collect();
    let ac = |lag: usize| (0..n - lag).map(|i| y[i] * y[i + lag]).sum::<f64>();
    let (lo, hi) = ((SR / 2000.0) as usize, (SR / 60.0) as usize);
    let mut best = (lo, f64::MIN);
    for lag in lo..hi {
        let c = ac(lag);
        if c > best.1 { best = (lag, c); }
    }
    let (l, c0) = (best.0, best.1);
    let (a, b) = (ac(l - 1), ac(l + 1));
    let p = 0.5 * (a - b) / (a - 2.0 * c0 + b);
    SR / (l as f64 + p)
}

#[test]
fn lfo1_vibrato_swings_the_pitch() {
    let Ok(rom) = std::fs::read(concat!(env!("CARGO_MANIFEST_DIR"), "/../../../firmware/build/neov8.bin")) else { return };
    let mut p = INIT;
    p[0x00] = 0x9f; // bank A: LFO1, not inverted, no controller
    p[0x04] = 0xcf; // bank A -> VCO1 + VCO2 (active low, high nibble)
    p[0x06] = 0x40; // depth
    p[0x0b] = (p[0x0b] & 0x80) | 30; // LFO1 rate
    p[0x1d] = (p[0x1d] & 0x9f) | (1 << 5); // triangle, no delay
    p[0x14] = 0x80; // no filter envelope; filter open
    p[0x13] = 0xff;
    let mut bram = vec![0u8; 0x2000];
    bram[..40].copy_from_slice(&p);
    bram[0x0fff] = 0xaa;
    bram[0x1a58] = 0xa5;
    let mut i = Instrument::new(&rom, Some(&bram), SR, 7);
    i.skip((0.4 * SR) as u64);
    i.panel_key(AUTOTUNE);
    i.skip((20.0 * SR) as u64);
    for k in [KB_WHOLE, CALL_R, DIGIT[0], DIGIT[0]] {
        i.panel_key(k);
        i.skip((0.06 * SR) as u64);
    }
    i.skip((0.3 * SR) as u64);
    i.key(57, true, 100);
    let n = (3.0 * SR) as usize;
    let (mut l, mut r) = (vec![0f32; n], vec![0f32; n]);
    i.render(&mut l, &mut r);
    let x: Vec<f32> = l.iter().zip(&r).map(|(a, b)| a + b).collect();
    let w = 2048;
    let track: Vec<f64> = (0..(n - w) / 1024).map(|k| pitch(&x[k * 1024..k * 1024 + w])).collect();
    // robust range: 10th / 90th percentile (the autocorrelation estimate has a few octave errors)
    let mut t: Vec<f64> = track[10..].iter().copied().filter(|f| f.is_finite() && *f > 0.0).collect();
    t.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let (lo, hi) = (t[t.len() / 10], t[t.len() * 9 / 10]);
    let swing = 12.0 * (hi / lo).log2();
    // triangle ≈ ±2.5 V, depth $40 -> (2.67 V − 1.2 V) / 9.47 V ≈ 0.155: ±0.39 octave, ≈ 9 semitones peak to peak;
    // the percentiles and the 43 ms analysis window cut the peaks
    eprintln!("pitch {lo:.1}..{hi:.1} Hz, swing {swing:.1} semitones");
    assert!(swing > 4.0 && swing < 11.0, "swing {swing:.1} semitones");
}
