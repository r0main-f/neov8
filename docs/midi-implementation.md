# NeoV8 MIDI implementation

Firmware: `firmware/src/midi.asm` (+ `midi_vars.inc`). Tests: `sim/test/fw-midi.test.ts`.
Settings come from the NeoV8 globals in battery RAM (`NV_GLOBALS`, `src/api.inc`): channel R/L, omni,
receive filters `G_RX`, transmit filters `G_TX`, program-change target `G_PC_TARGET`.

Side numbering: 0 = RIGHT, 1 = LEFT (as the stock ROM). `G_RX` bits: 0 notes, 1 program change,
2 CC/NRPN parameters, 3 SysEx (the Rev4 "MX" switch), 4 bend/mod/pressure/damper.

## 1. Implementation chart

| Function | Transmitted | Recognized | Remarks |
|---|---|---|---|
| Basic channel | 1–16 per side | 1–16 per side | `G_MIDI_CH_R/L`; both sides may share one channel |
| Mode | 3 (omni off, poly) | 1 or 3 per side | `G_OMNI` bit0 R, bit1 L (saved, unlike Rev4); omni/mono/poly messages only act as all-notes-off |
| Note number | 0–127 | 0–127 | the engine decides what is playable |
| Velocity on | 1–127 (VPK-5) | 1–127 | 9n with v = 0 is note off |
| Velocity off | 9n v=0 | ignored | |
| Poly pressure | × | × | |
| Channel pressure | × | ○ | → `eng_ctrl` MIDI CV 3 (stock "Pr" controller) |
| Pitch bend | × | ○ | 14 bit, → `eng_ctrl` CV 6 (R) / CV 4 (L) |
| CC 1 mod wheel | × | ○ | → CV 1 (+X) |
| CC 2 breath | × | ○ | → CV 0 (−X) |
| CC 4 foot | × | ○ | → CV 2 (Fc pedal) |
| CC 64 damper | × | ○ | → `eng_ctrl` 8 (R) / 9 (L), see §3 |
| CC 6/38/98/99/100/101 | ○ (`midi_nrpn_out`) | ○ | NRPN program-byte access, §4 |
| CC 121 reset controllers | × | ○ | bend centre, damper up, CV 0–3 = 0 |
| CC 120, 123–127 | × | ○ | → `eng_all_off` (whatever the receive filters) |
| CC 122 local control | × | × | TODO (Local belongs to UI/engine) |
| Other CC | `midi_cc_out` | × | TODO: per-parameter CC map (generated from the parameter table) |
| Program change | ○ 0–99 | ○ 0–99 | per side → `ui_recall_prog`, or step → `ui_recall_step` (`G_PC_TARGET` = 1); 100–127 ignored |
| SysEx | ○ | ○ | §5 |
| Song position / select | × | × | ignored |
| Tune request $F6 | × | ○ | runs the autotune (stock behaviour), only with SysEx on |
| Clock $F8 | × | ○ | counted in `midi_clock` (16 bit) by the NMI |
| Start / continue / stop | × | ○ | `midi_rtflags` bit0 / bit1 / bit2, set by the NMI, cleared by the consumer (arpeggiator) |
| Active sensing $FE | × | ignored | no timeout |
| System reset $FF | × | **ignored** | the stock ROM rebooted on $FF |

○ = yes, × = no.

## 2. Channel routing

A message is addressed to RIGHT if its channel is `G_MIDI_CH_R` or omni R is on, and to LEFT likewise.
Then the keyboard mode (`PERF+PF_KBMODE`) applies, so that the RIGHT channel behaves like the VPK-5:

| Mode | Notes | Bend, damper | Program change |
|---|---|---|---|
| WHOLE 8 | RIGHT channel → side 0; LEFT channel ignored (no LEFT side; stock) | R channel → both bend CVs (stock) | per side |
| LAYER | RIGHT channel → both sides; LEFT channel → side 1 | R channel → both | per side |
| SPLIT | per side; if one channel addresses both sides, the split point decides (note ≥ `PF_SPLIT` → RIGHT) | per side | per side |

Note off goes to every side the channel addresses (both in SPLIT with a shared channel), so moving the
split point while notes are held cannot leave stuck notes. Program change addresses each matching side
(a shared channel recalls the same number on both).

Calls: `eng_side_on (X side, A note, Y velocity)`, `eng_side_off (X side, A note)`,
`ui_recall_prog (X side, A number)`, `ui_recall_step (A number)`, `eng_all_off`.

## 3. Controllers → `eng_ctrl` (X index, A value 0–127, Y LSB)

Indices 0–7 are the Rev4 MIDI-controller CV bank (`$3080+i`, docs/hardware.md §3.1). The stock mapping
(routine `$9D7C`, table `$9DD6`, presets `$BD21`) is kept; the stock made the CC numbers user-assignable,
NeoV8 fixes them (CC 6, the stock default for −X, is NRPN data entry now).

