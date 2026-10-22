//! The whole instrument on the NeoV8 ROM: boot, AUTO TUNE with the emulated oscillators, the ROM's own init
//! program (A440+CALL R), notes on the VPK-5. Skipped when firmware/build/neov8.bin is missing (`npm run fw`).

use v8_core::Instrument;

const SR: f64 = 48_000.0;
// panel FIFO bytes (sim/src/machine/backend.ts fifoCodes; bit 6 = A440 up)
const AUTOTUNE: u8 = 82;
const CALL_R_A440: u8 = 75 & !0x40;

fn rom() -> Option<Vec<u8>> {
    std::fs::read(concat!(env!("CARGO_MANIFEST_DIR"), "/../../../firmware/build/neov8.bin")).ok()
}

fn ms(x: f64) -> usize { (x * SR / 1000.0) as usize }

fn render(i: &mut Instrument, n: usize) -> Vec<f32> {
    let (mut l, mut r) = (vec![0.0f32; n], vec![0.0f32; n]);
    i.render(&mut l, &mut r);
    l.iter().zip(&r).map(|(a, b)| a + b).collect()
}

/// tuned instrument with the init program loaded on the RIGHT side (WHOLE 8)
fn tuned() -> Option<Instrument> {
    let rom = rom()?;
    let mut i = Instrument::new(&rom, None, SR, 7);
    i.skip(ms(400.0) as u64);
    i.panel_key(AUTOTUNE);
    i.skip(ms(20_000.0) as u64);
    i.panel_key(CALL_R_A440); // init program (null patch) into the RIGHT edit buffer
    i.skip(ms(300.0) as u64);
    Some(i)
}

/// fundamental by autocorrelation + parabolic interpolation
fn pitch(x: &[f32]) -> f64 {
    let n = x.len();
    let mean = x.iter().map(|&v| v as f64).sum::<f64>() / n as f64;
    let y: Vec<f64> = x.iter().map(|&v| v as f64 - mean).collect();
    let ac = |lag: usize| (0..n - lag).map(|i| y[i] * y[i + lag]).sum::<f64>();
    let (lo, hi) = ((SR / 3000.0) as usize, (SR / 30.0) as usize);
    let mut best = (f64::MIN, lo);
    let vals: Vec<f64> = (lo..hi).map(ac).collect();
    for (k, &v) in vals.iter().enumerate() {
        // first clear maximum: avoid octave errors by taking the global max
        if v > best.0 { best = (v, lo + k); }
    }
    let l = best.1;
    let (a, b, c) = (ac(l - 1), ac(l), ac(l + 1));
    let d = if a - 2.0 * b + c != 0.0 { 0.5 * (a - c) / (a - 2.0 * b + c) } else { 0.0 };
    SR / (l as f64 + d)
}

fn note(i: &mut Instrument, n: u8, hold_ms: f64) -> Vec<f32> {
    i.key(n, true, 100);
    let out = render(i, ms(hold_ms));
    i.key(n, false, 64);
    render(i, ms(400.0));
    out
}

#[test]
fn pitch_follows_the_autotune_target_and_octaves_are_exact() {
    let Some(mut i) = tuned() else { eprintln!("skipped: no NeoV8 ROM"); return };
    let a5 = note(&mut i, 81, 600.0);
    let a4 = note(&mut i, 69, 600.0);
    let a3 = note(&mut i, 57, 600.0);
    let f5 = pitch(&a5[ms(200.0)..ms(500.0)]);
    let f4 = pitch(&a4[ms(200.0)..ms(500.0)]);
    let f3 = pitch(&a3[ms(200.0)..ms(500.0)]);
    let cents = |a: f64, b: f64| 1200.0 * (a / b).log2();
    eprintln!("A3 {f3:.2} Hz, A4 {f4:.2} Hz, A5 {f5:.2} Hz");
    // the firmware's autotune reference: 4 periods = $2343 E cycles at 2 MHz (docs/autotune.md §6, open question 1)
    let reference = 2_000_000.0 / (0x2343 as f64 / 4.0);
    // the program sets the register (the init program sits an octave below the battery-RAM null patch)
    let octave_ref = reference * (f5 / reference).log2().round().exp2();
    assert!(cents(f5, octave_ref).abs() < 1.5, "A5 {f5} Hz vs reference {reference} (octave {octave_ref})");
    assert!(cents(f5, 2.0 * f4).abs() < 1.5, "A5 {f5} / A4 {f4}");
    assert!(cents(f4, 2.0 * f3).abs() < 1.5, "A4 {f4} / A3 {f3}");
}

#[test]
fn silent_without_notes_and_deterministic() {
    let Some(mut a) = tuned() else { return };
    let quiet = render(&mut a, ms(300.0));
    assert!(quiet.iter().all(|v| v.abs() < 1e-4), "output without notes");
    let Some(mut b) = tuned() else { return };
    render(&mut b, ms(300.0)); // same timeline as `a`
    let x = note(&mut a, 60, 300.0);
    let y = note(&mut b, 60, 300.0);
    assert!(x.iter().any(|v| v.abs() > 0.01), "a note sounds");
    assert_eq!(x, y, "same inputs, same samples");
}

#[test]
fn renders_much_faster_than_real_time() {
    let Some(mut i) = tuned() else { return };
    for n in [48u8, 52, 55, 59, 62, 65, 69, 72] { i.key(n, true, 100); }
    let t = std::time::Instant::now();
    render(&mut i, ms(3000.0));
    let factor = t.elapsed().as_secs_f64() / 3.0;
    eprintln!("8 voices: {:.1} % of real time", factor * 100.0);
    if !cfg!(debug_assertions) {
        assert!(factor < 0.15, "8 voices take {:.0} % of real time", factor * 100.0);
    }
}
