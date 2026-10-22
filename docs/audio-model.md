# Voyetra Eight voice path — model for the NeoV8 sound engine

How each control voltage (CV) the CPU writes becomes sound, card by card, with the constants the sound engine
(`engine/`, plan: "NeoV8 Sound") uses. What is settled, what still needs a measurement, and the recording
protocol for a real unit: `docs/audio-validation.md`. Every constant has a source and a confidence:

- **L** legible on the schematic;
- **P** partly legible;
- **D** from a datasheet or secondary source (verify);
- **C** from the ROM code;
- **I** inferred;
- **F** to be fitted to recordings of a real unit (Stage 3).

S pN = page N of `Voyetra 8 synths/Voyetra 8 Schematics.pdf` (300 dpi scans; read crops with
`pdftoppm -r 300 -f N -l N -x X -y Y -W W -H H -png`). MM = `V8HardwareMaintenanceManual.pdf`.

Voices 0–3 are on side L (VCF card L, latches `$61xx`), voices 4–7 on side R (`$62xx`). This is the code's
convention; S p4 / p34 label the halves the other way round, and the code is authoritative.

## 1. CV conventions (DAC / S&H card, S p21, p40, p2)

| Item | Value | Conf. |
|---|---|---|
| DAC | 14-bit ICL7134, `cv14 = (PA & $7F) << 7 \| PB >> 1` | C |
| mDAC | DAC1022 multiplies by `mult/256` (PIA2 PA); `$FF` = ×1 | C / I |
| Full scale | ≈ 10.7 V (1 Fc step = 1 semitone at 1 V/oct ⇒ 128 steps ≈ 10.67 V; redraw quotes "0 < Vo < +10.1") | I |
| Level | `v = (cv14 / 16384) · (mult / 255) · VFS` | I |
| S&H | 0.01 µF hold + TL064 follower; settles in µs, no droop: a **zero-order hold** of the last write | I |
| Update rates | envelopes/LFOs every 6.15 ms, PWM 81 Hz, note-on immediate, static refresh ≤ 33 ms (NeoV8) / 27.7–36.9 ms (stock) | C |
| Mod-source copies | ADSR1/ADSR2 as **mod sources** come from the level-shifted DAC **before** the mDAC: unscaled | L (S p2, p47) |

## 2. VCO card (S p25/26/38; MM §3) — 2 × CEM3340 per voice, no trimmers

**CV slots** (voice v): `8v+0` VCO2 V/OCT scale trim, `+1` VCO2 PWM, `+2` VCO2 initial PW, `+3` VCO2 pitch;
`8v+4..7` the same for VCO1 (S p25 4051 outputs Y0–Y7, L).

**Pitch.**
- A 100K 1% S.I.L. network sums CV, MOD (from the VCF card's mod demux) and PBEND into pin 15 of the CEM3340 (the
  summing node), with a 110K 1% offset from +10 V VREF (S p25, L).
- Every input has the same weight: mod and pitch bend use the pitch slot's volts-per-octave.
- The scale adjust on pins 1–2 is fed by the V/OCT slot through 220K 1% (L).
- Model: reuse the emulator's law (`sim/src/machine/vco.ts` `periodAt`), which autotune calibrates:

  `period = REF · 2^(−(s·x − tune)/12)`, with `x = pitch14/128` semitones and `s = scale · (1 + 0.25·(trim14 − 8192)/8192)`.

  Mod/bend volts add `12 · V / (VFS·12/128)` semitones (I).

**Waveforms** (CEM3340 at +15 V: ramp 0→10 V, triangle 0→5 V, pulse open-emitter ≈ 0→13.7 V; D, Electric Druid).

| Wave | Path (S p25, L) | Gain into the 47K inverting summer | Peak-to-peak at the card output (I) |
|---|---|---|---|
| Saw | pin 8 → 220 Ω → CD4053 → **56K** (layout S p26; schematic label unclear, P) | 47/56 = 0.84 | ≈ 8.4 V |
| Triangle | pin 10 → 10K/10K divider (÷2) → CD4053 → **22.1K 1 %** (layout, P) | 0.5 · 47/22.1 = 1.06 | ≈ 5.3 V |
| Pulse | pin 4 → 10K (VCO1: 4.75K, hand-modified) → 2N3904 inverter (10K to +15 V) → **150K**, never switched (off = PW 100 %) | 47/150 = 0.31 of 15 V × 150/160 | ≈ 4.4 V (P) |
| Sub-octave | saw → 470 pF differentiator → MC14520 ÷2 (0/15 V square; SUB line holds it in reset) → **220K** | 47/220 = 0.21 | ≈ 3.2 V |

- The summer U8 (TL064, 47K feedback) is followed by a unity inverter (100K/100K) and 220 Ω, giving "VCO1 VOICE n"
  (L). The output is DC-coupled; the polarity is preserved after the two inversions.
