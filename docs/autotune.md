# Autotune — hardware path, stock algorithm, NeoV8 implementation, calibration format

Module: `firmware/src/tune.asm` (`tune_restore`, `tune_run`), variables `firmware/src/tune_vars.inc`.
Emulation: `sim/src/machine/vco.ts` (VCO bank + comparator + LS74 + PTM gate), `sim/src/machine/ptm6840.ts`
(gated timers). Tests: `sim/test/fw-tune.test.ts`.

Confidence tags as in `hardware.md`:
- **C**: read in the stock code.
- **S**: schematic.
- **E**: measured in the emulator.
- **I**: inferred.

## 1. Measurement hardware

| Element | Fact | Conf. |
|---|---|---|
| Tune mux | IC3 `$6302` = /VCO2 SEL, `$6303` = /VCO1 SEL (D7, active low). DIGIMOD IC22 Q0–Q2 = voice (written as `$6400+n` right after `STA $307F`; Q0 = voice bit 0). | C `$C043`, S p21/p19 |
| Waveforms | During the period passes, every waveform latch is off (`$FF`) except both sawtooths (`$6102/$6106/$6202/$6206` ← 0). During the PW pass all are off, so the comparator sees the pulse. | C `$C17F`, `$C20D` |
| Comparator | LM339 ("OSC SENSE"). Its raw, undivided output is **PIA1 PA7**. The stock counts PA7 high and low times in software for the PW pass, so PA7 cannot be divided. | C `$C55E`, S p21 |
| LS74 | Toggles on each rising comparator edge. **/PRE = PIA1 CA2, /CLR = PIA1 CB2** (both active low). **/Q drives PTM /G1** ("VCO DETECT"). | S p21 (partly legible) + C (only wiring consistent with `$C0AC`/`$C0B2` and the normal-mode T1 arp clock) |
| PTM T1 | CR1 = `$92`: continuous, initialised by G↓, internal E clock. **Counts only while /G1 is low.** The stock reads T1 after the next PA7 rising edge and requires two consecutive readings to be equal (tolerance 1). That only works if the gate holds the counter. | C `$C018`, `$C3FA`; datasheet behaviour **I** |
| 1-period reading | Sync on a rising edge (R1), pulse CB2 (clear: /Q high, T1 held), R2: /Q falls, T1 ← `$FFFF` and counts. R3: /Q rises, T1 holds. Read T1, `EOR $FF` = **1 period** in E cycles. | C `$C0AC` |
| 4-period reading | Same as above, but after R2 CA2 is held low (preset: /Q stays low) for 3 more periods, then released. The count ends at R6 = **4 periods**. | C `$C0B2` |
| Timeout | T3 one-shot (CR3 = `$22`), latch `$FFFF` written before each reading = 32.8 ms. Its flag is polled in every edge wait → error "A". | C `$C0FA`, `$C116` |
| Normal operation | CA2 low keeps the LS74 preset, so /G1 is low and T1 runs freely (stock arp clock). NeoV8: if T1 is used as a timer, set CA2 low and CB2 high (`$A6DF` does this). | C `$A6DF`, **I** |

The two readings fit together exactly: 4 periods at the offset point (PA `$2E`+ofs) and 1 period at
PA `$16`+ofs are equal when that span is exactly 2 octaves (24 PA units = 24 semitones). This also
confirms **1 PA unit = 1 semitone, 1 DAC LSB = 1/128 semitone**. **E**: the stock converges on the model.

## 2. VCO model (`sim/src/machine/vco.ts`)

`attachVcoBank(machine, {seed, tuneSpread, scaleSpread, pwSpread, jitter})` returns a `VcoBank`.
It installs `machine.vcoDetect` (PA7) and `machine.ptmDriver` (the PTM is clocked with /G1 edges at exact
fractional cycle times, so readings are exact to ±1 cycle).

Oscillator `i` belongs to voice `v = i >> 1`. Odd `i` is VCO1 (slots 8v+4..7), even `i` is VCO2 (slots 8v+0..3).
- `x = pitch slot / 128` (semitones).
- `s = scale_i · (1 + 0.25 · (trim slot − 8192) / 8192)`.
- `period = REF_PERIOD · 2^(−(s·x − tune_i)/12)` E cycles, with `REF_PERIOD = $2343/4`.
- `duty = 0.5 + (PW slot − pw50_i) / (48·128)`, clamped. Duty 0 or 1 means no edges (`$7F` = pulse off).

Slot values are the S&H levels (DAC × multiplier / 255). There is no droop and no settling time.

