//! NeoV8 as a standalone app and a CLAP / VST3 plugin: the Voyetra Eight emulator running the NeoV8 ROM with the
//! analog voice model (v8-core), MIDI in and out as raw bytes through the emulated ACIA, and an egui front panel.
//!
//! Threads: the audio callback owns the `Instrument`. The editor sends panel events (keys, pots, on-screen notes)
//! through a lock-free queue and reads the display RAM from atomics. Battery RAM is copied out about once a second
//! and persisted with the plugin state (DAW) or in a file (standalone).

// nih-plug's nih_export_vst3! expands to a macro with a trailing semicolon (vst3_com); not our code
#![allow(semicolon_in_expressions_from_non_local_macros)]

use nih_plug::midi::MidiResult;
use nih_plug::prelude::*;
use nih_plug_egui::EguiState;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};
use std::sync::{Arc, Mutex};
use v8_core::Instrument;

pub mod bank;
mod editor;
pub mod panel;

/// The NeoV8 ROM, built by `npm run fw` (firmware/build/neov8.bin).
pub static NEOV8_ROM: &[u8] = include_bytes!(concat!(env!("CARGO_MANIFEST_DIR"), "/../../../firmware/build/neov8.bin"));
/// This instrument's oscillator tolerances (the battery RAM's tuning belongs to them).
const VCO_SEED: u32 = 7;
/// panel byte for AUTO TUNE (A440 up)
const AUTOTUNE: u8 = 82;

/// Set by the standalone binary: battery RAM is then also kept in a file between runs.
pub static STANDALONE: AtomicBool = AtomicBool::new(false);
/// A bank to load at start (standalone `--bank <file>`).
pub static START_BANK: Mutex<Option<PathBuf>> = Mutex::new(None);
/// The factory cassette recording in the repository's (not distributed) reference folder: loaded on a first start
/// when it is there.
pub const FACTORY_TAPE: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../../Voyetra 8 synths/voyetra-8_v8factorytapeB2.wav");

pub enum Cmd {
    /// 8279 FIFO byte (bit 6 = 1 when A440 is up)
    Key(u8),
    /// pot multiplexer channel, value 0..1023
    Pot(usize, f64),
    /// VPK-5 keyboard: note, down, velocity
    Note(u8, bool, u8),
    /// replace the battery RAM, then power-cycle (a loaded bank)
    LoadBram(Box<[u8; 0x2000]>),
    /// POWER switch: CPU reset, battery RAM kept
    Power,
    /// VPK-5 front buttons: true = → (FWD), false = ← (REV); down / up
    VpkButton(bool, bool),
}

/// MIDI pitch-bend sensitivity in battery RAM ($5A79, the DAC1022 multiplier of the bend CVs). The firmware reads
/// it but never initialises it; the stock default is $7F.
pub const BRAM_PBSENS: usize = 0x1a79;

/// State shared between the audio thread and the editor.
pub struct Shared {
    pub display: [AtomicU8; 16],
    pub cmd: Mutex<rtrb::Producer<Cmd>>,
    pub bram_dirty: AtomicBool,
    pub ready: AtomicBool,
    /// last bank / start message for the editor
    pub status: Mutex<String>,
}

#[derive(Params)]
pub struct V8Params {
    #[persist = "editor-state"]
    pub editor_state: Arc<EguiState>,
    /// battery RAM (8 KB: programs, steps, settings, autotune data)
    #[persist = "battery-ram"]
    pub bram: Mutex<Vec<u8>>,
    /// panel MASTER VOLUME (analog)
    #[id = "master"]
    pub master: FloatParam,
    /// panel MASTER TUNE (analog), semitones
    #[id = "tune"]
    pub master_tune: FloatParam,
    /// keyboard joystick X: +X right, −X left (mod-bank controllers)
    #[id = "joyx"]
    pub joystick_x: FloatParam,
    #[id = "pressure"]
    pub pressure: FloatParam,
    #[id = "fcpedal"]
    pub fc_pedal: FloatParam,
    /// keyboard joystick Y: + away from the player = pitch bend up
    #[id = "joyy"]
    pub joystick_y: FloatParam,
    /// VPK-5 front trimmers: PITCH BEND RANGE UP / DOWN (semitones), PRESSURE SENSITIVITY (scales key pressure)
    #[id = "bendup"]
    pub bend_up: FloatParam,
    #[id = "benddown"]
    pub bend_down: FloatParam,
    #[id = "pressens"]
    pub pressure_sens: FloatParam,
}

