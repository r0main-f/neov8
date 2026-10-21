// NeoV8 MIDI module (firmware/src/midi.asm) on the bench build: real core + midi, logging stubs for eng/ui/tune.
// Spec: docs/midi-implementation.md.
import { describe, it, expect, beforeAll } from 'vitest';
import { MachineBackend } from '../src/machine/backend';
import { encodeProgramDump, SYSEX_PROGRAM_TAIL } from '../src/proto/patch';
import { buildFirmware, loadNeoRomFrom, loadStockRom, hasStock, neoSymbols, readCallLog } from './helpers';

const BUILD = 'build-midi';
// stub call-log ids (firmware/src/stubs/*.asm)
const ENG_APPLY_PROG = 0x11, ENG_SIDE_ON = 0x15, ENG_SIDE_OFF = 0x16, ENG_ALL_OFF = 0x17, ENG_CTRL = 0x18;
const UI_RECALL_PROG = 0x20, UI_RECALL_STEP = 0x21, UI_SYSEX_IN = 0x22, UI_KEY = 0x23, TUNE_RUN = 0x40;
const MIDI_IDS = new Set([ENG_APPLY_PROG, ENG_SIDE_ON, ENG_SIDE_OFF, ENG_ALL_OFF, ENG_CTRL, UI_RECALL_PROG, UI_RECALL_STEP, UI_SYSEX_IN, UI_KEY, TUNE_RUN]);

// battery RAM offsets ($4000 base)
const PROG = (n: number) => 40 * n;
const STEP = (n: number) => 0x1000 + 24 * n;
const NV_GLOBALS = 0x1a80;
const G = { CH_R: 0, CH_L: 1, OMNI: 2, RX: 3, TX: 4, PC_TARGET: 5 };
const PERF = 0x0880, PF_KBMODE = 3, PF_SPLIT = 4;
const EDIT_R = 0x0800, EDIT_L = 0x0840;

let sym: Record<string, number> = {};

interface Opts { chR?: number; chL?: number; omni?: number; rx?: number; tx?: number; pcTarget?: number; kbmode?: number }

function boot(o: Opts = {}) {
  const bram = new Uint8Array(0x2000);
  bram[0x0fff] = 0xaa;
  for (let n = 0; n < 100; n++) for (let i = 0; i < 40; i++) bram[PROG(n) + i] = (n * 7 + i) & 0xff;
  for (let n = 0; n < 100; n++) for (let i = 0; i < 24; i++) bram[STEP(n) + i] = (n * 3 + i * 5) & 0xff;
  const g = NV_GLOBALS;
  bram[g + G.CH_R] = o.chR ?? 0;
  bram[g + G.CH_L] = o.chL ?? 1;
  bram[g + G.OMNI] = o.omni ?? 0;
  bram[g + G.RX] = o.rx ?? 0x1f;
  bram[g + G.TX] = o.tx ?? 0x07;
  bram[g + G.PC_TARGET] = o.pcTarget ?? 0;
  const b = new MachineBackend('neov8-midi', loadNeoRomFrom(BUILD), bram);
  b.run(30);
  b.machine.ram[PERF + PF_KBMODE] = o.kbmode ?? 1; // SPLIT by default: sides are independent
  b.machine.ram[PERF + PF_SPLIT] = 60;
  clearLog(b);
  return b;
}
const clearLog = (b: MachineBackend) => { b.machine.ram[0x0fe8] = 0; };
const calls = (b: MachineBackend) => readCallLog(b.machine.ram).filter((c) => MIDI_IDS.has(c.id));
const send = (b: MachineBackend, bytes: number[], ms?: number) => {
  b.midiIn(bytes);
  b.run(ms ?? Math.ceil(bytes.length * 0.32) + 5);
};
const v8 = (b: MachineBackend, name: string) => b.machine.ram[sym[name]];
const nib = (bytes: number[]) => bytes.flatMap((x) => [x & 15, x >> 4]);

