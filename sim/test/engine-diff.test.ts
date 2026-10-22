// Differential test: the Rust emulator (engine/crates/v8-machine, via `v8-cli trace`) must behave exactly like
// the TypeScript machine (sim/src/machine) on the same ROM and the same scripted inputs: CPU state and cycles,
// RAM, display, S&H slots, latches, timers, MIDI out at every check, and every analog write with its cycle.
// Skipped when cargo is not installed.
import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Machine } from '../src/machine/machine';
import { attachVcoBank } from '../src/machine/vco';
import { fifoCodes } from '../src/machine/backend';
import type { ButtonId } from '../src/types';
import { ROOT, hasStock, buildFirmware, protoBattery } from './helpers';

const ENGINE = join(ROOT, 'engine');
const OUT = join(ENGINE, 'target', 'diff');
const CARGO_DIRS = [process.env.CARGO_HOME ? join(process.env.CARGO_HOME, 'bin') : '', '/opt/homebrew/opt/rustup/bin', join(process.env.HOME ?? '', '.cargo/bin')];
const cargo = CARGO_DIRS.map((d) => join(d, 'cargo')).find((p) => p && existsSync(p));
const CLI = join(ENGINE, 'target', 'release', 'v8-cli');
const BUILD = 'build-enginediff';

type Step =
  | { op: 'run'; cycles: number } | { op: 'key'; fifo: number } | { op: 'note'; note: number; down: boolean; vel?: number }
  | { op: 'midi'; bytes: number[] } | { op: 'pot'; ch: number; value: number } | { op: 'fsw'; n: number; closed: boolean }
  | { op: 'vpk'; fwd: boolean; rev: boolean } | { op: 'protect'; on: boolean } | { op: 'check' };
interface Script { rom: string; bram?: string; vco_seed?: number; steps: Step[] }

