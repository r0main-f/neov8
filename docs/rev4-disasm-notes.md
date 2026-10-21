# Rev4 stock ROM — disassembly notes

ROM set `V8600040…043` (Rev4 "CSR"), 4 × 2764 at `$8000/$A000/$C000/$E000`.
Image: `tools/rom/build/rev4.bin` (sha1 `91728a6243316a86408d82a8165ab19f8d4182f9`).

Confidence tags: **C** = confirmed by code (routine cited), **S** = schematic, **D** = documentation, **I** = inferred.

## 0. Tooling

| Step | Command | Output |
|---|---|---|
| Extract ROMs | `node tools/rom/extract-roms.mjs` | `tools/rom/build/rev4.bin`, `rev3.bin` (+ per-chip `.bin`) |
| Disassemble | `make -C tools/disasm` | `tools/disasm/rev4.info` (generated), `build/rev4.s` (da65), `build/rev4.lst` (compact listing with caller xrefs) |
| Round-trip check | `make -C tools/disasm verify` | reassembles `build/rev4.s` with ca65/ld65 → **byte-identical** to `rev4.bin` |
| Routine catalogue | `python3 -I tools/disasm/catalog.py tools/rom/build/rev4.bin tools/disasm/build/rev4.json tools/disasm/entries.txt out.tsv` | per-routine callers / callees / I/O regions touched |

- `entries.txt`: code entry points (JMP tables `JT addr n`, `JT4` = JMP+NOP tables, word tables `WTAB`). `trace.py` does recursive descent from these + the vectors. 26,421 of 32,768 bytes are traced code; no overlaps or bad opcodes.
- `ann/*.info`: hand labels/comments by topic (`00-io`, `20-ram`, `30-panel`, `40-engine`). `gen-info.py` merges them with the trace ranges into `rev4.info`. Edit `ann/`, never `rev4.info`.
- Indirect jumps (all resolved): `$8DEC JMP ($A6)` and `$A66E JMP ($CA)` → page `$89` envelope-state tables; `$9B69 JMP ($CA)` → SysEx word table `$9B6F`; `$A837 JMP ($0430)` → `$AB67+3n` edit-page button table; `$F76C JMP ($A2)` / `$F26F JMP ($A4)` → `$F000+4n` button-row table.

## 1. Vectors and reset

| Vector | Target | Notes |
|---|---|---|
| NMI `$FFFA` | `$9800` → `JMP $990B` | ACIA (MIDI) service. **C** |
| RESET `$FFFC` | `$E80E` → `JMP $E9F5` | **C** |
| IRQ `$FFFE` | `$8006` → `JMP $80B2` | PIA2 CA1 / PTM T1 / PTM T2 polling. **C** |

Reset `$E9F5` (**C**): `CLD; LDX #$FF; TXS; SEI` → `STA $3000`, `STA $6307` → `JSR $E027` (=`$E457` `WaitBattRam`: write/read `$AA` at `$4FFF` until it sticks) → clear `$0000–$00FF`, `$0200–$0BFF` and `$6D00–$6DFF` (PTM mirror, harmless) → `STA $6407` → I/O init table `$E989` (36 triples `value, addr-lo, addr-hi`, executed last→first, see `hardware.md`) → PIA outputs `$FF` → charge S&H slots `$4F`, `$47` to 0 V (mDAC = 0), then `$00–$3F` with mDAC = `$FF` with `JSR $EFE3` delays → `$702E=6, $702F=$80` → zero-page defaults → 8279 init `$C1`, delay, `$34`, `$0A`, `$40` → `$0318–$031F = $3D` → `$07F9/$07FA = PIA2_PB & $3F` → battery-RAM magic check `$5A58 == $A5` else copy 18 bytes `$E814 → $5A46–$5A57`; always re-copy bytes `$5A52–$5A57` from `$E81A` → read `$2802` → `$6406 = 0`, `$6307 = $FF` → `JSR $E009, $E003, $C821` → `$0608 = 2` → `JSR $F050, $A03F, $E012` → `CLI` → main loop.

Note: the stack page `$0100` is not cleared; `$0C00–$1FFF` is never referenced by absolute addressing (see ram map for pointer use).

## 2. Main loop `$EB40` (**C**)

```
EB40: JSR $F053  (=$F70A)  8279 FIFO: read one key, translate, dispatch to page handler
      JSR $E826            keyboard-mode dispatch: runs note->voice assigners $F803/$F806/$F809 per side
                           by WHOLE8/SPLIT/LAYER/UNISON flags $56-$5C (split point $1B), then
                           per-side voice update $EB58 (X=0 R, X=1 L)
      JSR $F80F  (=$FCAC)  VPK-5 front buttons ($3A/$3B) -> inject REV $12 / FWD $13; keyboard-absent check
      JSR $E00C  (=$E1AB)  pot scan: one 8-bit SAR conversion per call, at most once per 2 control ticks ($0637)
      JSR $F800  (=$F976)  footswitches PIA2 PB0-5 -> injected button codes (config $5A46)
      JSR $980C  (=$99FA)  MIDI RX parser (drains ring $0B00)
      JMP $EB40
```
No `WAI`/idle; the loop free-runs and everything time-critical is in the IRQ.