/** Runs `ms` in 2 ms slices and returns every call-log entry written meanwhile (the log ring holds 64). */
function runCollect(b: MachineBackend, ms: number) {
  const ram = b.machine.ram;
  const out: { id: number; a: number; x: number; y: number }[] = [];
  let last = ram[0x0fe8];
  for (let t = 0; t < ms; t += 2) {
    b.run(2);
    const n = ram[0x0fe8];
    const d = (n - last) & 0xff;
    if (d >= 64) throw new Error('call log lapped');
    for (let k = 0; k < d; k++) {
      const o = 0x0e00 + ((last + k) & 63) * 4;
      out.push({ id: ram[o], a: ram[o + 1], x: ram[o + 2], y: ram[o + 3] });
    }
    last = n;
  }
  return out;
}

beforeAll(() => {
  buildFirmware(BUILD, ['STUB_ENG', 'STUB_UI', 'STUB_TUNE']);
  sym = neoSymbols(BUILD);
}, 60_000);

describe('MIDI driver and parser', () => {
  it('routes notes per channel, with running status and velocity 0 = off', () => {
    const b = boot();
    send(b, [0x90, 60, 100, 62, 90, 60, 0, 0x91, 50, 70, 0x80, 62, 64, 0x81, 50, 0]);
    expect(calls(b)).toEqual([
      { id: ENG_SIDE_ON, x: 0, a: 60, y: 100 },
      { id: ENG_SIDE_ON, x: 0, a: 62, y: 90 },
      { id: ENG_SIDE_OFF, x: 0, a: 60, y: 0 },
      { id: ENG_SIDE_ON, x: 1, a: 50, y: 70 },
      { id: ENG_SIDE_OFF, x: 0, a: 62, y: 64 },
      { id: ENG_SIDE_OFF, x: 1, a: 50, y: 0 },
    ]);
    expect([...b.machine.ram.slice(sym.midi_mon, sym.midi_mon + 3)]).toEqual([0x81, 50, 0]);
  });

  it('ignores other channels; omni takes every channel', () => {
    const b = boot();
    send(b, [0x95, 60, 100]);
    expect(calls(b)).toEqual([]);
    const o = boot({ omni: 2 });
    send(o, [0x95, 60, 100]);
    expect(calls(o)).toEqual([{ id: ENG_SIDE_ON, x: 1, a: 60, y: 100 }]);
  });

  it('same channel for both sides: split point in SPLIT, both sides in LAYER, RIGHT only in WHOLE', () => {
    const s = boot({ chR: 2, chL: 2, kbmode: 1 });
    send(s, [0x92, 72, 100, 48, 100, 0x82, 72, 0]);
    expect(calls(s).map((c) => [c.id, c.x, c.a])).toEqual([[ENG_SIDE_ON, 0, 72], [ENG_SIDE_ON, 1, 48], [ENG_SIDE_OFF, 0, 72], [ENG_SIDE_OFF, 1, 72]]);
    const l = boot({ kbmode: 2 });
    send(l, [0x90, 64, 80, 0x91, 40, 80]);
    expect(calls(l).map((c) => [c.id, c.x, c.a])).toEqual([[ENG_SIDE_ON, 0, 64], [ENG_SIDE_ON, 1, 64], [ENG_SIDE_ON, 1, 40]]);
    const w = boot({ kbmode: 0 });
    send(w, [0x90, 64, 80, 0x91, 40, 80]);
    expect(calls(w).map((c) => [c.id, c.x, c.a])).toEqual([[ENG_SIDE_ON, 0, 64]]);
  });

  it('applies the receive filters', () => {
    const b = boot({ rx: 0x00 });
    send(b, [0x90, 60, 100, 0xc0, 5, 0xe0, 0, 0x50, 0xb0, 1, 99, 0xd0, 40]);
    expect(calls(b)).toEqual([]);
  });

  it('program change: per side, or a step when PC targets steps; 100+ ignored', () => {
    const b = boot();
    send(b, [0xc0, 12, 0xc1, 34, 0xc0, 100]);
    expect(calls(b).map((c) => [c.id, c.x, c.a])).toEqual([[UI_RECALL_PROG, 0, 12], [UI_RECALL_PROG, 1, 34]]);
    const s = boot({ pcTarget: 1 });
    send(s, [0xc1, 42]);
    expect(calls(s).map((c) => [c.id, c.a])).toEqual([[UI_RECALL_STEP, 42]]);
  });

  it('all notes off / all sound off / omni-mode messages -> eng_all_off', () => {
    const b = boot();
    send(b, [0xb0, 123, 0, 0xb1, 120, 0, 0xb0, 125, 0]);
    expect(calls(b).map((c) => c.id)).toEqual([ENG_ALL_OFF, ENG_ALL_OFF, ENG_ALL_OFF]);
  });

  it('controllers go to the MIDI CV bank through eng_ctrl', () => {
    const b = boot();
    send(b, [0xe0, 0x11, 0x50, 0xe1, 0, 0x20, 0xb0, 1, 100, 2, 50, 4, 30, 64, 127, 0xd1, 77]);
    expect(calls(b).map((c) => [c.x, c.a, c.y])).toEqual([
      [6, 0x50, 0x11], // bend RIGHT: A = MSB, Y = LSB
      [4, 0x20, 0], // bend LEFT
      [1, 100, 0], // mod wheel -> +X
      [0, 50, 0], // CC2 -> -X
      [2, 30, 0], // CC4 -> Fc pedal
      [8, 127, 0], // damper RIGHT
      [3, 77, 0], // channel pressure
    ]);
    expect(calls(b).every((c) => c.id === ENG_CTRL)).toBe(true);
    // outside SPLIT the RIGHT channel bends both sides (stock behaviour)
    const l = boot({ kbmode: 2 });
    send(l, [0xe0, 0, 0x40]);
    expect(calls(l).map((c) => c.x)).toEqual([6, 4]);
  });

  it('NRPN writes a raw program byte into the edit buffer and applies it', () => {
    const b = boot();
    send(b, [0xb0, 99, 1, 98, 13, 6, 1, 38, 0x2f]);
    expect(b.machine.ram[EDIT_L + 13]).toBe(0xaf);
    const c = calls(b);
    expect(c[c.length - 1]).toMatchObject({ id: ENG_APPLY_PROG, x: 1 });
    clearLog(b);
    send(b, [0xb0, 99, 0, 98, 40, 6, 0, 38, 5]); // byte 40: out of range
    expect(calls(b)).toEqual([]);
    send(b, [0xb0, 98, 2, 6, 0, 38, 0x55]);
    expect(b.machine.ram[EDIT_R + 2]).toBe(0x55);
  });

  it('survives dense traffic: 3000 bytes back to back, no message lost', () => {
    const b = boot();
    const bytes: number[] = [];
    let sent = 0;
    for (let i = 0; bytes.length < 3000; i++) {
      const ch = i & 1;
      if (i % 3 === 0) bytes.push(0x90 | ch);
      bytes.push(36 + (i % 60), 1 + (i % 127));
      sent++;
      if (i % 50 === 0) bytes.push(0xfe, 0xf8); // active sensing + clock interleaved
    }
    b.midiIn(bytes);
    let got = 0;
    let last = 0;
    const seq: number[] = [];
    for (let t = 0; t < 1200; t += 2) {
      b.run(2);
      const n = b.machine.ram[0x0fe8];
      const d = (n - last) & 0xff;
      expect(d).toBeLessThan(64); // the 64-entry log ring must not lap between two reads
      for (let k = 0; k < d; k++) {
        const o = 0x0e00 + ((last + k) & 63) * 4;
        if (b.machine.ram[o] === ENG_SIDE_ON) { got++; seq.push(b.machine.ram[o + 1]); }
      }
      last = n;
    }
    expect(got).toBe(sent);
    expect(seq.slice(0, 5)).toEqual([36, 37, 38, 39, 40]);
    expect(v8(b, 'midi_rxovr')).toBe(0);
    expect(v8(b, 'midi_hwovr')).toBe(0);
    expect(b.machine.acia.rxLost).toBe(0);
    expect(b.machine.ram[sym.midi_clock]).toBeGreaterThan(0);
  });

  it('a main loop stalled for 70 ms under full-rate input loses nothing (256-byte ring); NMI stays short', () => {
    const b = boot();
    const cpu = b.machine.cpu;
    // NMI cost: cycles spent from midi_nmi entry to its RTI
    let t0 = -1, worst = 0;
    const rti = sym.midi_rtbit - 1;
    cpu.onStep = (pc) => {
      if (pc === sym.midi_nmi && t0 < 0) t0 = cpu.cycles;
      if (pc === rti && t0 >= 0) { worst = Math.max(worst, cpu.cycles - t0); t0 = -1; }
    };
    const msgs = 72; // 216 bytes = 69 ms on the wire
    const bytes = Array.from({ length: msgs }, (_, i) => [0x90, 30 + (i % 90), 1 + i]).flat();
    const ram = b.machine.ram;
    for (let i = 0; i < 100000 && cpu.pc !== sym.main; i++) b.machine.run(1); // stall at the main-loop top
    expect(cpu.pc).toBe(sym.main);
    const pc = cpu.pc;
    ram[0x0ff8] = 0x4c; ram[0x0ff9] = 0xf8; ram[0x0ffa] = 0x0f; // JMP $0FF8: a main loop that never polls MIDI
    cpu.pc = 0x0ff8;
    b.midiIn(bytes);
    b.run(72);
    expect(calls(b)).toEqual([]);
    cpu.pc = pc;
    const got = runCollect(b, 80).filter((c) => c.id === ENG_SIDE_ON); // the bench tick takes most of the CPU
    cpu.onStep = undefined;
    expect(got.map((c) => c.y)).toEqual(Array.from({ length: msgs }, (_, i) => 1 + i));
    expect(v8(b, 'midi_rxovr')).toBe(0);
    expect(b.machine.acia.rxLost).toBe(0);
    expect(worst).toBeGreaterThan(0);
    expect(worst).toBeLessThan(150);
    console.log(`NMI handler worst case: ${worst} cycles`);
  });

  it('$FF does not reset; real-time start/stop/continue set flags, clocks are counted', () => {
    const b = boot();
    send(b, [0xff, 0xfa, 0xf8, 0xf8, 0xf8, 0xfb, 0xfc, 0x90, 60, 0xff, 100]);
    expect(calls(b)).toEqual([{ id: ENG_SIDE_ON, x: 0, a: 60, y: 100 }]);
    expect(v8(b, 'midi_clock')).toBe(3);
    expect(v8(b, 'midi_rtflags')).toBe(7);
    expect(b.machine.cpu.illegal).toBe(0);
  });

  it('transmits notes on the side channel (G_TX bit0) and program changes', () => {
    const b = boot({ chR: 3, chL: 9 });
    b.drainMidiOut();
    // drive midi_note_out / midi_pc_out through the test port is not possible: call via a tiny trampoline
    callRoutine(b, 'midi_note_out', { a: 60, x: 1, y: 100 });
    callRoutine(b, 'midi_note_out', { a: 60, x: 1, y: 0 });
    callRoutine(b, 'midi_pc_out', { a: 7, x: 0, y: 0 });
    b.run(10);
    expect(b.drainMidiOut()).toEqual([0x99, 60, 100, 0x99, 60, 0, 0xc3, 7]);
    const off = boot({ tx: 0 });
    off.drainMidiOut();
    callRoutine(off, 'midi_note_out', { a: 60, x: 0, y: 100 });
    off.run(5);
    expect(off.drainMidiOut()).toEqual([]);
  });
});

