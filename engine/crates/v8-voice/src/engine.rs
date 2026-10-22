//! The eight voices and the mixer, driven by the analog state the CPU writes (S&H slots, control latches).
//! Slot and latch meanings: docs/hardware.md §3.1/§4, docs/audio-model.md. Level 1: no modulation matrix yet.

use crate::calib::*;
use crate::filter::Ladder;
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
    duty1: f64,
    duty2: f64,
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
    k: f64,
}

#[derive(Clone, Default)]
struct Voice {
    o1: Osc,
    o2: Osc,
    vcf: Ladder,
    env1: f64,
    vca: f64,
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
    dirty: bool,
    a_env1: f64,
    a_vca: f64,
    a_dc: f64,
    /// master volume (panel MASTER VOLUME pot), 0..1
    pub master: f64,
}

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
            dirty: true,
            a_env1: a(ADSR1_TAU),
            a_vca: a(VCA_TAU),
            a_dc: a(1.0 / (2.0 * std::f64::consts::PI * 8.0)),
            master: 1.0,
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
            p.duty1 = duty_at(&self.osc[i1], st.level(b1 + 2) + st.level(b1 + 1) - PWM_REST);
            p.duty2 = duty_at(&self.osc[i2], st.level(b2 + 2) + st.level(b2 + 1) - PWM_REST);
            p.w1 = Waves { sub: on(0), tri: on(1), saw: on(2) };
            p.w2 = Waves { sub: on(4), tri: on(5), saw: on(6) };
            p.sync = on(3);
            p.bypass = on(7);
            p.lin_fm = c.ic3 & (1 << side) == 0;
            let sb = 8 * side;
            p.g1 = st.frac(0x44 + sb) * VFS / VCO_LEVEL_FULL;
            p.g2 = st.frac(0x45 + sb) * VFS / VCO_LEVEL_FULL;
            p.gn = st.frac(0x52 + 4 * side) * VFS / VCO_LEVEL_FULL;
            p.k = K_MAX * st.frac(0x46 + sb).powf(Q_CURVE);
            let fc7 = st.level(0x40 + sb + lv) / 128.0;
            p.fc_oct = (fc7 - FC_REF_STEP) / 12.0;
            p.env1_target = st.frac(0x70 + v) * VFS; // volts = octaves
            p.vca_target = st.frac(0x68 + v);
        }
        for side in 0..2 {
            self.vol[side] = st.frac(0x53 + 4 * side) * 1.5;
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
        let mut pan = [[0.0f64; 2]; 8];
        for (v, pv) in pan.iter_mut().enumerate() {
            *pv = if whole {
                match v / 2 { 0 => [1.0, 0.0], 1 => [1.0 - PAN_NEAR, PAN_NEAR], 2 => [PAN_NEAR, 1.0 - PAN_NEAR], _ => [0.0, 1.0] }
            } else if v < 4 { [1.0, 0.0] } else { [0.0, 1.0] };
        }
        let fs = self.sr;
        for i in 0..n {
            if i % BLOCK == 0 && self.dirty {
                self.update_params();
                self.dirty = false;
            }
            let noise = self.white() * 0.5 * NOISE_VPP;
            let (mut out_l, mut out_r) = (0.0, 0.0);
            let (a_env1, a_vca, a_dc) = (self.a_env1, self.a_vca, self.a_dc);
            for (v, vo) in self.voices.iter_mut().enumerate() {
                let p = vo.p;
                vo.vca += (p.vca_target - vo.vca) * a_vca;
                vo.env1 += (p.env1_target - vo.env1) * a_env1;
                if vo.vca < 1e-6 && p.vca_target < 1e-6 {
                    vo.vca = 0.0;
                    continue; // silent voice: skip the audio work (oscillators keep no phase while silent)
                }
                let t2 = vo.o2.tick(p.f2 / fs, p.duty2, p.w2, None);
                let fm = if p.lin_fm { 1.0 + LIN_FM_DEPTH * vo.last_v2 } else { 1.0 };
                let reset = if p.sync { t2.wrapped } else { None }; // hard sync on VCO2's saw reset
                let t1 = vo.o1.tick((p.f1 * fm).max(0.0) / fs, p.duty1, p.w1, reset);
                vo.last_v2 = t2.out;
                let into = p.g2 * t2.out + p.gn * noise + if p.bypass { 0.0 } else { p.g1 * t1.out };
                let fc = (FC_REF * (p.fc_oct + vo.env1).exp2()).clamp(10.0, 0.45 * fs);
                let g = (std::f64::consts::PI * fc / fs).tan();
                let mut y = vo.vcf.tick(into / DRIVE_V, g, p.k) * DRIVE_V;
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
            l[i] = (out_l * self.vol[0] * g) as f32;
            r[i] = (out_r * self.vol[1] * g) as f32;
        }
    }
}
