# Voyetra Eight Rev4: RAM map

Source: stock Rev4 ROM (V8600040–043), disassembled with `tools/disasm`. Labels are in `tools/disasm/ann/20-ram.info`.

Confidence:
- **C** = confirmed by code (the routine address is cited).
- **D** = from a document (SysEx PDF or Rev4 Reference Guide). The page is cited.
- **I** = inferred.

## 0. Corrections to earlier assumptions

| Earlier assumption | What the code shows | Conf. |
|---|---|---|
| Programs are stored as 45 B | **Stored as 40 B (`$00–$27`), stride 40.** `ProgAddr $A2A2` computes $4000 + 40·n. Recall, store, tape and SysEx all copy `$28` bytes. | C |
| Steps are stored as 30 B | **Stored as 24 B (`$00–$17`), stride 24.** `StepAddr $A2BD` computes $5000 + 24·n. | C |
| Program bytes `$28–$2C` carry data | **They are not stored anywhere.** SysEx TX (`$98CE`) synthesizes them: `$28,$29` are sent as `$80` and `$2A–$2C` as `$FF`. SysEx RX (`$9848`) stores only 40 bytes. Parameter change (cmd 10, `$9E2A`) rejects byte numbers ≥ `$28`. NeoV8 **cannot** put per-program data there without a new storage table. | C |
| Step bytes `$18–$1D` | Not stored. TX sends them as `$80`; RX stores 24 bytes. | C |
| Side numbering | **Side index 0 = RIGHT, 1 = LEFT** throughout the code. See the evidence in §5. | C |
| Battery RAM is ~500 B short | About **1.6 KB is free** (see §2). | C |
| Sequencer in battery RAM | **The sequencer is in volatile RAM** (`$0C00–$1FF7`). It is lost at power-off and not cleared by reset. | C |

## 1. Battery-backed CMOS RAM `$4000–$5FFF`