/** Runs a firmware routine to completion from the current state (main loop is interrupted, then resumed). */
function callRoutine(b: MachineBackend, name: string, r: { a: number; x: number; y: number }) {
  const cpu = b.machine.cpu as unknown as { pc: number; a: number; x: number; y: number; s: number; p: number };
  const saved = { ...cpu };
  const ret = 0x0ff8; // scratch: JSR target trampoline lives in RAM at $0FF8: JSR addr ; then BRK-free spin
  const addr = sym[name];
  const ram = b.machine.ram;
  ram[ret] = 0x20; ram[ret + 1] = addr & 0xff; ram[ret + 2] = addr >> 8; // JSR addr
  ram[ret + 3] = 0x4c; ram[ret + 4] = (ret + 3) & 0xff; ram[ret + 5] = (ret + 3) >> 8; // JMP * (done marker)
  cpu.pc = ret; cpu.a = r.a; cpu.x = r.x; cpu.y = r.y;
  for (let i = 0; i < 200000 && cpu.pc !== ret + 3; i++) b.machine.run(1);
  expect(cpu.pc).toBe(ret + 3);
  cpu.pc = saved.pc; cpu.a = saved.a; cpu.x = saved.x; cpu.y = saved.y; cpu.p = saved.p; cpu.s = saved.s;
}

