//! A Voyetra Eight: the CPU-card emulator running a real ROM and the voice model, sample-accurate.
//!
//! `render()` runs the CPU exactly as many cycles as the audio it produces (2 MHz × samples / sample rate) and
//! applies every analog write at the sample it falls on, so envelopes, glides and arpeggios keep the
//! hardware's timing at any block size. This is the core the plugin, the standalone app and `v8-cli render`
//! share.

use v8_machine::{AnalogEvent, Machine, VcoBank, VcoOptions, CPU_HZ};
use v8_voice::Engine;

pub struct Instrument {
    pub machine: Machine,
    pub engine: Engine,
    sr: f64,
    /// samples rendered since start
    sample: u64,
    /// CPU cycle at sample 0
    cycle0: u64,
    events: Vec<AnalogEvent>,
}

/// longest stretch rendered before the CPU catches up (samples): bounds the event-timing latency
pub const CHUNK: usize = 32;

impl Instrument {
    /// `rom`: 32 KB image; `bram`: battery RAM (8 KB) or None; `vco_seed`: this unit's oscillator tolerances
    /// (keep it per instrument: the battery RAM's autotune data belongs to it).
    pub fn new(rom: &[u8], bram: Option<&[u8]>, sr: f64, vco_seed: u32) -> Self {
        let mut machine = Machine::new(rom);
        if let Some(b) = bram { machine.set_bram(b); }
        machine.reset();
        let vco = VcoBank::new(VcoOptions { seed: vco_seed, ..Default::default() });
        let engine = Engine::new(sr, vco.osc.clone());
        machine.hw.vco = Some(vco);
        machine.hw.events = Some(Vec::with_capacity(4096));
        let cycle0 = machine.cpu.cycles;
        Instrument { machine, engine, sr, sample: 0, cycle0, events: Vec::with_capacity(4096) }
    }

    pub fn sample_rate(&self) -> f64 { self.sr }

    /// CPU cycle at which sample `s` starts
    fn cycle_of(&self, s: u64) -> u64 { self.cycle0 + ((s as f64) * CPU_HZ as f64 / self.sr).ceil() as u64 }

    /// Run the machine for `samples` without rendering audio (boot, autotune...). Analog writes still update
    /// the voice state.
    pub fn skip(&mut self, samples: u64) {
        let target = self.cycle_of(self.sample + samples);
        let now = self.machine.cpu.cycles;
        if target > now { self.machine.run(target - now); }
        self.sample += samples;
        if let Some(ev) = self.machine.hw.events.as_mut() {
            for e in ev.drain(..) { self.engine.apply(&e); }
        }
    }

    /// Render stereo audio, running the CPU alongside.
    pub fn render(&mut self, l: &mut [f32], r: &mut [f32]) {
        let n = l.len().min(r.len());
        let mut pos = 0;
        while pos < n {
            let chunk = CHUNK.min(n - pos);
            let start = self.sample;
            let target = self.cycle_of(start + chunk as u64);
            let now = self.machine.cpu.cycles;
            if target > now { self.machine.run(target - now); }
            if let Some(ev) = self.machine.hw.events.as_mut() { std::mem::swap(ev, &mut self.events); }
            // apply each write at its sample inside this chunk
            let mut at = 0usize;
            for e in self.events.drain(..) {
                let cyc = match e { AnalogEvent::Cv { cycle, .. } | AnalogEvent::Latch { cycle, .. } => cycle };
                let s = (((cyc.saturating_sub(self.cycle0)) as f64 * self.sr / CPU_HZ as f64) as u64).saturating_sub(start);
                let s = (s as usize).min(chunk);
                if s > at {
                    self.engine.render(&mut l[pos + at..pos + s], &mut r[pos + at..pos + s]);
                    at = s;
                }
                self.engine.apply(&e);
            }
            if at < chunk { self.engine.render(&mut l[pos + at..pos + chunk], &mut r[pos + at..pos + chunk]); }
            self.sample += chunk as u64;
            pos += chunk;
        }
    }

    // ------------------------------------------------------------ inputs
    pub fn midi_in(&mut self, bytes: &[u8]) { self.machine.hw.acia.receive(bytes); }
    /// MIDI the instrument sent since the last call
    pub fn take_midi_out(&mut self) -> Vec<u8> { std::mem::take(&mut self.machine.hw.acia.tx_out) }
    pub fn key(&mut self, note: u8, down: bool, velocity: u8) {
        if down { self.machine.key_down(note, velocity) } else { self.machine.key_up(note) }
    }
    /// raw 8279 FIFO byte (bit 6 = 1 when A440 is up)
    pub fn panel_key(&mut self, fifo: u8) { self.machine.hw.kd.press_key(fifo); }
    pub fn pot(&mut self, mux_channel: usize, value: f64) { self.machine.hw.pot_by_channel[mux_channel & 15] = value.clamp(0.0, 1023.0); }
}
