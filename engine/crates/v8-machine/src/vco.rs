//! VCO bank model for the autotune (and the pitch law of the sound engine): 16 CEM3340 oscillators with seeded
//! analog imperfections, the tune comparator mux, the LS74 divider and the PTM /G1 "VCO DETECT" gate.
//! Port of `sim/src/machine/vco.ts` (same law, same seeded generator, same edge timing). See that file and
//! docs/autotune.md for the signal path.

use crate::chips::{GateEvent, Pia6821, Ptm6840};
use crate::machine::Ctl;

/// E cycles of one period at the reference pitch: the stock offset target is 4 periods = $2343 cycles.
pub const REF_PERIOD: f64 = 0x2343 as f64 / 4.0;
pub const TRIM_GAIN: f64 = 0.25;
/// PW slot units for 0 -> 100 % duty: the IPW and PWM CVs reach CEM3340 pin 5 through two 71.5K (their average)
/// and 0 -> 5 V there is 0 -> 100 % (datasheet), so 10 V of summed CV = 120 PA steps at 10.67 V full scale
/// (docs/audio-validation.md). Same value as sim/src/machine/vco.ts.
pub const PW_SPAN: f64 = 120.0 * 128.0;

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum VcoFault { Dead, Unstable, Stuck, NoScale }

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct OscParams {
    /// semitones (pitch slot / 128) where the osc plays REF_PERIOD at s = 1
    pub tune: f64,
    /// V/oct scale error at trim mid scale (1 = perfect)
    pub scale: f64,
    /// pulse-width slot value (14-bit) giving a 50 % duty cycle
    pub pw50: f64,
    /// relative period jitter (gaussian sigma), 0 = clean
    pub jitter: f64,
    pub fault: Option<VcoFault>,
}

#[derive(Clone, Copy, Debug)]
pub struct VcoOptions { pub seed: u32, pub tune_spread: f64, pub scale_spread: f64, pub pw_spread: f64, pub jitter: f64 }

impl Default for VcoOptions {
    fn default() -> Self { VcoOptions { seed: 1, tune_spread: 3.0, scale_spread: 0.04, pw_spread: 4.0, jitter: 0.0 } }
}

/// mulberry32, bit-identical to the TypeScript generator
#[derive(Clone)]
pub struct Mulberry32(u32);
impl Mulberry32 {
    pub fn new(seed: u32) -> Self { Mulberry32(seed) }
    pub fn next_f64(&mut self) -> f64 {
        self.0 = self.0.wrapping_add(0x6d2b79f5);
        let mut t = self.0;
        t = (t ^ (t >> 15)).wrapping_mul(t | 1);
        t ^= t.wrapping_add((t ^ (t >> 7)).wrapping_mul(t | 61));
        (t ^ (t >> 14)) as f64 / 4294967296.0
    }
}

/// Pitch law shared with the sound engine: period in E cycles for given pitch / trim slot levels (14-bit
/// units, already × multiplier / 255); infinite = no oscillation.
pub fn period_at(o: &OscParams, pitch14: f64, trim14: f64) -> f64 {
    if o.fault == Some(VcoFault::Dead) { return f64::INFINITY; }
    let stuck = o.fault == Some(VcoFault::Stuck);
    let x = if stuck { o.tune - 2.0 } else { pitch14 / 128.0 };
    let s = if stuck { 1.0 } else { scale_at(o, trim14) };
    REF_PERIOD * 2f64.powf(-(s * x - o.tune) / 12.0)
}
pub fn scale_at(o: &OscParams, trim14: f64) -> f64 {
    if o.fault == Some(VcoFault::NoScale) { return o.scale; }
    o.scale * (1.0 + (TRIM_GAIN * (trim14 - 8192.0)) / 8192.0)
}
pub fn duty_at(o: &OscParams, pw14: f64) -> f64 { (0.5 + (pw14 - o.pw50) / PW_SPAN).clamp(0.0, 1.0) }

/// Slot base of oscillator i: 8v+4 for VCO1 (odd), 8v+0 for VCO2 (even).
pub fn slot_base(i: usize) -> usize { 8 * (i >> 1) + if i & 1 != 0 { 4 } else { 0 } }

