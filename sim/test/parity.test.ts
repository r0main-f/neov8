// Parity: stock Rev4 ROM vs NeoV8 firmware on identical emulated hardware.
// The harness itself is validated by comparing the stock ROM with itself.
import { describe, it, expect } from 'vitest';
import { MachineBackend } from '../src/machine/backend';
import { snapshot, diff, randomProgram, bramWith } from '../src/machine/parity';
import { loadStockRom, hasStock } from './helpers';
import type { ButtonId } from '../src/types';

function stockWith(bram: Uint8Array) {
  const b = new MachineBackend('stock', loadStockRom(), bram);
  b.run(1000);
  return b;
}
function press(b: MachineBackend, ...ids: Parameters<MachineBackend['button']>[0][]) {
  for (const id of ids) { b.button(id, true); b.run(30); b.button(id, false); b.run(50); }
}
const digits = (n: number) => [`k${Math.floor(n / 10)}`, `k${n % 10}`] as ButtonId[];

describe.skipIf(!hasStock)('parity harness', () => {
  it('stock vs stock: identical after the same program recall', () => {
    const bram = bramWith(Array.from({ length: 100 }, (_, i) => randomProgram(i + 1)));
    const a = stockWith(bram);
    const b = stockWith(bram);
    press(a, 'call_r', ...digits(17));
    press(b, 'call_r', ...digits(17));
    a.run(300); b.run(300);
    expect(diff(snapshot(a.machine), snapshot(b.machine))).toEqual([]);
  });

  it('detects a difference (different programs)', () => {
    const bram = bramWith(Array.from({ length: 100 }, (_, i) => randomProgram(i + 1)));
    const a = stockWith(bram);
    const b = stockWith(bram);
    press(a, 'call_r', ...digits(3));
    press(b, 'call_r', ...digits(4));
    a.run(300); b.run(300);
    expect(diff(snapshot(a.machine), snapshot(b.machine)).length).toBeGreaterThan(5);
  });
});
