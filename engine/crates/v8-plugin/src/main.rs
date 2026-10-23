//! NeoV8 standalone: `neov8 [nih-plug standalone options]`.
//!
//! Defaults: CoreAudio on macOS, WASAPI on Windows, ALSA on Linux (nih-plug's "auto" means JACK or silence), 256-sample periods, and the first MIDI input port (e.g. a USB keyboard) when no
//! `--midi-input` is given. `neov8 --midi-input ""` lists the ports; `neov8 --help` shows every option.
//! `--bank <file>` loads a bank at start (.syx dump, .wav cassette recording, 8 KB battery image).
//! Battery RAM (programs, steps, tuning) is kept in battery.bin: ~/Library/Application Support/NeoV8 (macOS),
//! %APPDATA%\NeoV8 (Windows), ~/.local/share/neov8 (Linux).

// release builds on Windows open no console window next to the instrument
#![cfg_attr(all(windows, not(debug_assertions)), windows_subsystem = "windows")]

use nih_plug::prelude::*;
use std::sync::atomic::Ordering;
use v8_plugin::{NeoV8, STANDALONE};

fn main() {
    STANDALONE.store(true, Ordering::Relaxed);
    let mut args: Vec<String> = std::env::args().collect();
    // --bank <file>: load a bank at start (.syx dump, .wav cassette recording, 8 KB battery image)
    if let Some(i) = args.iter().position(|a| a == "--bank") {
        if i + 1 < args.len() {
            let p = args.remove(i + 1);
            args.remove(i);
            if let Ok(mut b) = v8_plugin::START_BANK.lock() { *b = Some(p.into()); }
        }
    }
    let has = |a: &[String], f: &str| a.iter().any(|x| x == f || x.starts_with(&format!("{f}=")));
    let backend = if cfg!(target_os = "macos") {
        "core-audio"
    } else if cfg!(target_os = "windows") {
        "wasapi"
    } else {
        "alsa"
    };
    if !has(&args, "--backend") && !has(&args, "-b") {
        args.extend(["--backend".into(), backend.into()]);
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
