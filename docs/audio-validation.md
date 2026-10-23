# Voice model: assumptions, findings and data still needed

Companion to `docs/audio-model.md`. This page lists what the voice model assumes, what the schematics, datasheets
and manuals settled (October 2026 research), and what still needs data from a real Voyetra Eight. Confidence
tags as in `audio-model.md`: L legible on the schematic, P partly legible, D datasheet or manual, C ROM code,
I inferred, F to be fitted, U unknown.

Sources used:
- Schematics S (`Voyetra 8 Schematics.pdf`); page 26 (VCO component layout) and page 24 (VCF layout) are much
  more legible than the circuit pages.
- Maintenance manual MM, user manual UM (Rev3 teaching manual), Rev4 reference.
- Datasheets: Curtis CEM3340 (1980), SSM2044 (1981), SSM2024 (Analog Devices rev. A), TI LM13700; SSI2144 as a
  proxy for SSM2044 figures the original sheet lacks.

## 1. Settled and applied in the model

| Item | Finding | Source | In the model |
|---|---|---|---|
| Sync | Hard sync on VCO2's **saw** reset (CEM3340 Figure 5 circuit, 470 pF), not soft sync, not the pulse | L + D | VCO1 restarts at each VCO2 reset, band-limited |
| Saw summing resistor | 56K, not 51K (saw gain 0.84) | P (layout) | `SAW_GAIN` |
| Triangle resistor | 22.1K 1 % instead of 22K | P (layout) | `TRI_GAIN` |
| Pulse level | 2N3904 inverter, 10K pull-up into 150K: ≈ 4.4 V p-p | P | `PULSE_VPP` |
| Pulse width | Pin 5 = (V_IPW + V_PWM)/2 through two 71.5K, 0.1 µF to ground (τ ≈ 3.6 ms); 0 → 5 V = 0 → 100 %. No third element | L + D | `PW_SPAN` = 120 PA steps in both emulators (was 48), `PW_TAU` |
| Linear FM | Pin 13 = reference current, 1M from +15 V; FM through 0.05 µF + 2M2: Δf/f ≈ v / 33 V | L/P + D | `LIN_FM_DEPTH` = 1/33 (was a guessed 0.05) |
| SSM2024 VCAs | Linear, fully off below ≈ 0.2 V of control | D | threshold on the VCO-level, noise, voice and output VCAs |
| Cutoff CV | 0.01 µF across the summer U6: ≈ 1 ms pole on the whole cutoff CV; range bounded by the ±8/−7 V summers | P + MM | `FC_TAU`, `FC_MIN`/`FC_MAX` |
| Volume path | MASTER VOL × program VOL through two SSM2024s; VOL rises in ≈ 1 ms (470 Ω), falls in ≈ 40 ms (18K) | L | asymmetric smoothing |
| Output sides | Voices 0–3 (the RIGHT program) reach the RIGHT jack; DG308s cross pairs (2,3)/(4,5) over in WHOLE 8 only; trimmers equalise voice levels (MM §2.5) | L (mixer redraw) | left/right were swapped in the model before; now fixed |
| Resonance | Oscillation at ≈ 425 µA; slow at the low end, fast near oscillation; passband loss with Q | D | already true of the linear-feedback ladder (DC gain 1/(1+k)); no change |
| Filter input clip | ±50 mV at the SSM2044 input ≈ 2.7× one full-level VCO | D + I | consistent with `DRIVE_V` = 8; no change |
| Envelope rates | The original ADSR rate table, so envelope timing matches a stock unit | C | firmware |

## 2. Found, not applied yet

| Item | Finding | Confidence | Why not yet |
|---|---|---|---|
| VCO2 input level | VCO2's level VCA control resistor reads 47K against 22K for VCO1: VCO2 would be ≈ half as loud at the same level | P | Would change every patch's balance; confirm on the board or by recording first |
| Q modulation | Q mod gain ≈ −1.5, initial Q gain ≈ +2.5 (U7, 100K / 150K) | P | Needs the modulation matrix |
| Mod depth threshold | OTA bias ≈ 1.2 V above V−, depth through 22K: zero below ≈ 1.2 V. `$18` ≈ 0.95 V matches the manual's "inaudible below `$18`" | L + I | Needs the modulation matrix |
| Filter capacitors | Layout shows 3 × 0.01 µF + **470 pF**, not 1000 pF | P | No effect: the cutoff law is calibrated, not built from the capacitors |
| Output level | "as much as 2 Vpp" at full MASTER VOLUME; line level, 100 Ω, unbalanced | D | Sets the digital reference level; decide with the plugin's gain staging |