- Enables: latch `$61xx`/`$62xx`, active low. Q0 VCO1 sub, Q1 tri, Q2 saw, Q3 sync, Q4 VCO2 sub, Q5 tri, Q6 saw
  (C; the order of the tri/saw glyphs on the schematic is ambiguous).
- **Pulse width.** The IPW slot and the PWM slot each reach pin 5 through **71.5K 1%**, with 0.1 µF at the pin
  and nothing else (L): pin 5 = their **average**, smoothed with τ = 35.75K × 0.1 µF ≈ **3.6 ms**. The CEM3340 PW
  input spans 0→5 V for 0→100 % (D), so 10 V of summed CV covers the whole range and "+6 V = off" (MM §3.7.3)
  needs no extra part.
  - Model: `duty = clamp(0.5 + (ipw14 + pwm14 − pw50 − pwm0)/PW_SPAN)` on the smoothed CV sum, with `pw50` from
    autotune, `pwm0` = the PWM slot value meaning "no modulation" (`$0404`, C) and `PW_SPAN` = 120 PA steps
    (10 V at 10.67 V full scale; shared with the autotune model in both emulators). The program's pulse width
    byte 0..127 then sweeps about 2..98 %, matching the manual's "5 to approximately 95".
- **Sync: hard sync on VCO2's saw.**
  - The CD4053 "SYNC ON/OFF" input is wired to VCO2's **saw** (pin 8 → 220 Ω node, the node that also feeds the
    saw switch and the sub-octave differentiator) (L). The switched edge goes 470 pF + 10K → 2N3906 base, 47K
    bias from pin 9 (0.1 µF to ground); the transistor works on VCO1's timing node. Pin 6 (hard sync) is NC (L).
  - This is the CEM3340 datasheet's Figure 5, "Conventional hard sync" (200 pF there, 470 pF here): only the
    negative edge of the master's saw couples in, and the result is the waveform of conventionally synced saw
    oscillators (D). Pin 9 is only the bias point, bypassed as the datasheet says when soft sync is unused.
  - Model: VCO1's ramp restarts at each reset of VCO2's ramp, at its exact sub-sample time; the step of every
    enabled waveform is band-limited on both sides (the oscillator output is one sample late for that). The
    sub-octave divider toggles at the reset (it is clocked by the saw edge). Manuals: VCO1 should be above VCO2
    "for proper effect" (D).
- **Linear FM.** VCO2's mixed output → CD4053 "LINEAR FM ON/OFF" (`$6300`/`$6301`, one per side) → 0.05 µF →
  **2M2** → CEM3340 pin 13 (L/P). Pin 13 is the reference-current input, fed by 1M 1 % from +15 V (≈ 15 µA) with
  470 Ω + 0.01 µF to ground (L). Frequency is proportional to that current (D), so `Δf/f = v / (2.2M · 15 µA)
  = v / 33 V`: `LIN_FM_DEPTH` = 1/33 per volt, about ±14 % for a full VCO2 saw. MM §3.4 mentions the +10 V
  reference for the CEM3340 currents; if the 1M goes there, the depth is 1.5× (to verify).

## 3. VCF card (S p23/24/39; MM §4) — one per side, SSM2044 per voice

**Input (drive).**
- VCO1 and VCO2 each pass through an SSM2024 **linear** VCA (D: SSM2024 = linear current-controlled
  transconductance; S p23 U22/U23).
- Coupling: VCO1 via 39K / 2.2 µF; control via 22K. VCO2 control via 47K (P).
- Levels: VCO1 `$44`/`$4C`, VCO2 `$45`/`$4D`, **one CV per side** shared by its 4 voices; 7–10 V = on (MM §4.7.4).
- Noise: the mixer card's per-side noise VCA output → 100K into the same current node (L).
- The VCAs' output currents sum into the SSM2044 input.
- Model: `in = g1·VCO1 + g2·VCO2 + gn·noise`, with `gk = max(0, V_level − 0.2 V) / (10 V − 0.2 V)` (SSM2024:
  linear, fully off below ≈ 0.2 V of control, D) and a soft clip at the SSM2044 input (OTA, tanh, `DRIVE_V`).
  The SSM2044 input clips around ±50 mV; a full-level saw gives ≈ 18 mV there, so the clip sits ≈ 2.7× above one
  VCO at full level (I), which `DRIVE_V` = 8 V reproduces.
- The VCO2 level VCA's control resistor reads 47K against 22K for VCO1 (P). If right, VCO2 is about half as
  loud as VCO1 at the same level; not applied until confirmed.

**Cutoff.**
- The summer U6 (LM324) adds through a **100K 1% S.I.L. network**: Fc CV, ADSR1, Fc MOD, Fc PED, Fc INIT (L).
  **They all have the same weight.**
