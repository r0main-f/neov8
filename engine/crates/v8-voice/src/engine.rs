//! The eight voices and the mixer, driven by the analog state the CPU writes (S&H slots, control latches).
//! Slot and latch meanings: docs/hardware.md §3.1/§4, docs/audio-model.md. Level 1: no modulation matrix yet.

use crate::calib::*;
use crate::filter::Ladder;
use crate::modmatrix::{decode, Bank};
use crate::osc::{Osc, Waves};
use v8_machine::vco::{duty_at, period_at, OscParams};
use v8_machine::{AnalogEvent, Ctl, CPU_HZ};

/// Analog state mirrored from the machine's writes.
#[derive(Clone)]
pub struct AnalogState {
    pub cv: [u16; 136],
    pub mult: [u8; 136],
    pub ctl: Ctl,
}

impl Default for AnalogState {
    fn default() -> Self { AnalogState { cv: [0; 136], mult: [0; 136], ctl: Ctl::default() } }
}

impl AnalogState {
    pub fn apply(&mut self, e: &AnalogEvent) {
        match *e {
            AnalogEvent::Cv { slot, value, mult, .. } => {
                self.cv[slot as usize] = value;
                self.mult[slot as usize] = mult;
            }
            AnalogEvent::Latch { addr, data, slot, .. } => { self.ctl.apply(addr, data, slot); }
        }
    }
    /// S&H level in 14-bit DAC units (DAC word × multiplier / 255), as the VCO model reads it
    #[inline]
    pub fn level(&self, s: usize) -> f64 { self.cv[s] as f64 * self.mult[s] as f64 / 255.0 }
    /// S&H level as a 0..1 fraction of full scale
    #[inline]
    pub fn frac(&self, s: usize) -> f64 { self.level(s) / 16384.0 }
}

/// Per-voice parameters, recomputed from the state at control rate.
#[derive(Clone, Copy, Default)]
struct Params {
    f1: f64,
    f2: f64,
    /// summed pulse-width CV (IPW + PWM − rest), slot units
    pw1: f64,
    pw2: f64,
    w1: Waves,
    w2: Waves,
    sync: bool,
    lin_fm: bool,
    bypass: bool,
    g1: f64,
    g2: f64,
    gn: f64,
    fc_oct: f64,
    env1_target: f64,
    vca_target: f64,
    /// initial Q, 0..1 of full scale
    q: f64,
    /// mod sources of this voice: ADSR1 / ADSR2 copies (volts, before the mDAC) and the velocity / keyboard CV
    /// controller (0..1)
    adsr1_v: f64,
    adsr2_v: f64,
    vel: f64,
}

#[derive(Clone, Default)]
struct Voice {
    o1: Osc,
    o2: Osc,
    vcf: Ladder,
    env1: f64,
    vca: f64,
    /// smoothed pulse-width CVs (pin 5 RC) and cutoff (octaves re FC_REF, summer pole)
    pw1: f64,
    pw2: f64,
    fco: f64,
    /// last output of each VCO (the poly mod sources, tapped before the level VCAs)
    last_v1: f64,
    last_v2: f64,
    dc: f64,
    p: Params,
}

pub struct Engine {
    pub sr: f64,
    pub state: AnalogState,
    osc: Vec<OscParams>,
    voices: Vec<Voice>,
    noise: u32,
    vol: [f64; 2],
    vol_t: [f64; 2],
    dirty: bool,
    a_env1: f64,
    a_vca: f64,
    a_dc: f64,
    a_pw: f64,
    a_fc: f64,
    a_vol_up: f64,
    a_vol_dn: f64,
    /// master volume (panel MASTER VOLUME pot), 0..1
    pub master: f64,
    /// panel MASTER TUNE, semitones on both oscillators (range not documented; the panel knob gives ±1)
    pub master_tune: f64,
    /// analog controllers of the mod banks: joystick X (−1..1: +X right, −X left), key pressure, Fc pedal (0..1)
    pub joystick_x: f64,
    pub pressure: f64,
    pub fc_pedal: f64,
    /// decoded banks per side, their signed depth gain (invert, depth OTA, MOD_GAIN) and the mono sources per side
    /// (DC, LFO1, LFO2, LFO1 square, volts)
    banks: [[Bank; 4]; 2],
    depth: [[f64; 4]; 2],
    mono: [[f64; 4]; 2],
    lf_noise: f64,
    a_lf_noise: f64,
}