| Range | Size | Content | Read by | Written by | Conf. |
|---|---|---|---|---|---|
| `$4000–$4F9F` | 4000 | **Programs 0–99**, 40 B each, address = `$4000 + 40·n` | `RecallProgR $A520` / `RecallProgL $A513` → edit buffer; SysEx TX `$988C`; tape dump `$CAC0` | `StoreProg $A26A` (STORE); program transfer `$83B0` (Alt page); SysEx RX `$9822` (cmd 1); param change `$9E0E` (cmd 10); tape load | C |
| `$4FA0–$4FFE` | 95 | **free** (no access found) | – | – | C |
| `$4FFF` | 1 | **`$AA` sentinel.** At reset, `WaitBattRam $E457` loops writing `$AA` and reading it back until it reads `$AA`. This waits for the power-up CS-defeat of the CMOS RAM to release. With memory protect on, it still passes because the byte already holds `$AA`. **NeoV8 must keep `$AA` here.** | `$E45C` | `$E459` | C (purpose I) |
| `$5000–$595F` | 2400 | **Steps 0–99**, 24 B each, address = `$5000 + 24·n` (layout in §4) | `StepRecall $F469`; SysEx TX; tape | `StepStore $F387` (STEP LOAD + 2 digits); SysEx RX (cmd 2); tape | C |
| `$5960–$597F` | 32 | **free** | – | – | C |
| `$5980–$598F` | 16 | Autotune table A, one byte per oscillator (0–15). Copied to `$0720,Y` at boot. | `TuneRestore $E102` | `TuneSave $C606` | C |
| `$5990–$599F` | 16 | Autotune table B, copied to `$0730,Y` | `$E118` | `$C61F` | C |
| `$59A0–$59AF` | 16 | Autotune CV low byte for slot 4·i (i = osc 0–15), copied to `$0500+4i` | `$E106` | `$C60D` | C |
| `$59B0–$59BF` | 16 | Autotune CV high byte for slot 4·i, copied to `$0580+4i` | `$E10C` | `$C613` | C |
| `$59C0–$59CF` | 16 | Autotune derived value: slot 4i+2 low − `$40`, clipped 0–`$0F`, else `$F8` | pitch calc `$DDD8`, autotune start `$C216` | `$C62D` | C (meaning I) |
| `$59D0–$59DF` | 16 | Autotune: slot 4i+2 high byte | `$DDE2`, `$C21C` | `$C637` | C (meaning I) |
| `$59E0–$5A1F` | 64 | **free** | – | – | C |
| `$5A20–$5A23` | 4 | Velocity **lower clip**. Index 1–3 = Factory taper 1–3; index 0 unused (the user taper has no clip). | `$BCEA`, `$BC10` | taper pages (pot 9 via `zEditTgt` = `$5A21+k`) | C |
| `$5A24–$5A27` | 4 | Velocity **upper clip**. Index 1–3 = Factory 1–3. | `$BCE4`, `$BC06` | taper pages (pot 7, offset +4) | C |
| `$5A28–$5A36` | 15 | **User velocity taper**, speeds 0–14 (0 = fastest). Key velocity 0–31 is mapped to an index by `$BB6E`: v<6 → v; v<16 → v/2+3; v<28 → v/4+7; else 14. | `$BAD5` | User taper page: pots 0–14 map to offsets `0B 04 0A 03 09 02 07 00 08 01 0C 05 0D 06 0E` (table `$E076`) | C |
| `$5A37–$5A45` | 15 | **Not referenced** by Rev4 code. It sits inside the 57-byte "taper block" that is tape-dumped and received by SysEx cmd 22, so it travels with dumps. Possibly a Rev3 leftover. | – | block copies only | C |
| `$5A46–$5A57` | 18 | **Footswitch config**: 6 records × 3 B `[mode, func1, func2]`. Records 0–3 are switches B-Left, B-Right, A-Left, A-Right (programmable on the SET page). Records 4–5 are the FWD/REV jack. | `FswScan $F976` (`$F9AB/$F9DB`), SET page (`$86B1`: `$5A46 + 3·$0758`) | SET page; **records 4–5 are rewritten with defaults on every boot** (`$EB0D`) | C |
| `$5A58` | 1 | **`$A5` magic** for the footswitch block. If it is not `$A5` at boot, all 18 bytes get defaults from `$E814` (`$EAF6`). | `$EAF6` | `$EB0A` | C |
| `$5A59–$5A5F` | 7 | **free** (outside the tape/SysEx block) | – | – | C |
| `$5A60–$5A76` | 23 | **MIDI settings**: copy of `$0760–$0776` (see §3). Restored at boot by `LoadMidiCfg $CEC4` with masks. Byte `$5A62` (Slave) is never restored. | `$CECF` | `SaveMidiCfg $9F7A` (after every MIDI-page change) | C |
| `$5A77–$5A78` | 2 | **free.** OMNI R/L (`$0777/$0778`) are **not** saved. | – | – | C |
| `$5A79` | 1 | MIDI pitch-bend sensitivity (copy of `$0751`, default `$7F`) | `$CEEE` | `$E2CD`, `$BD8B` | C |
| `$5A7A–$5FFF` | 1414 | **free** | – | – | C |

**Free total:** 95 + 32 + 64 + 7 + 2 + 1414 = **1614 B**, plus 15 B at `$5A37` that is unreferenced but carried by dumps. The largest contiguous free run is `$5A7A–$5FFF` (1414 B).

How this was established (C):
- Every absolute reference into `$4000–$5FFF` in traced code was collected.
- Every indirect pointer whose high byte is `$40–$5F` was found: `$0E/$0F` (`$A2A7`, `$A2C2`), `$72/$73` and `$77/$78` (tape, `$CCE1`), `$75/$76` (`$CCAE`), `$CA/$CB` (`$86BD`) and `$AE/$AF` (`$BB57/$BB5F`). Each one's index range was bounded.
- A heuristic scan found no other `abs/abx/aby` operands into `$5A7A–$5FFF` inside code. All such hits fall in data tables.
- Rev3 (v8nde) uses the same 40/24 strides (`$A125`, `$A140`).

### Footswitch record format (`$5A46 + 3·k`)

| Byte | Meaning | Conf. |
|---|---|---|
| 0 | mode. Bit 7 = 1: the functions also fire on the other edge (momentary). Bit 7 = 0: they fire on one edge only (toggle). | C (edge logic `$F9A2`); edge polarity I |
| 1, 2 | function = **internal button code** 0–63, the same code the 8279 key handler and the SysEx "panel button" command use. The Ref Guide lists them in decimal (00 Unison L … 58 Arp Up). `$80` or more = none; `$1E` (AUTO TUNE) is blocked (`$F9E0`). | C / D (Ref p.17) |

Defaults at `$E814`:

