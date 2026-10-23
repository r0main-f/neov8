# Voyetra Eight Rev4: stock user interface map

Source: the Voyetra Eight teaching/user manual (`Voyetra 8 synths/v8_user.pdf`, 146 pp.), read page by page, cross-checked with the SysEx document.
Page numbers are the manual's printed page numbers.
Companion documents: `rev4-ram-map.md` and `hardware.md` (what the ROM actually does) and `ux-spec.md` (the NeoV8 redesign).
Where the scan was illegible, that is said rather than guessed.

# 1. Hardware

## 1a. Module front panel (Normal Page legends, p.19, with detail on pp.20–35)

The panel is divided into blocks. Here they are left to right, top to bottom.

| # | Block / legend | Controls | LED? | Notes / page |
|---|---|---|---|---|
| 1 | **AUDIO MUTE** (blue, top-left corner) | 1 button | yes | p.20 |
| 2 | **HEADPHONE MONITOR** | 1 level trimmer, stereo jack, keyboard XLR jack below | – | Headphone output is mono and is not affected by the VOLUME trimmers or MASTER VOLUME (pp.5, 20–21, 35) |
| 3 | **KEYBOARD MODE**: `whole 8 voice`, `split`, `layer` | 3 buttons | yes ×3 | p.21 |
| 4 | **UNISON**: `L`, `R` | 2 buttons | yes ×2 | p.22 |
| 5 | **REMOTE**: `edit`, `store` (grey) | 2 buttons | yes ×2 | p.24 |
| 6 | **TAPE**: `load`, `dump` (blue) | 2 buttons | yes ×2 | p.24 |
| 7 | **LEFT**: `call` (red), `octave` (white), then a 2-digit 7-segment readout labelled "PROGRAM NUMBER" | 2 buttons, 1 display | no LEDs on the buttons | p.11 |
| 8 | Octave LED columns between the LEFT and RIGHT readouts: `UP / NORMAL / DOWN` | 3 LEDs per side, 6 total | – | p.11. On the Alternate Page the left column shows the left arpeggiator clock source (ARPEG CLK / LFO1 / LFO2) (pp.82–83) |
| 9 | **RIGHT**: `octave` (white), `call` (red), 2-digit readout "PROGRAM NUMBER" | 2 buttons, 1 display | no | |
| 10 | **STEP**: `load` (red), `enable` (white), 2-digit readout "STEP NUMBER" | 2 buttons, 1 display | no | pp.9, 42 |
| 11 | **PROGRAMMER** keypad, 3×4 grid: `1 2 3 / 4 5 6 / 7 8 9 / FWD 0 REV` | 12 buttons | no | pp.10, 25 |
| 12 | **ARPEGGIATOR**. Top row labelled "mode": `UP` (white), `DOWN`, `RANDOM`. Right side: `speed` knob (slow–fast) with a rate LED under it. Bottom row labelled "assignment": `LEFT` (blue), `PAUSE` (white), `RIGHT` (blue) | 6 buttons, 1 knob | yes ×6, plus 1 rate LED | pp.30–31, 85, 98–99 |
| 13 | **Master section** under the "VOYETRA EIGHT / OEI" logo: `AUTO TUNE` (white), `A 440` (blue), `MASTER TUNE` knob, `MASTER VOLUME` knob, `POWER` switch | 2 buttons, 2 knobs, 1 switch | yes on AUTO TUNE and A440; power LED not stated | pp.6, 34–35 |
| 14 | **PROGRAM PARAMETER TRIMMERS** (grey). Two rows of 3 grey buttons labelled `RELEASE DEFEAT`, `PITCH BEND DEFEAT`, `HOLD`, one row LEFT and one row RIGHT. Beside them, two rows of 7 trimmers labelled `A`, `R`, `LFO RATE`, `GLIDE`, `Fc`, `DETUNE`, `VOLUME` | 6 buttons, 14 knobs | yes ×6 | pp.26–29 |

**Counts**
- **Push buttons: 42**, plus the POWER switch. That is AUDIO MUTE 1, KEYBOARD MODE 3, UNISON 2, REMOTE 2, TAPE 2, CALL/OCTAVE/STEP 6, keypad 12, ARPEGGIATOR 6, AUTO TUNE and A440 2, trimmer section 6.
- **Buttons with LEDs: 24.** These are every button except the 6 CALL/OCTAVE/STEP buttons and the 12 keypad keys. Those 18 show their state through the readout decimal points instead (p.10).
- **Knobs: 18.** 14 parameter trimmers, ARP SPEED, MASTER TUNE, MASTER VOLUME and HEADPHONE level.
- **Displays:** three 2-digit 7-segment readouts (6 digits), each digit with a decimal point.
- **Discrete LEDs: 32.** 24 button LEDs, 6 octave LEDs, 1 arpeggiator rate LED and 1 more that I can't place with certainty (the power LED is not shown clearly).
- **Absolute vs. incremental:** every panel trimmer except MASTER TUNE, MASTER VOLUME and HEADPHONE is **incremental, not absolute** (pp.26–27, 31). The exception is the Velocity Taper page, where the trimmers become absolute (p.116).
- **Left row is silent in Whole 8:** the LEFT row of the trimmer section has no audible effect in WHOLE 8 mode (p.26). GLIDE LEFT only works in SPLIT (p.28).

