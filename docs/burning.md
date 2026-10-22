# Putting NeoV8 into a Voyetra Eight (Rev4)

Status: for later (Phase 4). Nothing here modifies the instrument permanently: the stock EPROMs go back in
the same sockets at any time, and NeoV8 keeps the stock battery-RAM formats (programs, steps, autotune,
footswitches) so both firmwares can be swapped freely.

## 1. Before touching anything
1. Back up the memory over MIDI with the stock firmware: in the simulator (`npm run dev`, Chrome or Edge), open
   **Backup / restore your Voyetra**, connect MIDI, pick the ports, **Back up**: it requests the 100 programs and
   100 steps (`F0 03 06 nn F7` / `F0 03 07 nn F7`, MX on) and saves them as a `.syx` file (~15 s). **Restore from
   .syx** writes them back (memory protect off) and reads everything back to check it (~45 s): the stock ROM
   acknowledges loads even under memory protect, and needs a pause after each acknowledge (sim/src/backup.ts).
   Any SysEx librarian works too.
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

**Exact stock response (personal build).** If you own a stock Rev4 ROM, `npm run fw:stock` builds NeoV8 with
the original response curves extracted from your own dump (`Voyetra 8 synths/Voyetra8_rev4_CSR_ROMS.zip`)
instead of NeoV8's: envelope times and velocity feel then match a stock unit exactly. The images land in
`firmware/build-stock/` (same four file names). Keep them to yourself: they contain Octave-Plateau data.
What differs between the two builds is listed in `sim/test/curves.test.ts`: envelopes within one DAC step,
ADSR times within 1 % over the main range (up to ~30 % at a few extreme settings), tempo identical except
6 settable BPMs, velocity curves and factory tapers redesigned.

## 3. Bring-up order (Phase 4 plan)
1. "Hello" image: the splash `nEO 01`, every button shows its code, every knob its value — checks the 8279,
   the matrix, the ADC and the pot mux on your unit.
2. CV/latch test image: service menu exercisers (each slot, each latch) with a meter/scope on the voice cards.
3. Full NeoV8. First run: AUTO TUNE, then compare factory/your patches with the stock ROM by ear (and with a
   recording of both).

Always power off before swapping chips; mind pin 1 orientation; ground yourself.