| Rec | Jack | Bytes | Meaning |
|---|---|---|---|
| 0 | B-L | `FF 30 31` | Rel Def R + Rel Def L, momentary |
| 1 | B-R | `00 34 FF` | Arp Pause |
| 2 | A-L | `FF 04 05` | Hold L + R |
| 3 | A-R | `FF 00 01` | Unison L + R |
| 4 | FWD/REV jack | `00 12 FF` | REV, forced every boot |
| 5 | FWD/REV jack | `00 13 FF` | FWD, forced every boot |

The inputs are PIA2 PB0–PB5, read into `$07F9/$07FA` (`$EAEB`, `$F976`).

### Bulk images of battery RAM used by the stock OS
- **Tape dump/load** (`$CAC0` and others): 100 × (program 40 B from `$4000+40n`, step 24 B from `$5000+24n`), plus the block `$5A20–$5A58` (57 B, `$CCAE`). C
- **SysEx cmd 22 (`$16`, undocumented)** `SxRx22 $9DDA`: receives 57 B as 114 nibbles into `$5A20–$5A58`, which includes the footswitch block and the magic. No transmit counterpart was found. Documented cmd 5 (user taper) dispatches to `RTS` (`$9BA1`), so it is **not implemented** in Rev4. C

## 2. Program format (40 stored bytes)

The byte meanings `$00–$27` follow SysEx PDF pp.5–7 (D). Code confirmations:

| Byte | Code evidence | Conf. |
|---|---|---|
| `$0A` glide | On recall, if `(b & $7F) < 8` then glide is forced to 0 with bit 7 kept (`$A53A`) | C |
| `$13, $0A, $0B, $15, $17, $22, $21` | Normal-page trimmer targets (table `$A54B` = `15 17 13 0A 0B 22 21`). A/R trims also apply to `$19/$1B` (ADSR1). | C |
| `$1C` bit 7 | VCA velocity (active low). Toggled by A440+REL DEFEAT (`$F100`) and the Alt page (`$8283`). Also mirrored into step byte 20. | C |
| `$22` | VCO1 detune. "Detune reset" sets it to `$40` with bit 7 kept (`$82D7`). | C |
| `$24` bits 6..3 | LFO keyboard-track bits, read by `$E509` | C |
| `$27` bits 1..0 | Velocity taper select: `(b & 3) ^ 3` gives 0 = user, 1–3 = factory 1–3 (`$BCDC`) | C |
| `$28–$2C` | **not stored**: TX constants `80 80 FF FF FF` | C |

- **Null / init program** (A440+CALL, `$F1F7`): 40 B ROM image at `$F068`:
  `AF AF AF AF FF FF 00 00 00 00 80 90 80 C8 C8 C0 C0 C0 80 FF 80 80 00 80 FF 80 00 80 FF 80 F0 FF 80 FF C0 96 FF 00 C0 F8` (C)
- Edit-page pot → byte maps (`$E0A8` is a pointer table indexed by `vPage $060A`; a value ≥ `$40` means the left buffer, i.e. offset +`$40`): see `$E036…$E085`. Example: Normal page pots 0–14 = `13 53 0A 4A 0B 4B 15 55 17 57 22 62 21 61 C0`. Pot order alternates R, L per knob; `C0` = arp speed. (C)

## 3. MIDI settings block (`$0760–$0778`, saved part `$5A60–$5A76`)

Index = offset from `$0760`. The button is the Normal-page button that sits at that position on the MIDI-page overlay, given as its internal code (table `$B963`). D gives the MIDI-page labels (Ref p.24).