## 1b. VPK-5 keyboard (pp.4, 10–11, 16, 61–62, 77)
- Joystick: X-axis gives the −X and +X modulation controllers; Y-axis is pitch bend up/down.
- **FORWARD** and **REVERSE** buttons just above the joystick. The manual says "left is FORWARD, right is REVERSE" (p.10), but the Keyboard review (May 1984) says the module's keypad has them "backwards" relative to the keyboard, and the unit in the Doctor Mix video has ← on the left and → on the right; the app follows the arrows (← REV, → FWD). These are the only buttons with auto-repeat: holding one for about 0.5 s steps several Programs or Steps per second (p.11).
- Three small trimmers at the front left, all absolute: PITCH BEND RANGE UP, PITCH BEND RANGE DOWN, PRESSURE THRESHOLD/SENSITIVITY (pp.61–62). No range is printed; the schematics give about 5–10 semitones (docs/audio-model.md §2).
- MASTER TUNE: "a range of several semitones" (p.34); ±2.7 semitones from the schematic. The rear PITCH pedal bends up only, up to "about an octave and a fifth", "a greater range than that of the keyboard's joystick" (p.124).
- Key velocity and channel pressure sensing. The keyboard connects to the module with an XLR cable that also carries the keyboard's power (pp.2, 4).
- The manual does not give the number of keys.

## 1c. Rear panel, for context (pp.122–125)
- CONTROLLERS out/in (10-pin)
- MIDI IN / OUT / THRU (XLR-style per p.127)
- CASSETTE out/in
- EXT CLOCKS: sequencer and arpeggiator (stereo jacks; the arpeggiator clock out doubles as the metronome output)
- **MEMORY PROTECT switch**
- CV/GATE OUTPUT
- FOOTSWITCHES: fwd-rev, programmable A, programmable B
- FOOTPEDALS: vcf fc (programmable), pitch, volume
- AUDIO OUT: right / mono / left

---

# 2. Page system

The manual says there are 11 pages (pp.9, 14–15): Normal, Alternate, Poly-Sequencer (with the Song sub-page), Velocity Taper, Set, Edit 1, Edit 2, and Mod Banks A–D. **MIDI does not have its own page.** Its three switches live on the Alternate Page. There are also several temporary modes that behave like pages: auto-tune, the A440 tone, selective tape load, and tape load/dump.

**How to move between pages (p.15, Appendix 1 on PDF p.129)**

| Page | Enter | Exit |
|---|---|---|
| Alternate | A440 + STEP ENABLE | STEP ENABLE |
| Poly-Sequencer | A440 + ARPEG RIGHT | ARPEG RIGHT |
| Song (sub-page of the Sequencer) | middle KEYBOARD MODE button (SPLIT, "SET SONG") | same button |
| Velocity Taper | A440 + AUDIO MUTE | AUDIO MUTE |
| Set | A440 + RANDOM | RANDOM |
| Edit 1 | EDIT | EDIT, from any of the 6 edit pages |
| Edit 2, Mod A–D | FWD/REV from Edit 1, cycling 1 → 2 → A → B → C → D → 1 | EDIT |

Alternate, Sequencer, Velocity and Set can only be reached from the Normal Page and only return to it (p.14). The keyboard stays playable on every page. MASTER TUNE and MASTER VOLUME work on every page (pp.14, 35).

## Normal Page (pp.19–35)