| X | Destination | Source | Y |
|---|---|---|---|
| 0 | −X | CC 2 | 0 |
| 1 | +X | CC 1 mod wheel | 0 |
| 2 | Fc pedal | CC 4 | 0 |
| 3 | pressure | channel pressure | 0 |
| 4 | pitch bend LEFT | bend on the L channel (and the R channel outside SPLIT) | bend LSB (A = MSB) |
| 5 | (unused, stock: never written) | | |
| 6 | pitch bend RIGHT | bend on the R channel | bend LSB |
| 7 | (unused) | | |
| 8 | damper RIGHT (virtual) | CC 64 | 0 |
| 9 | damper LEFT (virtual) | CC 64 | 0 |

The stock wrote CVs 4–7 through the pitch-bend sensitivity multiplier (`$5A79`) and CVs 0–3 at full
scale; the bend CV is centred at value $40. The stock mapped the damper to RELEASE DEFEAT (pedal up =
release defeated). Indices 8/9 are left to the engine (lead) to implement as it chooses.

## 4. NRPN (receive: `G_RX` bit2; transmit: `midi_nrpn_out`, `G_TX` bit2)

Raw access to the 40 stored program bytes of the edit buffers, for editors/librarians:

| NRPN MSB (CC 99) | NRPN LSB (CC 98) | Data entry |
|---|---|---|
| 0 = RIGHT edit buffer (`EDIT_R`) | program byte 0–39 | value = MSB × 128 + LSB (CC 6, CC 38), clipped to 255 |
| 1 = LEFT edit buffer (`EDIT_L`) | | |

CC 6 writes the byte with LSB = 0, CC 38 writes MSB × 128 + LSB: send CC 6 then CC 38 (8-bit bytes need
both, e.g. $AF = MSB 1, LSB $2F). Each write calls `eng_apply_prog (X side)`. Byte numbers ≥ 40 and
MSB ≥ 2 are ignored; selecting an RPN (CC 101/100) deselects the NRPN. Data increment/decrement
(CC 96/97) are not implemented.

TODO (lead, parameter table generator): a CC map per program parameter (7-bit values), and NRPN numbers
per parameter on top of this raw scheme.

## 5. System exclusive

Received messages are collected in `midi_sxbuf` (bytes between F0 and F7: `[0]` = ID, `[1]` = command
byte, ..., length `midi_sxlen`, at most 144 bytes; longer ones are dropped). A message ends with F7 or
any status byte; real-time bytes may be interleaved. Every ID-3 message needs SysEx enabled
(`G_RX` bit3 = Rev4 "MX"). Data are sent as nibbles, low first, like the stock ROM.

**Controller flag** (bit 6 of the command byte, documented in the Octave-Plateau sheet): messages that
store data are only accepted with the flag set — as in the stock ROM — **or** while the UI's SYSEX RECEIVE
page is open (`midi_rxall` ≠ 0), so a dump sent by another V8 or by NeoV8 itself (flag 0) can be loaded.

**Memory protect**: every battery-RAM write is read back. A refused write aborts the message (nothing
else is written), **no load acknowledge is sent** (a controller waiting for it times out) and
`midi_sxstat` = 1. Edit buffers (126/127) always load. `midi_sxstat` = 0 after a good message, 2 for a
malformed one; `midi_sxcount` counts stored blocks (the receive page shows it).

### 5.1 Legacy Octave-Plateau commands (ID $03), compatible with the stock Rev4

`F0 03 <cmd | $40 if controller>  ... F7`. "flag" = needs the controller flag (or `midi_rxall`).

| Cmd | Message (received) | NeoV8 behaviour |
|---|---|---|
| 0 | `F0 03 00 ss F7` new step | `ui_recall_step (ss)`, ss < 100 |
| 1 | `F0 03 41 00 nn <90 nibbles> F7` program (flag) | nn 0–99: 40 bytes → `$4000+40n`; 126/127: `EDIT_R/L` + `eng_apply_prog`. Machine ID must be 0. Then ack `F0 03 0C nn F7`. Bytes 40–44 are ignored (stock). |
| 2 | `F0 03 42 00 ss <60 nibbles> F7` step (flag) | 24 bytes → `$5000+24s`, ack `F0 03 0C ss F7` |
| 3 | `F0 03 43 dd F7` keyboard on/off (flag) | `midi_kbd_off` = dd & 1 (to be read by the engine/UI) |
| 5 | `F0 03 45 <30 nibbles> F7` user taper (flag) | 15 bytes → `$5A28` (the stock ignored this command) |
| 6 | `F0 03 06 nn F7` request program | sends `F0 03 01 00 nn <45 bytes as 90 nibbles> F7`; bytes 40–44 = `80 80 FF FF FF`. nn 126/127 send the edit buffers. Byte-identical to the stock ROM (tested). |
| 7 | `F0 03 07 ss F7` request step | sends `F0 03 02 00 ss <30 bytes as 60 nibbles> F7`, bytes 24–29 = `$80` |
| 9 | `F0 03 09 F7` return to normal page | forwarded to `ui_sysex_in` |
| 10 | `F0 03 4A 00 nn bb lo hi F7` program byte (flag) | bb < 40 (stock). nn 0–99 → battery program; 126/127 → edit buffer + `eng_apply_prog`. No ack (stock). |
| 11 | `F0 03 4B 00 bb F7` panel button (flag, as the stock code) | `ui_key (A = bb & $3F, X = bb)`. X is the raw 8279 byte: bit 6 = 1 means A440 up, so a plain press is `bb = code + $40`; `bb = code` is A440 + button. |
| 12 | load acknowledge | ignored on receive |
| 4, 8 | | ignored |
| 22 ($16) | `F0 03 56 <114 nibbles> F7` (undocumented stock) (flag) | 57 bytes → `$5A20–$5A58` (velocity clips, user taper, unreferenced 15 B, footswitches, magic `$A5`), **first byte received goes to `$5A58`** (stock order). The stock accepted it without the flag; NeoV8 requires it. |