| Parameter | Default (seeded uniform) | Effect |
|---|---|---|
| `tune_i` | 94 ± 3 | calibrated offset ≈ `$30` ± 3 semitones (the stock error path writes `$30`) |
| `scale_i` | 1 ± 0.04 | trim needed ≈ `$40xx` ± 0.16 of its range |
| `pw50_i` | (`$38` ± 4) × 128 | PW cal ≈ `$F4`…`$FC` (negative, as the stock engine requires) |
| `jitter` | 0 | gaussian relative period jitter |
| `fault` | none | `dead` (no oscillation), `unstable` (3 % jitter), `stuck` (pitch ignores CV), `noscale` (trim ignored) |

Only the oscillator selected by the tune mux is evaluated. Saw or triangle on gives the comparator a 50 % square.

## 3. Stock algorithm (`$C124`, all **C**)

The whole run is SEI. Oscillators are tuned in the order 15 → 0, and the STEP window counts down.

1. **Setup.** PTM as in §1. Multiplier `$FF`. Lin FM `$6300/$6301` ← `$FF`. Slots `$40–$7F` ← 0, `$47/$4F` ← `$FF`. `$6406` ← `$FF`. Crosspoints reset. The display is cleared.
2. **Scale** (`$C348`), up to 32 iterations (`$0474 = $20`):
   - `M1` = 1 period at PA `$16`+ofs.
   - `M4` = 4 periods at PA `$2E`+ofs.
   - `err = M4 − M1`. Converged when `|err| < 2`.
   - Otherwise `trim += err`, doubled when `|err| ≥ 8`.
   - If it does not converge: "d", then go on with the offset.
3. **Offset** (`$C2D5`), up to 32 iterations:
   - `err = M4 − $2343`. Converged when `|err| < 4`.
   - Otherwise `ofs += err/8`, with the fraction accumulated in `$046B`. `ofs_hi &= $7F`.
   - If it does not converge: "b".
   - VCO1 is measured at `ofs + $80` (half a semitone up, `$045F`). The VCO1 detune byte `$40` × 2 adds it back in play.
4. **PW** (`$C55E`), up to 16 iterations:
   - Pitch PA `$16`+ofs.
   - Count PA7 high and low in 16-cycle software loops. `pw += (low − high)·4`.
   - Stops when `|·| < 5`. No error letter.
5. **Readings** (`$C3FA`): repeated until two agree. The tolerance is 1, or 6 while `|err| ≥ $20`. More than 48 → "C". A T3 timeout → "A".
6. **Errors** (`$C27B`):
   - The letter (`A b C d`) goes to display RAM 4.
   - The voice bit is OR-ed into `$F3`. The engine ORs `$F3` with the step's voice-disable mask (`$8784`, `$A3B1`).
   - "A"/"C" during the scale pass → offset pass. During the offset or PW pass → next oscillator.
   - Safe values: trim PA `$3F`, ofs_hi `$30`, PW `$38`.
7. **Save** (`$C606`, `$C62D`):
   - The tables are written at the end, unconditionally. The memory-protect switch is never read.
   - Then PTM restore (`$C64E`), UI/MIDI re-init, CLI.

**Stock bug (E, C `$C4BD`).** The magnitude test treats `err = −256` (`$FF00`) as 0. That is a false
convergence. On the model with ±6 % scale spread it left a scale error of 2 % (74 cents over 3 octaves)
and a PW error of 3.6 % duty, with no error letter, in 4 of 12 seeds. NeoV8 computes `|err|` correctly.

## 4. NeoV8 algorithm (`tune.asm`)

Same hardware sequence, same passes and same battery format. Differences:

| | Stock | NeoV8 |
|---|---|---|
| Order / display | 15 → 0, STEP counts down | voice 1 VCO1, voice 1 VCO2, … voice 8 VCO2. Progress `tU v.o` (v = 1–8, o = 1 VCO1 / 2 VCO2, DP after v). The STEP window keeps the last error as letter + voice (`d4`). |
| Readings | equal (tol. 1/6), 48 tries | the two latest within 2 cycles, averaged. 24 tries → "C" |
| Scale | `|err| < 2`, 32 it. | `|err| ≤ 2`, 32 it. (same gains: `trim += err`, ×2 when `|err| ≥ 8`) |
| Offset | `|err| < 4`, `+err/8` | `|err| ≤ 2` (0.4 cent), `+err/2` (1 offset unit ≈ 2.04 cycles at this pitch: near dead-beat) |
| PW | 16-cycle loops, high and low of different periods, measured in separate code | one shared 18-cycle loop for low and high (so its placement in ROM cannot bias it), `pw += (low − high)·4`, stop at `|low − high| < 2` |
| Blank battery RAM | starts from 0, times out ("A" everywhere) | ofs_hi = 0 → starts at `$30`; trim PA 0 or ≥ `$80` → `$40` |
| Errors | `A b C d`, `$F3` | same letters and rules. `CAL_FAILED` (bit v), `tune_res[16]` (0 or letter) for the UI report, first failure kept for the final message |
| Save | always | always, then read back. A refused write (memory protect) leaves the old tables, and the new calibration stays in RAM until power-off. Display `PrOtEC`. |
| End display | normal page | `tU  oK`, or `Er` + `v.o` + letter of the first failure, or `PrOtEC`. Left in `panel_disp` for the UI. AUTO TUNE LED on during the run. |