## 3. Conflicts and unknowns (need a measurement)

| # | Question | Why it matters | How to settle it |
|---|---|---|---|
| 1 | Absolute pitch: the firmware reference is 886.2 Hz at 2 MHz (≈ 443 Hz), but the Samples From Mars multisamples of a calibrated unit sit at A440 +1…+2 cents (EnvelopeSaw, SyncLite, 49 notes each). Likely the front-panel MASTER TUNE sets it (a plugin parameter); samples may also have been retuned | Tuning against other instruments | Tuner on A4 after AUTO TUNE, MASTER TUNE centred and at both ends |
| 2 | DAC full scale: 10.00 V (ICL7134 with the 10.00 V reference) or 10.67 V (schematic annotation "−10.67 V") | Every CV-to-volts conversion (`VFS`) | Voltmeter on the DAC output with a full-scale word (test program) |
| 3 | Linear FM reference: 1M to +15 V (scan label) or to the +10 V reference (MM §3.4) | FM depth (×1.5) | Read the board, or measure pin 13 voltage |
| 4 | Cutoff calibration point (`FC_REF_STEP`) | Absolute filter brightness of every patch | Self-oscillation frequency at maximum Q for a few Fc values |
| 5 | Resonance law and self-oscillation amplitude | Character of resonant patches | Same recording as #4, plus a slow Q sweep |
| 6 | Waveform levels at the VCO card output (saw, triangle, pulse, sub) | Mix balance | Scope on "VCO1 VOICE n" with one waveform on at a time |
| 7 | Input drive: at which VCO level the filter input starts to distort (UM p44: "a little distortion at maximum volume") | `DRIVE_V` | Recording of a saw at level 7, 15, 31, 63, 127 with the filter open |
| 8 | VCO1 bypass level (1K / 680 divider, partly legible) | `BYPASS_GAIN` | Recording with bypass on and off, same patch |
| 9 | PWM extremes: does high depth thin the pulse out to silence? (UM p44 says yes) | Pulse/PWM patches | Recording of a PWM sweep at depths 4, 8, 15 |
| 10 | Mod gain `G` and threshold `D0` | All modulation depths | Vibrato recordings at depths `$18`, `$30`, `$60`, `$C0` |
| 12 | Does the SSM2024 threshold cut release tails? The model turns a voice off ≈ 30 dB below sustain (0.2 V); Tony Clark's samples (retrosynth.com) fade smoothly over 40+ dB, but may carry reverb | Release tails, quiet passages | Single notes with a long release, dry, scope on the voice VCA control |
| 11 | Which early-board variant: the Rev A VCF photo shows LM13600 where the schematic has SSM2024 | Which VCA law applies to which revision | Photo of the user's VCF card |
| 13 | Pitch-bend ranges. Joystick: the schematic chain gives ≈ ±10 semitones at full travel with the service trims centred (docs/audio-model.md §2), the RANGE trimmers scaling 0.5–1, so 5–10 semitones in the model; the joystick pot's travel is undocumented. MIDI bend: its analog path is in no schematic; modelled like the joystick at PBEND, ±10.7 semitones at multiplier $FF (±2 at $30, the app's default; ±5.3 at the stock $7F). Rev4 guide: set the sensitivity "until VOYETRA P Bend tracks master P Bend" | Every bend | A held note with the joystick at full travel, each RANGE trimmer at minimum and maximum; MIDI bend at full up / down at sensitivity $30, $7F and $FF |
| 14 | Do the MIDI-controller CVs (`$3080+i`) add to the VPK-5's own controllers, and do PITCH BEND DEFEAT L/R gate MIDI bend as well as the joystick? The model adds them and gates both | MIDI mod wheel, pressure, bend | Mod wheel and joystick together on a +X bank; MIDI bend with PITCH BEND DEFEAT on |

## 4. Reference audio and patch data