- The ADSR1 input has an extra 22K / 0.1 µF RC, i.e. **τ ≈ 2.2 ms** smoothing (P).
- The summer output feeds a divider (V/OCT trimmer 10K, 1.15K 1% to ground) into SSM2044 pin 13. It is
  calibrated so that **1 V at the summer = 1 octave**, and Fc = 440 Hz at middle A with the test program
  (MM §4.3).
- Cutoff in octaves:
  - from the Fc CV: `Fc7/12`;
  - from ADSR1: `v_env/1 V`;
  - from mod and pedal: `v/1 V`.
- 0.01 µF across U6 adds a ≈ **1 ms** pole on the whole cutoff CV (P).
- Model: `fc = FC_REF · 2^((Fc7 − FC_REF_STEP)/12 + vADSR1 + vMOD + vPED)`, the exponent smoothed with τ 1 ms,
  clamped to 16 Hz–24 kHz (the summers' ±8/−7 V rails bound it well outside the 20 Hz–20 kHz sweep; SSM2044 pin 13
  is ≈ 18–19 mV/oct and collapses above ≈ +175 mV, D).
  - `FC_REF` = 440 Hz (L, MM).
  - `FC_REF_STEP` = the Fc value of the calibration program at middle A: U, so F; start 64.
- The firmware writes `Fc7 = clamp(Fc byte + (note − 42))` at full keyboard tracking, which makes 1 step = 1
  semitone (C).

**Resonance.**
- `$46`/`$4E` per side (byte `$12`) → U7 difference amplifier → **Q CAL** trimmer 20K per voice → SSM2044 pin 2
  (L/P). Q modulation is **subtracted** (MM §4.2).
- Calibration: every voice starts self-oscillating at the same Q setting (MM §4.3).
- SSM2044: oscillation at ≈ 425 µA into pin 2; resonance changes slowly at the low end and fast near oscillation;
  gain below cutoff drops as Q rises (D). A ladder with linear feedback `k` does all three (its DC gain is
  `1/(1+k)`), so the model keeps `Q_CURVE` = 1.
- U7: Q mod enters through 100K, feedback ≈ 150K, initial Q to the + input: Q mod gain ≈ −1.5, initial Q ≈ +2.5
  (P; for the modulation matrix).
- Model: `k = K_MAX · clamp(q7 − qmod, 0, 1)^Q_CURVE`, self-oscillation at `k ≥ 4` (4-pole). `K_MAX`, `Q_CURVE`: F.

**Filter.** 4 poles, pole capacitors 3 × 0.01 µF + 1000 pF (P), current output → 390 Ω / 680 Ω → TL082 U12 with
47K feedback (current-to-voltage) → VCF OUT (L). Model: a 4-stage one-pole cascade (ZDF) with tanh per stage and
global feedback `k`.

**VCO1 bypass.** Latch Q7 (`$6107`/`$6207`), **per side**. The MC14551 sends VCO1's VCA current straight to the
output current-to-voltage converter. A current divider matches the level (MM §4.2). Model:
`out = filter(VCO2 + noise) + BYPASS_GAIN · g1·VCO1`.

`$47`/`$4F`: no audible effect (I; channel 7 is unused, 0 V outside autotune).

## 4. Mixer card (S p27/28/37; `Voyetra 8 synths/Voyetra 8/Mixer-Schematic.png`; MM §2)

- **Voice VCA** (SSM2024, one per voice), **linear**:
  - audio from the VCF out via 1 µF → 100K into the current input with 220 Ω to ground;
  - control: ADSR2 × velocity (`$68–$6F`, mDAC) → hold → TL064 → 1K + **1 µF** + 10K gain trimmer → 22K, i.e.
    **≈ 1 ms** smoothing (L). Model: `gain = max(0, v_ctl − 0.2 V)/(VFS − 0.2 V)` (SSM2024 threshold, D), with a
    one-pole on the control (τ 1 ms).
- **Pair summers.** LF347, 100K ‖ 33 pF, voices (0,1), (2,3), (4,5), (6,7).
- **Panning** (mixer card redraw by J. Touzet, `Voyetra 8/Mixer-Schematic.png`, L; MM §2.2):
  - Pair (0,1) → R106 150K and pair (2,3) → R3 150K into the main VCA IC4A → IC5A → **RIGHT** jack; pair (4,5) →
    R32 150K and pair (6,7) → R35 into IC4D → IC5B → **LEFT** jack (R35 is marked 100K "or 150K?").
  - Four DG308 switches in two complementary pairs, driven by SPLIT/WHOLE 8 (`$6304`): pair (2,3) and pair (4,5)
    each get a 220K path either to their own side (SPLIT/LAYER) or to the other side (WHOLE 8: R107 → RIGHT,
    R33 → LEFT).
  - So SPLIT/LAYER: voices 0–3 → RIGHT, 4–7 → LEFT (side 0, the RIGHT program, on the RIGHT jack). WHOLE 8: pair
    (0,1) hard RIGHT, (6,7) hard LEFT, (2,3) and (4,5) 1 : 0.68 to their own / the other side.
  - The channel gain trimmers are set for equal voice levels (MM §2.5), so the per-pair resistor differences are
    trimmed out; the model uses 0.595 / 0.405 for the near-centre pairs (equal levels in SPLIT/LAYER).