impl Default for V8Params {
    fn default() -> Self {
        Self {
            editor_state: EguiState::from_size(1400, 715),
            bram: Mutex::new(Vec::new()),
            master: FloatParam::new("Master volume", 0.8, FloatRange::Linear { min: 0.0, max: 1.0 }),
            master_tune: FloatParam::new("Master tune", 0.0, FloatRange::Linear { min: -1.0, max: 1.0 }).with_unit(" st"),
            joystick_x: FloatParam::new("Joystick X", 0.0, FloatRange::Linear { min: -1.0, max: 1.0 }),
            pressure: FloatParam::new("Key pressure", 0.0, FloatRange::Linear { min: 0.0, max: 1.0 }),
            fc_pedal: FloatParam::new("Fc pedal", 0.0, FloatRange::Linear { min: 0.0, max: 1.0 }),
            joystick_y: FloatParam::new("Joystick Y (pitch bend)", 0.0, FloatRange::Linear { min: -1.0, max: 1.0 }),
            bend_up: FloatParam::new("Pitch bend range up", 2.0, FloatRange::Linear { min: 0.0, max: 12.0 }).with_unit(" st"),
            bend_down: FloatParam::new("Pitch bend range down", 2.0, FloatRange::Linear { min: 0.0, max: 12.0 }).with_unit(" st"),
            pressure_sens: FloatParam::new("Pressure sensitivity", 1.0, FloatRange::Linear { min: 0.0, max: 2.0 }),
        }
    }
}

/// Raw SysEx through the ACIA (NeoV8 and Rev4 dumps are well under 512 bytes per message).
#[derive(Debug, Clone, PartialEq)]
pub struct RawSysEx {
    buf: [u8; 512],
    len: usize,
}

impl SysExMessage for RawSysEx {
    type Buffer = [u8; 512];
    fn from_buffer(b: &[u8]) -> Option<Self> {
        if b.len() > 512 { return None; }
        let mut buf = [0u8; 512];
        buf[..b.len()].copy_from_slice(b);
        Some(RawSysEx { buf, len: b.len() })
    }
    fn to_buffer(self) -> ([u8; 512], usize) { (self.buf, self.len) }
}

/// Splits the ACIA's output byte stream into MIDI messages (running status, SysEx).
#[derive(Default)]
struct MidiOut {
    status: u8,
    data: [u8; 2],
    n: usize,
    sysex: Vec<u8>,
    in_sysex: bool,
}

impl MidiOut {
    fn feed(&mut self, bytes: &[u8], mut emit: impl FnMut(&[u8])) {
        for &x in bytes {
            if x >= 0xf8 { emit(&[x]); continue; } // real time
            if self.in_sysex {
                self.sysex.push(x);
                if x == 0xf7 { emit(&self.sysex); self.sysex.clear(); self.in_sysex = false; }
                continue;
            }
            if x == 0xf0 { self.in_sysex = true; self.sysex.clear(); self.sysex.push(x); continue; }
            if x & 0x80 != 0 { self.status = x; self.n = 0; continue; }
            if self.status == 0 { continue; }
            self.data[self.n] = x;
            self.n += 1;
            let need = if matches!(self.status & 0xf0, 0xc0 | 0xd0) { 1 } else { 2 };
            if self.n == need {
                let msg = [self.status, self.data[0], self.data[1]];
                emit(&msg[..1 + need]);
                self.n = 0;
            }
        }
    }
}

pub struct NeoV8 {
    params: Arc<V8Params>,
    shared: Arc<Shared>,
    cmd_rx: rtrb::Consumer<Cmd>,
    inst: Option<Box<Instrument>>,
    midi_out: MidiOut,
    blocks: u32,
    /// The battery RAM last copied into the persisted state: if the state still holds it at a re-initialization,
    /// the host did not restore a project in between.
    bram_out: Vec<u8>,
}

