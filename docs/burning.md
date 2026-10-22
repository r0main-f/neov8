# Putting NeoV8 into a Voyetra Eight (Rev4)

Status: for later (Phase 4). Nothing here modifies the instrument permanently: the stock EPROMs go back in
the same sockets at any time, and NeoV8 keeps the stock battery-RAM formats (programs, steps, autotune,
footswitches) so both firmwares can be swapped freely.

## 1. Before touching anything
1. Back up the memory over MIDI with the stock firmware: request every program and step with the legacy
   SysEx (the simulator's Backup tab will do this through Web MIDI; until then any SysEx librarian works:
   program request = `F0 03 46 nn F7`, step request = `F0 03 47 nn F7`, with MX on).
2. Write down the autotune state (run an AUTO TUNE once with the stock ROM so the battery tables are fresh).
3. Note which sockets hold V8600040 ... V8600043 on the CPU card (U-CS4 ... U-CS7).

## 2. Chips
- Four 8 KB parts in the original 28-pin sockets. **2764 / 27C64 EPROM** or **28C64 EEPROM** (handy: rewritable
  in the programmer without UV). On the CPU card pins 1, 26, 27, 28 are tied to +5 V (schematic p.31), so a
  28C64 is held in read mode (/WE high). Access time ≤ 250 ns (the stock parts are 2764-3, 300 ns; 2 MHz bus).
- A single 27C256 does not fit without an adapter (pins 1/26/27 are tied high).

| Socket (CPU card) | Address | Stock chip | NeoV8 image |
|---|---|---|---|
| CS4 | $8000-$9FFF | V8600040 | `firmware/build/neov8-8000.bin` |
| CS5 | $A000-$BFFF | V8600041 | `firmware/build/neov8-A000.bin` |
| CS6 | $C000-$DFFF | V8600042 | `firmware/build/neov8-C000.bin` |
| CS7 | $E000-$FFFF | V8600043 | `firmware/build/neov8-E000.bin` |

Build: `npm run fw` (needs cc65 only), or take the four images from a GitHub release. The images carry
NeoV8's own response curves (`tools/gen-curves.mjs`), no data of the original ROM. The parity tests
(`npm test`) also use your stock ROM dump in `Voyetra 8 synths/` when it is there.

## 3. Bring-up order (Phase 4 plan)
1. "Hello" image: the splash `nEO 01`, every button shows its code, every knob its value — checks the 8279,
   the matrix, the ADC and the pot mux on your unit.
2. CV/latch test image: service menu exercisers (each slot, each latch) with a meter/scope on the voice cards.
3. Full NeoV8. First run: AUTO TUNE, then compare factory/your patches with the stock ROM by ear (and with a
   recording of both).

Always power off before swapping chips; mind pin 1 orientation; ground yourself.
