// VPK-5 front buttons REV / FWD on the full NeoV8 ROM: read in the keyboard frame header, debounced, sent as
// the panel's REV / FWD, with auto-repeat (stock $FC4F / $FCAC). docs/hardware.md §7.
import { describe, it, expect, beforeAll } from 'vitest';
import { MachineBackend } from '../src/machine/backend';
import { neoInspect } from '../src/machine/neov8-inspect';
import { buildFirmware, loadNeoRomFrom, protoBattery } from './helpers';

const BUILD = 'build-kbd';
let rom: Uint8Array;
beforeAll(() => { buildFirmware(BUILD); rom = loadNeoRomFrom(BUILD); }, 120_000);

function boot(bram = protoBattery(), fwdHeld = false) {
  const b = new MachineBackend('neov8', rom, bram);
  if (fwdHeld) b.kbdButton('fwd', true);
  b.run(300);
  return b;
}
const progR = (b: MachineBackend) => (neoInspect(b.machine) as any).progR as number;
const hold = (b: MachineBackend, id: 'fwd' | 'rev', ms: number) => { b.kbdButton(id, true); b.run(ms); b.kbdButton(id, false); b.run(60); };

describe('NeoV8 ROM: VPK-5 keyboard REV / FWD', () => {
  it('a press steps the focused program like the panel FWD / REV', () => {
    const b = boot();
    const p0 = progR(b);
    hold(b, 'fwd', 60);
    expect(progR(b)).toBe((p0 + 1) % 100);
    hold(b, 'rev', 60);
    hold(b, 'rev', 60);
    expect(progR(b)).toBe((p0 + 99) % 100);
  });

  it('held: repeats after ~0.65 s, then every ~0.15 s', () => {
    const b = boot();
    const p0 = progR(b);
    hold(b, 'fwd', 500);
    expect(progR(b)).toBe((p0 + 1) % 100); // no repeat yet
    const p1 = progR(b);
    hold(b, 'fwd', 1500); // 1 + repeats at 0.65 s, then every 0.154 s: 0.65, 0.80, 0.96, 1.11, 1.27, 1.42
    const n = (progR(b) - p1 + 100) % 100;
    expect(n).toBeGreaterThanOrEqual(6);
    expect(n).toBeLessThanOrEqual(8);
  });

  it('a bounce shorter than one sample (10 ms) is ignored', () => {
    const b = boot();
    const p0 = progR(b);
    for (let i = 0; i < 5; i++) hold(b, 'fwd', 4);
    expect(progR(b)).toBe(p0);
  });

  it('ignored until both buttons have been seen released (keyboard absent reads "pressed")', () => {
    const b = boot(undefined, true);
    const p0 = progR(b);
    b.run(1500);
    expect(progR(b)).toBe(p0);
    b.kbdButton('fwd', false);
    b.run(60);
    hold(b, 'fwd', 60);
    expect(progR(b)).toBe((p0 + 1) % 100);
  });
});
