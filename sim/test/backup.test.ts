// Backup / restore over MIDI (sim/src/backup.ts) against the emulated stock Rev4 ROM and NeoV8.
import { describe, it, expect, beforeAll } from 'vitest';
import { MachineBackend } from '../src/machine/backend';
import { backup, restore, dumpsIn, type Transport } from '../src/backup';
import { hasStock, loadStockRom, buildFirmware, loadNeoRomFrom } from './helpers';

const BUILD = 'build-backup';
const PROG = (n: number) => 40 * n;
const STEP = (n: number) => 0x1000 + 24 * n;
const MX = 0x1a61; // stock MIDI MISC switch (bit 7): SysEx on

function bramFilled(seed: number, mx = true) {
  const b = new Uint8Array(0x2000);
  b[0x0fff] = 0xaa;
  for (let n = 0; n < 100; n++) for (let i = 0; i < 40; i++) b[PROG(n) + i] = (n * 7 + i * 13 + seed) & 0xff;
  for (let n = 0; n < 100; n++) for (let i = 0; i < 24; i++) b[STEP(n) + i] = (n * 3 + i * 5 + seed) & 0x7f;
  if (mx) b[MX] = 0x80;
  return b;
}
const machineTransport = (m: MachineBackend): Transport => ({
  send: (bytes) => m.midiIn(bytes),
  poll: async (ms) => { m.run(ms); return m.drainMidiOut(); },
});
const programs = (b: Uint8Array) => [...b.slice(0, 4000)];
const steps = (b: Uint8Array) => [...b.slice(0x1000, 0x1000 + 2400)];

let neoRom: Uint8Array;
beforeAll(() => { buildFirmware(BUILD); neoRom = loadNeoRomFrom(BUILD); }, 120_000);

const roms: [string, () => Uint8Array, boolean][] = [
  ['stock Rev4 ROM', () => loadStockRom(), hasStock],
  ['NeoV8', () => neoRom, true],
];

for (const [name, rom, ok] of roms) {
  describe.skipIf(!ok)(`backup / restore over MIDI: ${name}`, () => {
    const boot = (bram: Uint8Array) => { const m = new MachineBackend(name, rom(), bram); m.run(1500); m.drainMidiOut(); return m; };

    it('backs up the 100 programs and 100 steps, and restores them onto another memory', async () => {
      const src = boot(bramFilled(1));
      let last = 0;
      const res = await backup(machineTransport(src), { onProgress: (p) => (last = p.done) });
      expect(res.missing).toEqual([]);
      expect([res.programs, res.steps, last]).toEqual([100, 100, 200]);
      const file = res.messages.flat();
      expect(file.length).toBe(100 * 96 + 100 * 66);
      expect(dumpsIn(file).length).toBe(200);

      const dst = boot(bramFilled(99));
      expect(programs(dst.machine.bram)).not.toEqual(programs(src.machine.bram));
      const r = await restore(machineTransport(dst), file);
      expect(r.mismatched).toEqual([]);
      expect([r.acknowledged, r.verified]).toEqual([200, 200]);
      expect(programs(dst.machine.bram)).toEqual(programs(src.machine.bram));
      expect(steps(dst.machine.bram)).toEqual(steps(src.machine.bram));
    }, 120_000);

    it('memory protect on: the restore stops with a clear message, nothing is written', async () => {
      const src = boot(bramFilled(1));
      const file = (await backup(machineTransport(src), { steps: false })).messages.flat();
      const dst = boot(bramFilled(99));
      dst.setProtect(true);
      const before = programs(dst.machine.bram);
      await expect(restore(machineTransport(dst), file, { timeoutMs: 300 })).rejects.toThrow(/memory protect/);
      expect(programs(dst.machine.bram)).toEqual(before);
    }, 60_000);
  });
}

describe.skipIf(!hasStock)('backup over MIDI: stock ROM with MX off', () => {
  it('no answer: the backup says to turn SysEx on', async () => {
    const m = new MachineBackend('stock', loadStockRom(), bramFilled(1, false));
    m.run(1500);
    await expect(backup(machineTransport(m), { timeoutMs: 150 })).rejects.toThrow(/MX/);
  }, 30_000);
});
