//! Every physical constant of the voice model, with its source and confidence (docs/audio-model.md):
//! L legible on the schematic, P partly legible, D datasheet / secondary source, C ROM code, I inferred,
//! F to be fitted to recordings of a real unit (Stage 3). Units: volts unless stated.

/// DAC full scale: 128 Fc steps = 128 semitones at 1 V/oct  (I, §1)
pub const VFS: f64 = 128.0 / 12.0;

// ---------------------------------------------------------------- VCO card (S p25)
/// CEM3340 at +15 V: ramp 0..10 V, triangle 0..5 V, pulse 0..13.7 V (D); sub-octave CMOS 0..15 V (L)
pub const SAW_VPP: f64 = 10.0;
pub const TRI_VPP: f64 = 5.0;
pub const PULSE_VPP: f64 = 15.0;
pub const SUB_VPP: f64 = 15.0;
/// summer U8 (47K feedback) input weights: saw 51K, triangle 10K/10K then 22K, pulse 150K, sub 220K (L)
pub const SAW_GAIN: f64 = 47.0 / 51.0;
pub const TRI_GAIN: f64 = 0.5 * 47.0 / 22.0;
pub const PULSE_GAIN: f64 = 47.0 / 150.0;
pub const SUB_GAIN: f64 = 47.0 / 220.0;
/// PWM slot level meaning "no modulation" (`$0404` = 514, C apply.asm); autotune's pw50 includes it
pub const PWM_REST: f64 = 514.0;
/// soft sync (CEM3340 pin 9, hard sync pin NC, L): VCO1 resets only past this phase (F)
pub const SOFT_SYNC_WINDOW: f64 = 0.5;
/// linear FM VCO2 mix -> VCO1 (0.05 µF into pin 13, series R unknown): relative deviation per volt (F)
pub const LIN_FM_DEPTH: f64 = 0.05;

// ---------------------------------------------------------------- VCF card (S p23/24)
/// SSM2024 VCO level VCAs: 7-10 V = on (MM §4.7.4); gain = level / this (I)
pub const VCO_LEVEL_FULL: f64 = 10.0;
/// filter input drive: volts at the SSM2044 input stage that reach tanh(1) (F)
pub const DRIVE_V: f64 = 8.0;
/// noise level into the VCF (100K, same as a VCO at full level) (I)
pub const NOISE_VPP: f64 = 8.0;
/// cutoff: Fc = FC_REF Hz when the Fc CV (in semitone steps) = FC_REF_STEP; 1 V = 1 octave for every
/// summer input (100K S.I.L. network, L; MM §4.3)
pub const FC_REF: f64 = 440.0;
pub const FC_REF_STEP: f64 = 64.0; // F
/// ADSR1 input RC 22K / 0.1 µF (P)
pub const ADSR1_TAU: f64 = 2.2e-3;
/// resonance: k = K_MAX * q^Q_CURVE, self-oscillation at k >= 4 (F; all voices oscillate at the same Q, MM)
pub const K_MAX: f64 = 4.4;
pub const Q_CURVE: f64 = 1.0;
/// VCO1 bypass level match (MM §4.2 current divider) (F)
pub const BYPASS_GAIN: f64 = 0.25;

// ---------------------------------------------------------------- Mixer card (S p27)
/// voice VCA control smoothing: 1K + 1 µF (L)
pub const VCA_TAU: f64 = 1.0e-3;
/// WHOLE 8 pair panning: 150K / 220K weights (L/I) -> the near-centre pairs lean ~3.3 dB
pub const PAN_NEAR: f64 = 150.0 / (150.0 + 220.0);
/// overall output scaling to digital full scale (one saw voice, filter open, full volume ≈ -12 dBFS)
pub const OUT_GAIN: f64 = 0.06;