| Control | Function |
|---|---|
| WHOLE 8 / SPLIT / LAYER | Keyboard mode. Holding a key while pressing SPLIT sets the split point there. |
| UNISON L / R | Whole 8: R makes all 8 voices sound together, L does nothing. Split: L or R makes that side's 4 voices sound together. Layer: R gives 8 voices (4 Left program + 4 Right program), L does nothing. |
| EDIT | Enter the Edit pages |
| STORE | Write the current program to memory (see §3) |
| TAPE LOAD / DUMP | Cassette load / save |
| CALL L / CALL R / STEP ENABLE | Choose what the keypad targets; the decimal points move to that readout |
| OCTAVE L / R | Cycle that side's octave; shown on the UP/NORMAL/DOWN LEDs |
| STEP LOAD | Then type two digits to store the current Step |
| Keypad 0–9 | Two-digit Program or Step number |
| FWD / REV | Next / previous Program or Step |
| ARP UP / DOWN / RANDOM | Arpeggiator mode. Pressing UP and DOWN together gives up-down. |
| ARP LEFT / RIGHT | Arpeggiator on/off. LEFT works in SPLIT only. |
| ARP PAUSE | Pause the arpeggiator. It becomes Sequencer START/STOP whenever any Sequencer-page switch is on (pp.31, 100). |
| ARP SPEED knob | Arpeggiator rate (incremental) |
| AUTO TUNE / A440 / MASTER TUNE / MASTER VOLUME / AUDIO MUTE | As labelled. A440 on its own is only a shift key. |
| RELEASE DEFEAT L / R | Release of both ADSRs goes to 0. If Release-Gets-Decay is set in the program, it goes to the Decay value instead. |
| PITCH BEND DEFEAT L / R | Joystick Y-axis no longer bends that side |
| HOLD L / R | Hold notes indefinitely |
| Trimmers A, R, LFO RATE, GLIDE, Fc, DETUNE, VOLUME (L and R rows) | Offsets to the program. A and R move both ADSRs at once. LFO RATE affects LFO1 only. DETUNE moves VCO1 by up to about one semitone. VOLUME sets the L/R balance and does not reach the headphones. |

**A440 shift combinations (Appendix 1, PDF p.129; also pp.31, 38, 47, 89, 117)**

