#!/usr/bin/env node
// Extract the stock Voyetra Eight ROM sets into flat 32K images for $8000-$FFFF.
//   node tools/rom/extract-roms.mjs            -> tools/rom/build/rev4.bin, rev3.bin (+ per-chip .bin)
// Source zips are read with `unzip -p` (no npm deps). Nothing in "Voyetra 8 synths/" is modified.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const srcDir = join(root, 'Voyetra 8 synths');
const outDir = join(here, 'build');

const SETS = {
  rev4: {
    zip: 'Voyetra8_rev4_CSR_ROMS.zip',
    chips: ['V8600040.HEX', 'V8600041.HEX', 'V8600042.HEX', 'V8600043.HEX'],
    format: 'hex',
  },
  rev3: {
    zip: 'Voyetra8_rev3_JST_ROMS.zip',
    chips: ['v8nde0.bin', 'v8nde1.bin', 'v8nde2.bin', 'v8nde3.bin'],
    format: 'bin',
  },
};
const CHIP = 0x2000;

function readMember(zip, name) {
  return execFileSync('unzip', ['-p', zip, name], { maxBuffer: 1 << 20 });
}

function parseIntelHex(text, size) {
  const out = new Uint8Array(size).fill(0xff);
  const seen = new Uint8Array(size);
  let upper = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line[0] !== ':') throw new Error(`bad HEX line: ${line}`);
    const b = Buffer.from(line.slice(1), 'hex');
    const n = b[0], addr = (b[1] << 8) | b[2], type = b[3];
    let sum = 0;
    for (const x of b) sum = (sum + x) & 0xff;
    if (sum !== 0) throw new Error(`HEX checksum error: ${line}`);
    if (type === 0x00) {
      for (let i = 0; i < n; i++) {
        const a = upper + addr + i;
        if (a >= size) throw new Error(`HEX address ${a.toString(16)} out of range`);
        out[a] = b[4 + i];
        seen[a] = 1;
      }
    } else if (type === 0x01) break;
    else if (type === 0x02) upper = ((b[4] << 8) | b[5]) << 4;
    else if (type === 0x04) upper = ((b[4] << 8) | b[5]) << 16;
  }
  const missing = seen.reduce((s, v) => s + (v ? 0 : 1), 0);
  if (missing) console.warn(`  warning: ${missing} bytes not covered by HEX (left $FF)`);
  return out;
}

mkdirSync(outDir, { recursive: true });
for (const [name, set] of Object.entries(SETS)) {
  const zip = join(srcDir, set.zip);
  if (!existsSync(zip)) { console.error(`missing ${zip}`); process.exitCode = 1; continue; }
  const image = new Uint8Array(4 * CHIP);
  set.chips.forEach((chip, i) => {
    const data = readMember(zip, chip);
    const bin = set.format === 'hex' ? parseIntelHex(data.toString('latin1'), CHIP) : new Uint8Array(data);
    if (bin.length !== CHIP) throw new Error(`${chip}: expected ${CHIP} bytes, got ${bin.length}`);
    image.set(bin, i * CHIP);
    writeFileSync(join(outDir, `${name}-${(0x8000 + i * CHIP).toString(16).toUpperCase()}.bin`), bin);
  });
  const file = join(outDir, `${name}.bin`);
  writeFileSync(file, image);
  const v = (a) => image[a - 0x8000] | (image[a - 0x8000 + 1] << 8);
  const sha = createHash('sha1').update(image).digest('hex');
  console.log(`${name}: ${file}  sha1=${sha}  NMI=$${v(0xfffa).toString(16)} RESET=$${v(0xfffc).toString(16)} IRQ=$${v(0xfffe).toString(16)}`);
}