- **Factory bank.** `Voyetra 8 synths/voyetra-8_v8factorytapeB2.wav` is a Rev4 cassette dump. It decodes to 100
  programs, 100 steps and the global block, every checksum passes, and the decoder round-trips a dump written by
  the stock ROM in the emulator byte for byte. Three other tapes in `Patches Voyetra 8/` are users' banks. The
  decoded data is Octave-Plateau's and is kept out of the repository.
- **No factory program names exist** in any manual or web source; the V8 stores numbers only.
- **Public recordings.** None pairs a known program with its values. The Vintage Synthesizer Solutions demo
  (YouTube `NaDu9ls3Tow`, dry) shows its program numbers on the panel, but that unit does not hold the factory
  bank (its program 22 plays; the factory program 22 has no waveform enabled), and none of the four decoded banks
  fits its sections (its "resonant" programs 4/7 and 0/0 have Q 0–9 in all of them). The narration confirms the
  numbers and modes read from the panel (L09/R34 = step 54, etc.) and says the patches were tuned and their
  filters adjusted. So it cannot be used for fitting; its dry filter sweeps with resonance (7:10, 9:00) remain a
  reference for the swept SSM2044's character.
- The Doctor Mix demo (YouTube `QrGLSp1WzzY`, UVI's unit) steps through stored steps 10, 14, 18, 19 and 26
  (programs L33/R09, R59, L72/R00, L22/R38, R11 on the display); none matches the steps of the four decoded tapes,
  so that unit holds another bank. The presenter notes audible steps in a cutoff sweep, as the 7-bit Fc gives.
- retrosynth.com/gear/v8: board photos (VCF "REV 2", oscillator "REV D"; too small for values) and four Tony Clark
  samples (string, percussive string, percussive noise, split bass/bell), no settings.
- Board photos: `Voyetra 8/v8_vcf_reva.jpg` is a **Rev A** VCF card with four LM13600 OTAs as the VCO level
  VCAs (week 8151) instead of the SSM2024s of the schematic, 100K trimmers; retrosynth's "REV 2 vcf" has the 20K
  Q CAL trimmers of the schematic. `v8_vco_revc.jpg` (Rev C VCO card): CEM3340 (week 8227), MC14520B, TL074/TL064,
  CD4053. Resistor colours are not readable on any photo (light washes brown/red/orange together).
- **Samples From Mars, free pack** (`Recordings/SamplesFromMars/wav`, 874 files): ten multisampled patches
  (EnvelopeSaw, SyncLite/SyncMod, PWMEnvelopeLFO, LayeredHorns, ...), every semitone, 24-bit, no settings and no
  single-oscillator waveforms (those are in the paid pack). Used for absolute pitch (§3 #1).
- User manual pp. 74–75 (also as `V8 Audio Chain Schematic.pdf`, `V8 Mod Bankl Schematics.pdf`): voice and mod-bank
  block diagrams. VCO sources to the mod banks and linear FM are taken before the level VCAs; a bank's selected
  controllers are summed before its gain VCA.
- The mixer card redraw (`Voyetra 8/Mixer-Schematic.png`, J. Touzet 2006) is fully legible and settled the output
  routing, panning and volume smoothing (§1).
- **No published measurements** of a real unit (levels, sweeps, envelope times) were found.

## 5. Recording protocol for a real unit (when available)

Stock ROM, after a 10-minute warm-up and two AUTO TUNEs, line out direct, 48 kHz / 24-bit, no processing. Patches
are made from the init program (A440 + CALL) and saved as `.syx` so they can be rendered identically:

1. A4, then C2–C6, each waveform alone (saw, triangle, pulse 50 %, sub), filter open: items 1, 6.
2. Filter: Q maximum, VCO levels 0, Fc 20 → 120 in steps of 10, one note: items 4, 5.
3. Slow Q sweep at Fc 64 with a saw: item 5.
4. VCO1 level ladder 7 → 127, filter open: item 7.
5. Bypass on/off, same patch: item 8.
6. PWM depth ladder, LFO1 triangle at a slow rate: item 9.
7. LFO1 → VCO1 at depths `$18`, `$30`, `$60`, `$C0`: item 10.
8. Linear FM on/off with VCO2 at a fifth below VCO1: item 3.
9. Full-scale DAC voltage and pin-13 voltage with a meter, if the case is open: items 2, 3.
