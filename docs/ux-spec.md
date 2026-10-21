# NeoV8 user-interface specification — v0 (prototype)

Status: **draft for review**. Implemented by the simulator's Prototype back end (`sim/src/proto/`).
The executable form of this document is `spec/scenarios/*.yaml`: every rule below that has a scenario
is tested (`npm test`). The firmware must pass the same scenarios.

Hardware is unchanged: 42 buttons, 15 digitized pots (14 trimmers + ARP SPEED), three 2-digit
7-segment windows (LEFT · RIGHT · STEP) with decimal points, 6 octave LEDs, MEMORY PROTECT switch.
**Only 24 buttons have an LED**: AUDIO MUTE, the 3 keyboard modes, UNISON L/R, EDIT, STORE, TAPE LOAD/DUMP,
the 6 arpeggiator buttons, AUTO TUNE, A440, and the 6 RELEASE DEFEAT / PITCH BEND DEFEAT / HOLD buttons.
CALL, OCTAVE, STEP and the keypad have none: state on them is shown with the decimal points, as on Rev4
(manual p.10, LED table `$A09D` in `hardware.md` §5.4). The memory-protect switch cannot be read by software:
a refused write is detected by reading the byte back.

## 1. Principles

1. **Three layers, one grammar.** PLAY (Normal page, panel legends are true) · EDIT (6 sound pages,
   same control layout as the Rev4 overlays) · SYSTEM (one numbered menu replacing the Alternate, Set,
   Velocity and MIDI pages).
2. **A440 is SHIFT.** Alone it does nothing (as on Rev4). Every second function is A440 + a button and
   is printed in orange above that button on the NeoV8 overlay.
3. **EDIT backs out.** From any page, menu, entry or store in progress, EDIT goes one level up.
   No page-specific exit buttons any more (Rev4 used EDIT, ARP RIGHT, ARP RANDOM, AUDIO MUTE, DOWN).
4. **FWD/REV = previous/next** of whatever has focus (program, step, page, menu item).
5. **The display always says what you touched** (2-letter mnemonic + value), then returns to the home view.
6. **Nothing destructive in one keypress.** Store, dump, undo and reset need a confirming STORE.
   Memory protect is always obeyed.

## 2. Display grammar

| Situation | LEFT | RIGHT | STEP |
|---|---|---|---|
| PLAY home | L program `42` | R program `07` | step `03` — DP on the tens digit of the focused window (CALL/STEP target) |
| number entry | `4-` / `--` blinking in the focused window | | |
| EDIT home (pages 1, 2) | side+page `L1` `r2` | program number | PWM1/PWM2 source (P1) or LFO1/LFO2 wave (P2), one digit each, DP = the one the keypad edits (as Rev4) |
| EDIT home (mod A–D) | `LA` `rb` `Lc` `rd` | source mnemonic `L1` `E2`…, DP = inverted (Rev4: `-3`) | mod depth hex `00`–`FF` (as Rev4) |
| control touched (1.5 s) | mnemonic `Fc` | value, 4 chars: `Fc 127`, `SY  On`, `2S  E1` | |
| pickup not caught | `Fc` | `‾ 60` = turn up · `_ 60` = turn down | |
| STORE armed | `St` | destination, blinking | `␣L` / `␣r` program side · `SP` step |
| SYSTEM menu | item `30` | mnemonic `Pn` | value `PU` |
| messages | `StOrEd` `PrOtEC` `CAnCEL` `UndOnE` `InIt L` `SEnd ?` `SEnt` `tU 1.2` `tU oK` | | |

**Edited flag:** a blinking decimal point — after the program number on the Normal page, after the
page id (`L1.`) in EDIT — while the edit buffer differs from the stored program. Rev4 had no indication at all. **Compare:** the program window shows `CP` blinking, EDIT/STORE LEDs blink.

## 3. PLAY (Normal page)

| Action | Result |
|---|---|
| CALL L / CALL R | focus that side (LED on), window shows `--` blinking, waiting for 2 digits |
| digits | 2 digits recall a program on the focused side (no need to press CALL again) |
| FWD / REV | recall the next/previous program (or step) of the focus at once |
| CALL STEP (ENABLE) + 2 digits | recall a performance step (programs L/R, keyboard mode, split, arp, trims …) |
| STORE STEP (LOAD) | store the current performance as a step (store flow, §5) |
| EDIT | edit the focused side (right after CALL also works); EDIT cancels a half-typed number |
| A440+CALL L/R | load the null program into that side's edit buffer (Rev4 null patch) |
| A440+STORE | compare (if edited) — otherwise offer to undo the last store |
| A440+EDIT | SYSTEM menu |
| hold a key on the keyboard and press SPLIT (as on Rev4) | split point, shown as a note: `SP  C3` (sharp = decimal point) |
| WHOLE 8 / SPLIT / LAYER, UNISON L/R, HOLD, REL DEF, BEND DEF | as printed (performance settings) |
| OCTAVE L/R | cycles normal → up → down; A440+OCTAVE = arpeggiator octave range 1–4 |
| ARP UP / DOWN / RANDOM | mode; UP then DOWN (or DOWN then UP) = up/down |
| ARP LEFT / RIGHT / PAUSE | arpeggiate that side / pause |
| AUTO TUNE | autotune with progress `tU v.o` (voice.osc) then `tU oK` or the failing oscillator |
| A440+AUTO TUNE | A440 reference tone on/off |
| TAPE DUMP (now SYSEX DUMP) | `SEnd ?` → STORE sends all 100 programs as legacy SysEx |
| TAPE LOAD (now SYSEX RECEIVE) | `Ld nn` counts received programs; EDIT leaves |
| Rev4 chords | A440+ARP DOWN → menu 10 (MIDI) · A440+RANDOM → 40 (Set) · A440+STEP ENABLE → 50 (Alternate) · A440+AUDIO MUTE → 21 (Velocity) · A440+ARP RIGHT → sequencer (not in MVP) |

