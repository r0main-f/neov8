# NeoV8

A new operating system for the **Octave-Plateau Voyetra Eight Rev4** analog polysynth, designed to run on
the unmodified hardware (swap the four 2764 EPROMs) and to keep the original battery-RAM patch layout.
Plus a browser **front-panel simulator** to try the navigation before burning anything.

## Try the simulator

```sh
npm install
npm run dev        # opens http://localhost:5173
npm test           # scenarios + CPU + stock ROM + firmware tests (needs cc65: brew install cc65)
```

* Click buttons, drag knobs up/down (Shift = fine), right-click a button to latch it for chords.
* Computer keys: notes `Z S X D C V G B H N J M ,`, keypad `0-9`, FWD `]`, REV `[`, EDIT `Esc`,
  STORE `Enter`, A440/SHIFT `Shift`, CALL L `Q`, CALL R `W`, CALL STEP `E`.
* "Connect MIDI keyboard" plays it from a real controller (Chrome/Edge, Web MIDI).
* "Load .syx" imports Voyetra SysEx program dumps; SYSEX DUMP (ex-TAPE DUMP) saves one.

## Layout

| Path | What |
|---|---|
| `spec/params.yaml` | the 40-byte program (45 over SysEx), parameter by parameter (single source of truth) |
| `spec/pages.yaml` | what every button/pot does on each edit page (from the Rev4 overlays) |
| `spec/scenarios/` | executable UX spec (YAML), run by `npm test` |
| `docs/ux-spec.md` | the NeoV8 user interface |
| `docs/parameters.md` | generated parameter table |
| `docs/hardware.md`, `docs/rev4-ram-map.md` | reverse-engineering results (Phase 0) |
| `sim/` | Vite + TypeScript simulator: `panel/` (SVG panel, keyboard, inspector), `proto/` (NeoV8 prototype), `machine/` (6502 + chip emulation) |
| `tools/` | generators and ROM tooling |
| `firmware/` | ca65 sources; `make -C firmware` -> `build/neov8.bin` + 4 EPROM images |
| `Voyetra 8 synths/` | source material: manuals, schematics, ROM dumps (not redistributable) |

## Status

* Phase 0 — reverse engineering of the stock Rev4 ROM: **done** (`docs/hardware.md`, `docs/rev4-ram-map.md`,
  `docs/rev4-disasm-notes.md`, `docs/rev4-ui-map.md`; `make -C tools/disasm verify` rebuilds a byte-identical ROM)
* Phase 1 — simulator + NeoV8 navigation prototype: **usable**, awaiting UX review
* Phase 2 — 6502 machine emulator: **the stock Rev4 OS runs and is navigable in the panel** (buttons, display,
  LEDs, pots, VPK-5 keyboard decoded from the ROM)
* Phase 3 — NeoV8 firmware (6502 assembly, ca65): **v0.8** — full OS in the emulator: engine at parity with the
  stock ROM (voices, envelopes, LFOs, mod system, arpeggiator with octave range and as-played order,
  polysequencer), NeoV8 UI (edit pages, SYSTEM menu, store/compare/undo), MIDI (channels, filters, CC map +
  NRPN in and out, legacy and NeoV8 SysEx, clock), autotune — `npm run fw`. The ROM uses NeoV8's own response
  curves (`tools/gen-curves.mjs`), so it builds without the stock ROM and can be shared (GitHub releases).
* Phase 4 — bring-up on real hardware (`docs/burning.md`): not started