### Key dispatch `$F70A` (**C**)
1. If 8279 status bit5 (FIFO overrun/error) → write `$C2` (clear FIFO). If status bits 0–2 = 0 (FIFO empty) → return.
2. Read FIFO → `$94` (bit6 = SHIFT line, used as the A440 modifier — see hardware.md), index = `((code&$38)…)|(code&7)` → translate via table `$A0BD` → internal button code (`$FF` = ignore).
3. `$F782`: `$0606` = code, `$0601` = code & 7, `$A2` = (code & $38) >> 1.
4. Page precedence (first non-zero wins), `key_dispatch $F73E` (**C**; page names from button chords, see hardware.md §3):

| Flag | Handler | Page | Entered by |
|---|---|---|---|
| `$0702 ≠ 0` | `$A800` → `$A812` (map `$AB80` → dispatch `$AB67+3n`) | EDIT pages 1–2 and mod banks A–D (`$060A` = 1–6; side `$0703`, buffer offset `$AE` = `$00` R / `$40` L) | EDIT (`$1D`) → `$A94A` toggles |
| `$4F ≠ 0` | `$8009` → `$825B` | Alternate page | A440+STEP ENABLE (`$22`) |
| `$1A` bit7 | `$B800` → `$BAF3` | User / factory velocity taper (`$060A` = 7–10) | A440+AUDIO MUTE (`$2B`) |
| `$09C6 ≠ 0` | `$9000` → `$9015` | Polysequencer / song | A440+ARP RIGHT (`$32`) |
| `$075A ≠ 0` | `$8003` → `$85C5` | Set page (footswitch programming) | A440+ARP RANDOM (`$39`) |
| `$0750 ≠ 0` | `$B82A` → `$B830` | MIDI pages (`$060A=$0B` pitch-bend sub-page) | A440+ARP DOWN (`$38`) |
| none | `$F75D`: clear `$0458–$045A`, `JMP ($A2)` → `$F000 + 4·(code>>3)` | Normal page | — |

Each page handler owns its own exit key (EDIT, STEP ENABLE, AUDIO MUTE, ARP RIGHT, ARP RANDOM, ARP DOWN), which is the Rev4 inconsistency NeoV8 removes. There is no central state variable: the page is the set of these flags, plus `$060A` as sub-page index.

Normal-page row handlers (`JT4 $F000`): row0 `$F618`, rows1–2 `$F272`, row3 `$F268` (→ second-level `$F020+4·col`: `$F7BC,$F7BC,$F7B6(→$C803),$F7B0(→$C800),$F7A4,$F7A1(→$A800 EDIT),$F793,$F7B9`), row4 `$F1F3`, row5 `$F17B`, row6 `$F11F`, row7 `$F090`. Button names per code: see `hardware.md` §panel.

## 3. Interrupts (**C**)

### IRQ `$80B2`
```
push A,X,Y
if PIA2_CRA bit7 (CA1 flag):   read PIA2_PA (clear); if $09B6: INC $07F3     ; external clock
if PTM status bit0 & $09BA:     read T1 (clear);     INC $07F3                 ; internal arp/seq clock
if PTM status bit1:             read T2 (clear);     INC $07F1                 ; CONTROL TICK
if $07F5 (main-loop lock) or $07F0 (already inside tick service): RTI
$07F0=$FF; CLI                                     ; nested: further IRQs may pre-empt the tick work
loop: while $07F3: SEI; DEC; CLI; JSR $9003 (=$948F clock step)
      while $07F1: SEI; DEC; CLI; JSR $8127 (control tick)
SEI; $07F0=0; pull; RTI
```
- Ticks are counted, never lost: if the main loop holds `$07F5` (e.g. during the pot conversion `$E1BA–$E205`) the work runs on the next IRQ after release.
- PIA1 is **not** polled in the IRQ (its CA1 is polled from inside the tick at `$816C`).

