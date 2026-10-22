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

| Item | Finding | Source |
|---|---|---|
| Sync | Hard sync on VCO2's **saw** reset (CEM3340 Figure 5 circuit, 470 pF), not soft sync, not the pulse | L + D |
| Saw summing resistor | 56K, not 51K (saw gain 0.84) | P (layout) |
| Envelope rates | The original ADSR rate table is used, so envelope timing matches a stock unit | C |

## 2. Settled, not yet applied (next model changes)

| Item | Finding | Confidence | Model change |
|---|---|---|---|
| Pulse width | Pin 5 = (V_IPW + V_PWM)/2 through two 71.5K, 0.1 µF to ground: τ ≈ 3.6 ms. CEM3340: 0 → 5 V = 0 → 100 %. No third element; "+6 V = off" needs nothing else | L + D | duty from the average of the two CVs, 5 V span, 3.6 ms smoothing |
| Linear FM | Pin 13 = reference current: 1M from +15 V (I_REF ≈ 15 µA); FM through 0.05 µF + 2M2. Δf/f ≈ v / 33 V, about ±14 % for a ±4.6 V VCO2 mix | L/P + D | `LIN_FM_DEPTH` ≈ 0.03 per volt (×1.5 if the 1M goes to +10 V, see §3) |
| Pulse level | Inverter is a 2N3904 with 10K pull-up into 150K: ≈ 4.4 V p-p | P | `PULSE_VPP` / gain |
| Triangle resistor | 22.1K 1 % (layout) instead of 22K | P | negligible |
| SSM2024 VCAs | Linear, full scale ≈ 500 µA, turn fully off below ≈ 0.2 V of control | D | dead zone on VCO-level, voice and output VCAs |
| SSM2044 cutoff | ≈ 18–19 mV/oct at pin 13; the filter collapses above ≈ +175 mV; the LM324 summers run on +8/−7 V, which bounds the range | D + MM | clamp the cutoff CV range |
| SSM2044 resonance | Oscillation at ≈ 425 µA into pin 2; the curve is flat at the low end and steep near oscillation; passband gain drops as Q rises | D | replace `K_MAX`·q^`Q_CURVE` by a current-based law; add passband loss |
| SSM2044 input | Clips around ±50 mV differential at the pins | D | tanh scale for `DRIVE_V` |
| Cutoff CV | 0.01 µF across the summer U6: an extra ≈ 1 ms pole on the whole cutoff CV | P | one-pole on the cutoff CV |
| Q circuit | Q mod gain ≈ −1.5, initial Q gain ≈ +2.5 (100K / 150K around U7) | P | Q mod scaling |
| Filter capacitors | Layout shows 3 × 0.01 µF + **470 pF**, not 1000 pF | P | none (cutoff law is calibrated), check |
| Mixer weights | Main VCA inputs: pair (0,1) 100K, (2,3) 150K, (4,5)/(6,7) 220K | L | check against the panning model (`PAN_NEAR`) |
| Volume path | Two-stage: MASTER VOL × program VOL; volume CV rises in ≈ 1 ms (470 Ω × 2.2 µF), falls in ≈ 22 ms (10K) | L + I | smoothing on the output VCAs |
| Mod depth threshold | OTA bias pin sits ≈ 1.2 V above V−, depth through 22K: zero current below ≈ 1.2 V. Depth `$18` ≈ 0.95 V on a 10.1 V mDAC, which matches the manual's "inaudible below `$18`" | L + I | physical origin for `D0` |
| Output level | "as much as 2 Vpp" at full MASTER VOLUME; line level, 100 Ω, unbalanced | D (UM p124, Rev4 ref) | `OUT_GAIN` target |

## 3. Conflicts and unknowns (need a measurement)

| # | Question | Why it matters | How to settle it |
|---|---|---|---|
| 1 | Absolute pitch: does a tuned unit play A = 440 Hz or ≈ 443 Hz? (the firmware reference is 886.2 Hz at 2 MHz) | Tuning against other instruments | Tuner on A4 after AUTO TUNE |
| 2 | DAC full scale: 10.00 V (ICL7134 with the 10.00 V reference) or 10.67 V (schematic annotation "−10.67 V") | Every CV-to-volts conversion (`VFS`) | Voltmeter on the DAC output with a full-scale word (test program) |
| 3 | Linear FM reference: 1M to +15 V (scan label) or to the +10 V reference (MM §3.4) | FM depth (×1.5) | Read the board, or measure pin 13 voltage |
| 4 | Cutoff calibration point (`FC_REF_STEP`) | Absolute filter brightness of every patch | Self-oscillation frequency at maximum Q for a few Fc values |
| 5 | Resonance law and self-oscillation amplitude | Character of resonant patches | Same recording as #4, plus a slow Q sweep |
| 6 | Waveform levels at the VCO card output (saw, triangle, pulse, sub) | Mix balance | Scope on "VCO1 VOICE n" with one waveform on at a time |
| 7 | Input drive: at which VCO level the filter input starts to distort (UM p44: "a little distortion at maximum volume") | `DRIVE_V` | Recording of a saw at level 7, 15, 31, 63, 127 with the filter open |
| 8 | VCO1 bypass level (1K / 680 divider, partly legible) | `BYPASS_GAIN` | Recording with bypass on and off, same patch |
| 9 | PWM extremes: does high depth thin the pulse out to silence? (UM p44 says yes) | Pulse/PWM patches | Recording of a PWM sweep at depths 4, 8, 15 |
| 10 | Mod gain `G` and threshold `D0` | All modulation depths | Vibrato recordings at depths `$18`, `$30`, `$60`, `$C0` |
| 11 | Which early-board variant: the Rev A VCF photo shows LM13600 where the schematic has SSM2024 | Which VCA law applies to which revision | Photo of the user's VCF card |

## 4. Reference audio and patch data

- **Factory bank.** `Voyetra 8 synths/voyetra-8_v8factorytapeB2.wav` is a Rev4 cassette dump. It decodes to 100
  programs, 100 steps and the global block, every checksum passes, and the decoder round-trips a dump written by
  the stock ROM in the emulator byte for byte. Three other tapes in `Patches Voyetra 8/` are users' banks. The
  decoded data is Octave-Plateau's and is kept out of the repository.
- **No factory program names exist** in any manual or web source; the V8 stores numbers only.
- **Public recordings.** None pairs a known program with its values. The Vintage Synthesizer Solutions demo
  (YouTube `NaDu9ls3Tow`, dry) shows its program numbers on the panel, but that unit does not hold the factory
  bank (its program 22 plays; the factory program 22 has no waveform enabled), so it cannot be used for fitting.
  It remains a general reference for character.
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