Normal-page trimmers: **Trim** mode (default, Rev4 behaviour: relative −64…+63 offsets stored in the step)
or **Direct** mode (menu 31: the trimmer edits the program parameter itself and marks it edited).

## 4. EDIT

* Pages in Rev4 order: **1** VCO · **2** VCF/ADSR/LFO · **A B C D** modulation banks.
  FWD/REV step through them; **EDIT then a digit 1…6 within 0.6 s**, or **A440 + digit** while in EDIT, jumps
  directly (1, 2, A, B, C, D).
* Every button and pot keeps its Rev4 page function (`spec/pages.yaml`); the keypad selects the
  page's enum (PWM source, LFO waveform, mod source) and lights the digit of the current value.
* **CALL L / CALL R** switch the edited side. EDIT returns to PLAY and remembers the page per side.
* **A440+FWD/REV**: ±1 on the last touched parameter (fine control of 8-bit mod depth without the
  coarse/fine pot pair, which still works).
* **Pot modes** (menu 30): **Pickup** (default) — the pot only takes over after passing the stored value;
  **Jump**; **Relative**.

## 5. Store, compare, undo

1. **STORE** — LED blinks, display `St` + destination (current number) blinking.
2. Choose the destination: 2 digits, or FWD/REV.
3. **STORE** commits (`StOrEd`), **EDIT** cancels (`CAnCEL`). Memory protect → `PrOtEC`, nothing written.
4. The overwritten program is kept: **A440+STORE** (when nothing is edited) shows `UndO nn`, STORE restores it.

Programs are one pool of 100: copying L → R is "store L at nn, call nn on R".
Storing is refused while comparing.

## 6. SYSTEM menu (A440+EDIT)

Two digits jump to an item, FWD/REV walk the list, the **ARP SPEED** knob (or A440+FWD/REV) sets the value,
EDIT leaves. Values marked *step* belong to the performance and are saved with STORE STEP.

| # | Mn | Item | Values |
|---|---|---|---|
| 10 / 11 | cL / cr | MIDI channel Left / Right | 01–16 |
| 12 / 13 | oL / or | Omni Left / Right (saved, unlike Rev4) | On/oF |
| 14 – 18 | rn rP rS tn tP | receive notes / program change / SysEx (Rev4 "MX"), transmit notes / program change | On/oF |
| 19 | PC | program change selects programs or steps | Pr/SP |
| 20 | Lo | local control | On/oF |
| 21 | tA | user velocity taper (Rev4 page; not in prototype yet) | |
| 22 | SP | split point (*step*) | note |
| 30 | Pn | pot mode | PU/JP/rL |
| 31 | tr | Normal-page trimmers | tr (trim) / dI (direct) |
| 32 | dh | display hold ×100 ms | 05–30 |
| 33 | PS | power-on step | LA (last) / 00 |
| 40 – 43 | F0–F3 | footswitch functions (Rev4 Set-page codes) | 00–99 |
| 44 – 47 | t0–t3 | footswitch momentary / toggle | no/to |
| 50 | AC | arp clock | In / EH (external) / nI (MIDI) |
| 51 / 52 | AL / Ar | arp octaves L / R (*step*) | 1–4 |
| 60 / 61 | SL / Sr | key assign L / R (*step*): 0 normal, 1 normal+same voice, 2 circular, 3 circular+same | 0–3 |
| 62 | St | voice stealing | od (oldest) / no |
| 63 | ud | unison detune spread | 00–15 |
| 90 | Ud | voice disable: keys 0–7 toggle a voice (LED = disabled) | count enabled |
| 91 – 95 | bt Pt dt nn tu | button test · pot raw · display test · MIDI monitor · autotune report | |
| 99 | rG | reset globals (patches untouched): set `YE`, press STORE | no/YE |

## 6c. Polysequencer page (A440 + ARP RIGHT; EDIT or ARP RIGHT leaves)

The engine is the Rev4 sequencer, behaving like the original (2 channels, loop, lock/bounce, overdub, song,
quantize, metronome, internal / external clock; REC turns off after a take), plus MIDI clock and a SysEx dump.
Capacity differs: 1138 event slots shared by both channels (stock: 850 per channel, 1700 in double-channel
recording) - more for one channel, less for two.
The page keeps the Rev4 button positions; what changes is that every state is visible and nothing fails silently.

