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
  curves (`tools/gen-curves.mjs`) except the ADSR rate table, which is the original one so envelope times
  match a stock unit; it builds without the stock ROM (GitHub releases).
* Phase 4 — bring-up on real hardware (`docs/burning.md`): not started

## Sound engine (in progress)

`engine/` is a Rust workspace for a native Voyetra Eight: an emulator of the CPU card that runs the real ROMs
(`v8-machine`, a behaviour-identical port of `sim/src/machine`, checked by `sim/test/engine-diff.test.ts`) and a
model of the analog voice cards, modulation banks included (`v8-voice`, `docs/audio-model.md`; what is settled and
what still needs a real unit: `docs/audio-validation.md`).
Needs Rust (`brew install rustup && rustup default stable`, with `$(brew --prefix rustup)/bin` on the PATH):
`npm run engine:build`, `npm run engine:test`.

* **Standalone app:** `npm run app` builds the NeoV8 ROM and starts NeoV8 with a front panel drawn after a real
  Rev4 module (displays, LEDs, every button, the trimmers, arpeggiator speed, MASTER TUNE / VOLUME, POWER), the
  joystick / pressure / Fc-pedal controls and an on-screen keyboard. Knobs turn by dragging up or down
  (double-click centres a trimmer); A440 latches as the shift key for the next button. It uses the first MIDI
  input it finds (a USB keyboard or interface); `npm run app -- --midi-input ""` lists the ports,
  `--midi-output <name>` sends the instrument's MIDI out, `--help` shows the audio options.
* **Sound banks:** LOAD BANK (below the panel) or `npm run app -- --bank <file>` loads a SysEx dump (`.syx`,
  Rev4 / NeoV8 program and step dumps), a cassette recording (`.wav`, decoded like the ROM's tape reader) or an
  8 KB battery image (`.bin`), then power-cycles the instrument; the tuning is kept. On a first start (fresh
  battery RAM) the app loads the factory cassette recording from `Voyetra 8 synths/` when it is there (not
  distributed), otherwise an init bank, and runs AUTO TUNE. Programs, steps and tuning are kept in
  `~/Library/Application Support/NeoV8/battery.bin` (delete it to start fresh).
* **Plugin (CLAP, VST3):** `npm run plugin` builds `NeoV8.clap` and `NeoV8.vst3` (nih-plug's bundler,
  `cd engine && cargo xtask bundle v8-plugin --release`, output in `engine/target/bundled/`) and installs them in
  `~/Library/Audio/Plug-Ins/CLAP` and `~/Library/Audio/Plug-Ins/VST3`. Same panel as the app; each instance is a
  whole instrument whose battery RAM (programs, steps, tuning) is saved with the DAW project, and a new instance
  starts like the app's first start. Notes on MIDI channel 1 reach the RIGHT side (both sides in LAYER and WHOLE 8),
  channel 2 the LEFT side. MASTER volume / tune, joystick X, pressure and Fc pedal are automatable. The bundles are
  ad-hoc signed for this Mac only (no notarisation); AU (Logic) is not built.
* **CPU:** one instrument (emulated CPU + 8 voices) takes about 2 % of one core silent and 3.6 % with 8 notes held
  (Apple Silicon; `cargo run --release -p v8-core --example cpu`). The panel redraws only when a display, LED or
  parameter changes, or on input, thanks to small patches to two GUI crates (`engine/vendor/*/NEOV8.md`); with
  the window open it adds about 6 %, mostly one redraw per blink of the tempo LED.
* `engine/target/release/v8-cli render <script.json> <out.wav>` plays a scripted session (boot, AUTO TUNE, panel,
  notes, MIDI) on either ROM and writes the audio.

## License

Copyright (C) 2026 r0main-f and the NeoV8 contributors.

* **Firmware, simulator, tools and specs** (`firmware/`, `sim/`, `tools/`, `spec/`, build files): GNU General
  Public License v3.0 or later ([`LICENSE`](LICENSE)). You may use, modify and burn NeoV8; if you distribute a
  modified version (source or ROM images), you must share its source under the same license.
* **Documentation** (`docs/`): Creative Commons Attribution-ShareAlike 4.0 International
  ([`docs/LICENSE`](docs/LICENSE)).

NeoV8 is an independent project, not affiliated with or endorsed by Octave-Plateau Electronics or its
successors. "Voyetra" and "Octave-Plateau" are names of their respective owners, used here only to say which
instrument this firmware is for. The original Rev4 firmware, manuals and ROM dumps are not part of this
repository and are not covered by these licenses: the release ROM images use NeoV8's own response curves
(`tools/gen-curves.mjs`), with one exception: the 128-entry ADSR rate table (256 bytes) is copied from the
original Rev4 ROM so envelope times match a stock unit. It is a table of numbers that sets envelope speeds,
kept here for interoperability with existing patches; it is excluded from the licenses above. `npm run fw:stock` builds a personal image from your own stock ROM dump, which you
must not distribute.

