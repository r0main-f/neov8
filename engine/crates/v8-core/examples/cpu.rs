//! CPU cost of one instrument, as a share of one core in real time:
//! `cargo run --release -p v8-core --example cpu [battery.bin]` (needs firmware/build/neov8.bin: `npm run fw`).
//! Without a file it uses the app's battery RAM (your programs), so the held notes sound; with neither, the
//! notes play an empty program and the "notes held" figure is too low.
use std::time::Instant;
use v8_core::Instrument;

const SR: f64 = 48_000.0;
const SECS: f64 = 10.0;

fn main() {
    let rom = std::fs::read(concat!(env!("CARGO_MANIFEST_DIR"), "/../../../firmware/build/neov8.bin")).expect("npm run fw");
    // the app's battery file (same place as v8-plugin's bram_file)
    let app_bram = if cfg!(target_os = "windows") {
        std::env::var_os("APPDATA").map(|d| std::path::PathBuf::from(d).join("NeoV8").join("battery.bin"))
    } else {
        std::env::var_os("HOME").map(|h| {
            let dir = if cfg!(target_os = "macos") { "Library/Application Support/NeoV8" } else { ".local/share/neov8" };
            std::path::PathBuf::from(h).join(dir).join("battery.bin")
        })
    };
    let path = std::env::args().nth(1).map(std::path::PathBuf::from).or(app_bram);
    let bram = path.as_ref().and_then(|p| std::fs::read(p).ok());
    match (&path, &bram) {
        (Some(p), Some(_)) => println!("battery RAM: {}", p.display()),
        _ => println!("battery RAM: none (empty programs: the held notes are silent; start the app once, or pass a file)"),
    }
    let mut i = Instrument::new(&rom, bram.as_deref(), SR, 7);
    i.skip((0.4 * SR) as u64);
    i.panel_key(82); // AUTO TUNE
    i.skip((20.0 * SR) as u64);
    let n = (SECS * SR) as usize;
    let block = 256;
    let (mut l, mut r) = (vec![0.0f32; block], vec![0.0f32; block]);
    let pct = |t: f64| 100.0 * t / SECS;

    let t = Instant::now();
    i.skip(n as u64);
    println!("emulated CPU only      {:5.1} % of a core", pct(t.elapsed().as_secs_f64()));

    let mut run = |i: &mut Instrument, label: &str| {
        let t = Instant::now();
        for _ in 0..n / block { i.render(&mut l, &mut r); }
        println!("{label:22} {:5.1} % of a core", pct(t.elapsed().as_secs_f64()));
    };
    run(&mut i, "silent");
    for k in 0..8 { i.key(48 + 3 * k, true, 100); }
    run(&mut i, "8 notes held");
    for k in 0..8 { i.key(48 + 3 * k, false, 0); }
    i.skip((5.0 * SR) as u64);
    run(&mut i, "silent after release");
}