| Control | Function |
|---|---|
| REL DEF L / R | PLAY 1 / PLAY 2 (LED) |
| PB DEF L / R | REC 1 / REC 2 (LED) |
| HOLD L / R | LOOP / LOCK (LED) |
| ARP PAUSE | START / STOP (LED on while running, blinking while a recording waits for its first key) |
| ARP LEFT | CLEAR: all switches off, stop. **A440 + ARP LEFT**: erase the recorded data (`ErASE?`, STORE confirms) |
| ARP DOWN | INSTANT RECORD (start on START instead of on the first key) |
| ARP RANDOM | METRONOME on/off (was EDIT on Rev4: EDIT now leaves the page) |
| ARP UP | clock source: `CL In` internal / `EH` external SEQ CK IN / `nI` MIDI clock (NeoV8) |
| LAYER / UNISON L / R | external clock rate 96 / 48 / 24 per quarter |
| WHOLE 8 | SONG on/off; **SPLIT**: song repeats, 4 digits (`S1 0305` = channel 1 three times, channel 2 five times) |
| CALL R / CALL L / OCTAVE L | value field: tempo `bP` (20–251), metronome beat `nb` (4 / 8 / 16), quantize `qU` (`--` … `2t`) |
| digits, FWD / REV | edit the selected field; the **SPEED knob** always sets the tempo |
| TAPE DUMP / LOAD | send / receive the sequences as SysEx |
| A440 + ARP PAUSE (Normal page) | START / STOP without opening the page (live use) |

Display: LEFT = state `--` stopped, `PL` playing, `rE` recording (blinks while waiting for the first key), `Od`
overdub, `Sn` song; RIGHT+STEP = tempo, or the free events while recording. Refusals are messages: `SEL  ?`
(nothing selected), `nodAtA`, `SOnG 2` (song needs both channels), `rEC On` (song while recording), `FULL`.
Rev4 problems removed: ARP PAUSE no longer turns into START/STOP on the Normal page; quantize cannot be changed
while recording; sequences are sent over SysEx instead of tape. Sequences live in volatile RAM, as on Rev4.

## 6b. Hardware constraints that shaped the UI (found while porting it to the firmware)

* **The 8279 reports key presses only, never releases.** A440 works as SHIFT because it is wired to the 8279
  SHIFT input (its level comes with every key press), but no other button can be "held": EDIT acts when
  pressed, page jumps are *EDIT then a digit within 0.6 s* or *A440 + digit* in EDIT, the split point is set by
  holding a key on the keyboard and pressing SPLIT (the Rev4 gesture), and the prototype's "hold A440 to
  audition the store destination" was dropped.
* **Steps**: the stock 24-byte format is kept (stock steps remain readable both ways). NeoV8 adds one byte per
  step in the battery extension block (`NV_STEPEXT`) for HOLD, ARP PAUSE and the arpeggiator octave range.
  The voice-disable mask (menu 90) is part of the step, as on Rev4 (step byte 22).
* **Footswitches** (menu 40–47) edit the stock battery records, so a footswitch setup survives a swap back
  to the stock ROM; `99` = no function.
* Service items: menu 91 shows the button code in decimal (the Rev4 Set-page / SysEx numbering), menu 92 the
  7-bit pot value in hex. With the arpeggiator on MIDI clock, touching ARP SPEED shows the division
  (`AS  16`, `AS 16t` …).

## 7. What the stock OS taught us (from `rev4-ui-map.md`, `hardware.md`)

* Rev4 shows **no value for any 7-bit parameter** (only mod depth, in hex) and its knobs are incremental:
  NeoV8's value-on-touch + pickup is the single biggest improvement.
* STORE overwrote at once and failed silently with memory protect on; the velocity page **wiped the user
  taper on entry**. NeoV8: arm/confirm/undo, `PrOtEC` message, and taper editing must start from the stored taper.
* Left-side controls silently do nothing in WHOLE 8 (manual p.12, 26). Proposal: touching a Left control in
  WHOLE 8 shows `L oFF` instead of nothing.
* Rev4 already used FWD/REV in edit for pages and the 2-digit keypad for numbers — kept.
* VCO pitch is one 7-bit byte set with two knobs, OCTAVE and SEMI (manual p.42): NeoV8 keeps that split.

## 8. Open questions (to decide with the user)

* Recalling a program over an edited buffer discards the edit (Prophet/OB-X8 behaviour). Warn instead?
* Steps: the real 30-byte layout is decoded in Phase 0; which new per-step settings fit.
* Which of the four unassigned LED bits belongs to EDIT, STORE, TAPE LOAD, TAPE DUMP (check on the unit).
* Programs are 40 bytes in memory: new per-program settings go in a NeoV8 table in the free battery RAM
  (`$5A7A–$5FFF`, 1414 B, never touched by the stock ROM).
* Joystick and pressure are analog-only: they cannot be sent over MIDI (hardware limit).