#[derive(Clone)]
pub struct VcoBank {
    pub osc: Vec<OscParams>,
    rnd: Mulberry32,
    key: Option<(i32, f64, f64, f64, bool)>,
    active: bool,
    level: bool,
    period: f64,
    duty: f64,
    last_rise: f64,
    next_rise: f64,
    next_fall: f64,
    cur_osc: i32,
    q: bool,
    gate: bool,
    pub edges: u64,
    pending: Vec<GateEvent>,
    t0: f64,
    preset: bool,
    clear: bool,
}

impl VcoBank {
    pub fn new(opts: VcoOptions) -> Self {
        let mut rnd = Mulberry32::new(opts.seed);
        let mut osc = Vec::with_capacity(16);
        for _ in 0..16 {
            let mut u = || rnd.next_f64() * 2.0 - 1.0;
            let tune = 94.0 + u() * opts.tune_spread;
            let scale = 1.0 + u() * opts.scale_spread;
            let pw50 = (0x38 as f64 + u() * opts.pw_spread) * 128.0;
            osc.push(OscParams { tune, scale, pw50, jitter: opts.jitter, fault: None });
        }
        Self::with_osc(osc, rnd)
    }
    pub fn from_params(osc: Vec<OscParams>, seed: u32) -> Self { Self::with_osc(osc, Mulberry32::new(seed)) }
    fn with_osc(osc: Vec<OscParams>, rnd: Mulberry32) -> Self {
        VcoBank {
            osc, rnd, key: None, active: false, level: true, period: REF_PERIOD, duty: 0.5, last_rise: 0.0,
            next_rise: f64::INFINITY, next_fall: f64::INFINITY, cur_osc: -1, q: true, gate: false, edges: 0,
            pending: Vec::with_capacity(16), t0: 0.0, preset: false, clear: false,
        }
    }

    fn gauss(&mut self) -> f64 {
        let u = self.rnd.next_f64().max(1e-12);
        let v = self.rnd.next_f64();
        (-2.0 * u.ln()).sqrt() * (2.0 * std::f64::consts::PI * v).cos()
    }

    pub fn period_of(&self, i: usize, pitch14: f64, trim14: f64) -> f64 { period_at(&self.osc[i], pitch14, trim14) }

    fn slot(cv: &[u16], mult: &[u8], s: usize) -> f64 { (cv[s] as f64 * mult[s] as f64) / 255.0 }

    fn config(&mut self, t: f64, ctl: &Ctl, cv: &[u16], mult: &[u8]) {
        let vco1 = ctl.ic3 & 0x08 == 0;
        let vco2 = ctl.ic3 & 0x04 == 0;
        let v = (ctl.ic22 & 7) as i32;
        let i: i32 = if vco1 { 2 * v + 1 } else if vco2 { 2 * v } else { -1 };
        let mut period = f64::INFINITY;
        let mut duty = 0.5;
        let mut const_level = true;
        let key;
        if i >= 0 {
            let iu = i as usize;
            let base = slot_base(iu);
            let wave = if v < 4 { ctl.ic1 } else { ctl.ic2 };
            let odd = iu & 1 != 0;
            let saw = wave & if odd { 0x04 } else { 0x40 } == 0 || wave & if odd { 0x02 } else { 0x20 } == 0;
            let pitch = Self::slot(cv, mult, base + 3);
            let trim = Self::slot(cv, mult, base);
            let pw = Self::slot(cv, mult, base + 2);
            key = Some((i, pitch, trim, pw, saw));
            if key == self.key { return; }
            period = period_at(&self.osc[iu], pitch, trim);
            duty = if saw { 0.5 } else { duty_at(&self.osc[iu], pw) };
            if !period.is_finite() || duty <= 0.0 { const_level = false; } else if duty >= 1.0 { const_level = true; }
        } else {
            key = Some((-1, 0.0, 0.0, 0.0, false));
            if key == self.key { return; }
        }
        self.key = key;
        self.rebase(t, i, period, duty, const_level);
    }