/// SSM2024 gain for a control voltage `v`: off below the threshold, 1 at `full` volts
#[inline]
fn vca_gain(v: f64, full: f64) -> f64 { (v - VCA_TH).max(0.0) / (full - VCA_TH) }

/// control-rate block (samples)
pub const BLOCK: usize = 16;

impl Engine {
    pub fn new(sr: f64, osc: Vec<OscParams>) -> Self {
        assert_eq!(osc.len(), 16);
        let a = |tau: f64| 1.0 - (-1.0 / (tau * sr)).exp();
        Engine {
            sr,
            state: AnalogState::default(),
            osc,
            voices: vec![Voice::default(); 8],
            noise: 0x1234_5678,
            vol: [0.0; 2],
            vol_t: [0.0; 2],
            dirty: true,
            a_env1: a(ADSR1_TAU),
            a_vca: a(VCA_TAU),
            a_dc: a(1.0 / (2.0 * std::f64::consts::PI * 8.0)),
            a_pw: a(PW_TAU),
            a_fc: a(FC_TAU),
            a_vol_up: a(VOL_RISE_TAU),
            a_vol_dn: a(VOL_FALL_TAU),
            master: 1.0,
            master_tune: 0.0,
            joystick_x: 0.0,
            pressure: 0.0,
            fc_pedal: 0.0,
            banks: [[Bank::default(); 4]; 2],
            depth: [[0.0; 4]; 2],
            mono: [[0.0; 4]; 2],
            lf_noise: 0.0,
            a_lf_noise: 1.0 - (-2.0 * std::f64::consts::PI * LF_NOISE_HZ / sr).exp(),
        }
    }

    pub fn apply(&mut self, e: &AnalogEvent) {
        self.state.apply(e);
        self.dirty = true;
    }

    fn update_params(&mut self) {
        let st = &self.state;
        let c = &st.ctl;
        for v in 0..8 {
            let side = v / 4;
            let lv = v % 4;
            let (b2, b1) = (8 * v, 8 * v + 4);
            let (i2, i1) = (2 * v, 2 * v + 1);
            let wave = if side == 0 { c.ic1 } else { c.ic2 }; // active low
            let on = |bit: u8| wave & (1 << bit) == 0;
            let p = &mut self.voices[v].p;
            p.f1 = CPU_HZ as f64 / period_at(&self.osc[i1], st.level(b1 + 3), st.level(b1));
            p.f2 = CPU_HZ as f64 / period_at(&self.osc[i2], st.level(b2 + 3), st.level(b2));
            p.pw1 = st.level(b1 + 2) + st.level(b1 + 1) - PWM_REST;
            p.pw2 = st.level(b2 + 2) + st.level(b2 + 1) - PWM_REST;
            p.w1 = Waves { sub: on(0), tri: on(1), saw: on(2) };
            p.w2 = Waves { sub: on(4), tri: on(5), saw: on(6) };
            p.sync = on(3);
            p.bypass = on(7);
            p.lin_fm = c.ic3 & (1 << side) == 0;
            let sb = 8 * side;
            p.g1 = vca_gain(st.frac(0x44 + sb) * VFS, VCO_LEVEL_FULL);
            p.g2 = vca_gain(st.frac(0x45 + sb) * VFS, VCO_LEVEL_FULL);
            p.gn = vca_gain(st.frac(0x52 + 4 * side) * VFS, VCO_LEVEL_FULL);
            p.q = st.frac(0x46 + sb);
            let fc7 = st.level(0x40 + sb + lv) / 128.0;
            p.fc_oct = (fc7 - FC_REF_STEP) / 12.0;
            p.env1_target = st.frac(0x70 + v) * VFS; // volts = octaves
            p.vca_target = vca_gain(st.frac(0x68 + v) * VFS, VFS);
            // mod sources: the ADSR copies are taken before the mDAC (raw DAC word); controller = velocity slot
            p.adsr1_v = st.cv[0x70 + v] as f64 / 16384.0 * VFS;
            p.adsr2_v = st.cv[0x68 + v] as f64 / 16384.0 * VFS;
            p.vel = st.frac(0x58 + v);
        }
        for side in 0..2 {
            let o = 4 * side;
            let volts = |x: f64| x / 16384.0 * VFS;
            let sq = c.ic3 & (0x20 << side) != 0;
            self.mono[side] = [
                MOD_DC_V,
                volts(st.level(0x79 + o) - st.level(0x78 + o)),
                volts(st.level(0x7a + o) - LFO2_REF),
                if sq { LFO1_SQ_V } else { 0.0 },
            ];
            self.banks[side] = decode(&c.xpoint, &c.ls670, side);
            for b in 0..4 {
                let vd = st.frac(0x60 + o + b) * VFS;
                let g = (vd - MOD_TH).max(0.0) / (VFS - MOD_TH) * MOD_GAIN;
                self.depth[side][b] = if self.banks[side][b].invert { -g } else { g };
            }
        }
        for side in 0..2 {
            self.vol_t[side] = vca_gain(st.frac(0x53 + 4 * side) * VFS, VFS) * 1.5;
        }
    }

