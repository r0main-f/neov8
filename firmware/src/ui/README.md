# NeoV8 UI module (`ui_`)

Behaviour reference: `sim/src/proto/proto.ts` (+ `menu.ts`, `state.ts`), `docs/ux-spec.md`, `spec/scenarios/*.yaml`.
Tests: `sim/test/fw-ui.test.ts`. It runs every scenario on the ROM and runs a seeded differential fuzz
(prototype vs ROM). Run more seeds with `NEOV8_FUZZ_SEEDS=40 npx vitest run sim/test/fw-ui.test.ts`.

| File | Content |
|---|---|
| `ui.asm` | entry points, key dispatch, EDIT button, timers, helpers (param get/set, arithmetic, text builder), weak links |
| `play.asm` | Normal page: recall, performance buttons, trimmers (Trim / Direct), ARP SPEED, AUTO TUNE, SysEx dump/receive |
| `edit.asm` | EDIT pages: bindings, keypad, nudge, pot modes (pickup / jump / relative, coarse12 / fine12 / fine) |
| `menu.asm` | SYSTEM menu (table `ui_menu_tab`) |
| `store.asm` | programs/steps in battery RAM, store flow, compare, undo, memory-protect probe, step pack/unpack, NV init |
| `seq.asm` | polysequencer page (A440+ARP RIGHT): switches → `seq_*` (api.inc contract), tempo / beat / quantize / song fields, A440+ARP PAUSE start/stop, erase confirm, debug block `$0FE0-$0FE7` + `$0FEC-$0FEF` |
| `render.asm` | display + LEDs + blink → `panel_disp`, debug block |
| `tables.asm` | LED map, texts, step-format tables, global defaults |
| `gen_tables.inc` | **generated** by `tools/gen-ui-tables.mjs` from `spec/params.yaml` + `spec/pages.yaml` (through `sim/src/gen/params.ts`) and `NULL_PROGRAM_IMAGE` |

Regenerate the tables after a spec change with `npm run gen && node tools/gen-ui-tables.mjs`.

## Timing

Everything uses the core `ticks` counter (2.0485 ms). The timers are:

- number entry: 4 s
- message: 1.3 s
- value-on-touch: `G_DISPHOLD` × 100 ms
- EDIT→digit page jump window: 0.6 s

Blinking has a 500 ms period and is on 60 % of the time. `ui_service` renders after every event, on every blink
phase change, and every ~130 ms (to follow changes made by MIDI). It flushes only when `panel_disp` changed.
Display byte 9 bit 2 (tempo LED) belongs to the arp clock: the UI preserves it.

## Hardware adaptations (vs the prototype)

- **No key-up events.** EDIT acts when it is pressed. Two ways to jump to a page:
  - **EDIT, then a digit within 0.6 s** jumps to page 1-6. This stands in for the prototype's EDIT+digit chord, so
    the scenarios are unchanged.
  - **A440+digit in EDIT** also jumps to page 1-6. This is a deterministic alternative.

  For the split point, use the stock gesture: hold a key, then press SPLIT. The UI calls `eng_lowest_held`.
  Holding A440 to audition the store destination is not possible.
- **Memory protect** cannot be read. Before a store or an undo, the UI flips the first byte of the destination,
  reads it back and restores it. If the write did not take, it shows `PrOtEC`.
- **Only 24 buttons have LEDs.** EDIT, STORE, TAPE LOAD and TAPE DUMP are assumed to be the 4 bits the stock OS
  never drives (`$6A-$6D`). This is **to check on the unit** (`tables.asm` `LEDL_*`,
  `neov8-inspect.ts NEOV8_EXTRA_LEDS`).
- **The A440 key** is code `$2A` (if it also closes the matrix). It toggles the reference tone, as A440+AUTO TUNE
  does. The tone is driven on PTM T3 like the stock ROM's `$F1B2`, and needs CR2 bit 0 = 0.

## Storage