### Control tick `$8127` (T2, see hardware.md for rate)
| Step | Action |
|---|---|
| 1 | `$0637` down-counter (pot-scan pacing) |
| 2 | read `$2807`, `$2801` (VPK-5 handshake), `$81 = 7` = keyboard clock pulses to issue this tick |
| 3 | every 5th tick (`$34`): `JSR $F80C` (=`$FC4F`, VPK-5 header clocks + 2 front buttons), `$81 = 0` |
| 4 | `JSR $B011` (=`$B1D4`: C=1 while key-assign busy `$0612/$0613`); if C=0 `JSR $801B` (S&H refresh slice) — keyboard clocks are interleaved into the refresh loop via `$81` |
| 5 | remaining keyboard clocks (`$8150` loop, `$2800`) |
| 6 | `$0634` ≥ 0 → `JSR $B00B` (=`$B053` VPK-5 61-key read) |
| 7 | read `$2802`; blink/tempo LED: phase `$2A` toggled every `($2C+1)·6` ticks (or PIA1 CA1-driven when `$07E8`), written to 8279 display RAM addr 9 bit 2 (`$81C3`) |
| 8 | `$0979` timeout → `JSR $A05A` |
| 9 | 3-phase round robin `$2B`: **0** `JSR $8A00` (16 envelopes + ADSR→PWM) + clear `$0640–$0647` + `JSR $F827` (=`$F90D` volume gate), then alternately `$F812`/`$F81B` (LFO→PWM VCO1/VCO2); **1** `JSR $F815` (LFO1 L+R), and `$A806` (glide L) if `$0450`≥0; **2** `JSR $A80C` (glide R), `JSR $F818` (LFO2 L+R) |

### NMI `$990B` (MIDI)
- Writes `$09F0` (ACIA control without interrupt enables) → read status → RDRF: `$996F` (byte → RX ring) else TDRE & `$09EA`: `$9948` (TX ring → ACIA) → re-write control with `$09EA|$09EB` (re-arm) → if status bit7 still set, loop. This toggle guarantees a fresh NMI edge.
- RX ring `$0B00–$0B7F` (wr `$09F6`, rd `$09F8`, count `$09F2`); **bytes are dropped when count ≥ $7F**. TX ring `$0B80–$0BFF` (wr `$09F7`, rd `$09F9`, count `$09F3`); `$999F` blocks (spins) while TX ring is full.
- System real-time `$F8–$FE` are ignored; **`$FF` (System Reset) jumps to `$E80E` = full reset** (`$9982`).
- The parser (`$99FA`) runs from the main loop, so RX is only drained once per main-loop pass — a long main-loop pass with dense MIDI overflows the 127-byte ring (I: likely cause of the "dense MIDI hang").

## 4. ROM module map

Every module begins with a `JMP` table (inter-module ABI). `JMP *` self-loops are unused slots.

| Chip | Range | Table | Entries | Content (C/I) |
|---|---|---|---|---|
| 040 | `$8000` | `$8000` | 5 | IRQ `$80B2`, control tick `$8127`, S&H refresh `$801B/$8089`, Alternate page `$825B` (program transfer `$83B0`), Set page `$85C5`, `$8588` (A440+STEP LOAD), `$8799` |
| 040 | `$8900–$89FF` | 8 × 7 | 56 | envelope state dispatch tables (one per segment table, `JMP ($A6)`/`($CA)` with `$A7/$CB=$89`) |
| 040 | `$8A00–$8FFF` | — | — | envelope/LFO engine `$8A00` and state routines `$8DEF–$8FE8` |
| 040 | `$9000` | `$9000` | 7 | polysequencer/song page `$9015`, arp/seq clock step `$948F` (from IRQ) |
| 040 | `$9800` | `$9800` | 11 | MIDI: NMI, TX, parser `$99FA`, SysEx dispatcher `$9B56` (25 cmds), `$9F15`, `$9F7A` |
| 041 | `$A000` | `$A000` | 40 | display refresh `$A2CA`, program/step address calc `$A2A2/$A2BD`, STORE `$A26A`, recall `$A513/$A520`, trims `$A586/$A5D1`, PTM helpers `$A6AF–$A745`, mod-depth writer `$A61B` |
| 041 | `$A800` | `$A800` | 6 | EDIT pages: key handler `$A812`, pot handlers `$AE50/$AE67`, `$AB09` |
| 041 | `$B000` | `$B00B` | 22 | VPK-5 key scan `$B053`, key events `$B116`, note-on/off queues, MIDI note TX `$B3F9`, `$B1D4` |
| 041 | `$B800` | `$B800` | 16 | velocity-taper pages `$BAF3` (battery `$5A20–$5A36`), taper lookup `$BB6E/$BCDC`, MIDI pages `$B830/$B97C`; **new in Rev4** |
| 042 | `$C000` | `$C000` | 3 | autotune `$C124` (PTM, battery `$5980–$59DF`) |
| 042 | `$C800` | `$C800` | 19 | tape load `$CAC0` / dump `$CB09` (end with `JMP $E80E`), display helpers `$CD89–$CE38`, `$CEA3` (MIDI/ACIA init, `$702E/F`) |
| 042 | `$D000–$D9FF` | — | — | lookup tables (see hardware.md / engine tables) |
| 042 | `$DA00` | `$DA00` | 16 | program → hardware apply (`$DAC0` writes `$6xxx` strobes), voice assignment |
| 043 | `$E000` | `$E000` | 18 | pot scan `$E1AB` / boot read `$E692` / mux select `$E685`, Normal-page trims `$E2DC`, autotune restore `$E102`, battery wait `$E457` |
| 043 | `$E80E` | `$E80E` | 2 | RESET → `$E9F5`; `$ED83` |
| 043 | `$F000` | `$F000` (JT4) + `$F050` | 16 + 8 | Normal-page button handlers, key dispatcher `$F70A` |
| 043 | `$F800` | `$F800` | 15 | footswitches `$F976`, voice assigners `$F9E8/$FA15/$FC27`, VPK-5 header/buttons `$FC4F/$FCAC`, per-phase tick work `$FCE2–$FD77` |