    #[inline]
    fn white(&mut self) -> f64 {
        let mut x = self.noise;
        x ^= x << 13;
        x ^= x >> 17;
        x ^= x << 5;
        self.noise = x;
        (x as f64 / u32::MAX as f64) * 2.0 - 1.0
    }

    /// Render stereo samples (adds nothing outside: overwrites `l` and `r`).
    pub fn render(&mut self, l: &mut [f32], r: &mut [f32]) {
        let n = l.len().min(r.len());
        let whole = self.state.ctl.ic3 & 0x10 != 0; // $6304 = $FF in WHOLE 8 (voice.asm vx_split_latch)
        // [left, right]. Voices 0-3 (side 0, the RIGHT program) reach the RIGHT jack (mixer card: pairs (0,1),(2,3)
        // -> IC4A -> IC5A -> RIGHT); in WHOLE 8 the DG308s cross pairs (2,3) and (4,5) over through 220K.
        let mut pan = [[0.0f64; 2]; 8];
        for (v, pv) in pan.iter_mut().enumerate() {
            *pv = if whole {
                match v / 2 { 0 => [0.0, 1.0], 1 => [PAN_NEAR, 1.0 - PAN_NEAR], 2 => [1.0 - PAN_NEAR, PAN_NEAR], _ => [1.0, 0.0] }
            } else if v < 4 { [0.0, 1.0] } else { [1.0, 0.0] };
        }
        let fs = self.sr;
        let fc_max = FC_MAX.min(0.45 * fs);
        let tune = (self.master_tune / 12.0).exp2();
        for i in 0..n {
            if i % BLOCK == 0 && self.dirty {
                self.update_params();
                self.dirty = false;
            }
            let noise = self.white() * 0.5 * NOISE_VPP;
            let (mut out_l, mut out_r) = (0.0, 0.0);
            for side in 0..2 {
                let a = if self.vol_t[side] > self.vol[side] { self.a_vol_up } else { self.a_vol_dn };
                self.vol[side] += (self.vol_t[side] - self.vol[side]) * a;
            }
            self.lf_noise += (noise / (0.5 * NOISE_VPP) - self.lf_noise) * self.a_lf_noise;
            let (a_env1, a_vca, a_dc, a_pw, a_fc) = (self.a_env1, self.a_vca, self.a_dc, self.a_pw, self.a_fc);
            let (px, nx) = (self.joystick_x.max(0.0), (-self.joystick_x).max(0.0));
            let mono_ctl = [self.pressure, self.fc_pedal, self.lf_noise.max(0.0)];
            let osc = &self.osc;
            for (v, vo) in self.voices.iter_mut().enumerate() {
                let p = vo.p;
                let side = v / 4;
                // mod banks: source × controllers × depth, summed per destination (VCO1, VCO2, Fc octaves; Q volts)
                let mut m = [0.0f64; 4];
                for (b, bank) in self.banks[side].iter().enumerate() {
                    let g = self.depth[side][b];
                    if bank.dest == 0 || g == 0.0 { continue; }
                    let s = match bank.src {
                        0..=3 => self.mono[side][bank.src as usize],
                        4 => vo.last_v1 * VCO1_SRC_GAIN,
                        5 => vo.last_v2 * VCO2_SRC_GAIN,
                        6 => p.adsr1_v,
                        _ => p.adsr2_v,
                    };
                    // controller inputs summed into OTA1's bias (the "unity" input = full scale)
                    let mut ctl = 0.0;
                    if bank.vel { ctl += p.vel; }
                    if bank.unity { ctl += 1.0; }
                    if bank.lf_noise { ctl += mono_ctl[2]; }
                    if bank.adsr1 { ctl += p.adsr1_v / VFS; }
                    if bank.plus_x { ctl += px; }
                    if bank.minus_x { ctl += nx; }
                    if bank.pressure { ctl += mono_ctl[0]; }
                    if bank.pedal { ctl += mono_ctl[1]; }
                    let x = s * ctl.clamp(0.0, 1.0) * g;
                    for (d, md) in m.iter_mut().enumerate() {
                        if bank.dest & (1 << d) != 0 { *md += if d < 2 { x * VCO_MOD_K } else { x }; }
                    }
                }
                vo.vca += (p.vca_target - vo.vca) * a_vca;
                vo.env1 += (p.env1_target - vo.env1) * a_env1;
                vo.pw1 += (p.pw1 - vo.pw1) * a_pw;
                vo.pw2 += (p.pw2 - vo.pw2) * a_pw;
                vo.fco += (p.fc_oct + vo.env1 + m[2] - vo.fco) * a_fc;
                let k = K_MAX * (p.q - Q_MOD_K * m[3] / VFS).clamp(0.0, 1.0).powf(Q_CURVE);
                if vo.vca < 1e-6 && p.vca_target < 1e-6 {
                    vo.vca = 0.0;
                    continue; // silent voice: skip the audio work (oscillators keep no phase while silent)
                }
                let (duty1, duty2) = (duty_at(&osc[2 * v + 1], vo.pw1), duty_at(&osc[2 * v], vo.pw2));
                let t2 = vo.o2.tick(p.f2 * tune * m[1].exp2() / fs, duty2, p.w2, None);
                let fm = if p.lin_fm { 1.0 + LIN_FM_DEPTH * vo.last_v2 } else { 1.0 };
                let reset = if p.sync { t2.wrapped } else { None }; // hard sync on VCO2's saw reset
                let t1 = vo.o1.tick((p.f1 * tune * m[0].exp2() * fm).max(0.0) / fs, duty1, p.w1, reset);
                vo.last_v2 = t2.out;
                vo.last_v1 = t1.out;
                let into = p.g2 * t2.out + p.gn * noise + if p.bypass { 0.0 } else { p.g1 * t1.out };
                let fc = (FC_REF * vo.fco.exp2()).clamp(FC_MIN, fc_max);
                let g = (std::f64::consts::PI * fc / fs).tan();
                let mut y = vo.vcf.tick(into / DRIVE_V, g, k) * DRIVE_V;
                if p.bypass {
                    y += p.g1 * t1.out * BYPASS_GAIN;
                }
                let s = y * vo.vca;
                vo.dc += (s - vo.dc) * a_dc;
                let s = s - vo.dc;
                out_l += s * pan[v][0];
                out_r += s * pan[v][1];
            }
            let g = OUT_GAIN * self.master;
            // output VCAs: side 0's volume ($53) on the RIGHT output, side 1's ($57) on the LEFT
            l[i] = (out_l * self.vol[1] * g) as f32;
            r[i] = (out_r * self.vol[0] * g) as f32;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ssm2024_is_off_below_its_threshold_and_linear_above() {
        assert_eq!(vca_gain(0.0, 10.0), 0.0);
        assert_eq!(vca_gain(VCA_TH * 0.9, 10.0), 0.0);
        assert!((vca_gain(10.0, 10.0) - 1.0).abs() < 1e-12);
        let (a, b) = (vca_gain(4.0, 10.0), vca_gain(6.0, 10.0));
        assert!((b - a - 2.0 / (10.0 - VCA_TH)).abs() < 1e-12);
    }

    /// One voice playing a saw with the filter open, everything else silent.
    fn one_voice(v: usize, whole: bool) -> (f64, f64) {
        let osc = vec![OscParams { tune: 94.0, scale: 1.0, pw50: 0x38 as f64 * 128.0, jitter: 0.0, fault: None }; 16];
        let mut e = Engine::new(48_000.0, osc);
        let st = &mut e.state;
        st.mult = [255; 136];
        let side = v / 4;
        st.cv[8 * v + 7] = 60 * 128; // VCO1 pitch
        st.cv[8 * v + 6] = 16300; // pulses off
        st.cv[8 * v + 2] = 16300;
        st.cv[0x44 + 8 * side] = 16383; // VCO1 level
        st.cv[0x40 + 8 * side + v % 4] = 120 * 128; // cutoff open
        st.cv[0x68 + v] = 16383; // voice VCA
        st.cv[0x53] = 16383;
        st.cv[0x57] = 16383;
        st.ctl.ic1 = !0x04; // VCO1 saw (active low), side 0
        st.ctl.ic2 = !0x04; // side 1
        st.ctl.ic3 = if whole { 0x10 } else { 0x00 };
        let (mut l, mut r) = (vec![0f32; 4800], vec![0f32; 4800]);
        e.render(&mut l, &mut r);
        let rms = |x: &[f32]| (x[2400..].iter().map(|s| (*s as f64).powi(2)).sum::<f64>() / 2400.0).sqrt();
        (rms(&l), rms(&r))
    }

    /// Frequency of voice 0's VCO1 saw with bank A of side 0 = DC → VCO1 at the given depth slot value (0..1).
    fn vco1_freq_with_dc_mod(depth: f64, dest_q: bool) -> (f64, f64) {
        let osc = vec![OscParams { tune: 94.0, scale: 1.0, pw50: 0x38 as f64 * 128.0, jitter: 0.0, fault: None }; 16];
        let mut e = Engine::new(48_000.0, osc);
        let st = &mut e.state;
        st.mult = [255; 136];
        st.cv[7] = 94 * 128; // the reference pitch, ≈ 886 Hz
        st.cv[6] = 16300;
        st.cv[2] = 16300;
        st.cv[0x44] = 16383;
        st.cv[0x40] = 120 * 128;
        st.cv[0x68] = 16383;
        st.cv[0x53] = 16383;
        st.ctl.ic1 = !0x04;
        // bank A, side 0: source DC (X0), unity controller, in phase to VCO1 (or Q), the rest grounded
        st.ctl.xpoint[0] = 1;
        st.ctl.xpoint[0x21] = 1;
        for d in 0..4 {
            let on = if dest_q { d == 3 } else { d == 0 };
            st.ctl.xpoint[0x30 + d * 4 + 2 + usize::from(!on)] = 1;
        }
        st.cv[0x60] = (depth * 16384.0) as u16;
        let mut r = vec![0f32; 48_000];
        let mut l = vec![0f32; 48_000];
        e.render(&mut l, &mut r);
        // rising zero crossings over the second half
        let y = &r[24_000..];
        let mean = y.iter().map(|&v| v as f64).sum::<f64>() / y.len() as f64;
        let n = (1..y.len()).filter(|&i| (y[i - 1] as f64) < mean && (y[i] as f64) >= mean).count();
        let rms = (y.iter().map(|&v| (v as f64 - mean).powi(2)).sum::<f64>() / y.len() as f64).sqrt();
        (n as f64 * 2.0, rms)
    }

    #[test]
    fn mod_bank_dc_to_vco1_follows_the_depth_law() {
        let (f0, _) = vco1_freq_with_dc_mod(0.0, false);
        // +1 octave: depth CV = threshold + the span / (DC volts × the VCO bus share), 1 V/oct
        let d = (MOD_TH + (VFS - MOD_TH) / (MOD_DC_V * VCO_MOD_K)) / VFS;
        let (f1, _) = vco1_freq_with_dc_mod(d, false);
        assert!((f1 / f0 - 2.0).abs() < 0.02, "{f0} -> {f1}");
        // depth $18 is below the OTA threshold: no modulation (user manual p.64)
        let (f18, _) = vco1_freq_with_dc_mod(24.0 / 256.0, false);
        assert!((f18 / f0 - 1.0).abs() < 0.005, "{f0} -> {f18}");
        // DC to Q (a positive source lowers the resonance; nothing to lower here, so the output stays the same)
        let (_, r0) = vco1_freq_with_dc_mod(0.0, true);
        let (_, r1) = vco1_freq_with_dc_mod(1.0, true);
        assert!((r1 / r0 - 1.0).abs() < 0.05, "{r0} -> {r1}");
    }

    #[test]
    fn voices_0_3_are_the_right_output_and_whole_8_spreads_the_pairs() {
        let (l, r) = one_voice(0, false);
        assert!(r > 0.01 && l < r * 1e-3, "voice 0, split: L {l} R {r}");
        let (l, r) = one_voice(5, false);
        assert!(l > 0.01 && r < l * 1e-3, "voice 5, split: L {l} R {r}");
        let (l, r) = one_voice(2, true);
        assert!((l / r - PAN_NEAR / (1.0 - PAN_NEAR)).abs() < 0.01, "voice 2, whole: L {l} R {r}");
        let (l, r) = one_voice(7, true);
        assert!(r < l * 1e-3, "voice 7, whole: L {l} R {r}");
    }
}