| Off | RAM | Saved at | Function | Restore mask | Conf. |
|---|---|---|---|---|---|
| 0 | `$0760` | `$5A60` | MIDI KBD (WHOLE8 position) | `&$80` | C pos / D label |
| 1 | `$0761` | `$5A61` | MIDI MISC "MX". Gates SysEx TX (`$9F16`). | `&$80` | C |
| 2 | `$0762` | `$5A62` | SLAVE (REL DEF L position). Copied to `$0634` by `$9F7A`. Boot sets `$0762 = $80` (`$CEC4`) and never restores it from `$5A62`. | – | C (label D) |
| 3 | `$0763` | `$5A63` | BEND ENABLE (LAYER position), checked `$9D5E` | `&$80` | C |
| 4 | `$0764` | `$5A64` | MIDI ASSIGN (AUDIO MUTE position), checked `$9BD1` | `&$80` | C |
| 5 | `$0765` | `$5A65` | STEP/PROG: program change calls a step (`$9E78`) | `&$80` | C |
| 6 | `$0766` | `$5A66` | DAMPER ENABLE: CC64 → Rel Defeat (`$9CAE`) | `&$80` | C |
| 7 | `$0767` | `$5A67` | +/−: CC `$60/$61` → FWD/REV (`$9C93`) | `&$80` | C |
| 8–11 | `$0768–$076B` | `$5A68–6B` | Controller enable **R** for ctl pages +X, −X, Pr, Fc (ARP RIGHT position) | `&$80` | C |
| 12–15 | `$076C–$076F` | `$5A6C–6F` | Controller enable **L** for the same pages (ARP LEFT position) | `&$80` | C |
| 16 | `$0770` | `$5A70` | MOD WHEEL (ARP PAUSE position), applied at `$9FB7` | `&$80` | C |
| 17–20 | `$0771–$0774` | `$5A71–74` | MIDI CC numbers mapped to +X, −X, Pressure, Fc-pedal | full | C |
| 21 | `$0775` | `$5A75` | **MIDI channel R** (0–15) | `&$0F` | C |
| 22 | `$0776` | `$5A76` | **MIDI channel L** (0–15) | `&$0F` | C |
| 23 | `$0777` | – | **OMNI R** (UNISON R position), not saved | – | C |
| 24 | `$0778` | – | **OMNI L** (UNISON L position), not saved | – | C |

- `$0751` holds pitch-bend sensitivity and is saved in `$5A79`.
- Presets (25 B each, offset 2 skipped) are at `$BD21`, `$BD3A`, `$BD53`, applied by `$BD6C`.

## 4. Step format (24 stored bytes, 30 transmitted)

Written by `StepStore $F387` and read by `StepRecall $F469`. Bits are listed MSB first. All rows are C.

| Byte | Content |
|---|---|
| 0 | b7 WHOLE8 `$5C` · b6 SPLIT `$58` · b5 UNISON L `$56` · b4 UNISON R `$57` · b3 ARP L on `$61` · b2 ARP R on `$60` · b1–0 ARP R mode `$0603` (0 down, 1 random, 2 up, 3 up/down). LAYER is implied when neither WHOLE nor SPLIT is set (`$F4AB` sets `$59`). |
| 1 | b7 PB DEFEAT R `$63` (→ latch `$6400`) · b6–0 program # R `$50` |
| 2 | b7 PB DEFEAT L `$64` (→ `$6401`) · b6–0 program # L `$51` |
| 3 | b7–6 OCTAVE R `$15` (0–2) · b5 LFO2 L-R sync `$089D` · b4 LFO1 L-R sync `$089C` · b3 ARP retrigger `$08A4` · b2 ARPEG L-R sync `$08A5` · b1–0 ARP L clock source `$089F` (0 arp clk, 1 LFO1, 2 LFO2) |
| 4 | b7–6 OCTAVE L `$16` · b5–0 split point `$1B` (key index; default `$24` = 36, `$F6E2`) |
| 5 | ARP speed `$08FF` (0–127) |
| 6–12 | **Right** trimmer offsets, signed 8-bit (prog + trim, clamped 0..127; `ApplyTrims $A586`), in order: Attack(`$15`,+`$19`), Release(`$17`,+`$1B`), Fc `$13`, Glide `$0A`, LFO1 rate `$0B`, Detune `$22`, Volume `$21`. For A/R, `CalcTrims $A5D1` stores the larger of the ADSR2/ADSR1 deltas. |
| 13–19 | **Left** trimmer offsets, same order |
| 20 | Stored XOR `$30`. b7 ARP auto-octave L `$1F` · b6 auto-octave R `$1E` · b5 VCA velocity L (= NOT bit 7 of `$085C`) · b4 VCA velocity R (`$081C`) · b3 PRESSURE DEFEAT R `$08A9` · b2 PRESSURE DEFEAT L `$08AA` · b1–0 ARP L mode `$08AB`. The step **overrides program byte `$1C` bit 7** on recall. |
| 21 | b7 0 · b6 KBD GATE L `$0799` · b5 KBD GATE R `$0798` (corrected: see $824E) · b4 CV LEFT `$08E5` · b3–2 KBD ASSIGN mode L `$079B` (0–3) · b1–0 KBD ASSIGN mode R `$079A` |
| 22 | Voice-disable mask `$0759` (SET page, bit per voice). Bit order follows button table `$85BD`. |
| 23 | b1 REL DEFEAT L `$5F` · b0 REL DEFEAT R `$5E` |
| 24–29 | not stored (TX sends `$80`) |