impl Default for NeoV8 {
    fn default() -> Self {
        let (tx, rx) = rtrb::RingBuffer::new(1024);
        Self {
            params: Arc::new(V8Params::default()),
            shared: Arc::new(Shared {
                display: Default::default(),
                cmd: Mutex::new(tx),
                bram_dirty: AtomicBool::new(false),
                ready: AtomicBool::new(false),
                status: Mutex::new(String::new()),
            }),
            cmd_rx: rx,
            inst: None,
            bram_out: Vec::with_capacity(0x2000),
            midi_out: MidiOut { sysex: Vec::with_capacity(1024), ..Default::default() },
            blocks: 0,
        }
    }
}

/// The ROM's init program (A440 + CALL: saws on both VCOs, filter open), stock image at $F068.
const INIT_PROGRAM: [u8; 40] = [
    0xAF, 0xAF, 0xAF, 0xAF, 0xFF, 0xFF, 0x00, 0x00, 0x00, 0x00, 0x80, 0x90, 0x80, 0xC8, 0xC8, 0xC0, 0xC0, 0xC0, 0x80,
    0xFF, 0x80, 0x80, 0x00, 0x80, 0xFF, 0x80, 0x00, 0x80, 0xFF, 0x80, 0xF0, 0xFF, 0x80, 0xFF, 0xC0, 0x96, 0xFF, 0x00,
    0xC0, 0xF8,
];

/// A battery RAM for a first start, as a freshly initialised unit: the init program in all 100 slots, every step
/// WHOLE 8 with programs 00/00, octaves normal, split at C4, arpeggiator up; default footswitch records; the
/// battery check bytes ($4FFF, $5A58). Same layout as the simulator's (sim/test/helpers.ts protoBattery).
pub fn default_bram() -> Vec<u8> {
    let mut b = vec![0u8; 0x2000];
    for n in 0..100 {
        b[40 * n..40 * n + 40].copy_from_slice(&INIT_PROGRAM);
        let s = 0x1000 + 24 * n;
        b[s] = 0x80 | 2; // WHOLE 8, arpeggiator RIGHT up
        b[s + 3] = 1 << 6; // octave RIGHT normal
        b[s + 4] = (1 << 6) | (60 - 12); // octave LEFT normal, split C4
        b[s + 5] = 64; // arpeggiator speed
        b[s + 20] = 2 ^ 0x30; // arpeggiator LEFT up (stored XOR $30)
    }
    b[0x0fff] = 0xaa;
    b[0x1a46..0x1a58].copy_from_slice(&[0x80, 34, 0xff, 0x80, 35, 0xff, 0x00, 52, 0xff, 0x80, 0xff, 0xff, 0x00, 0x12, 0xff, 0x00, 0x13, 0xff]);
    b[0x1a58] = 0xa5;
    b
}

/// Battery-RAM file of the standalone app.
pub fn bram_file() -> Option<PathBuf> {
    let home = std::env::var_os("HOME")?;
    let dir = if cfg!(target_os = "macos") {
        PathBuf::from(home).join("Library/Application Support/NeoV8")
    } else {
        PathBuf::from(home).join(".local/share/neov8")
    };
    Some(dir.join("battery.bin"))
}

pub fn save_bram_file(bram: &[u8]) {
    if let Some(p) = bram_file() {
        if let Some(d) = p.parent() { let _ = std::fs::create_dir_all(d); }
        let _ = std::fs::write(p, bram);
    }
}

impl NeoV8 {
    fn copy_bram_out(&mut self) {
        if let (Some(inst), Ok(mut b)) = (self.inst.as_ref(), self.params.bram.try_lock()) {
            let cur = &inst.machine.hw.bram[..];
            if b.as_slice() != cur {
                b.clear();
                b.extend_from_slice(cur);
                self.shared.bram_dirty.store(true, Ordering::Relaxed);
            }
            if self.bram_out != cur {
                self.bram_out.clear();
                self.bram_out.extend_from_slice(cur);
            }
        }
    }
}

impl Drop for NeoV8 {
    fn drop(&mut self) {
        if STANDALONE.load(Ordering::Relaxed) {
            if let Some(inst) = self.inst.as_ref() { save_bram_file(&inst.machine.hw.bram[..]); }
        }
    }
}

impl Plugin for NeoV8 {
    const NAME: &'static str = "NeoV8";
    const VENDOR: &'static str = "NeoV8";
    const URL: &'static str = "https://github.com/r0main-f/neov8";
    const EMAIL: &'static str = "";
    const VERSION: &'static str = env!("CARGO_PKG_VERSION");