Rev3 vs Rev4 (**C**, table scan of both images): same skeleton; Rev4 adds the `$B800` module (16 entries), grows `$A000` 35→40, `$C800` 4→19, `$F800` 13→15, `$9800` 10→11. Only 6728 bytes are identical at the same address. Rev3 had 2976 B of zero fill (longest 704); Rev4 1517 B.

## 5. Free ROM space (Rev4)

Zero-filled, unreferenced runs ≥ 8 bytes (**C**: `trace.py` coverage + fill scan). Total **1517 B**; the per-chip end-of-module gaps are the only usable spaces.

| Range | Bytes | Range | Bytes |
|---|---|---|---|
| `$87A8–$882F` | 136 | `$B763–$B7FF` | 157 |
| `$8915–$89FF` (8 × 11 between tables) | 88 | `$BD94–$BE1F` | 140 |
| `$8FF5–$8FFF` | 11 | `$BF80–$BF8F` | 16 |
| `$97BE–$97FF` | 66 | `$C745–$C7FF` | **187** |
| `$9FF0–$9FFF` | 16 | `$CFB6–$D00C` | 87 |
| `$A7B5–$A7FF` | 75 | `$DF4C–$DFFF` | 180 |
| `$AF5C–$AFFF` | 164 | `$E7D7–$E80D` | 55 |
| `$B001–$B00A` | 10 | `$F7D4–$F7FF` | 44 |

Unreferenced non-zero bytes (dead code or tables reached only through computed indices) are listed in `build/rev4.lst` as `.byte` lines.

For NeoV8 this matters little (full rewrite), but it bounds any "patch the stock ROM" approach to ~1.5 KB scattered.

## 6. Routine list

All labelled ROM addresses (generated from `tools/disasm/ann/*.info`; purposes are **C** unless the label file says otherwise). Jump-table entry points without a label are listed by module in §4; `build/catalog.tsv` (from `catalog.py`) gives callers, callees and I/O regions for all 639 routines.

