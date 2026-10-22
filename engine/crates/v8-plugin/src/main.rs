//! NeoV8 standalone: `neov8 [nih-plug standalone options]`.
//!
//! Defaults: CoreAudio on macOS, 256-sample periods, and the first MIDI input port (e.g. a USB keyboard) when no
//! `--midi-input` is given. `neov8 --midi-input ""` lists the ports; `neov8 --help` shows every option.
//! Battery RAM (programs, steps, tuning) is kept in ~/Library/Application Support/NeoV8/battery.bin.

use nih_plug::prelude::*;
use std::sync::atomic::Ordering;
use v8_plugin::{NeoV8, STANDALONE};

fn main() {
    STANDALONE.store(true, Ordering::Relaxed);
    let mut args: Vec<String> = std::env::args().collect();
    let has = |a: &[String], f: &str| a.iter().any(|x| x == f || x.starts_with(&format!("{f}=")));
    if cfg!(target_os = "macos") && !has(&args, "--backend") && !has(&args, "-b") {
        args.extend(["--backend".into(), "core-audio".into()]);
    }
    if !has(&args, "--period-size") && !has(&args, "-p") {
        args.extend(["--period-size".into(), "256".into()]);
    }
    if !has(&args, "--midi-input") {
        if let Ok(midi) = midir::MidiInput::new("NeoV8 port scan") {
            let names: Vec<String> = midi.ports().iter().filter_map(|p| midi.port_name(p).ok()).collect();
            match names.first() {
                Some(first) => {
                    eprintln!("NeoV8: MIDI input \"{first}\" (other ports: {:?}; choose with --midi-input)", &names[1..]);
                    args.extend(["--midi-input".into(), first.clone()]);
                }
                None => eprintln!("NeoV8: no MIDI input port found; play with the on-screen keyboard"),
            }
        }
    }
    nih_export_standalone_with_args::<NeoV8, _>(args);
}
