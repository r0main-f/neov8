//! NeoV8 engine tools.
//!
//! `v8-cli trace <script.json>`: runs a scripted session on the Rust machine and prints its state at every
//! `check` step plus every analog event, as JSON. `sim/test/engine-diff.test.ts` runs the same script on the
//! TypeScript machine and requires identical output (the port must be behaviour-identical).

use serde::Deserialize;
use serde_json::{json, Value};
use v8_machine::{AnalogEvent, Machine, VcoBank, VcoOptions};

#[derive(Deserialize)]
struct Script {
    rom: String,
    #[serde(default)]
    bram: Option<String>,
    /// attach a seeded VCO bank (autotune) when set
    #[serde(default)]
    vco_seed: Option<u32>,
    steps: Vec<Step>,
}

#[derive(Deserialize)]
#[serde(tag = "op", rename_all = "lowercase")]
enum Step {
    Run { cycles: u64 },
    /// raw 8279 FIFO byte (bit 6 = 1 when A440 is up)
    Key { fifo: u8 },
    Note { note: u8, down: bool, #[serde(default = "default_vel")] vel: u8 },
    Midi { bytes: Vec<u8> },
    Pot { ch: usize, value: f64 },
    Fsw { n: u8, closed: bool },
    Vpk { fwd: bool, rev: bool },
    Protect { on: bool },
    Check,
}
fn default_vel() -> u8 { 100 }

/// FNV-1a 32-bit (same function in the TS harness)
fn fnv(b: &[u8]) -> u32 {
    let mut h: u32 = 0x811c9dc5;
    for &x in b {
        h ^= x as u32;
        h = h.wrapping_mul(0x01000193);
    }
    h
}

fn check(m: &mut Machine) -> Value {
    let hw = &mut m.hw;
    let tx: Vec<u8> = std::mem::take(&mut hw.acia.tx_out);
    json!({
        "cycles": m.cpu.cycles, "pc": m.cpu.pc, "a": m.cpu.a, "x": m.cpu.x, "y": m.cpu.y, "s": m.cpu.s, "p": m.cpu.p,
        "illegal": m.cpu.illegal, "irq": m.irq_count, "nmi": m.nmi_count,
        "ram": fnv(&hw.ram[..]), "bram": fnv(&hw.bram[..]),
        "display": hw.kd.display.to_vec(),
        "cv": hw.cv.to_vec(), "mult": hw.cv_mult.to_vec(),
        "ctl": [hw.ctl.ic1, hw.ctl.ic2, hw.ctl.ic3, hw.ctl.ic22, hw.ctl.ic23],
        "xpoint": fnv(&hw.ctl.xpoint), "ls670": hw.ctl.ls670.to_vec(),
        "ptm": [hw.ptm.counter[0], hw.ptm.counter[1], hw.ptm.counter[2]], "ptmFlags": hw.ptm.flags,
        "tx": tx,
    })
}

fn trace(path: &str) -> Result<Value, String> {
    let text = std::fs::read_to_string(path).map_err(|e| format!("{path}: {e}"))?;
    let script: Script = serde_json::from_str(&text).map_err(|e| format!("{path}: {e}"))?;
    let rom = std::fs::read(&script.rom).map_err(|e| format!("{}: {e}", script.rom))?;
    let mut m = Machine::new(&rom);
    if let Some(b) = &script.bram {
        let bram = std::fs::read(b).map_err(|e| format!("{b}: {e}"))?;
        m.set_bram(&bram);
    }
    m.reset();
    if let Some(seed) = script.vco_seed {
        m.hw.vco = Some(VcoBank::new(VcoOptions { seed, ..Default::default() }));
    }
    m.hw.events = Some(Vec::new());
    let mut checks = Vec::new();
    for s in &script.steps {
        match s {
            Step::Run { cycles } => m.run(*cycles),
            Step::Key { fifo } => m.hw.kd.press_key(*fifo),
            Step::Note { note, down, vel } => { if *down { m.key_down(*note, *vel) } else { m.key_up(*note) } }
            Step::Midi { bytes } => m.hw.acia.receive(bytes),
            Step::Pot { ch, value } => m.hw.pot_by_channel[*ch & 15] = value.clamp(0.0, 1023.0),
            Step::Fsw { n, closed } => {
                let p = &mut m.hw.pia2;
                p.in_b = if *closed { p.in_b & !(1 << n) } else { p.in_b | (1 << n) };
            }
            Step::Vpk { fwd, rev } => { m.hw.vpk_fwd = *fwd; m.hw.vpk_rev = *rev; }
            Step::Protect { on } => m.hw.mem_protect = *on,
            Step::Check => checks.push(check(&mut m)),
        }
    }
    let events: Vec<Value> = m.hw.events.take().unwrap_or_default().iter().map(|e| match *e {
        AnalogEvent::Cv { cycle, slot, value, mult } => json!([cycle, "cv", slot, value, mult]),
        AnalogEvent::Latch { cycle, addr, data, slot } => json!([cycle, "latch", addr, data, slot]),
    }).collect();
    Ok(json!({ "checks": checks, "events": events }))
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    match args.get(1).map(String::as_str) {
        Some("trace") if args.len() == 3 => match trace(&args[2]) {
            Ok(v) => println!("{v}"),
            Err(e) => { eprintln!("v8-cli trace: {e}"); std::process::exit(1); }
        },
        _ => {
            eprintln!("usage: v8-cli trace <script.json>");
            std::process::exit(2);
        }
    }
}