describe('MIDI SysEx', () => {
  const prog = (seed: number) => Uint8Array.from({ length: 40 }, (_, i) => (seed * 11 + i * 13) & 0xff);
  const ack = (n: number) => [0xf0, 0x03, 0x0c, n, 0xf7];

  it('legacy program dump in (controller flag) -> battery RAM + load acknowledge', () => {
    const b = boot();
    b.drainMidiOut();
    const p = prog(5);
    const msg = encodeProgramDump(17, p, true);
    send(b, msg, 50);
    expect([...b.machine.bram.slice(PROG(17), PROG(17) + 40)]).toEqual([...p]);
    expect(b.drainMidiOut()).toEqual(ack(17));
    expect(v8(b, 'midi_sxstat')).toBe(0);
    expect(v8(b, 'midi_sxcount')).toBe(1);
    // without the controller flag: ignored (stock), unless the UI receive page is open
    send(b, encodeProgramDump(18, p, false), 50);
    expect(b.machine.bram[PROG(18)]).not.toBe(p[0]);
    expect(b.drainMidiOut()).toEqual([]);
    b.machine.ram[sym.midi_rxall] = 1;
    send(b, encodeProgramDump(18, p, false), 50);
    expect([...b.machine.bram.slice(PROG(18), PROG(18) + 40)]).toEqual([...p]);
    expect(b.drainMidiOut()).toEqual(ack(18));
  });

  it('program dump to 126/127 loads the edit buffer and applies it', () => {
    const b = boot();
    const p = prog(9);
    send(b, encodeProgramDump(127, p, true), 50);
    expect([...b.machine.ram.slice(EDIT_L, EDIT_L + 40)]).toEqual([...p]);
    expect(calls(b)).toEqual([{ id: ENG_APPLY_PROG, a: expect.any(Number), x: 1, y: expect.any(Number) }]);
    expect(b.drainMidiOut()).toEqual(ack(127));
  });

  it('memory protect: no write, no acknowledge, midi_sxstat = 1; edit buffers still load', () => {
    const b = boot();
    b.drainMidiOut();
    b.setProtect(true);
    const before = [...b.machine.bram.slice(PROG(3), PROG(3) + 40)];
    send(b, encodeProgramDump(3, prog(1), true), 50);
    expect([...b.machine.bram.slice(PROG(3), PROG(3) + 40)]).toEqual(before);
    expect(b.drainMidiOut()).toEqual([]);
    expect(v8(b, 'midi_sxstat')).toBe(1);
    send(b, encodeProgramDump(126, prog(1), true), 50);
    expect([...b.machine.ram.slice(EDIT_R, EDIT_R + 40)]).toEqual([...prog(1)]);
    expect(b.drainMidiOut()).toEqual(ack(126));
  });

  it('program request -> exactly the stock dump bytes', () => {
    const b = boot();
    b.drainMidiOut();
    send(b, [0xf0, 0x03, 0x06, 42, 0xf7], 50);
    const stored = b.machine.bram.slice(PROG(42), PROG(42) + 40);
    expect(b.drainMidiOut()).toEqual(encodeProgramDump(42, stored, false));
    // MX off: no answer
    const off = boot({ rx: 0x17 });
    off.drainMidiOut();
    send(off, [0xf0, 0x03, 0x06, 42, 0xf7], 50);
    expect(off.drainMidiOut()).toEqual([]);
  });

  it.skipIf(!hasStock)('program/step request answers are byte-identical to the stock Rev4 ROM', () => {
    const neo = boot();
    const bram = new Uint8Array(neo.machine.bram);
    bram[0x1a61] = 0x80; // stock MX switch
    const stock = new MachineBackend('stock', loadStockRom(), bram);
    stock.run(1500);
    const req = [0xf0, 0x03, 0x06, 42, 0xf7, 0xf0, 0x03, 0x07, 77, 0xf7, 0xf0, 0x03, 0x06, 0, 0xf7];
    for (const b of [neo, stock]) { b.drainMidiOut(); b.midiIn(req); b.run(300); }
    const n = neo.drainMidiOut();
    expect(n.length).toBe(96 + 66 + 96);
    expect(n).toEqual(stock.drainMidiOut());
  });

  it('step dump in and step request (24 stored bytes, 30 sent, padded with $80)', () => {
    const b = boot();
    b.drainMidiOut();
    const st = Array.from({ length: 24 }, (_, i) => (i * 9 + 1) & 0xff);
    send(b, [0xf0, 0x03, 0x42, 0x00, 55, ...nib([...st, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80]), 0xf7], 40);
    expect([...b.machine.bram.slice(STEP(55), STEP(55) + 24)]).toEqual(st);
    expect(b.drainMidiOut()).toEqual(ack(55));
    send(b, [0xf0, 0x03, 0x07, 55, 0xf7], 40);
    expect(b.drainMidiOut()).toEqual([0xf0, 0x03, 0x02, 0x00, 55, ...nib([...st, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80]), 0xf7]);
  });

  it('parameter byte change: battery program, and edit buffer + apply', () => {
    const b = boot();
    send(b, [0xf0, 0x03, 0x4a, 0x00, 10, 5, 0x0c, 0x0a, 0xf7]);
    expect(b.machine.bram[PROG(10) + 5]).toBe(0xac);
    expect(calls(b)).toEqual([]);
    send(b, [0xf0, 0x03, 0x4a, 0x00, 126, 39, 0x01, 0x02, 0xf7]);
    expect(b.machine.ram[EDIT_R + 39]).toBe(0x21);
    expect(calls(b).map((c) => [c.id, c.x])).toEqual([[ENG_APPLY_PROG, 0]]);
    clearLog(b);
    send(b, [0xf0, 0x03, 0x4a, 0x00, 126, 40, 0x01, 0x02, 0xf7]); // byte 40 rejected (stock)
    expect(calls(b)).toEqual([]);
  });

  it('panel button -> ui_key (A = code, X = raw byte), new step -> ui_recall_step, return page -> ui_sysex_in', () => {
    const b = boot();
    send(b, [0xf0, 0x03, 0x4b, 0x00, 0x60, 0xf7, 0xf0, 0x03, 0x00, 7, 0xf7, 0xf0, 0x03, 0x09, 0xf7]);
    expect(calls(b).map((c) => [c.id, c.a, c.x])).toEqual([[UI_KEY, 0x20, 0x60], [UI_RECALL_STEP, 7, expect.any(Number)], [UI_SYSEX_IN, expect.any(Number), expect.any(Number)]]);
    expect(b.machine.ram[sym.midi_sxbuf + 1]).toBe(0x09);
    // panel button needs the controller flag (stock)
    clearLog(b);
    send(b, [0xf0, 0x03, 0x0b, 0x00, 0x60, 0xf7]);
    expect(calls(b)).toEqual([]);
  });

  it('keyboard off flag, user taper, cmd 22 taper/footswitch block (stored last byte first)', () => {
    const b = boot();
    send(b, [0xf0, 0x03, 0x43, 0x01, 0xf7]);
    expect(v8(b, 'midi_kbd_off')).toBe(1);
    const taper = Array.from({ length: 15 }, (_, i) => 14 - i);
    send(b, [0xf0, 0x03, 0x45, ...nib(taper), 0xf7]);
    expect([...b.machine.bram.slice(0x1a28, 0x1a28 + 15)]).toEqual(taper);
    const blk = Array.from({ length: 57 }, (_, i) => (i * 3) & 0xff);
    send(b, [0xf0, 0x03, 0x56, ...nib(blk), 0xf7]);
    expect([...b.machine.bram.slice(0x1a20, 0x1a59)]).toEqual([...blk].reverse());
  });

  it('a SysEx interrupted by real-time bytes still completes; unknown IDs are ignored', () => {
    const b = boot();
    b.drainMidiOut();
    send(b, [0xf0, 0x03, 0xf8, 0x06, 0xfe, 3, 0xf7, 0xf0, 0x41, 0x10, 0x42, 0xf7], 50);
    expect(b.drainMidiOut()).toEqual(encodeProgramDump(3, b.machine.bram.slice(PROG(3), PROG(3) + 40)));
    expect(SYSEX_PROGRAM_TAIL.length).toBe(5);
  });

  it('identity: NeoV8 cmd $20 and universal identity request', () => {
    const b = boot();
    b.drainMidiOut();
    send(b, [0xf0, 0x03, 0x20, 0xf7, 0xf0, 0x7e, 0x7f, 0x06, 0x01, 0xf7], 20);
    const out = b.drainMidiOut();
    expect(out.slice(0, 5)).toEqual([0xf0, 0x03, 0x21, 0x4e, 0x38]);
    expect(out.slice(8, 14)).toEqual([0xf0, 0x7e, 0x7f, 0x06, 0x02, 0x03]);
    expect(out[out.length - 1]).toBe(0xf7);
  });

  it('NeoV8 bulk dump round trip: programs, steps, globals, taper block', () => {
    const a = boot();
    a.drainMidiOut();
    a.machine.bram[NV_GLOBALS + 20] = 0x5a; // something in the globals
    for (let i = 0; i < 57; i++) a.machine.bram[0x1a20 + i] = (i * 5 + 1) & 0xff; // taper/footswitch block
    send(a, [0xf0, 0x03, 0x22, 0x0f, 0xf7], 10);
    expect(v8(a, 'midi_dmask')).not.toBe(0);
    a.run(6000); // ~16.6 kB at 3125 B/s
    expect(v8(a, 'midi_dmask')).toBe(0);
    const out = a.drainMidiOut();
    expect(v8(a, 'midi_txdrop')).toBe(0);
    expect(out.length).toBe(100 * 96 + 100 * 66 + 132 + 118);
    expect(out.slice(0, 96)).toEqual(encodeProgramDump(0, a.machine.bram.slice(0, 40)));

    // replay into a blank machine with the receive page open
    const z = boot();
    z.machine.bram.fill(0, 0, 0x1a7a);
    z.machine.ram[sym.midi_rxall] = 1;
    for (let i = 0; i < out.length; i += 600) send(z, out.slice(i, i + 600), 200);
    z.run(50);
    const ab = a.machine.bram, zb = z.machine.bram;
    expect([...zb.slice(0, 4000)]).toEqual([...ab.slice(0, 4000)]);
    expect([...zb.slice(0x1000, 0x1000 + 2400)]).toEqual([...ab.slice(0x1000, 0x1000 + 2400)]);
    expect([...zb.slice(0x1a20, 0x1a59)]).toEqual([...ab.slice(0x1a20, 0x1a59)]);
    expect([...zb.slice(NV_GLOBALS, NV_GLOBALS + 64)]).toEqual([...ab.slice(NV_GLOBALS, NV_GLOBALS + 64)]);
    expect(v8(z, 'midi_rxovr')).toBe(0);
  });

  it('tune request starts the autotune (stock), only with SysEx enabled', () => {
    const b = boot();
    send(b, [0xf6]);
    expect(calls(b).map((c) => c.id)).toEqual([TUNE_RUN]);
  });
});
