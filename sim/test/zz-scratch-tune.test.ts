import { it } from 'vitest';
import { MachineBackend } from '../src/machine/backend';
import { attachVcoBank } from '../src/machine/vco';
import { loadStockRom } from './helpers';

it('stock autotune on the model', () => {
  const bram = new Uint8Array(0x2000);
  bram[0x0fff] = 0xaa;
  for (let i = 0; i < 16; i++) { bram[0x1980 + i] = 0x30; bram[0x19a0 + i] = 0x40; bram[0x19c0 + i] = 0xf8; }
  const b = new MachineBackend('stock', loadStockRom(), bram);
  const m = b.machine;
  const vco = attachVcoBank(m, { seed: Number(process.env.SEED ?? 1) });
  b.run(1500);
  b.button('autotune', true); b.run(20); b.button('autotune', false);
  const t0 = m.cpu.cycles;
  let last = -1;
  for (let k = 0; k < 600; k++) {
    b.run(100);
    const o = m.ram[0x047a];
    if (o !== last) { console.log(`t=${((m.cpu.cycles - t0) / 2e6).toFixed(2)}s osc=${o} F3=${m.ram[0xf3].toString(2)}`); last = o; }
    if (o === 0xff) break;
  }
  const hex = (a: number) => [...m.bram.slice(a - 0x4000, a - 0x4000 + 16)].map((x) => x.toString(16).padStart(2, '0')).join(' ');
  for (const a of [0x5980, 0x5990, 0x59a0, 0x59b0, 0x59c0, 0x59d0]) console.log(a.toString(16), hex(a));
  for (let i = 0; i < 16; i++) {
    const o = vco.osc[i];
    const ofs = (m.bram[0x1980 + i] << 8) | m.bram[0x1990 + i];
    const trim = (m.bram[0x19a0 + i] << 7) | (m.bram[0x19b0 + i] >> 1);
    const tTrim = 8192 * ((1 / o.scale - 1) / 0.25) + 8192;
    const p46 = ((46 << 8) + ofs + (i & 1 ? 0x80 : 0)) / 2;
    const per = vco.periodAt(i, p46, trim);
    const pw = ((0x40 + (m.bram[0x19c0 + i] << 24 >> 24)) << 7) | (m.bram[0x19d0+i] >> 1);
    console.log(i, 'trim', trim, 'ideal', tTrim.toFixed(0), 's', vco.scaleAt(i, trim).toFixed(5), 'per4', (per * 4).toFixed(1), 'duty', vco.dutyAt(i, pw).toFixed(4));
  }
}, 600000);