Transmitted by NeoV8 (helpers for the UI): `midi_sx_event (A cmd, X data or $FF)` sends
`F0 03 cmd [data] F7` when SysEx is on — cmd 0 "new step" (X = step) and cmd 8 "new data available".

### 5.2 NeoV8 extensions (ID $03, commands $20–$3F; the stock ignores commands ≥ $10 except 22)

| Cmd | Message | Behaviour |
|---|---|---|
| $20 | `F0 03 20 F7` identify | reply `F0 03 21 4E 38 <major> <minor> F7` ("N8" + firmware version) |
| $22 | `F0 03 22 mm F7` dump request | starts the bulk dump of parts `mm` (no mm = all), see below |
| $23 | `F0 03 63 <128 nibbles> F7` globals (flag) | 64 bytes → `NV_GLOBALS`, then forwarded to `ui_sysex_in` so the UI reloads them |
| other | | forwarded to `ui_sysex_in` (UI-level messages) |

Universal identity request `F0 7E <any> 06 01 F7` → `F0 7E 7F 06 02 03 4E 38 00 00 <maj> <min> 00 00 F7`.

**Bulk dump** (`midi_dump_all (A = parts)`, also the SYSEX DUMP button): parts bit0 = 100 programs as
legacy cmd 1 (96 B each), bit1 = 100 steps as legacy cmd 2 (66 B each), bit2 = globals cmd $23
(132 B), bit3 = taper/footswitch block as cmd 22 (118 B, last byte first). All parts: 16 450 bytes,
5.3 s. The dump runs in the background from `midi_poll`: one message is queued whenever the TX ring has
140 bytes free, so the panel stays live; `midi_dmask` ≠ 0 while it runs. Messages are sent with the
controller flag 0 (they come from a V8): to load them back, open the SYSEX RECEIVE page (`midi_rxall`)
or have the librarian set bit 6. Round trip tested.

## 6. Driver

- 68B50 at `$3800/$3801` on NMI, 500 kHz ÷ 16 = 31 250 baud, 8N1. Control register `$15` | `$80`
  (RX IRQ) | `$20` (TX IRQ, only while the TX ring is not empty).
- NMI (≈ 110 cycles worst case, measured): interrupts off (releases /IRQ), read status (overrun →
  `midi_hwovr`), RX byte → 256-byte ring, real-time bytes handled here and never queued; one TX byte if
  TDRE; rewrite the control register with the enables (a pending condition gives a fresh edge), loop
  while /IRQ is still asserted.
- RX ring full: the byte is dropped and counted in `midi_rxovr` (never silent). 256 bytes = 82 ms of
  continuous input with the main loop stalled (tested: 70 ms stall, nothing lost).
- `midi_poll` drains the whole ring each main-loop pass (the stock handled one message per pass).
- `midi_tx (A)`: main-loop only, preserves X/Y. If the 256-byte TX ring is full it waits for the NMI;
  after ~1.3 ms without a free slot (4 byte times: the TX is stuck) the byte is dropped and counted in
  `midi_txdrop`.
- TX helpers: `midi_note_out (X side, A note, Y vel, 0 = off)` (`G_TX` bit0), `midi_pc_out (X side, A num)`
  (bit1), `midi_cc_out (X side, A cc, Y value)` and `midi_nrpn_out (X side, A byte, Y value)` (bit2).
  No running status on transmit.

## 7. Public variables (`midi_vars.inc`)

`midi_rxovr`, `midi_hwovr`, `midi_txdrop` (error counters), `midi_clock` (16 bit), `midi_rtflags`,
`midi_kbd_off`, `midi_rxall` (written by the UI), `midi_sxstat`, `midi_sxcount`, `midi_mon` (last channel
message: status, data1, data2 — MIDI monitor), `midi_dmask`/`midi_dnum` (dump progress),
`midi_sxbuf`/`midi_sxlen` (last SysEx, for `ui_sysex_in`).
