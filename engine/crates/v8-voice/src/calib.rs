//! Every physical constant of the voice model, with its source and confidence (docs/audio-model.md):
//! L legible on the schematic, P partly legible, D datasheet / secondary source, C ROM code, I inferred,
//! F to be fitted to recordings of a real unit (Stage 3). Units: volts unless stated.

/// DAC full scale: 128 Fc steps = 128 semitones at 1 V/oct  (I, §1)
pub const VFS: f64 = 128.0 / 12.0;

// ---------------------------------------------------------------- VCO card (S p25)
/// CEM3340 at +15 V: ramp 0..10 V, triangle 0..5 V (D); sub-octave CMOS 0..15 V (L). The pulse is re-made by a
/// 2N3904 with a 10K pull-up to +15 V driving the 150K summing input: 15 V × 150K / 160K (P)
pub const SAW_VPP: f64 = 10.0;
pub const TRI_VPP: f64 = 5.0;
pub const PULSE_VPP: f64 = 15.0 * 150.0 / 160.0;
pub const SUB_VPP: f64 = 15.0;
/// summer U8 (47K feedback) input weights: saw 56K, triangle 10K/10K then 22.1K 1 % (component layout S p26; the
/// schematic labels are unclear, P), pulse 150K, sub 220K (L)
pub const SAW_GAIN: f64 = 47.0 / 56.0;
pub const TRI_GAIN: f64 = 0.5 * 47.0 / 22.1;
pub const PULSE_GAIN: f64 = 47.0 / 150.0;
pub const SUB_GAIN: f64 = 47.0 / 220.0;
/// PWM slot level meaning "no modulation" (`$0404` = 514, C apply.asm); autotune's pw50 includes it
pub const PWM_REST: f64 = 514.0;
/// pin 5 smoothing: the two 71.5K in parallel (35.75K) into 0.1 µF (L)
pub const PW_TAU: f64 = 35.75e3 * 0.1e-6;
/// linear FM VCO2 mix -> VCO1: pin 13 takes the reference current, 1M from +15 V (≈ 15 µA); the FM comes in
/// through 0.05 µF + 2M2, so Δf/f = v / (2.2M × 15 µA) = v / 33 V (L/P + D). If the 1M goes to the +10 V reference
/// instead (MM §3.4), this is 1.5× larger (docs/audio-validation.md §3).
pub const LIN_FM_DEPTH: f64 = 1.0 / 33.0;

// ---------------------------------------------------------------- VCF card (S p23/24)
/// SSM2024 VCO level VCAs: 7-10 V = on (MM §4.7.4); gain = (level − VCA_TH) / (this − VCA_TH) (I)
pub const VCO_LEVEL_FULL: f64 = 10.0;
/// SSM2024 control threshold: the VCA is fully off below ≈ 0.2 V (datasheet: 160-220 mV) (D). Applies to the VCO
/// level, noise, voice and output VCAs.
pub const VCA_TH: f64 = 0.2;
/// filter input drive: card volts at which the SSM2044 input reaches tanh(1) (F). Cross-check (I): a full-level
/// saw (±4.6 V) gives ≈ 18 mV at the SSM2044 input (39K/220 Ω, SSM2024 gm 8.17·I, 22K control); the input pair
/// clips around ±50 mV ≈ 12 card volts. 8 V puts that clip point at tanh(1.5), consistent.
pub const DRIVE_V: f64 = 8.0;
/// noise level into the VCF (100K, same as a VCO at full level) (I)
pub const NOISE_VPP: f64 = 8.0;
/// cutoff: Fc = FC_REF Hz when the Fc CV (in semitone steps) = FC_REF_STEP; 1 V = 1 octave for every
/// summer input (100K S.I.L. network, L; MM §4.3)
pub const FC_REF: f64 = 440.0;
pub const FC_REF_STEP: f64 = 64.0; // F
/// ADSR1 input RC 22K / 0.1 µF (P)
pub const ADSR1_TAU: f64 = 2.2e-3;
/// 0.01 µF across the cutoff summer U6 (100K feedback): ≈ 1 ms on the whole cutoff CV (P)
pub const FC_TAU: f64 = 1.0e-3;
/// cutoff range: the LM324 summers run on +8/−7 V, which bounds the CV well outside the 20 Hz-20 kHz sweep (MM
/// §4.2, §4.5); the clamp only keeps the model stable at the extremes
pub const FC_MIN: f64 = 16.0;
pub const FC_MAX: f64 = 24_000.0;
/// resonance: k = K_MAX * q^Q_CURVE, self-oscillation at k >= 4 (F; all voices oscillate at the same Q, MM)
pub const K_MAX: f64 = 4.4;
pub const Q_CURVE: f64 = 1.0;
/// VCO1 bypass level match (MM §4.2 current divider) (F)
pub const BYPASS_GAIN: f64 = 0.25;