Not in the step:
- external arp clock `$07E8`
- hold `$5A/$5B`
- audio mute `$5D`

## 5. Side convention and evidence (C)

- CALL R is internal code `$20`; Ref p.17 gives "32 = Call Right". It sets `vCallTarget = 0` (`$F22A`), recalls into `$0800` via `$A520`, and stores the number in `$50`.
- WHOLE8 forces editing of buffer `$0800` (`$E31A`). Ref p.3: "WHOLE 8 = 8 voices on Program R".
- SysEx program number 126 maps to `$0800` and 127 to `$0840` (`$A782`). This matches the SysEx doc: "126 Right, 127 Left".
- OMNI R is `$0777`, at the UNISON R position. It is paired with channel `$0775` in `$9ECB`, the side-0 test.

## 6. Volatile RAM `$0000–$1FFF` (key variables)

Boot clears `$0000–$0BFF` (and `$6D00–$6DFF`) at `$EA08`. `$0C00–$1FFF` is **not** cleared.

| Addr | Name | Meaning | Conf. |
|---|---|---|---|
| `$0E/$0F` | zPtrMem | pointer to program, step or scratch | C |
| `$15/$16` | | octave R / L | C |
| `$17/$18` | | arp R / L running | C |
| `$19` | zSide | current side, 0 = R | C |
| `$1A` | | velocity-taper pages active (bit 7) | C |
| `$1B` | | split key | C |
| `$1E/$1F` | | arp auto-octave R / L | C |
| `$2A, $2C, $2D, $29` | | LED blink phase, rate, counters (tick `$8164`) | C |
| `$2B` | | 3-phase round robin of the control tick (`$81F3`) | C |
| `$4F` | | Alternate page flag (A440+STEP ENABLE) | C |
| `$50/$51/$52` | | program R, program L, step # (shown in RIGHT / LEFT / STEP windows by `$A2CA`) | C |
| `$53–$55` | | per-window decimal-point / display flags | I |
| `$56–$5C` | | UNISON L, UNISON R, SPLIT, LAYER, HOLD L, HOLD R, WHOLE8 (= `$56` + button code 0–6, `$F618`) | C |
| `$5D` | | AUDIO MUTE | C |
| `$5E/$5F` | | REL DEFEAT R / L | C |
| `$60/$61/$62` | | ARP R on, ARP L on, ARP PAUSE (codes `$32–$34`) | C |
| `$63/$64` | | PB DEFEAT R / L | C |
| `$65` | | A440 tone on (PTM T3, `$F1B2`) | I |
| `$66–$69` | | arp-mode LED flags | C |
| `$94` | zKey | last raw 8279 key byte; bit 6 = 1 means A440 **not** held | C |
| `$A2/$A3` | | key-dispatch vector `$F000 + 4·(code>>3)` | C |
| `$A6/$A7` | | `$89xx` dispatch | C |
| `$AE/$AF` | zEditTgt | pot-edit base | C |
| `$B0–$B2` | | CV refresh round-robin counters (`$801B`) | C |
| `$C6/$C7` | zEditBuf | `$0800` / `$0840` | C |
| `$0100` | | stack | C |
| `$0200–$023F` | | per-key state (bit 7 = down) | C |
| `$0280–$02BF` | | per-key velocity / flags (`$C1` from MIDI) | C |
| `$0458–$045B` | | keypad entry state | C |
| `$0500–$057F` / `$0580–$05FF` | | **CV value per S&H slot** (low → PIA1 PA, high → PIA1 PB), indexed by slot = enable·8 + channel | C |
| `$0601` | | code & 7 | C |
| `$0602` | | previous key code | C |
| `$0603` | | ARP R mode | C |
| `$0604` | | digit-entry count | C |
| `$0605` | | entered number | C |
| `$0606` | | current internal button code | C |
| `$0608` | vCallTarget | CALL target | C |
| `$060A` | vPage | 0 Normal, 1 Edit1, 2 Edit2, 3–6 Mod A–D, 7 User taper, 8–10 Factory taper 1–3, `$0B` MIDI Pb page | C |
| `$0634` | | keyboard on/off: set by SysEx cmd 3 (`$9EA2`) and the Slave copy (`$9F7D`); bit 7 set skips `$B00B` in the control tick | C (meaning I) |
| `$0637` | | pot-scan holdoff counter | C |
| `$0702` | | sequencer page flag | I |
| `$0707/$0708` | | ADC result / work | C |
| `$070C–$070F` | | PIA control-register shadows | C |
| `$0710–$071E` | | last pot readings (15) | C |
| `$0720/$0730` | | autotune per-osc copies | C |
| `$0740–$074F` | | MIDI controller values | C |
| `$0750` | | MIDI pages flag | C |
| `$0751` | | Pb sensitivity | C |
| `$0758` | | SET-page switch # | C |
| `$0759` | | voice-disable mask | C |
| `$075A` | | SET page flag | C |
| `$075B–$075E` | | SET-page function digits | C |
| `$0760–$0778` | | MIDI settings (§3) | C |
| `$0780–$078E` | | pot relative accumulators (signed) | C |
| `$0798/$0799` | | KBD GATE R / L (stock Alternate table $824E: TAPE LOAD -> $0798 = RIGHT; corrected) | C |
| `$079A/$079B` | | assign mode R / L | C |
| `$07E8` | | external arp clock enable | C |
| `$07F0` | | IRQ deferred-work active flag | C |
| `$07F1` | | pending control ticks (PTM T2) | C |
| `$07F3` | | pending clock ticks (T1 or ext CA1) | C |
| `$07F5` | | "busy" inhibit for deferred IRQ work | C |
| `$07F9/$07FA` | | footswitch levels | C |
| `$0800–$0827` | vEditR | **edit buffer RIGHT** (40 B) | C |
| `$0840–$0867` | vEditL | **edit buffer LEFT** | C |
| `$089C, $089D, $089F, $08A4, $08A5, $08A9, $08AA, $08AB, $08E5` | | Alt-page settings (see step bytes 3, 20, 21) | C |
| `$08C0–$08C3` | | program-transfer / MIDI-page sub-index | C |
| `$08E7` | | SysEx dump type | C |
| `$08FF` | | arp speed | C |
| `$0980/$0988,X` | | per-voice "refresh VCO-card CVs" flags | C |
| `$09B6/$09BA` | | clock source: ext CA1 vs PTM T1 | C |
| `$09BB` | | last MIDI status | C |
| `$09BD` | | MIDI receive filter mask | C |
| `$09C6–$09DF` | | sequencer state (`$09D0/$09D1` record pointer, `$09D4/$09D5` limit) | C |
| `$09EA` | | ACIA TX-IRQ enable bits | C |
| `$09EC` | | MIDI parse state | C |
| `$09EE` | | bytes needed | C |
| `$09EF` | | message index (dispatch `$9B6F`) | C |
| `$09F0` | | ACIA control base | C |
| `$09F2` / `$09F3` | | RX / TX count | C |
| `$09F6` / `$09F8` | | RX write / read | C |
| `$09F7` / `$09F9` | | TX write / read | C |
| `$0B00–$0B7F` | | **MIDI RX ring** (128 B). The NMI drops bytes when the count is ≥ 127. RX of `$FF` jumps to RESET (`$9982`). | C |
| `$0B80–$0BFF` | | **MIDI TX ring** (128 B). `$999F` spins while full. | C |
| `$0C00–$1FF7` | | **Sequencer events**, 3 B each. Normal: track 1 from `$0C00`, track 2 from `$1600` (end `$15F8`). Extended: one track to `$1FF8`, about 1700 events (`$B4ED`). | C |

## 7. Implications for NeoV8 (inferred)

- Keep these unchanged so stock ROMs keep working:
  - the 40 B / 24 B strides and the base addresses;
  - `$4FFF = $AA`;
  - `$5A20–$5A58` and `$5A60–$5A79`.
- The extension block fits easily in `$5A7A–$5FFF` (1414 B). This leaves room for:
  - magic and version, globals, omni;
  - a 40 B undo slot and a checksum;
  - a **per-program extension table** (100 × N bytes; N ≤ 13 fits with the rest), because `$28–$2C` are not stored.
- Stock Rev4 never touches `$5A7A–$5FFF` (C). Swapping back to the stock ROM leaves the extension intact.