- **Programs:** 40 B at `$4000+40n`.
- **Steps:** stock 24-byte format at `$5000+24n` (`docs/rev4-ram-map.md` §4).
  - The split point is stored as a key index = MIDI note − 12. The stock default `$24` gives C3 (48), "second C
    from the left". **Check this.**
  - VCA velocity (byte 20) is taken from the edit buffers when the step is stored, as the stock ROM does.
  - Not in the stock step, so kept in a NeoV8 per-step byte at `NV_END` (`$5C90 + n`, 100 B, **requested in
    api.inc**):
    - bits 1-0: arp octaves R − 1
    - bits 3-2: arp octaves L − 1
    - bits 5-4: HOLD (L, R)
    - bit 6: ARP PAUSE
- **Globals:** `NV_GLOBALS`. They are initialised on first boot (no `"N8"` at `NV_MAGIC`), together with
  `NV_VERSION = 1`, an empty undo slot (`NV_UNDO = $FF`) and a zeroed step extension. Programs and steps are not
  touched.
- **Menu 99 (reset):** writes the defaults to `NV_GLOBALS` 0-15. `G_LAST_STEP`, the footswitch records and the
  voice mask are kept.
- **Footswitches:** menus 40-47 edit the stock records `BRAM_FSW` 0-3. The core's `fsw.asm` reads them.
  - 40-43 set `code1`. The value is 0-98; **99 = none** (`$FF`). `code2` is left as it is.
  - 44-47 set mode bit 7. `no` = momentary (both edges), `to` = toggle.
- **Voice disable (menu 90):** `PF_VOICEMASK`, which is step byte 22, as on Rev4. The prototype keeps it as a global.
- **Power-on:** recall `G_LAST_STEP`, or step 00 if `G_POWERON` = 1. This loads both programs into the edit
  buffers, calls `eng_apply_prog` for R and L, then `eng_apply_perf`.

## UIDBG debug block (`$0FC0-$0FDF`)

| Offset | Content |
|---|---|
| +0 | mode: 0 play, 1 edit, 2 menu, 3 tune, 4 confirm, 5 receive |
| +1 | edit page 0-5 (1 2 A B C D) |
| +2 | edited side (0 R, 1 L) |
| +3 | focus (0 R, 1 L, 2 STEP) |
| +4 | flags (see the list below this table) |
| +5 | menu item number |
| +6 | confirm: 0 SysEx dump, 1 undo |
| +7 | blinking digits (bit i = digit i, 0 = LEFT tens … 5 = STEP units) |
| +8 | decimal points |
| +9 | blinking decimal points |
| +10..+15 | the 6 digit segment bytes **before blinking** (8279 bit order: 7=a 6=c 5=f 4=b 3=e 2=d 1=g 0=dp) |
| +16..+19 | LED bytes before blinking (display RAM 0, 3, 6, 9) |
| +20..+23 | LED blink masks |
| +24 | last button code |
| +25 | store destination |
| +26 | SysEx blocks received on the receive page |
| +27 | last touched param ($FF none) |
| +28 | store: bit0 side L, bit1 step |
| +29 | entry target ($FF none; 0 R, 1 L, 2 STEP, 3 menu) |
| +30 | keypad selectors: pwm in bits 0-3, lfo in bits 4-7 |
| +31 | render counter |

Flags at +4:

- b0: edited R
- b1: edited L
- b2: store armed
- b3: entry pending
- b4: comparing
- b5: compare side is L
- b6: A440 tone
- b7: mute

`sim/src/machine/neov8-inspect.ts` turns this block, `PERF` and the battery into the prototype's `inspect()` fields.
`neoPanelCheck` verifies that the 8279 display RAM equals the image with the blink applied.

## API used

- **Engine:** `eng_apply_prog` (X side), `eng_apply_perf`, `eng_compare` (X side, A), `eng_lowest_held` (A = note
  or $FF; weak stub returns $FF), `eng_mute` (A = 1/0; weak stub, **requested**).
- **Core:** `autotune` (tune + MIDI flush + all notes off), `panel_*`, `font`.
- **MIDI:**
  - `midi_dump_all` (A = 1: programs).
  - `midi_rxall`, `midi_sxcount` and `midi_sxstat` on the SYSEX RECEIVE page.
  - `midi_mon` for menu 94.
  - In a `STUB_MIDI` build these are weak-defined by the UI.
- **Called by others:** `ui_init`, `ui_key`, `ui_pot`, `ui_service`, `ui_recall_prog` (X side, A num),
  `ui_recall_step` (A), `ui_sysex_in` (redraw).