ROM: 1228 bytes. Zero page: 21 bytes. BSS: 20 bytes.

Behaviour during the run:
- SEI from start to end. The control tick stops; the MIDI NMI keeps running (it is never masked).
- The DAC is locked (`cv_lock`).

`tune_run` is only called through the core wrapper `autotune` (`main.s`: AUTO TUNE, MIDI tune request, test
port 6). The wrapper then drops the MIDI received during the tune (`midi_flush`) and calls `eng_all_off`.
`tune_run` itself never touches the MIDI rings: it only leaves the NMI unmasked.

### Hand-back (what `tune_run` restores and what it leaves to the engine)
- **Restored by tune_run:**
  - All 128 S&H re-sent from `cv_pa/cv_pb/cv_mul`. The trim slots carry the new calibration.
  - `$6406` ← 0.
  - PIA1 CRA/CRB set back to their values at entry.
  - `ptm_init`: T2 control tick exactly as at boot; T1 and T3 stopped.
  - Interrupt flag (PLP), `cv_unlock`, then **`eng_apply_prog` X=0 and X=1**.
- **Left to `eng_apply_prog`:**
  - Waveform latches IC1/IC2 (`$61xx/$62xx`).
  - Lin FM `$6300/$6301` (`$FF` during the tune).
  - The program-dependent slots (already re-sent from the tables).
- **Left as is:**
  - IC3 `$6302/$6303` (tune select, no audio effect).
  - IC22 (`adc_read` selects the pot mux on every conversion).
  - Crosspoints (not touched).
- **Owners of PTM T1 (arp clock) and T3 (A440 tone) must re-arm them after a tune.**

## 5. Calibration tables (battery `$5980–$59DF`, RAM `CAL` = `$0900`, identical layout)

The oscillator index is `i`: `2v` = VCO2 of voice v, `2v+1` = VCO1.

| Offset | Table | Content |
|---|---|---|
| `+$00` | `CAL_OFS_HI` | pitch offset, integer semitones (0–`$7F`). Typical `$2C`–`$33`. |
| `+$10` | `CAL_OFS_LO` | pitch offset fraction, PB-byte format (1/256 semitone; bit 0 is not seen by the DAC) |
| `+$20` | `CAL_TRIM_PA` | scale trim, PA byte of slot `4i` (= 8v+0 / 8v+4) |
| `+$30` | `CAL_TRIM_PB` | scale trim, PB byte |
| `+$40` | `CAL_PW_HI` | PW slot PA at 50 % duty − `$40`. Stock clamp: values `$10`–`$7F` become `$F8`, negative values are kept. |
| `+$50` | `CAL_PW_LO` | PW slot PB byte at 50 % duty |
| `+$60` | `CAL_FAILED` | RAM only: bit v = voice failed in the last tune (cleared at boot) |

**Boot (`tune_restore`):**
- Copy `$5980–$59DF` → `CAL`, and clear `CAL_FAILED`.
- Set `cv_pa/cv_pb[4i]` ← trim (static, refreshed by the tick).

Swapping stock ↔ NeoV8 ROMs keeps the calibration valid (tested).

## 6. What the engine must compute (stock `$AEB3/$AF38`, `$ED97/$EFB1/$EF94`, `$DD66/$DDD8`, all **C**)

### Pitch slots (8v+3 VCO2, 8v+7 VCO1)

For each oscillator, a 16-bit base is built when the program, octave or detune changes (`$AF38`).
- `F` = VCO frequency byte `& $7F`: `$0D` for VCO1, `$0E` for VCO2.
- `D` = VCO1 detune byte `$22 & $7F` (`$40` = centre).
- `oct` = 0 / 12 / 24 for octave state 0/1/2.

```
lo   = (VCO1 ? 2·D : 0) + CAL_OFS_LO[i]                   -> PB byte (carry goes up)
mid  = F + CAL_OFS_HI[i] + oct + $89 + carries            (8-bit, $32 = $FF + carries = sign/overflow)
     i.e. base16 = (F + ofs_hi + oct − 119)·256 + 2·D·[VCO1] + ofs_lo     (signed)
```

