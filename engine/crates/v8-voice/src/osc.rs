//! CEM3340 core: a ramp with phase 0..1, the card's waveform taps (saw, triangle, pulse, sub-octave), band-
//! limited with polyBLEP at every discontinuity (saw reset, pulse edges, sub-octave toggles). Output in volts
//! as the VCO card's summer delivers them (calib.rs weights), DC removed later in the voice.

use crate::calib::*;

/// polyBLEP residual for a discontinuity at phase 0, t = phase, dt = phase increment
#[inline]
fn blep(t: f64, dt: f64) -> f64 {
    if t < dt {
        let x = t / dt;
        x + x - x * x - 1.0
    } else if t > 1.0 - dt {
        let x = (t - 1.0) / dt;
        x * x + x + x + 1.0
    } else {
        0.0
    }
}

#[derive(Clone, Copy, Default)]
pub struct Waves {
    pub saw: bool,
    pub tri: bool,
    pub sub: bool,
}

#[derive(Clone, Default)]
pub struct Osc {
    pub phase: f64,
    /// sub-octave flip-flop (MC14520 ÷2, toggled at each ramp reset)
    sub_state: bool,
}

/// One sample of an oscillator.
pub struct Tick {
    /// card output, volts
    pub out: f64,
    /// the ramp wrapped during this sample (sync source event), at this fraction of the sample
    pub wrapped: Option<f64>,
}

impl Osc {
    /// Advance by `dt` (cycles per sample). `duty` 0..1 (>= 1: no pulse). `reset_at`: hard phase reset
    /// requested inside this sample (soft sync from the master), as a fraction of the sample.
    pub fn tick(&mut self, dt: f64, duty: f64, w: Waves, reset_at: Option<f64>) -> Tick {
        let dt = dt.clamp(1e-9, 0.5);
        let mut p = self.phase + dt;
        let mut wrapped = None;
        if p >= 1.0 {
            p -= 1.0;
            wrapped = Some(p / dt);
            self.sub_state = !self.sub_state;
        }
        // soft sync: reset only when the ramp is past the window (CEM3340 pin 9 behaviour, approximated). The
        // reset is band-limited like a normal wrap (level 1: the BLEP assumes a full-height jump).
        if reset_at.is_some() && p > SOFT_SYNC_WINDOW && wrapped.is_none() {
            p = 0.0;
            self.sub_state = !self.sub_state;
            wrapped = Some(0.0);
        }
        self.phase = p;
        let mut out = 0.0;
        if w.saw {
            let s = 2.0 * p - 1.0 - blep(p, dt);
            out += s * 0.5 * SAW_VPP * SAW_GAIN;
        }
        if w.tri {
            let t = if p < 0.5 { 4.0 * p - 1.0 } else { 3.0 - 4.0 * p };
            out += t * 0.5 * TRI_VPP * TRI_GAIN;
        }
        if duty < 1.0 && duty > 0.0 {
            // pulse high for phase < duty; inverted by the 2N3906 stage, polarity irrelevant for the sound
            let mut s = if p < duty { 1.0 } else { -1.0 };
            s += blep(p, dt);
            let mut q = p - duty;
            if q < 0.0 { q += 1.0; }
            s -= blep(q, dt);
            out += s * 0.5 * PULSE_VPP * PULSE_GAIN;
        }
        if w.sub {
            let mut s = if self.sub_state { 1.0 } else { -1.0 };
            // the toggle happens at the ramp reset; the BLEP's sign is the state after the jump: the current
            // one just after the wrap (p small), the upcoming one just before it (p near 1)
            let after = if p < 0.5 { self.sub_state } else { !self.sub_state };
            s += if after { 1.0 } else { -1.0 } * blep(p, dt);
            out += s * 0.5 * SUB_VPP * SUB_GAIN;
        }
        Tick { out, wrapped }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frequency_is_exact_and_sub_is_an_octave_down() {
        let fs = 48_000.0;
        let f = 441.0;
        let mut o = Osc::default();
        let mut wraps = 0;
        let mut sub_flips = 0;
        let mut last_sub = false;
        for _ in 0..48_000 {
            let t = o.tick(f / fs, 1.0, Waves { saw: true, tri: false, sub: true }, None);
            if t.wrapped.is_some() { wraps += 1; }
            if o.sub_state != last_sub { sub_flips += 1; last_sub = o.sub_state; }
        }
        assert_eq!(wraps, 441);
        assert_eq!(sub_flips, 441); // the ÷2 square: 220.5 Hz
    }

    #[test]
    fn saw_is_band_limited() {
        // energy of the alias region above 20 kHz for a 5 kHz saw stays small (polyBLEP)
        let fs = 48_000.0;
        let n = 4096;
        let mut o = Osc::default();
        let x: Vec<f64> = (0..n).map(|_| o.tick(5000.0 / fs, 1.0, Waves { saw: true, tri: false, sub: false }, None).out).collect();
        // naive DFT at a few non-harmonic bins between harmonics vs the fundamental
        let bin = |f: f64| {
            let (mut re, mut im) = (0.0, 0.0);
            for (i, v) in x.iter().enumerate() {
                let w = 2.0 * std::f64::consts::PI * f * i as f64 / fs;
                re += v * w.cos();
                im += v * w.sin();
            }
            (re * re + im * im).sqrt()
        };
        let fund = bin(5000.0);
        let alias = bin(2000.0).max(bin(3000.0)).max(bin(7000.0)); // 48k-45k=3k, 50k-48k=2k aliases
        assert!(20.0 * (alias / fund).log10() < -30.0, "aliases at {} dB", 20.0 * (alias / fund).log10());
    }
}