// ---------------------------------------------------------------- Mixer card (S p27)
/// voice VCA control smoothing: 1K + 1 µF (L)
pub const VCA_TAU: f64 = 1.0e-3;
/// output VCA control: the volume CV charges C35/C36 2.2 µF through 470 Ω + 1N4148 (≈ 1 ms) and discharges through
/// R21/R22 18K into the control pin (≈ 40 ms) (mixer card redraw by J. Touzet, L)
pub const VOL_RISE_TAU: f64 = 470.0 * 2.2e-6;
pub const VOL_FALL_TAU: f64 = 18.0e3 * 2.2e-6;
/// WHOLE 8 pair panning: pairs (2,3)/(4,5) reach their own output through 150K and, in WHOLE 8, the other one
/// through 220K (DG308s; in SPLIT/LAYER the 220K joins their own side). With the channel gain trimmers set for
/// equal voice levels (MM §2.5) that is 0.595 / 0.405: the near-centre pairs lean ~3.3 dB (L + I)
pub const PAN_NEAR: f64 = 150.0 / (150.0 + 220.0);
/// overall output scaling to digital full scale (one saw voice, filter open, full volume ≈ -12 dBFS)
pub const OUT_GAIN: f64 = 0.06;

// ---------------------------------------------------------------- Modulation banks (ANA I/II, audio-model.md §5)
/// DC source: +13.5 V against the mod system's +8 V pseudo-ground (ANA I, partly legible) (P)
pub const MOD_DC_V: f64 = 5.5;
/// VCO taps into the poly source mux: VCO1 through 27K/100K (−0.27, with `$7B`/`$7F` centring it), VCO2 −0.91
/// (20K/22K) (ANA I, partly legible); the sign does not matter for an audio-rate source (P)
pub const VCO1_SRC_GAIN: f64 = 0.27;
pub const VCO2_SRC_GAIN: f64 = 0.91;
/// destination summers (−2 per bank) feed the VCF card's mod busses, divided by 2 for Fc and Q and by 3 for
/// VCO1/VCO2 (1K/1K, 2K/1K 1 %): at equal weight, VCO modulation is 2/3 of Fc modulation (L/P)
pub const VCO_MOD_K: f64 = 2.0 / 3.0;
/// LFO2: the ROM adds a per-waveform offset so that every waveform centres near this slot level (measured on both
/// ROMs: triangle/saw 5888, sine 5700); ANA I subtracts it. LFO1's centre is its own offset slot ($78/$7C) (C + I)
pub const LFO2_REF: f64 = 5888.0;
/// LFO1 square: unipolar, high while the LFO1 phase rises (latch $6305/$6306) (I)
pub const LFO1_SQ_V: f64 = 4.5;
/// depth OTA bias: about 2 Vbe above V−, depth through 22K, so depth CVs below ≈ 1.2 V give nothing: depth $18
/// (1.0 V) is just under it, as the manual says ("not strong enough to matter until it reaches 18") (L + I)
pub const MOD_TH: f64 = 1.2;
/// bank output volts per source volt at full controller and full depth (1 V = 1 octave at VCO and Fc). With it, the
/// manual's vibrato settings ($25-$30, LFO1 ≈ ±2.5 V, a half-way controller) give ≈ ±0.5-1 semitone (F)
pub const MOD_GAIN: f64 = 1.0;
/// Q modulation: U7 takes Q mod through 100K against ≈ 150K feedback and the initial Q at gain ≈ 2.5, and more
/// negative mod gives more resonance (UM p.69): q_eff = q − Q_MOD_K · mod / VFS (P)
pub const Q_MOD_K: f64 = 0.6;
/// LF noise (bank C replacement controller): the noise low-passed at ≈ 130 Hz (I)
pub const LF_NOISE_HZ: f64 = 130.0;
/// MIDI-controller CV bank (slots 128..135, `$3080+i`): the ROM writes a 7-bit controller as DAC word value << 6, so
/// 127 gives 8128 and full scale is 8192 (C, measured on the NeoV8 ROM)
pub const MIDI_CV_FULL: f64 = 8192.0;
/// MIDI pitch-bend CVs (indices 4 LEFT, 6 RIGHT): 14-bit bend >> 2, centred at 4096, through the DAC1022 multiplier
/// = pitch-bend sensitivity (`$5A79`, stock default $7F). Bend at full deflection and multiplier $FF, in
/// semitones: not documented; chosen so that the stock default gives about ±2 semitones (I, check on a unit)
pub const MIDI_BEND_CENTRE: f64 = 4096.0;
pub const MIDI_BEND_ST: f64 = 4.0;
/// VPK-5 joystick pitch bend: the PITCH BEND RANGE UP / DOWN trimmers set each direction (UM p.61-62); their span
/// is not documented: 0..12 semitones here (I)
pub const JOY_BEND_MAX_ST: f64 = 12.0;