At note-on (`$ED97`):
- **PA = clamp(note + mid (with sign byte), 0, 127)** with the **raw MIDI note** (`$30` at `$EDBA`, used by
  `$EF94`/`$EFB1`). A positive overflow gives `$7F`; a negative result gives 0. (Corrected by the engine port:
  the key index `clamp(note − 33, 3, 63)` of `$ED83` is only used for VCF tracking, the velocity slot, PWM and
  envelope keyboard tracking — not for pitch. The tuner drives the pitch slots directly and is unaffected.)
- **PB = lo** (not clamped).

Glide (`$AD30`) interpolates the same values.

Calibration meaning:
- A pitch word of `($2E·256 + ofs16 + $80·[VCO1])` plays 4 periods = `$2343` E cycles, i.e. 886.2 Hz if E = 2 MHz.
- Each PA unit is one semitone once the trim is right.
- So the engine pitch is **semitone-exact for every oscillator**, and VCO1 = VCO2 at detune `$40`.

### Scale trim slots (8v+0, 8v+4)
Static `CAL_TRIM_PA/PB[i]`, multiplier `$FF`. Never written by the engine.

### Pulse width slots (8v+2 VCO2, 8v+6 VCO1)

`$DD66`/`$DDD8`:
- `pw` = byte `$26` (VCO2) or `$0F` (VCO1), `& $7F`.
- If byte `$12` bit 7 (VCO2) or byte `$11` bit 7 (VCO1) is set, the pulse is off: **PA = `$7F`** (no cal), **PB = CAL_PW_LO[i]**.
- Otherwise:
  ```
  sum = pw + CAL_PW_HI[i]           (8-bit add)
  PA  = carry ? sum : 0             -> with a negative cal: PA = max(0, pw + cal)
  PB  = CAL_PW_LO[i]
  ```
- So `pw = $40` gives a 50 % square.
- **Stock quirk:** a positive cal (`$00`–`$0F`, i.e. the hardware 50 % point at or above PA `$40`) gives no carry, so PA = 0 for every pw.
- **Recommendation for NeoV8:** treat `CAL_PW_HI` as signed: `PA = clamp(pw + (int8)cal, 0, 127)`. This is identical to the stock whenever cal is negative, and correct when it is positive.

The PWM slots (8v+1, 8v+5) are `$04/$04` when no PWM source is set (`$DDE9`). The tune also uses `$0404`.

### Voice availability
A voice is unavailable if `PF_VOICEMASK | CAL_FAILED` has its bit set (stock: `$0759 | $F3`).

## 7. Timings (emulator, 2 MHz, model defaults)

| Case | NeoV8 | Stock |
|---|---|---|
| 16 healthy oscillators (12 seeds) | 11.0–12.3 s | 15.2–16.4 s |
| all dead ("A") | 0.6 s | 1.3 s |
| all unstable ("C") | 5.5 s | 25.4 s |
| all no-scale ("d") | 24.0 s | 23.7 s |
| all stuck ("d" then "b") | 19.5 s | 21.3 s |

Accuracy on the model (12 seeds, wide spreads ±4 semitones / ±6 % scale / ±6 PA):

| | NeoV8 | Stock |
|---|---|---|
| Worst pitch error over 5 octaves | ≤ 1.45 cent | ≤ 1.2 cent, except the `$C4BD` false convergences |
| Worst duty error | ±0.25 % | ±0.12 % |

## 8. Open questions
1. **Absolute pitch.**
   - The reference (4 periods = `$2343` cycles → 886.2 Hz at PA `$2E`+ofs) assumes the LS74 wiring above.
   - With the init program (F = 72, octave normal) the engine formula puts C4 at PA ≈ ofs − 8, i.e. 54 semitones below the reference (≈ 39 Hz).
   - Either F = 72 is a low register, or the comparator path divides once more (2× the frequency everywhere).
   - The relative tuning is unaffected. **Check on hardware** (one measured note is enough).
2. **LS74 pins.** The pin labels around the LS74 on schematic p21 are hard to read. /PRE = CA2, /CLR = CB2 and gate = /Q are the only assignment consistent with the stock code (and with T1 running freely in normal mode), but not read directly.
3. **6840 gate semantics** (counter held while the gate is high, in continuous mode): modelled from the datasheet as I remember it. The stock's "two equal readings" logic needs it. **Check the datasheet.**
4. **S&H droop and VCO settling** are not modelled. NeoV8 rewrites the 4 slots of the oscillator before every reading, like the stock.
5. **Isolation.** The stock also resets the crosspoint matrix, sets slots `$47/$4F` to `$FF` and writes `$6405`/`$6307`. NeoV8 only zeroes slots `$40–$7F` (mod depths, LFOs, envelopes → 0 V) and sets `$6406`. If a real unit shows modulation leaking into the VCOs during the tune, add the crosspoint reset.
6. The stock never skips voices. NeoV8 also tunes voices disabled in `PF_VOICEMASK`, so they are in tune if re-enabled.