| A440 + … | Effect |
|---|---|
| AUDIO MUTE | Velocity Taper page |
| ARPEG RIGHT | Sequencer page |
| STEP ENABLE | Alternate page |
| RANDOM | Set page (p.117; this row of the Appendix 1 table is blank or illegible) |
| TAPE LOAD | Selective tape load |
| TAPE LOAD, then AUDIO MUTE | Load the User Velocity Taper from tape |
| RELEASE DEFEAT L / R | Velocity-controlled VCA for that side |
| OCTAVE L / R | Arpeggiator automatic octave shift for that side (doesn't work with Unison, p.32) |
| AUTO TUNE | A440 reference tone. Pressing AUTO TUNE again stops the tone and runs a full tune. |
| STEP LOAD | Clear the Alternate Page and re-enable any voices disabled on the Set page |
| CALL L / R | Load the Null Program into that side |

## Edit Page 1: VCO (pp.39–45)

**Readouts**
- LEFT: side and page, shown as `r1` (Program Right) or `L1` (Program Left). The r is lower case and the L is upper case.
- RIGHT: number of the program being edited.
- STEP: PWM1 and PWM2 source, one digit each. The decimal point shows which one the keypad is changing.

| Control | Function |
|---|---|
| WHOLE 8 / SPLIT / LAYER | VCO1 BYPASS VCF / SYNC / LINEAR FM |
| UNISON L / R | LFO1 KBD TRACK on/off / HALF |
| STEP LOAD (red) / STEP ENABLE (white) | Select PWM1 / PWM2. Keypad 0–3 then sets the source: 0 LFO1, 1 LFO2, 2 ADSR1, 3 ADSR2. Other digits are ignored. |
| FWD / REV | Next / previous edit page |
| EDIT / STORE / TAPE | Exit / store and overwrite / no function |
| ARP UP / DOWN / RANDOM | VCO1 PULSE / SAW / VCO1 KBD TRACK (pressing it turns tracking **off**) |
| ARP LEFT / PAUSE / RIGHT | VCO1 SUB-OCT / TRIANGLE / PWM1 KBD TRACK |
| Trimmer buttons, top row (RelDef L, PBDef L, Hold L) | VCO2 PULSE / SAW / *unused* |
| Trimmer buttons, bottom row (RelDef R, PBDef R, Hold R) | VCO2 SUB-OCT / TRIANGLE / PWM2 KBD TRACK |
| Top row of trimmers | VCO1 VOL, VCO1 PWM DEPTH, VCO1 INIT PW, VCO1 OCTAVE, VCO1 SEMI, VCO1 DETUNE, PROGRAM VOLUME |
| Bottom row of trimmers | VCO2 VOL, VCO2 PWM DEPTH, VCO2 INIT PW, VCO2 OCTAVE, VCO2 SEMI, GLIDE/GLISS TIME, NOISE VOL |
| CALL / OCTAVE / ARP SPEED | Not documented for this page |

There is no VCO2 keyboard-tracking control (p.43).

## Edit Page 2: VCF / ADSR / LFO (pp.46–56)

**Readouts**
- LEFT: `r2` / `L2`.
- RIGHT: program number.
- STEP: LFO1 and LFO2 waveforms, one digit each (0 sine, 1 triangle, 2 saw, 3 sample & hold).

| Control | Function |
|---|---|
| WHOLE 8 / SPLIT / LAYER | VCA VELOCITY / GLISS-GLIDE (LED lit = glissando) / RELEASE GETS DECAY |
| UNISON L / R | LFO2 KBD TRACK / HALF (LED on = half) |
| STEP LOAD / STEP ENABLE, then keypad 0–3 | LFO1 / LFO2 waveform |
| ARP UP / DOWN / RANDOM | ADR1 mode / UNCONDITIONAL ADSR1 RETRIGGER / LFO1 RETRIGGER |
| ARP LEFT / PAUSE / RIGHT | ADR2 / UNCONDITIONAL ADSR2 RETRIGGER / LFO2 RETRIGGER |
| (hidden) ADR + UNCONDITIONAL together | ADSR reset-to-zero (p.55) |
| Trimmer buttons, three FULL (top) / HALF (bottom) pairs | Keyboard decay/release tracking, velocity → attack, VCF keyboard tracking. Each is off / full / half, and **HALF does nothing unless FULL is also on** (p.52). |
| Top row of trimmers | Fc, ADSR1→VCF depth, Q, A1, D1, S1, R1 |
| Bottom row of trimmers | LFO1 SPEED, LFO2 SPEED, LFO1 DELAY, A2, D2, S2, R2 |

## Mod Banks A–D (pp.57–64)

**Readouts**
- LEFT: `rA`…`rD` or `LA`…`LD`.
- RIGHT: source digit, with a `-` sign when inverted. **The program number is not shown on these pages.**
- STEP: mod depth in **hex 00–FF**.

| Control | Function |
|---|---|
| Keypad 0–7 | Source: 0 DC, 1 LFO1, 2 LFO2, 3 LFO1 square, 4 VCO1, 5 VCO2, 6 ADSR1, 7 ADSR2. On units shipped before September 1983, 1 and 2 are swapped (p.60). |
| White button above RIGHT (OCTAVE R) | Invert the source |
| FWD / REV | Next / previous bank or page |
| ARP UP / DOWN / RANDOM | Controller: VELOCITY / +X / KEYBOARD CV. Keyboard CV replaces velocity in **all** banks; its LED behaviour is confusing (p.61 note). |
| ARP LEFT / PAUSE / RIGHT | Controller: −X / PRESSURE / per-bank replacement for velocity: ADSR1 in banks A and B, NOISE in C, VCF PEDAL in D |
| Trimmer buttons, left and centre | Destinations: Q (top-left), Fc (bottom-left), VCO1 (top-centre), VCO2 (bottom-centre) |
| Trimmer buttons, right | VEL/CV INVERT (top) / USER/FACTORY VELOCITY TAPER (bottom), applying to the whole mod system |
| Top row of trimmers | MOD DEPTH COARSE, MOD DEPTH FINE (FINE moves 1 step), 3rd trimmer *unlabelled*, then ADSR1 A D S R |
| Bottom row of trimmers | LFO1 SPEED, LFO2 SPEED, LFO1 DELAY, ADSR2 A D S R (same functions as Edit 2) |

With no controller selected, the depth applies directly (p.63). Depth "doesn't matter until about 18 hex" (p.64).

## Alternate Page (pp.82–89)

**Readouts**
- LEFT and RIGHT show dashes `--` plus the keyboard assignment mode for each side.
- STEP: step number.

| Control | Function |
|---|---|
| WHOLE 8 / SPLIT / LAYER | KEYBOARD INTERFACE (MIDI KBD) / MIDI MISC / SLAVE ON (pp.82, 127) |
| UNISON L | *not documented* |
| UNISON R | CV/GATE output follows the LEFT side when the LED is on, the RIGHT side when off (p.88) |
| EDIT | External arpeggiator clock |
| STORE | Program-transfer commit |
| TAPE LOAD / DUMP | KEYBOARD GATE RIGHT / LEFT (p.85) |
| CALL L / CALL R | Choose the source program for a transfer |
| OCTAVE L | Cycle the left arpeggiator clock: standard clock, LFO1, LFO2. Shown on the octave LEDs. |
| FWD / REV | Cycle keyboard assignment mode LEFT / RIGHT |
| Keypad | Transfer destination number |
| ARP UP / DOWN / RANDOM | Arpeggiator **LEFT** mode |
| ARP SPEED | With an external clock, sets the gate length |
| ARP LEFT / PAUSE / RIGHT | LFO1 L/R SYNC / ARP CLOCK LEFT RESET / LFO2 L/R SYNC |
| AUTO TUNE | Arpeggiator clock keyboard retrigger |
| Trimmer buttons, left | VELOCITY VCA L/R |
| Trimmer buttons, centre | PRESSURE DEFEAT L/R |
| Trimmer buttons, right | DETUNE DEFEAT L/R: one-shot reset, **no LED** (p.87) |
| Trimmers | Same as on the Normal Page; the LFO RATE L trimmer stays active (p.84) |

## Poly-Sequencer Page (pp.96–112)

**Readouts**
- LEFT: metronome beat count (left digit: 0 quarter, 1 eighth, 2 sixteenth notes) and quantize setting (right digit, 0–A).
- RIGHT + STEP: tempo in BPM, 20–251.
- While recording, RIGHT + STEP count down the free events (starting at 850, or 1700 in double-channel mode).

| Control | Function |
|---|---|
| CALL L | Metronome beat count |
| OCTAVE L | Quantize setting |
| Tempo | p.98 says the "white button above RIGHT" (OCTAVE R); p.101 says CALL RIGHT. **Contradictory.** |
| Keypad, FWD / REV | Enter values |
| WHOLE 8 / SPLIT / LAYER | SONG on/off / SET SONG (enter Song page) / clock rate 96 |
| UNISON L / R | Clock rate 48 / 24 |
| EDIT | Metronome enable |
| TAPE LOAD / DUMP | Sequencer data only |
| ARP UP | External clock enable |
| ARP DOWN | Instant record |
| ARP RANDOM | *not documented* |
| ARP LEFT | CLEAR (all sequencer switches off) |
| ARP PAUSE | START/STOP |
| ARP RIGHT | Exit |
| RELEASE DEFEAT L / R | PLAY channel 1 / 2 |
| PITCH BEND DEFEAT L / R | RECORD channel 1 / 2 |
| HOLD L / R | LOOP / LOCK |
| Trimmers | Their normal functions |

**Song sub-page:** type four digits. RIGHT shows the repeat count for sequence 1 and STEP the repeat count for sequence 2 (00–99). All other sequencer buttons keep working (p.96).

The sequencer state is **not stored in Steps** (p.100).

## Velocity Taper Page (pp.113–116)
- The STEP readout shows the speed of the last key strike as one hex digit. The text says 0–E (15 levels, 0 is the fastest); the diagram says 0–F.
- Each trimmer is the output level for one velocity bucket. Top row: 0 1 2 3 4 5 6. Bottom row: 7 8 9 A B C, with the last one labelled "E" (no "D" is visible). The ARP SPEED knob is labelled "F". The scan is ambiguous here.
- The trimmers are absolute on this page. **Entering the page immediately overwrites the User Taper with the current knob positions** (pp.14, 114, 116).
- Leaving with AUDIO MUTE saves automatically.

## Set Page (pp.117–121)

**Voice disable:** a lit LED means the voice is disabled.

| Button | Voice |
|---|---|
| SPLIT | 7 |
| LAYER | 6 |
| UNISON L | 5 |
| UNISON R | 4 |
| EDIT | 3 |
| STORE | 2 |
| TAPE LOAD | 1 |
| TAPE DUMP | 0 |

**Footswitch programming**
- STEP readout, left digit: which footswitch side is being programmed (0 = B right, 1 = B left, 2 = A right, 3 = A left), chosen with FWD/REV.
- STEP readout, right digit: single-strike (a "backwards Y") or double-strike (`H`), toggled with STEP ENABLE. The diagram labels the two buttons above STEP as "FTSW#" and "m/T".
- Keypad: four digits. The first code appears in LEFT, the second in RIGHT. 99 means no function.
- **STEP LOAD commits.** It fails if MEMORY PROTECT is on.

**Footswitch codes**

| Code | Function | Code | Function | Code | Function |
|---|---|---|---|---|---|
| 00 / 01 | Unison L / R | 26 / 27 | Tape Load / Dump | 40 / 41 | Pitch Bend Defeat R / L |
| 02 | Split | 28 | Store | 43 | Audio Mute |
| 03 | Layer | 29 | Edit | 48 / 49 | Release Defeat R / L |
| 04 / 05 | Hold L / R | 30 | Tune | 50 / 51 | Arp Right / Left |
| 06 | Whole 8 | 32 / 33 | Call Right / Left | 52 | Arp Pause |
| 18 / 19 | Reverse / Forward | 34 / 35 | Step Enable / Step Load | 56 / 57 / 58 | Arp Down / Random / Up |
| 20 / 21 | Glide R / L | 08–17 | keypad digits 0–9 | 99 | No function |
| 24 / 25 | Octave R / L | | | | |

---

# 3. Procedures

- **Call a Program:** press CALL LEFT or CALL RIGHT (the decimal points move to that readout), then type two digits or use FWD/REV (pp.10–11). In WHOLE 8 only Program RIGHT is heard. In Split/Layer, LEFT changes silently until that side is in use (p.12).
- **Call a Step:** press STEP ENABLE, then two digits or FWD/REV. All three readouts change (p.12).
- **Edit a Program:**
  1. CALL LEFT or RIGHT to choose the side (Split/Layer needed for Left).
  2. Press EDIT to reach Edit 1.
  3. FWD/REV to move through 1, 2, A, B, C, D.
  4. EDIT to exit.
  The manual recommends WHOLE 8 while editing (pp.36–37, 40).
- **Write (STORE):** press STORE from the Normal or Edit pages. It overwrites immediately with no confirmation. The decimal points must be on that Program's readout, otherwise nothing happens (pp.24–25, 41). It is blocked by MEMORY PROTECT (p.24). The diagram on p.78 says it stores to the location "specified by Program Right", which is unclear for Left.
- **Copy / move a Program:**
  1. Alternate page (A440 + STEP ENABLE).
  2. CALL L or R for the source; that readout shows `00`.
  3. Type the destination; it can be retyped freely until step 4.
  4. Press STORE (pp.72–73).
- **Null patch:** A440 + CALL L or R. Both VCOs on saw at half volume, Fc fully open, Q at 0, ADSRs with full sustain and fast A/D/R, all mod banks off (p.38).
- **Compare:** **no compare function exists.** The only way back is to re-call the program number, which throws the edit away (pp.27, 38).
- **Create / store a Step:**
  1. Set up the Programs, keyboard mode, trimmers and so on.
  2. In the Normal page, press STEP LOAD and type two digits (pp.25, 81).
  Trimmer positions are stored as **differences** from the Program (p.90). A Step holds the program numbers, volumes, octaves, keyboard mode and unison, split point, assignment modes, trimmer offsets, all arpeggiator settings, LFO sync, the defeat buttons, velocity VCA, voice disable and the slave CV assignment (p.90).
- **Keyboard modes:** see the Normal Page table. Changing keyboard mode switches Unison off; Unison switches the Arpeggiator off (p.23).
- **Split point:** hold the key and tap SPLIT. The default is the "second C from the left". To get Program RIGHT on almost the whole keyboard, hold the lowest D♭ and tap SPLIT (pp.22, 80).
- **Assign modes:** on the Alternate page, FWD cycles the Left mode (LEFT readout) and REV the Right mode (RIGHT readout). 0 Normal, 1 Normal + Single, 2 Circular, 3 Circular + Single. The setting is stored in the Step (p.86). The diagram on p.82 numbers them 1–4.
- **Arpeggiator:**
  - Basic: UP/DOWN/RANDOM, then RIGHT (or LEFT in Split), then hold a chord (pp.30–31).
  - Up-down: press both UP and DOWN. To switch from up-down to a single direction, press the wanted button twice (p.31).
  - Left arpeggiator setup is on the Alternate page (pp.83–85): OCTAVE L for the source, UP/DOWN/RANDOM for the mode, PAUSE for clock reset, AUTO TUNE for keyboard retrigger, EDIT for external clock, TAPE LOAD/DUMP for keyboard gate.
  - Setting LFO2 as the left clock rate means leaving the Alternate page, pressing CALL L, going to Edit 2 and using the LFO2 SPEED trimmer (p.84).
- **Sequencer (pp.106–111).** Every mode is a chord of buttons pressed before START/STOP:

  | Mode | Record | Play / repeat |
  |---|---|---|
  | Single | REC1 or REC2, START/STOP | PLAY n, START/STOP; add LOOP to repeat |
  | Auto-playback | REC + PLAY on the same channel, START/STOP | Plays back as soon as recording stops |
  | Overdub | PLAY on the last-recorded channel + REC on the other, START/STOP. LOOP before START/STOP fixes the length. | |
  | Continuous overdub | as Overdub, plus LOCK; the channels bounce automatically | |
  | Auto-continuous overdub | REC + LOCK, START/STOP | |
  | Double-channel | REC1 + REC2 (1700 events) | PLAY1 |
  | Song | Needs data on both channels and no REC lit | PLAY 1 or 2, SONG, START/STOP |
  | Stevenson | PLAY + REC + LOOP + LOCK, START/STOP | Each START/STOP replaces the loop |

  Instant Record starts recording on START/STOP instead of on the first key. The metronome forces Instant Record on (p.112).
- **Auto-tune:** MEMORY PROTECT must be off (p.34). Press AUTO TUNE. The display counts down 15 → 0 and the keyboard is silent during the tune (p.33).
- **Cassette (pp.91–95):**
  - Save: TAPE DUMP saves all 100 Programs, 100 Steps and the velocity taper. STEP counts 00–99, then returns to Step 00.
  - Load: TAPE LOAD. Start the tape during the clicks.
  - Selective load: A440 + TAPE LOAD (the readouts go blank), type the source number (shown in LEFT) and the destination (shown in RIGHT), then play the tape.
  - Taper only: A440 + TAPE LOAD, then AUDIO MUTE.
  - Sequences: from the Sequencer page with TAPE LOAD/DUMP. Selective load does not work for sequences.
  - Rev2 tapes load with the new features off; Rev1 tapes don't load.
- **Velocity taper:**
  1. Enable it: for VCA, use A440 + RELEASE DEFEAT L/R, the Alternate-page VCA VELOCITY or the Edit 2 VCA VELOCITY; for modulation, use USER/FACTORY on any mod bank.
  2. Press WHOLE 8.
  3. A440 + AUDIO MUTE (this wipes the old taper).
  4. Play and adjust the trimmers.
  5. AUDIO MUTE to exit, which saves (pp.115–116).
  To recover the factory user taper you have to reload the factory tape.
- **Voice disable:** see the Set Page table.
  - Voices disabled by auto-tune cannot be re-enabled here; you have to re-tune (p.118).
  - In Layer the voices are paired 7/3, 6/2, 5/1, 4/0 (p.118).
  - The setting is stored in the Step.
  - A440 + STEP LOAD re-enables all voices.

---

# 4. What the displays show

| Situation | LEFT | RIGHT | STEP |
|---|---|---|---|
| Normal | Program L number | Program R number | Step number. The decimal points mark the keypad target (p.10). |
| Edit 1 / 2 | `r1`/`L1` or `r2`/`L2` | Program number | PWM sources (Ed 1) or LFO waveforms (Ed 2), two single digits with a point marking the selected one |
| Mod bank | `rA`…`LD` | Source digit; `-3` means inverted source 3 | Depth 00–FF hex |
| Alternate | `--` + assignment mode L | `--` + assignment mode R | Step. During a transfer, the source readout shows 00 and then the destination. |
| Sequencer | Metronome digit + quantize digit (e.g. `2A`) | Tempo, continued in STEP | Tempo (e.g. `120`). While recording: events left, e.g. `8` + `50` → 850 |
| Song | blank | Repeats for sequence 1 | Repeats for sequence 2 |
| Set | Footswitch function 1 (e.g. `20`) | Function 2 (e.g. `58`) | Footswitch number + single/double symbol (e.g. `2H`) |
| Velocity Taper | – | – | Key speed, one hex digit |
| Auto-tune | – | Countdown, with an error letter on the left when there is a problem | Countdown / oscillator number. The p.33 example shows `b` and `3`. |
| Tape | – | – | Counts 00–99. `EE` = load error. Selective load shows blank readouts. Taper load shows a special glyph in LEFT that looks like "nn" (p.95; the exact segments are unclear). |

**Auto-tune error letters (p.34):** the voice with the failing oscillator is disabled automatically.

| Letter | Meaning |
|---|---|
| A | Oscillator dead or far too low |
| b | Initial pitch can't be calibrated |
| C | Oscillator unstable (often insufficient warm-up) |
| d | Scaling can't be calibrated |
| e | Pulse wave is dead |

**How values appear on 2-digit displays**
- **Mod depth is the only continuous parameter with a numeric readout.** It is 8-bit and shown as hex 00–FF (pp.62–63; the hex table is in Appendix 3).
- All 7-bit parameters (0–127, per the SysEx map) have **no numeric display at all** and are set by ear with incremental trimmers.
- Enumerated settings (sources, waveforms, quantize, assignment mode) are single digits, using hex up to A.
- Tempo uses the RIGHT and STEP readouts together.

---

# 5. Usability problems

1. **STORE writes immediately and destructively, with no confirmation and no undo** (pp.2, 24, 41). It also fails silently if the decimal points are on the wrong readout (p.25) or MEMORY PROTECT is on (p.24).
2. **Entering the Velocity Taper page destroys the User Taper** the moment you arrive (pp.14, 114, 116). Recovery requires the factory cassette.
3. **MEMORY PROTECT fails silently.** It blocks STORE, STEP LOAD for footswitches, tape load ("sounds aren't there", p.93), sysex writes, and even auto-tune ("will take forever", p.34), with no error shown.
4. **No numeric feedback for almost every parameter.** Only mod depth is shown (in hex). Everything else is incremental knobs set by ear (pp.26–27, 63).
5. **Incremental knobs run out of travel.** You have to "clear" a trimmer by sweeping it fully before it gives the full range (pp.27, 31, 44).
6. **Four different exit keys** for the shift pages: STEP ENABLE, ARPEG RIGHT, RANDOM, AUDIO MUTE (p.15). The entry chords are hidden behind A440 and only listed in an appendix (PDF p.129).
7. **Every button changes meaning on every page**, while the panel labels stay the same; the manual admits this (p.40). For example: STEP ENABLE is the Step target on Normal, exit on Alternate, PWM2/LFO2 select in Edit, and the single/double-strike toggle in Set. FWD/REV means Program/Step, page change, assignment mode, or footswitch number depending on the page.
8. **The Left controls do nothing in Whole 8 and give no indication** (pp.12, 26). Arpeggiator LEFT works only in Split (p.31). GLIDE L doesn't work in Layer (p.28). UNISON L does nothing in Whole 8 or Layer (p.23).
9. **Step numbers mislead.** A Step stores trimmer *differences*, so "60" in a readout may not sound like Program 60 (pp.12–13, 90).
10. **No compare function**, and the only way to clear the mod banks is to turn off every LED by hand; the Null Program wipes the whole patch (p.65).
11. **Edit pages don't show the program number on mod-bank pages**, because the RIGHT readout is used for the source (p.60), even though p.37 says RIGHT always shows the program.
12. **Hidden combinations:** ADSR reset-to-zero is ADR + UNCONDITIONAL (p.55). HALF does nothing without FULL (p.52). Up-down arpeggio means pressing both, and returning to a single direction means pressing twice (p.31). Release Defeat overrides Edit-page release until you turn it off (p.50).
13. **Set-page footswitch entry can't be cancelled.** You must finish all four digits (p.119), and nothing takes effect until STEP LOAD (p.120).
14. **The Sequencer is modal and gives no error.** Buttons pressed in the wrong order simply don't light (p.106). In LOCK modes, pressing STOP a second time ruins the take (p.109). Song mode needs data on both channels and refuses if REC is on (p.111). Changing quantize while recording rearranges what was already recorded (p.104).
15. **ARP PAUSE secretly becomes Sequencer START/STOP** whenever any Sequencer switch is left on (pp.31, 100). Footswitch functions also interact with each other (p.120).
16. **Tape errors are opaque.** A single `EE` code; the readouts go blank with no prompt in selective load; an interrupted load needs a power-cycle (pp.92–93). Selective load requires you to know the program numbers already (p.93).
17. **Setting the left arpeggiator to LFO2 rate takes several page trips** (p.84).
18. **Auto-tune-disabled voices can't be re-enabled on the Set page**; the only indication was a briefly flashed letter (p.118).
19. **The DETUNE DEFEAT button has no LED** (p.87). The Keyboard-CV and ADSR1 velocity-replace buttons have contradictory LED behaviour (p.61).
20. **The manual contradicts itself:**
    - Assignment modes are 0–3 in the text (p.86) but 1–4 in the diagram (p.82).
    - Key speed is 0–E in the text but 0–F in the diagram (pp.113–114).
    - The Tempo button is OCTAVE R on p.98 but CALL R on p.101.
    - LFO1 and LFO2 source numbers are swapped on pre-September-83 units (p.60).
    - Not every BPM between 20 and 251 can be set (p.98).
21. **Headphones are mono and ignore the L/R VOLUME trimmers**, so you can't balance a Split/Layer on headphones (pp.5, 21).
22. **The Unison / Arpeggiator / keyboard-mode interlocks silently switch features off** (p.23).
23. **The keypad has no undo.** Mistyped Program numbers take effect at once. Only the module-side FWD/REV lacks auto-repeat; the keyboard's FWD/REV have it (p.11).

---

# Cross-reference: Octave_Plateau_V8_sysex.pdf

**Message format**
- `F0 03 0pcccccc …`, where p is a "controller flag" that must be 1 for the V8 to accept data from a computer.
- Commands:

| Cmd | Message |
|---|---|
| 0 | New Step |
| 1 | Program bulk (says 45 bytes / 90 nibbles, low nibble first) |
| 2 | Step bulk (30 bytes) |
| 3 | Keyboard on/off |
| 5 | User velocity taper (15 bytes) |
| 6 / 7 | Request Program / Step |
| 8 | New data available (also sent when leaving Edit) |
| 9 | Return to Normal page |
| 10 | Program parameter byte change (byte 0–45) |
| 11 | **Panel Button** (button number 0–58; handwritten note "0 = A440") |
| 12 | Load acknowledge |

- Everything requires "MX" (the MIDI MISC switch on the Alternate page) to be on.
- Program number 126 is the Right scratch buffer and 127 the Left scratch buffer. These are the "holding areas" from p.78, and they can be written even with Memory Protect on.

**Program map:** the table runs from 0x00 to 0x27, which is 40 bytes even though the header says 45.
- 8-bit: the four mod depths.
- 7-bit (0–127): glide time, LFO1 rate, noise volume, VCO1/2 frequency, VCO1/2 initial PW, VCO1/2 volume, Q, Fc, ADSR1→Fc depth, all ADSR A/D/S/R, program volume, VCO1 detune, LFO2 rate.
- **4-bit:** LFO1 delay, and the VCO1/VCO2 PWM depths. The PWM depth knobs therefore have only 16 steps.
- Single-bit flags are active-low.

**Points to check against the Rev4 addendum**
- **Mod source encoding differs from the keypad.** SysEx 001 is LFO2 and 010 is LFO1, while the Rev3 keypad has 1 = LFO1 and 2 = LFO2, so the firmware remaps the digits (compare the p.60 note).
- **The velocity taper select has four values** (Factory 1, Factory 2, Factory 3, User). The manual only describes Factory and User.
- **ADSR mode is 2 bits:** reset-to-zero, ADR, unconditional retrigger, normal. This confirms the hidden combination on p.55.
- **Panel Button numbering looks like the footswitch codes.** Both run to 58 and code 00 matches the A440 note. My guess is that the footswitch codes are the internal panel-button IDs, which would give a full button-ID map for the new OS. This is not confirmed by either document.