    fn rebase(&mut self, t: f64, i: i32, period: f64, duty: f64, const_level: bool) {
        let oscillating = period.is_finite() && duty > 0.0 && duty < 1.0;
        let mut phase = 0.0;
        if self.active && i == self.cur_osc {
            phase = ((t - self.last_rise) / self.period).clamp(0.0, 0.999999);
        } else if oscillating {
            phase = self.rnd.next_f64(); // the newly selected osc runs at an unknown phase
        }
        self.cur_osc = i;
        self.active = oscillating;
        if !oscillating {
            self.set_level(t, const_level);
            self.next_rise = f64::INFINITY;
            self.next_fall = f64::INFINITY;
            return;
        }
        self.period = period;
        self.duty = duty;
        self.last_rise = t - phase * period;
        self.next_rise = self.last_rise + period;
        self.next_fall = if phase < duty { self.last_rise + duty * period } else { f64::INFINITY };
        self.set_level(t, phase < duty);
    }

    fn set_level(&mut self, t: f64, l: bool) {
        if l == self.level { return; }
        self.level = l;
        if l { self.rise(t); }
    }
    fn rise(&mut self, t: f64) {
        self.edges += 1;
        if self.preset || self.clear { return; }
        self.q = !self.q;
        self.set_gate(t, !self.q);
    }
    fn set_gate(&mut self, t: f64, g: bool) {
        if g == self.gate { return; }
        self.gate = g;
        self.pending.push(GateEvent { at: t - self.t0, level: g });
    }

    /// PIA1 CA2 / CB2 levels (manual output mode; any other mode = released, high)
    fn async_inputs(&mut self, t: f64, pia1: &Pia6821) {
        self.preset = pia1.cra & 0x38 == 0x30;
        self.clear = pia1.crb & 0x38 == 0x30;
        if self.preset && self.clear { self.q = true; self.set_gate(t, true); }
        else if self.clear { self.q = false; self.set_gate(t, true); }
        else if self.preset { self.q = true; self.set_gate(t, false); }
    }

    /// Comparator level (PIA1 PA7) at absolute E-cycle time t.
    pub fn level_at(&self, t: f64) -> bool {
        let (mut l, mut f, mut r) = (self.level, self.next_fall, self.next_rise);
        while f.min(r) <= t {
            if f <= r { l = false; f = f64::INFINITY; } else { l = true; f = r + self.duty * self.period; r += self.period; }
        }
        l
    }

    /// One instruction's worth of time: [t0, t0 + n) E cycles. Clocks the PTM with the /G1 edges.
    #[allow(clippy::too_many_arguments)]
    pub fn clock(&mut self, t0: f64, n: u32, pia1: &Pia6821, ctl: &Ctl, cv: &[u16], mult: &[u8], ptm: &mut Ptm6840) {
        self.t0 = t0;
        self.pending.clear();
        self.async_inputs(t0, pia1);
        self.config(t0, ctl, cv, mult);
        let t1 = t0 + n as f64;
        while self.active {
            let (f, r) = (self.next_fall, self.next_rise);
            if f.min(r) > t1 { break; }
            if f <= r {
                self.level = false;
                self.next_fall = f64::INFINITY;
            } else {
                self.level = true;
                self.last_rise = r;
                let o = self.osc[self.cur_osc as usize];
                let j = if o.fault == Some(VcoFault::Unstable) { 0.03 } else { o.jitter };
                let p = if j != 0.0 { self.period * (1.0 + j * self.gauss()) } else { self.period };
                self.next_rise = r + p;
                self.next_fall = r + self.duty * p;
                self.rise(r);
            }
        }
        ptm.clock(n, &self.pending);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mulberry32_matches_javascript() {
        // values printed by the TypeScript generator (sim/src/machine/vco.ts) for seed 7
        let mut r = Mulberry32::new(7);
        let want = [0.011704753153026104, 0.06195825757458806, 0.97690763277933, 0.6990287057124078];
        for w in want {
            assert_eq!(r.next_f64(), w);
        }
    }

    #[test]
    fn pitch_law_reference_point() {
        let o = OscParams { tune: 94.0, scale: 1.0, pw50: 0x38 as f64 * 128.0, jitter: 0.0, fault: None };
        // at x = tune, s = 1: exactly REF_PERIOD; one octave up halves it
        assert_eq!(period_at(&o, 94.0 * 128.0, 8192.0), REF_PERIOD);
        assert!((period_at(&o, 106.0 * 128.0, 8192.0) - REF_PERIOD / 2.0).abs() < 1e-9);
        assert_eq!(duty_at(&o, o.pw50), 0.5);
    }
}
