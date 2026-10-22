//! SSM2044 model, level 1: four one-pole stages (topology-preserving transform, zero-delay feedback) with a
//! global resonance loop and a tanh at the input stage (the SSM2044's OTA input; level 2 will add per-stage
//! nonlinearities). Self-oscillates for k >= 4.

#[derive(Clone, Default)]
pub struct Ladder {
    s: [f64; 4],
}

impl Ladder {
    /// x = input (normalised to the drive level), g = tan(pi fc / fs), k = resonance (0..~4.4)
    #[inline]
    pub fn tick(&mut self, x: f64, g: f64, k: f64) -> f64 {
        let b = 1.0 / (1.0 + g);
        let gg = g * b; // one-pole TPT gain G
        let g2 = gg * gg;
        let g4 = g2 * g2;
        // linear prediction of the 4th-stage output (zero-delay feedback), then saturate the loop input
        let sigma = g2 * gg * self.s[0] * b + g2 * self.s[1] * b + gg * self.s[2] * b + self.s[3] * b;
        let y4 = (g4 * x + sigma) / (1.0 + k * g4);
        let mut u = (x - k * y4).tanh();
        for s in self.s.iter_mut() {
            let v = (u - *s) * gg;
            let y = v + *s;
            *s = y + v;
            u = y;
        }
        // flush denormals
        for s in self.s.iter_mut() {
            if s.abs() < 1e-20 { *s = 0.0; }
        }
        u
    }

    pub fn reset(&mut self) { self.s = [0.0; 4]; }
}

#[cfg(test)]
mod tests {
    use super::*;
    const FS: f64 = 48_000.0;

    /// steady-state gain of a sine through the filter
    fn gain(fc: f64, k: f64, f: f64, amp: f64) -> f64 {
        let g = (std::f64::consts::PI * fc / FS).tan();
        let mut l = Ladder::default();
        let n = (FS * 0.5) as usize;
        let mut peak: f64 = 0.0;
        for i in 0..n {
            let y = l.tick(amp * (2.0 * std::f64::consts::PI * f * i as f64 / FS).sin(), g, k);
            if i > n / 2 { peak = peak.max(y.abs()); }
        }
        peak / amp
    }

    #[test]
    fn four_pole_lowpass_response() {
        // small signal (linear region): passband ~1, -12 dB at fc, -24 dB/oct above
        assert!((gain(1000.0, 0.0, 100.0, 0.01) - 1.0).abs() < 0.02);
        let at_fc = 20.0 * gain(1000.0, 0.0, 1000.0, 0.01).log10();
        assert!((at_fc + 12.0).abs() < 1.0, "{at_fc} dB at fc");
        let oct = 20.0 * (gain(1000.0, 0.0, 4000.0, 0.01) / gain(1000.0, 0.0, 2000.0, 0.01)).log10();
        assert!(oct < -18.0, "{oct} dB/oct");
    }

    #[test]
    fn self_oscillates_at_high_resonance_near_cutoff() {
        let fc = 500.0;
        let g = (std::f64::consts::PI * fc / FS).tan();
        let mut l = Ladder::default();
        let mut y = Vec::new();
        let mut x = 1e-3; // a tiny kick
        for _ in 0..(FS as usize) {
            y.push(l.tick(x, g, 4.4));
            x = 0.0;
        }
        let tail = &y[y.len() / 2..];
        let amp = tail.iter().fold(0.0f64, |m, v| m.max(v.abs()));
        // grows from the 1e-3 kick to a tanh-limited level (~0.15 of the drive level with this model)
        assert!(amp > 0.05, "no self-oscillation ({amp})");
        let crossings = tail.windows(2).filter(|w| w[0] <= 0.0 && w[1] > 0.0).count() as f64;
        let f = crossings / (tail.len() as f64 / FS);
        assert!((f / fc - 1.0).abs() < 0.15, "oscillates at {f} Hz for fc {fc}");
        // and k = 0 stays silent after the kick
        let mut q = Ladder::default();
        let mut last = 0.0;
        for i in 0..(FS as usize) { last = q.tick(if i == 0 { 1e-3 } else { 0.0 }, g, 0.0); }
        assert!(last.abs() < 1e-9);
    }
}
