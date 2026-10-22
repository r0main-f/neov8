# NeoV8 firmware architecture

6502 assembly (ca65/ld65), one translation unit: `src/main.s` includes every module.
Hardware facts: `docs/hardware.md`. Battery-RAM formats: `docs/rev4-ram-map.md`. UI: `docs/ux-spec.md`.
Shared layout and API: `src/api.inc` (only the lead edits it; ask for a change in your report).

## Build

```
npm run fw                       # tables + font + make -C firmware  -> firmware/build/neov8.bin (+ 4 chip images)
make -C firmware BUILD=build-x   # private build dir (parallel work)
make -C firmware MAIN=test/foo_main.s BUILD=build-foo   # module test bench
```

`firmware/gen/rev4-tables.inc` is generated from the user's stock ROM dump (`tools/extract-tables.mjs`) and is
never committed: the response curves of the original (envelope law, rate tables) are Octave-Plateau data.
NeoV8 code is new; it reproduces the original's behaviour, verified in the emulator.

## Rules

1. **Naming.** One translation unit, so every global label is visible everywhere. Public routines and
   variables carry their module prefix: `eng_key_on`, `ui_key`, `midi_poll`, `tune_run`, `panel_text`,
   `cv_write`. Inside a routine use cheap local labels (`@loop`). Wrap bigger private helpers in
   `.proc name ... .endproc` (their labels become `name::x`) or prefix them too (`ui_menu_draw`).
2. **Variables** live in the module's vars file (`eng/vars.inc`, `ui/vars.inc`, `midi_vars.inc`,
   `tune_vars.inc`), included by `main.s` *before any code*, so ca65 knows zero-page symbols when they
   are used (forward references to zero page assemble as absolute and break `(zp),y`). Zero page in use
   (after the ROM review moved the most-accessed variables there, 1 byte saved per access): core 27, eng 102
   (sequencer 21 of them), ui 43, midi 15, tune 21 = 208 of 254 bytes; 46 free. Give new zero page to the
   variables with the most absolute accesses. Page-aligned tables go in segment
   `PAGE` (v8.cfg: first in ROM, no alignment padding inside CODE). BSS areas: `BSS` $0200-$07FF, `BSS2`
   $0A00-$0DFF, `BSS3` $1000-$1FFF (not cleared at reset). Shared temporaries `tmp`, `tmp2`, `ptr`, `ptr2`
   (core) may be used freely between calls; the IRQ saves `tmp`, `tmp2`, `ptr`.
3. **Stubs and benches.** Each module has a logging stub in `src/stubs/`. Build a bench with
   `make BUILD=build-<you> DEFS="-D STUB_ENG -D STUB_UI ..."`: stubbed calls are appended to the call
   log at `$0E00` (`sim/test/helpers.ts: readCallLog`). Never break the default build for long; build
   your bench in your own `BUILD` directory.
4. **The DAC is shared** between the control tick (IRQ) and main-loop writers. Main-loop code that touches
   the DAC, S&H address or `$6xxx` latches brackets the access with `jsr cv_lock` / `jsr cv_unlock`
   (ticks are counted while locked and run at unlock, like the stock ROM's `$07F5` scheme).
5. **Battery RAM**: never write outside the documented formats. Writes may be refused by the hardware
   memory-protect switch: read back to detect it.
6. **Tests**: every module ships tests in `sim/test/fw-<module>.test.ts` running the ROM in the emulator
   (symbols from the ld65 label file: `neoSymbols(build)`). Engine behaviour is checked against the stock
   ROM with the parity harness (`sim/src/machine/parity.ts`).
7. **Timing**: the control tick is 4097 cycles (488 Hz). Keep IRQ work under ~3000 cycles; measure with
   the emulator (`machine.cpu.cycles`).

## Modules

| Prefix | File(s) | Role | Owner |
|---|---|---|---|
| (core) | `main.s` | reset, init order, main loop, IRQ/tick scheduler, test port | lead |
| `panel_` | `panel.asm` | 8279: display image, text/hex helpers, key FIFO + matrix table | lead |
| `adc_` | `adc.asm` | pot ADC (software SAR) | lead |
| `cv_` | `cv.asm` | S&H slot table + refresh, DAC lock | lead |
| `eng_` | `eng/*.asm` | program apply, voices, pitch, envelopes, LFOs, VPK-5, footswitches | lead |
| `tune_` | `tune.asm` | autotune + calibration restore | agent |
| `midi_` | `midi.asm` | 68B50 driver (NMI rings), parser, channel/notes/CC/NRPN/PC, SysEx (legacy + NeoV8), clock | agent |
| `ui_` | `ui/*.asm` | NeoV8 user interface (docs/ux-spec.md, spec/scenarios), store/compare/undo, menu, steps | agent |

## Main loop / tick

```
main:  panel_poll -> ui_key      midi_poll      pot scan -> ui_pot      eng_service
       ui_service                 test port
IRQ:   PIA2 CA1 (SEQ CK IN) / PTM T1 (sequencer tempo) -> seq_cpend, PTM T2 (488 Hz) -> tick counter; the work
       runs with CLI, never re-entered, one sequencer clock event then one tick (stock order):
       seq_clock (eng/seq.asm), eng_tick (CV refresh slice, VPK-5 scan, envelopes / LFOs / glide in 3 phases)
NMI:   midi_nmi (68B50 RX/TX rings only)
```