- **Output VCAs.** SSM2024 L/R controlled by program volume `$53`/`$57` × MASTER VOL (a panel pot; a plugin
  parameter here). Two stages: a control SSM2024 passes the MASTER VOL CV with VOL as its control, and drives the
  main VCA's control (L). The VOL CV goes through 470 Ω + 1N4148 into 2.2 µF (C35/C36) and 18K (R21/R22) to the
  control pin: it rises in ≈ 1 ms and falls in ≈ 40 ms (L). The CPU divides the volume by 4 when no voice sounds
  (C). Model: the SSM2024 threshold on VOL, asymmetric smoothing 1 ms up / 40 ms down.
- Main VCAs: 33K ‖ 33 pF current-to-voltage (IC5A/IC5B), 100 Ω, 22 µF, 10K to the jack bay; MONO = IC5D sum of both
  (L).
- **Noise.** MM5837 PRBS. Audio: per-side SSM2024 controlled by `$52`/`$56` → VCF cards (L → voices 0–3).
  Modulation: LM358 low-pass ≈ 130 Hz → "LF NOISE" (I).
- **A440 tone.** PTM T3 O3 (439.95 Hz square, `$F1B2`) → 2N3904 → mix (MM §2.2).

## 5. Modulation (ANA I S p18, ANA II S p16, DIGIMOD S p19, diagrams p42–p50)

- **4 banks × 2 sides.** Each bank is a chain:
  1. source crosspoint (CD22100, `$65xx`);
  2. OTA 1, controller gain (LM13600);
  3. OTA 2, depth (`$60–$63` L, `$64–$67` R; 8-bit: PA = d >> 1, PB b7 = d & 1);
  4. ± outputs;
  5. destination crosspoint;
  6. per-side summers;
  7. CD4052 demux on the VCF card → per-voice VCO1 / VCO2 / Fc / Q mod CVs.
- **Sources.**
  - Mono, per side: DC, LFO1 (`$79`/`$7D` × delay fade, offset `$78`/`$7C`), LFO2 (`$7A`/`$7E`), LFO1 square
    (unipolar 0 → +4.5 V).
  - Poly: VCO1 (level-shifted by `$7B`/`$7F`), VCO2, ADSR1, ADSR2 (unscaled copies).
- **Controllers.**
  - Poly: velocity / kbd CV `$58–$5F`. Replacement: ADSR1 (banks A/B), LF noise (bank C).
  - Mono: Fc pedal, +X, −X, pressure. These are analog and gated per bank by the `ls670` registers; in the plugin
    they are parameters.
  - No controller selected = unity.
- **Gain law.**
  - OTAs are linear: `M_d = Σ_b ±G · S_b · C_b · D_b`.
  - Modulation is inaudible below depth ≈ `$18` (user manual p.64), so the OTA has a threshold:
    `D_eff = max(0, D − D0)` with `D0 ≈ $18/$FF` (F).
- **Scan.** Poly paths are time-multiplexed at ≈ 30–60 kHz per voice (I). Model them at audio rate.
- **Crosspoint addresses.** Learn the row/bit map from both ROMs in tests: drive every program setting and record
  `xpoint`/`ls670`. Don't trust the scans for this.
- `$6307` = 0 while the matrix is reprogrammed: probably inhibits it. Model: hold the previous routing while
  `$6307` = 0 (I).

## 6. Calibration targets (MM)

| Target | Value |
|---|---|
| Middle A | 440 Hz VCO and VCF (test program) |
| VCF tracking | 1 V = 1 octave, one keyboard octave = one Fc octave |
| Q | all voices start self-oscillating at the same Q |
| Mod outputs at rest | 0 V ± 5 mV |
| ADSR buffers at sustain | ≈ 7 V |
| VCO volume CV | 7–10 V when on |

**Fitting list** (Stage 3, from recordings of a real unit):
- waveform levels (verify the Section 2 table);
- `DRIVE_k` and the input clip;
- `FC_REF_STEP`;
- `K_MAX`, `Q_CURVE`;
- `BYPASS_GAIN`;
- `VCA_GAIN`;
- `LIN_FM_DEPTH`;
- `D0` and the mod gain `G`.
