// Shared test helpers.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseIntelHex } from '../src/machine/machine';
import { demoBank } from '../src/proto/patch';

export const ROOT = join(__dirname, '../..');
export const STOCK_ZIP = join(ROOT, 'Voyetra 8 synths/Voyetra8_rev4_CSR_ROMS.zip');
export const NEOV8_BIN = join(ROOT, 'firmware/build/neov8.bin');
export const hasStock = existsSync(STOCK_ZIP);
export const hasNeo = existsSync(NEOV8_BIN);

/** The user's stock Rev4 ROM image ($8000-$FFFF), read from the dump zip. */
export function loadStockRom(): Uint8Array {
  const rom = new Uint8Array(0x8000).fill(0xff);
  ['V8600040', 'V8600041', 'V8600042', 'V8600043'].forEach((n, i) => {
    const hex = execFileSync('unzip', ['-p', STOCK_ZIP, `${n}.HEX`], { encoding: 'utf8' });
    parseIntelHex(hex, rom, i * 0x2000);
  });
  return rom;
}
export const loadNeoRom = () => new Uint8Array(readFileSync(NEOV8_BIN));

/** Symbol table of the NeoV8 build (ld65 -Ln label file): name -> address. */
export function neoSymbols(build = 'build'): Record<string, number> {
  const out: Record<string, number> = {};
  const file = join(ROOT, `firmware/${build}/neov8.lbl`);
  if (!existsSync(file)) return out;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = /^al ([0-9A-F]+) \.(\S+)/i.exec(line);
    if (m) out[m[2]] = parseInt(m[1], 16);
  }
  return out;
}

/** NeoV8 ROM from a given firmware build directory (default "build"). */
export const loadNeoRomFrom = (build = 'build') => new Uint8Array(readFileSync(join(ROOT, `firmware/${build}/neov8.bin`)));

/** Entries of the stub call log (firmware/src/stubs/log.inc): [{id, a, x, y}] in call order (last 64). */
export function readCallLog(ram: Uint8Array): { id: number; a: number; x: number; y: number }[] {
  const n = ram[0x0fe8];
  const out = [];
  const first = Math.max(0, n - 64);
  for (let i = first; i < n; i++) {
    const o = 0x0e00 + (i & 63) * 4;
    out.push({ id: ram[o], a: ram[o + 1], x: ram[o + 2], y: ram[o + 3] });
  }
  return out;
}

/** Build the firmware into firmware/<build> with optional ca65 defines (e.g. ['STUB_UI']). */
export function buildFirmware(build = 'build', stubs: string[] = []) {
  execFileSync('make', ['-C', join(ROOT, 'firmware'), `BUILD=${build}`, `DEFS=${stubs.map((s) => `-D ${s}`).join(' ')}`], { stdio: 'pipe' });
}

/** NeoV8 test-port command (firmware/src/api.inc TP_*): waits until the firmware has executed it. */
export function tp(b: { machine: { ram: Uint8Array }; run(ms: number): void }, cmd: number, a = 0, x = 0, y = 0) {
  const TP = 0x0ff0;
  const ram = b.machine.ram;
  const done = ram[TP + 4];
  ram[TP + 1] = a; ram[TP + 2] = x; ram[TP + 3] = y; ram[TP] = cmd;
  for (let i = 0; i < 400 && ram[TP + 4] === done; i++) b.run(5);
  if (ram[TP + 4] === done) throw new Error(`test port command ${cmd} not executed`);
  b.run(20);
}

/** Stock 24-byte step (docs/rev4-ram-map.md §4) for the prototype's defaultPerf, as firmware/src/ui/store.asm packs it. */
function defaultStep(progR: number, progL: number): number[] {
  const s = new Array(24).fill(0);
  s[0] = 0x80 | 2; // WHOLE 8, arp mode R = up
  s[1] = progR;
  s[2] = progL;
  s[3] = 1 << 6; // octave R normal
  s[4] = (1 << 6) | (60 - 12); // octave L normal, split C4 (key index = note - 12)
  s[5] = 64; // arp speed
  s[20] = 2 ^ 0x30; // arp mode L = up (byte stored XOR $30)
  return s;
}

/** Battery RAM image matching the prototype's power-on state (programs = demoBank, L 00 / R 01). */
export function protoBattery(): Uint8Array {
  const b = new Uint8Array(0x2000);
  demoBank().forEach((p, n) => b.set(p, 40 * n));
  b[0x0fff] = 0xaa;
  for (let n = 0; n < 100; n++) b.set(defaultStep(n === 0 ? 1 : 0, 0), 0x1000 + 24 * n);
  // footswitch records as the prototype's defaults (fsw [34, 35, 52, none], toggle on #2), stock magic
  b.set([0x80, 34, 0xff, 0x80, 35, 0xff, 0x00, 52, 0xff, 0x80, 0xff, 0xff, 0x00, 0x12, 0xff, 0x00, 0x13, 0xff], 0x1a46);
  b[0x1a58] = 0xa5;
  return b;
}