const fnv = (b: Uint8Array) => {
  let h = 0x811c9dc5;
  for (const x of b) { h ^= x; h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
};

/** The TypeScript side of the trace, mirroring engine/crates/v8-cli/src/main.rs step for step. */
function traceTs(s: Script) {
  const m = new Machine(new Uint8Array(readFileSync(s.rom)));
  if (s.bram) m.bram.set(new Uint8Array(readFileSync(s.bram)).subarray(0, 0x2000));
  m.reset();
  if (s.vco_seed !== undefined) attachVcoBank(m, { seed: s.vco_seed });
  const events: unknown[] = [];
  const mm = m as unknown as { sample(slot: number): void; write(a: number, v: number): void; slot: number };
  const sample = mm.sample.bind(m);
  mm.sample = (slot: number) => { sample(slot); events.push([m.cpu.cycles, 'cv', slot, m.cv[slot], m.cvMult[slot]]); };
  const write = mm.write.bind(m);
  mm.write = (a: number, v: number) => {
    if (a >= 0x6000 && a < 0x6800) events.push([m.cpu.cycles, 'latch', a, v, mm.slot]);
    write(a, v);
  };
  const checks: unknown[] = [];
  for (const st of s.steps) {
    switch (st.op) {
      case 'run': m.run(st.cycles); break;
      case 'key': m.kd.pressKey(st.fifo); break;
      case 'note': if (st.down) m.keyDown(st.note, st.vel ?? 100); else m.keyUp(st.note); break;
      case 'midi': m.acia.receive(st.bytes); break;
      case 'pot': m.potByChannel[st.ch & 15] = Math.max(0, Math.min(1023, st.value)); break;
      case 'fsw': m.pia2.inB = st.closed ? m.pia2.inB & ~(1 << st.n) : m.pia2.inB | (1 << st.n); break;
      case 'vpk': m.vpkFwd = st.fwd; m.vpkRev = st.rev; break;
      case 'protect': m.memProtect = st.on; break;
      case 'check': {
        const c = m.ctl;
        checks.push({
          cycles: m.cpu.cycles, pc: m.cpu.pc, a: m.cpu.a, x: m.cpu.x, y: m.cpu.y, s: m.cpu.s, p: m.cpu.p,
          illegal: m.cpu.illegal, irq: m.irqCount, nmi: m.nmiCount,
          ram: fnv(m.ram), bram: fnv(m.bram), display: [...m.kd.display],
          cv: [...m.cv], mult: [...m.cvMult], ctl: [c.ic1, c.ic2, c.ic3, c.ic22, c.ic23],
          xpoint: fnv(c.xpoint), ls670: [...c.ls670],
          ptm: [...m.ptm.counter], ptmFlags: m.ptm.flags, tx: m.acia.txOut.splice(0),
        });
        break;
      }
    }
  }
  return { checks, events };
}

function traceRust(s: Script, name: string) {
  mkdirSync(OUT, { recursive: true });
  const file = join(OUT, `${name}.json`);
  writeFileSync(file, JSON.stringify(s));
  return JSON.parse(execFileSync(CLI, ['trace', file], { maxBuffer: 1 << 30 }).toString());
}

/** First differing check field or event, for a readable failure. */
function firstDiff(a: { checks: any[]; events: any[] }, b: { checks: any[]; events: any[] }): string | null {
  for (let i = 0; i < Math.max(a.checks.length, b.checks.length); i++) {
    const x = a.checks[i], y = b.checks[i];
    if (!x || !y) return `check ${i} missing`;
    for (const k of Object.keys(x)) if (JSON.stringify(x[k]) !== JSON.stringify(y[k])) return `check ${i} (cycle ${x.cycles}) field ${k}: TS ${JSON.stringify(x[k]).slice(0, 200)} / Rust ${JSON.stringify(y[k]).slice(0, 200)}`;
  }
  for (let i = 0; i < Math.max(a.events.length, b.events.length); i++)
    if (JSON.stringify(a.events[i]) !== JSON.stringify(b.events[i])) return `event ${i}: TS ${JSON.stringify(a.events[i])} / Rust ${JSON.stringify(b.events[i])}`;
  return null;
}

const MS = 2000; // cycles per ms
const btn = (id: ButtonId, a440 = false): Step => ({ op: 'key', fifo: fifoCodes()[id]! | (a440 ? 0 : 0x40) });
const run = (ms: number): Step => ({ op: 'run', cycles: ms * MS });
const chk: Step = { op: 'check' };

/** A session touching every input path: boot, buttons, keyboard, MIDI, pots, footswitch, keyboard buttons. */
function session(): Step[] {
  return [
    run(400), chk,
    btn('call_r'), run(40), btn('k1'), run(40), btn('k2'), run(200), chk,
    { op: 'note', note: 60, down: true, vel: 110 }, run(50), { op: 'note', note: 64, down: true, vel: 40 }, run(300), chk,
    { op: 'note', note: 60, down: false }, run(30), { op: 'note', note: 64, down: false }, run(400), chk,
    { op: 'midi', bytes: [0x90, 67, 100, 0x90, 71, 90] }, run(300), { op: 'midi', bytes: [0x80, 67, 0, 0x90, 71, 0] }, run(300), chk,
    { op: 'pot', ch: 1, value: 900 }, run(100), { op: 'pot', ch: 9, value: 100 }, run(200), chk,
    btn('edit'), run(100), btn('fwd'), run(100), btn('arp_up'), run(100), btn('edit'), run(300), chk,
    { op: 'fsw', n: 1, closed: true }, run(50), { op: 'fsw', n: 1, closed: false }, run(100),
    { op: 'vpk', fwd: true, rev: false }, run(80), { op: 'vpk', fwd: false, rev: false }, run(200), chk,
    btn('arp_right'), run(30), { op: 'note', note: 48, down: true }, { op: 'note', note: 55, down: true }, run(800), chk,
  ];
}

let neoRom = '';
const roms: [string, () => string, boolean][] = [
  ['NeoV8', () => neoRom, true],
  ['stock Rev4', () => join(ROOT, 'tools/rom/build/rev4.bin'), hasStock && existsSync(join(ROOT, 'tools/rom/build/rev4.bin'))],
];

describe.skipIf(!cargo)('Rust engine emulator = TypeScript emulator (differential traces)', () => {
  let bram = '';
  beforeAll(() => {
    const env = { ...process.env, PATH: `${join(cargo!, '..')}:${process.env.PATH}` }; // rustup's proxies call rustc
    execFileSync(cargo!, ['build', '--release', '-q', '-p', 'v8-cli'], { cwd: ENGINE, stdio: 'pipe', env });
    buildFirmware(BUILD);
    neoRom = join(ROOT, `firmware/${BUILD}/neov8.bin`);
    mkdirSync(OUT, { recursive: true });
    bram = join(OUT, 'bram.bin');
    const b = protoBattery();
    b[0x1a61] = 0x80; // stock MX on (SysEx)
    writeFileSync(bram, b);
  }, 300_000);

  for (const [name, rom, ok] of roms) {
    it.skipIf(!ok)(`${name}: boot, panel, keyboard, MIDI, pots, footswitch, arpeggiator`, () => {
      const s: Script = { rom: rom(), bram, steps: session() };
      const ts = traceTs(s), rs = traceRust(s, `${name.replace(/\W/g, '')}-session`);
      expect(ts.events.length).toBeGreaterThan(1000);
      expect(firstDiff(ts, rs)).toBeNull();
    }, 120_000);

    it.skipIf(!ok)(`${name}: AUTO TUNE with the seeded VCO model`, () => {
      const s: Script = { rom: rom(), bram, vco_seed: 7, steps: [run(400), chk, btn('autotune'), run(200), chk, run(3000), chk, run(4000), chk] };
      const ts = traceTs(s), rs = traceRust(s, `${name.replace(/\W/g, '')}-tune`);
      expect(firstDiff(ts, rs)).toBeNull();
    }, 180_000);
  }
});