    const AUDIO_IO_LAYOUTS: &'static [AudioIOLayout] = &[AudioIOLayout {
        main_input_channels: None,
        main_output_channels: NonZeroU32::new(2),
        ..AudioIOLayout::const_default()
    }];
    const MIDI_INPUT: MidiConfig = MidiConfig::MidiCCs;
    const MIDI_OUTPUT: MidiConfig = MidiConfig::MidiCCs;
    const SAMPLE_ACCURATE_AUTOMATION: bool = false;

    type SysExMessage = RawSysEx;
    type BackgroundTask = ();

    fn params(&self) -> Arc<dyn Params> { self.params.clone() }

    fn editor(&mut self, _async_executor: AsyncExecutor<Self>) -> Option<Box<dyn Editor>> {
        editor::create(self.params.clone(), self.shared.clone())
    }

    fn initialize(&mut self, _layout: &AudioIOLayout, config: &BufferConfig, _ctx: &mut impl InitContext<Self>) -> bool {
        // a re-initialization keeps the running battery RAM (sample-rate change), unless the host has just restored
        // a project's state (the persisted copy then differs from the last one written); else the saved state, else
        // the file
        if let Some(old) = self.inst.as_ref() {
            if let Ok(mut b) = self.params.bram.lock() {
                if *b == self.bram_out { *b = old.machine.hw.bram.to_vec(); }
            }
        }
        let mut bram = self.params.bram.lock().map(|b| b.clone()).unwrap_or_default();
        if bram.len() != 0x2000 && STANDALONE.load(Ordering::Relaxed) {
            if let Some(b) = bram_file().and_then(|p| std::fs::read(p).ok()) { bram = b; }
        }
        let have = bram.len() == 0x2000;
        let mut msg = String::new();
        if !have {
            bram = default_bram();
            if let Ok(b) = bank::load(std::path::Path::new(FACTORY_TAPE)) {
                b.apply(&mut bram);
                msg = format!("first start: factory tape loaded ({})", b.summary());
            } else {
                msg = "first start: init bank (load a bank with LOAD BANK)".into();
            }
        }
        if let Some(p) = START_BANK.lock().ok().and_then(|mut s| s.take()) {
            match bank::load(&p) {
                Ok(b) => {
                    b.apply(&mut bram);
                    msg = format!("{}: {}", p.file_name().map(|f| f.to_string_lossy()).unwrap_or_default(), b.summary());
                }
                Err(e) => msg = e,
            }
        }
        if !msg.is_empty() {
            nih_log!("NeoV8: {msg}");
            if let Ok(mut s) = self.shared.status.lock() { *s = msg; }
        }
        if bram.len() == 0x2000 && bram[BRAM_PBSENS] == 0 {
            bram[BRAM_PBSENS] = 0x7f; // never set by the firmware: without it MIDI pitch bend is silent
        }
        let sr = config.sample_rate as f64;
        let mut inst = Box::new(Instrument::new(NEOV8_ROM, Some(&bram[..]), sr, VCO_SEED));
        if !have {
            // first start: tune this instrument's oscillators (20 s of instrument time, well under a second here)
            inst.skip((0.4 * sr) as u64);
            inst.panel_key(AUTOTUNE);
            inst.skip((20.0 * sr) as u64);
        }
        self.inst = Some(inst);
        self.copy_bram_out();
        self.shared.ready.store(true, Ordering::Relaxed);
        true
    }

    fn process(&mut self, buffer: &mut Buffer, _aux: &mut AuxiliaryBuffers, ctx: &mut impl ProcessContext<Self>) -> ProcessStatus {
        let Some(inst) = self.inst.as_mut() else { return ProcessStatus::Normal };
        while let Ok(c) = self.cmd_rx.pop() {
            match c {
                Cmd::Key(k) => inst.panel_key(k),
                Cmd::Pot(ch, v) => inst.pot(ch, v),
                Cmd::Note(n, down, vel) => inst.key(n, down, vel),
                Cmd::LoadBram(mut b) => {
                    if b[BRAM_PBSENS] == 0 { b[BRAM_PBSENS] = 0x7f; }
                    inst.machine.set_bram(&b[..]);
                    inst.machine.reset();
                }
                Cmd::Power => inst.machine.reset(),
                Cmd::VpkButton(fwd, down) => {
                    if fwd { inst.machine.hw.vpk_fwd = down } else { inst.machine.hw.vpk_rev = down }
                }
            }
        }
        let e = &mut inst.engine;
        e.master = self.params.master.value() as f64;
        e.master_tune = self.params.master_tune.value() as f64;
        e.joystick_x = self.params.joystick_x.value() as f64;
        e.pressure = (self.params.pressure.value() * self.params.pressure_sens.value()).min(1.0) as f64;
        e.joystick_y = self.params.joystick_y.value() as f64;
        e.bend_up = self.params.bend_up.value() as f64;
        e.bend_down = self.params.bend_down.value() as f64;
        e.fc_pedal = self.params.fc_pedal.value() as f64;

        let n = buffer.samples();
        let chans = buffer.as_slice();
        let (l, r) = chans.split_at_mut(1);
        let (l, r) = (&mut l[0][..n], &mut r[0][..n]);
        // MIDI in as raw bytes at their sample position
        let mut pos = 0;
        while let Some(ev) = ctx.next_event() {
            let t = (ev.timing() as usize).min(n);
            if t > pos {
                inst.render(&mut l[pos..t], &mut r[pos..t]);
                pos = t;
            }
            match ev.as_midi() {
                Some(MidiResult::Basic(m)) => {
                    let len = match m[0] & 0xf0 { 0xc0 | 0xd0 => 2, _ => 3 };
                    inst.midi_in(&m[..len]);
                }
                Some(MidiResult::SysEx(buf, len)) => inst.midi_in(&buf[..len]),
                None => {}
            }
        }
        if pos < n { inst.render(&mut l[pos..n], &mut r[pos..n]); }

        for (a, v) in self.shared.display.iter().zip(inst.machine.hw.kd.display.iter()) {
            a.store(*v, Ordering::Relaxed);
        }
        let out = inst.take_midi_out();
        if !out.is_empty() {
            self.midi_out.feed(&out, |m| {
                if let Ok(ev) = NoteEvent::from_midi(0, m) { ctx.send_event(ev); }
            });
        }
        self.blocks = self.blocks.wrapping_add(1);
        if self.blocks.is_multiple_of(100) { self.copy_bram_out(); }
        ProcessStatus::KeepAlive
    }
}