| Addr | Label | Purpose |
|---|---|---|
| `$800F` | `REFRESH_GRP_END` | group refresh: slot index stop (exclusive) |
| `$8015` | `REFRESH_GRP_START` | group refresh: slot index start (counts down) |
| `$801B` | `CV_REFRESH_STEP` | 1 of 3 calls: next slot group ($B0 5..0); else next voice channel ($805B); interleaves VPK-5 clocks |
| `$805B` | `CV_REFRESH_VOICECH` | channel c=$B2: slots c+$18..c (L voices) if $0980+c bit7, c+$38..c+$20 (R) if $0988+c; wrap -> MIDICV_REFRESH |
| `$8089` | `CV_REFRESH_4SLOTS` | write 4 slots X, X-8, X-16, X-24 from $0500/$0580 |
| `$80B2` | `IRQ_HANDLER` | IRQ: poll PIA2 CA1 (ext clk), PTM T1 (int clk) -> $07F3; PTM T2 (tick) -> $07F1; then CLI and run pending work unless $07F0/$07F5 set |
| `$8127` | `CTRL_TICK` | control tick, once per PTM T2 timeout (4097 cyc = 2.0485 ms); 3-phase round robin on $2B |
| `$842E` | `disp_seq` | sequencer page display |
| `$870F` | `disp_setpage` | Set page (A440+RANDOM) display |
| `$8800` | `ENV_RATE_HI` | 128 x rate MSB for ADSR time params |
| `$8880` | `ENV_RATE_LO` | 128 x rate LSB |
| `$8900` | `ENV_JT` | 8 dispatch tables x 7 JMPs at $8900+$20*k |
| `$8A00` | `ENV_OUTPUT_ALL` | phase 0: 16 ADSRs; ADSR2 v -> slot $68+v (mDAC velocity), ADSR1 v -> $70+v (mDAC Fc depth); ADSR->PWM slots 8v+1/8v+5 |
| `$8DEA` | `ENV_DISPATCH` | JMP ($00A6): A = state ($0360,X) / mode/gate base ($98-$9B, $03E0+v) |
| `$8DEF` | `ENV_ENTER_A` | state entry: level -> table position via ENV_INV |
| `$8E03` | `ENV_ENTER_B` | envelope state entry (variant) |
| `$8E15` | `ENV_DECAY` | segment using rate $0900/$0910, target $0960 (sustain) |
| `$8EAA` | `ENV_RELEASE` | segment using rate $0920/$0930 |
| `$8F2C` | `ENV_HOLD` | idle/sustain: output current level |
| `$8F39` | `ENV_ATTACK` | segment using rate $0940/$0950 |
| `$948C` | `ARP_DIV_TBL` | clock events per arp step: 96/48/24 (minus 1) |
| `$948F` | `ARP_CLOCK_TICK` | per T1/ext-clock event: arp/seq step divider ($0978 from ARP_DIV_TBL), PIA2 CB2 pulse |
| `$9822` | `SxBulkRx` | SysEx bulk receive (cmds 1/2) |
| `$988C` | `SxBulkTx` | SysEx bulk transmit (synthesizes prog bytes $28-$2C, step $18-$1D) |
| `$98FD` | `SxGetNibbles` | SysEx: assemble nibble pairs |
| `$9B56` | `MidiDispatch` | SysEx command dispatcher (25 cmds via word table $9B6F) |
| `$9DDA` | `SxRx22` | SysEx cmd 22: 57 B -> $5A20-$5A58 |
| `$9E0E` | `SxParamChg` | SysEx cmd 10 parameter change (rejects byte# >= $28) |
| `$9F7A` | `SaveMidiCfg` | save MIDI settings $0760-$0776 -> $5A60 |
| `$A080` | `SEGFONT` | 7-seg font 0-F; bit7=a 6=c 5=f 4=b 3=e 2=d 1=g 0=dp |
| `$A090` | `DISP_WINSIDE` | digit pair order: side 1(L) @1-2, side 0(R) @4-5, 2(STEP) @7-8 |
| `$A093` | `DISP_KIND` | display RAM 0..9: $00 = LED byte, $FF = digit |
| `$A09D` | `LEDTAB` | zero-page flag per LED bit (MSB first) for display RAM 0,3,6,9 |
| `$A0BD` | `KEYTAB` | 8279 key translate: index RL*8+SL -> button code ($FF = none) |
| `$A26A` | `StoreProg` | STORE: copy edit buffer -> program $50,X |
| `$A273` | `StoreProgX` | store program X |
| `$A292` | `oct_led_set` | octave LED flag $6E + 2*$15,X + X := A |
| `$A2A2` | `ProgAddr` | A=prog# -> zPtrMem=$4000+40*A |
| `$A2BD` | `StepAddr` | A=step# -> zPtrMem=$5000+24*A |
| `$A2CA` | `disp_normal` | Normal page: rewrite 8279 display RAM 0..9 from $50-$53,$0458.. and LED flags |
| `$A379` | `led_clear_step` | clear step/panel flags $54-$73 except $5D,$5E,$5F,$65 |
| `$A513` | `RecallProgL` | A=prog# -> $0840 |
| `$A520` | `RecallProgR` | A=prog# -> $0800 |
| `$A552` | `TrimPtrR` | trim pointer R |
| `$A56F` | `TrimPtrL` | trim pointer L |
| `$A586` | `ApplyTrims` | apply Normal-page trims to edit buffer |
| `$A5D1` | `CalcTrims` | compute trims |
| `$A61B` | `ENV_RESTART_VOICE` | note-on: immediate ADSR1/ADSR2 output for one voice |
| `$A682` | `PIA_CX2_WRITE` | X=0..3: PIA1 CA2, PIA1 CB2, PIA2 CA2, PIA2 CB2 <- A bit3 (shadow $070C-$070F) |
| `$A6AF` | `CLOCK_SRC_INT` | clock source = internal (PTM T1) |
| `$A712` | `PTM_SET_T1_TEMPO` | T1 latch <- $0977*256 |
| `$A745` | `CLOCK_SRC_STOP` | clock source stop |
| `$A782` | `SysexAddr` | prog/step/scratch ptr for SysEx |
| `$AB09` | `disp_edit` | Edit pages: rewrite display RAM 0..9 from $04F4/$04FA and $04C0 switch states |
| `$AB80` | `EDIT_KEYTAB` | edit pages: button code -> edit function/switch index |
| `$ABBB` | `EDIT_LEDTAB` | edit pages: LED bit -> switch index in $04C0 ($FF = off) |
| `$ABDB` | `EDIT_DISPKIND` |  |
| `$AD30` | `GLIDE_VOICE` | glide one voice |
| `$AE50` | `GLIDE_LEFT` | phase 1: glide left side |
| `$AE67` | `GLIDE_RIGHT` | phase 2: glide right side |
| `$B053` | `vpk_scan` | per tick: 61 keys, X=60..0, D7 of $2805 then clock; velocity via $2806 |
| `$B116` | `vpk_key_event` | key on/off event, note=(X^$3F)+$21 |
| `$B364` | `RUN_DEFERRED_TICKS` | if ticks/clocks pending and not busy: fake an IRQ (push $B37D, PHP, JMP $8006) |
| `$B657` | `TEMPO_TO_T1` | A=BPM -> A=T1 MSB, Y=representable BPM |
| `$B66D` | `TEMPO_T1_TABLE` | 236 entries, index BPM-20; $FF = not representable (step down) |
| `$BD21` | `MidiPresets` | MIDI page presets |
| `$BE20` | `FactTaper1` | factory velocity taper 1 |
| `$BE40` | `FactTaper2` | factory velocity taper 2 |
| `$BE60` | `FactTaper3` | factory velocity taper 3 |
| `$C009` | `POT_MUX_ORDER` | pot mux order for autotune/boot |
| `$C018` | `AT_PTM_SETUP` | T1 gated continuous (G1 = VCO DETECT), T3 one-shot timeout, T2 latch $2000 |
| `$C043` | `AT_SELECT_OSC` | $6302/$6303 VCO2/VCO1 SEL; $307F then $6400-$6402 = voice (VCO tune mux) |
| `$C066` | `AT_INIT_CV` | autotune: init CVs |
| `$C0CC` | `AT_WAIT_PA7_HI` | wait PIA1 PA7 high |
| `$C0D5` | `AT_WAIT_PA7_LO` | wait PIA1 PA7 low |
| `$C0EA` | `AT_CLEAR_DIV` | pulse PIA1 CB2 (clear LS74 divider) |
| `$C0FA` | `AT_PTM_LATCH_FFFF` | PTM latches <- $FFFF |
| `$C116` | `AT_TIMEOUT_CHECK` | T3 flag -> error A |
| `$C124` | `AUTOTUNE` | entry via $C003; SEI for whole run; osc $047A = 15..0 (odd = VCO1) |
| `$C14F` | `AT_FINISH` | save cal, restore PTM, CLI, return |
| `$C27B` | `AT_ERROR` | show error letter (A..d) in digit 4, mark voice in $F3, next osc |
| `$C2C7` | `AT_WAVE_LATCH_OFF` | all waveform latches off ($FF) |
| `$C2D5` | `AT_TUNE_OFFSET` | autotune pass 1: pitch offset |
| `$C348` | `AT_TUNE_SCALE` | autotune pass 2: scale |
| `$C3FA` | `AT_MEASURE_PERIOD` | read gated PTM T1 (EOR $FF), repeat until 2 readings agree |
| `$C4FC` | `AT_WRITE_OSC_CV` | write the 4 slots of the current osc with long settle |
| `$C55E` | `AT_MEASURE_DUTY` | software count of PA7 high vs low time -> PW cal |
| `$C5D1` | `CV_REFRESH_ALL128` | write all 128 slots from $0500/$0580 (autotune / init) |
| `$C606` | `TuneSave` | save autotune results -> $5980-$59BF |
| `$C62D` | `AT_SAVE_PWCAL` | save PW calibration -> $59C0-$59DF |
| `$C64E` | `PTM_RESTORE` | normal PTM setup: T2 latch $1000, T3 latch $111C |
| `$C68E` | `disp_autotune` | autotune progress: $047A in STEP window, AUTO TUNE LED |
| `$C6CF` | `XPT_CLEAR_ALL` | clear all crosspoints + IC23 |
| `$C719` | `IC22_WRITE_BYTE` | STA $307F then 8 bits -> $6400-$6407 (DIGIMOD IC22: pot/VCO mux address) |
| `$C993` | `tape_bit_in` | tape input on PIA2 PB6, period via PTM T2 |
| `$CE4E` | `adc_sar8` | 8-bit SAR ADC: DAC bits on PIA1 PA0-6 + PB7, comparator on PIA1 PB0 -> $0707 |
| `$CEC4` | `LoadMidiCfg` | restore MIDI settings from $5A60 |
| `$CEFA` | `MIDICV_REFRESH` | refresh A7=1 slots $3080-$3087 (MIDI controller CVs) from $0740/$0748 |
| `$CF0B` | `MIDICV_WRITE1` | write one MIDI controller CV slot Y |
| `$CF1A` | `MIDICV_SETSLOT` | DAC <- $0740/$0748,Y, mDAC <- $FF (Y<4) or $0751; STA $3000,Y then $3080,Y |
| `$D000` | `ENV_CURVE` | $D000-$D7FF: 1024-entry 14-bit level->DAC curve, 4 interleaved PA/PB page pairs (frac bits 00,01,10,11 = D0/D1,D2/D3,D4/D5,D6/D7) |
| `$D800` | `ENV_INV` | 256: inverse curve, level*2 -> table position |
| `$D900` | `PARAM_EXP` | 256: convex 0..255 curve, param*2 (glide, LFO, prog volume, blink rate) |
| `$DA30` | `APPLY_VCF_FC_STATIC` | byte $13 Fc -> slots side*8+$40..$43 when bit7=1 |
| `$DA4A` | `APPLY_VCF_Q_VOLS` | bytes $10,$11,$12 -> slots side*8+$44,$45,$46 (VCO1 vol, VCO2 vol, Q) |
| `$DA64` | `APPLY_VCO1_PITCH_STATIC` | VCO1 not kbd-tracked: pitch -> ch7 of side voices |
| `$DAAF` | `APPLY_NOISE` | byte $0C -> slot side*4+$52 |
| `$DAC0` | `MOD_HW_INIT` | clear crosspoints ($65xx), reprogram both sides |
| `$DB22` | `APPLY_XPT` | mod bank controllers/invert -> ANA I CD22100 crosspoints $65xx |
| `$DBE1` | `APPLY_LS670` | mod bank sources -> DIGIMOD 74LS670 $66xx/$67xx (word = A4:A3, data D4-D7) |
| `$DC37` | `APPLY_PROG_VOLUME` | byte $21 via PARAM_EXP -> $0553+side*4 (slot $53/$57) |
| `$DC92` | `APPLY_PWM` | byte $25 depths -> $0990/$0998, byte $20 sources -> $09A8, flags $88-$8F, $0981.. refresh enables |
| `$DD66` | `APPLY_INIT_PW` | bytes $0F/$26 + PW cal $59C0 -> ch6/ch2; ch5/ch1 <- $0404 |
| `$DDF6` | `APPLY_MOD_DEPTHS` | bytes $06-$09 -> slots side*4+$60..$63 |
| `$DE30` | `APPLY_GLIDE` | apply glide |
| `$DE5F` | `APPLY_LFO1_DELAY` | apply LFO1 delay |
| `$DEBA` | `APPLY_PROGRAM_SIDE` | apply program at ($C6) to side $19 |
| `$DEE1` | `WAVE_LEVEL_COMP` | waveform level steps (3 B) |
| `$DEF3` | `APPLY_WAVE_LATCHES` | bytes $14-$1B bit7 -> $61xx (L) / $62xx (R) CD4724 Q0-Q7; waveform level comp -> $057B |
| `$DF37` | `APPLY_LIN_FM` | byte $22 bit7 -> $6300+side (IC3 Q0/Q1 LIN FM) |
| `$E0CB` | `POT_MUXTAB` | pot index 0..15 -> pot mux channel |
| `$E0DB` | `POT_PARMTAB` | pot -> program byte offset (+$40 = L buffer) |
| `$E0E9` | `ENV_RESET_ALL` | reset all envelopes |
| `$E102` | `TuneRestore` | restore autotune tables at boot |
| `$E1AB` | `pot_scan` | main loop: one pot conversion per call (rate-limited by $0637) |
| `$E2DC` | `pot_trim_dispatch` | Normal page: pot index -> program byte / arp speed |
| `$E427` | `VCF_REFRESH_ALL` | slots $40-$57 from $0540 (PB=0) |
| `$E457` | `WaitBattRam` | reset: wait until $4FFF reads back $AA |
| `$E521` | `APPLY_ENV_PARAMS` | ADSR params; $90+side <- vel-VCA flag (byte $1C), $92+side <- byte $14*2 (ADSR1->Fc depth) |
| `$E685` | `pot_mux_select` | strobe slot $7F, then shift A bits into latch $6400-$6407 |
| `$E692` | `pot_init_all` | boot: read all 16 mux channels into $0710..$071F |
| `$E814` | `FswDefaults` | footswitch defaults (18 B) |
| `$E989` | `IO_INIT_TBL` | boot I/O init: (value, lo, hi) triples, executed last to first |
| `$ED97` | `NOTE_ON_CV` | note-on: pitch slots 8v+3/8v+7, Fc slot $40+v, velocity slot $58+v, kbd-tracked PWM depth |
| `$F000` | `BTN_GROUP_JT` | JMP+NOP x16: handler per code group (code>>3); $F020.. = group 3 sub-table |
| `$F068` | `NullProgram` | null (init) program, 40 B |
| `$F090` | `btn_arpmode` | codes 56-58: ARP DOWN, RANDOM, UP (A440: MIDI page / Set page) |
| `$F11F` | `btn_reldef_arp` | codes 48-52: REL DEF R/L, ARP R/L, PAUSE |
| `$F17B` | `btn_pbdef_a440` | codes 40-43: PB DEF R/L ($6400/$6401), A440 tone, AUDIO MUTE |
| `$F1F3` | `btn_call_step` | codes 32-35: CALL R, CALL L, STEP ENABLE, STEP LOAD (A440: init/alt page) |
| `$F268` | `btn_group3` | codes 24-31 -> JMP ($A4) via $F020 table |
| `$F272` | `btn_digits` | codes 8-21: digits 0-9, REV, FWD, $14/$15 glide-defeat toggles |
| `$F387` | `StepStore` | STEP LOAD: pack panel -> step |
| `$F469` | `StepRecall` | step recall -> panel |
| `$F618` | `btn_kbdmode` | codes 0-6: UNISON L/R, SPLIT, LAYER, HOLD L/R, WHOLE |
| `$F6D8` | `split_find_key` | scan $0200..$023B for a held key (split point) |
| `$F6F7` | `key_done` | end of key handler: clear digit-entry, $0602=$FF, refresh display |
| `$F70A` | `kbd_fifo_poll` | main loop: read one 8279 FIFO entry, translate RL*8+SL via KEYTAB, dispatch |
| `$F73E` | `key_dispatch` | A=button code 0..58: page-flag dispatch, else JMP ($A2) into BTN_GROUP_JT |
| `$F782` | `key_split_code` | $0606=code, $0601=code&7, $A2=(code&$38)>>1 |
| `$F793` | `btn_autotune` | code 30: AUTO TUNE; with A440 acts as code $2A (A440 tone) |
| `$F7A4` | `btn_store` | code 28: STORE (JSR $A00F) |
| `$F7BC` | `btn_oct` | codes 24/25: OCT R/L cycle; A440: toggle octave-jump $1E,X |
| `$F90D` | `VOLUME_GATE` | every phase 0: if no ADSR2 active, program volume /4 (slots $53/$57) |
| `$F976` | `FswScan` | footswitch poll PIA2 PB0-5 |
| `$F9D7` | `footsw_press` | footswitch -> injected button code |
| `$FBFE` | `oct_cycle` | $15,X = ($15,X+1) mod 3, update octave LEDs |
| `$FC4F` | `vpk_hdr_bits` | every 5th tick: 7 header clocks, sample VPK-5 REV/FWD buttons ($2805/$2806 D7) |
| `$FC80` | `vpk_btn_debounce` | VPK-5 button debounce/repeat |
| `$FCAC` | `vpk_buttons` | main loop: VPK-5 buttons -> codes $12/$13 (REV/FWD) with repeat |
| `$FCE2` | `LFO_PWM_VCO1` | LFO-sourced PWM, VCO1 (ch5), both sides |
| `$FCE6` | `LFO_PWM_VCO2` | LFO-sourced PWM, VCO2 (ch1) |
| `$FD23` | `LFO_PWM_WRITE4` | write 4 LFO-PWM slots |
| `$FD5B` | `LFO2_TICK` | phase 2: LFO2 L,R |
| `$FD64` | `LFO1_TICK` | phase 1: LFO1 L,R |
| `$FD77` | `LFO_UPDATE` | X = lfo#*2 + side; value -> $0579+side*4+lfo#, slot $79+..; LFO1 offset -> $78/$7C |
| `$FE6D` | `LFO1_SQ_LATCH` | LFO1 square -> $6305+side (IC3 Q5/Q6) |
| `$FF7B` | `LFO1_DELAY_FADE` | delay fade-in -> mDAC $0578 |
| `$FFE1` | `RANDOM8` | 8-bit LFSR in $28 (S&H) |

## 7. CPU timing

See `hardware.md` §2 for the full table. Summary (**C** structure, **E** = scratch-emulator measurement):

| Item | Value |
|---|---|
| CPU clock | 2.000 MHz (S p31) |
| Control tick | PTM T2, 4097 cycles = 2.0485 ms (488.2 Hz) |
| Tick cost | phase 0 (envelopes): 2225 idle → 3064 (16 env) → 3371 avg / 3799 max with ADSR→PWM; phase 1: ≈1728; phase 2: ≈1543 (E) |
| IRQ CPU share | ≈49 % idle, ≈58 % loaded (E) |
| Envelope/LFO/glide update | every 3 ticks = 162.7 Hz |
| S&H refresh | voice channels ≈27.7 ms, groups 36.9 ms; envelopes/LFOs rewritten dynamically (not refreshed statically) |
| Per-slot DAC write | ≈37 cycles in the refresh loop (settle 9–13, sample 20–23) |
| Pot conversion | ≈150 µs (≈300 cycles) software SAR, main loop, once per ≥2 ticks |
| Autotune | blocking, SEI for the whole run (only NMI/MIDI alive) |
| Main loop | ≈300 passes/s idle (E); MIDI RX drained once per pass |

Implications for NeoV8:
- Keep the 488 Hz tick and the 3-phase split if engine parity is wanted; there is <20 % headroom in phase 0 under load, so new per-tick work belongs in phases 1/2 or in the main loop.
- Refresh is cheap (≈500 cycles/tick avg); envelopes are the dominant cost (≈150 cycles per active ADSR).
- The deferred-tick protocol (`$07F5` + `$B364`) is the stock answer to DAC sharing between IRQ and main loop; a NeoV8 HAL should own the DAC exclusively from the IRQ and queue main-loop writes instead.