impl ClapPlugin for NeoV8 {
    const CLAP_ID: &'static str = "io.github.r0main-f.neov8";
    const CLAP_DESCRIPTION: Option<&'static str> = Some("Voyetra Eight: the NeoV8 OS on an emulated CPU card and an analog voice model");
    const CLAP_MANUAL_URL: Option<&'static str> = Some(Self::URL);
    const CLAP_SUPPORT_URL: Option<&'static str> = None;
    const CLAP_FEATURES: &'static [ClapFeature] = &[ClapFeature::Instrument, ClapFeature::Synthesizer, ClapFeature::Stereo];
}

impl Vst3Plugin for NeoV8 {
    const VST3_CLASS_ID: [u8; 16] = *b"NeoV8VoyetraEigh";
    const VST3_SUBCATEGORIES: &'static [Vst3SubCategory] = &[Vst3SubCategory::Instrument, Vst3SubCategory::Synth];
}

nih_export_clap!(NeoV8);
nih_export_vst3!(NeoV8);

#[cfg(test)]
mod tests {
    use super::MidiOut;

    #[test]
    fn midi_out_splits_messages_with_running_status_and_sysex() {
        let mut p = MidiOut::default();
        let mut got: Vec<Vec<u8>> = Vec::new();
        p.feed(&[0x90, 60, 100, 62, 0, 0xc1, 5, 0xf0, 0x03, 0x41, 0x00, 0xf7, 0xf8, 0xb0, 7], |m| got.push(m.to_vec()));
        p.feed(&[100], |m| got.push(m.to_vec()));
        assert_eq!(
            got,
            vec![vec![0x90, 60, 100], vec![0x90, 62, 0], vec![0xc1, 5], vec![0xf0, 0x03, 0x41, 0x00, 0xf7], vec![0xf8], vec![0xb0, 7, 100]]
        );
    }
}
