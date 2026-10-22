// MIDI out of panel actions and MIDI in of parameter CCs, on the full NeoV8 ROM (real UI + MIDI), checked
// byte for byte against the prototype. Spec: docs/midi-implementation.md §1, §4 and docs/parameters.md (CC map).
import { describe, it, expect, beforeAll } from 'vitest';
import { MachineBackend } from '../src/machine/backend';
import { neoEditBuffer } from '../src/machine/neov8-inspect';
import { NeoV8Proto } from '../src/proto/proto';
import { PARAM, getRaw } from '../src/proto/patch';
import type { ButtonId, PotId } from '../src/types';
import { buildFirmware, loadNeoRomFrom, protoBattery } from './helpers';

const BUILD = 'build-midipanel';
const GAP = 30;
const POT_GAP = 80;
const NV_GLOBALS = 0x1a80, G_RX = 3, G_TX = 4;

type Act = ['press', ButtonId | ButtonId[]] | ['pot', PotId, number] | ['wait', number];
interface Both { p: NeoV8Proto; b: MachineBackend }

let rom: Uint8Array;
beforeAll(() => {
  buildFirmware(BUILD);
  rom = loadNeoRomFrom(BUILD);
}, 120_000);

function boot(): Both {
  const p = new NeoV8Proto();
  p.steps[0].progR = 1; // same battery as protoBattery(): step 00 = the power-on programs
  p.run(300);
  const b = new MachineBackend('neov8', rom, protoBattery());
  b.run(300);
  p.drainMidiOut();
  b.drainMidiOut();
  return { p, b };
}

function press(x: { button(id: ButtonId, d: boolean): void; run(ms: number): void }, ids: ButtonId | ButtonId[]) {
  const list = Array.isArray(ids) ? ids : [ids];
  for (const h of list.slice(0, -1)) { x.button(h, true); x.run(GAP); }
  const last = list[list.length - 1];
  x.button(last, true); x.run(GAP);
  x.button(last, false); x.run(GAP);
  for (const h of list.slice(0, -1).reverse()) { x.button(h, false); x.run(GAP); }
}

/** Runs the same actions on both back ends; returns the MIDI bytes each one sent. */
function play(s: Both, acts: Act[]): { proto: number[]; rom: number[] } {
  for (const a of acts) {
    for (const x of [s.p, s.b] as const) {
      if (a[0] === 'press') press(x, a[1]);
      else if (a[0] === 'pot') { x.pot(a[1], a[2]); x.run(POT_GAP); }
      else x.run(a[1]);
      if (a[0] === 'press' && (a[1] === 'edit')) x.run(650); // no digit inside the EDIT+digit page-jump window
    }
  }
  s.p.run(100);
  s.b.run(100); // let the TX ring drain (31250 baud: 3 bytes per ms)
  return { proto: s.p.drainMidiOut(), rom: s.b.drainMidiOut() };
}

/** Splits a byte stream into messages (status byte + data; SysEx up to F7). */
function messages(bytes: number[]): number[][] {
  const out: number[][] = [];
  for (const x of bytes) {
    if (x >= 0x80 && !(out.length && out[out.length - 1][0] === 0xf0 && out[out.length - 1].at(-1) !== 0xf7)) out.push([x]);
    else out[out.length - 1].push(x);
  }
  return out;
}

const pot = (id: PotId, k: number): Act => ['pot', id, Math.round((k * 1023) / 127)];

describe('NeoV8 ROM: panel edits and recalls go out over MIDI (same bytes as the prototype)', () => {
  it('a 7-bit knob sends its CC, scaled params are shifted to 0-127', () => {
    const s = boot();
    play(s, [['press', 'edit']]); // EDIT on RIGHT (channel 1), page 1
    const r = play(s, [pot('r_detune', 0), pot('r_detune', 127), pot('r_r', 0), pot('r_r', 127)]);
    expect(r.rom).toEqual(r.proto);
    const m = messages(r.rom);
    // glide time (CC 5) ends at 127; VCO2 PWM depth (4-bit, CC 26) ends at 15 << 3 = 120
    expect(m.filter((x) => x[1] === 5).at(-1)).toEqual([0xb0, 5, 127]);
    expect(m.filter((x) => x[1] === 26).at(-1)).toEqual([0xb0, 26, 120]);
    expect(m.every((x) => x[0] === 0xb0 && (x[1] === 5 || x[1] === 26))).toBe(true);
    expect(getRaw(neoEditBuffer(s.b.machine, 'R'), 'glide_time')).toBe(127);
  });

  it('a switch sends NRPN with the raw byte; an enum sends its CC; the LEFT side uses channel 2', () => {
    const s = boot();
    play(s, [['press', 'call_l'], ['press', 'edit']]); // EDIT on LEFT
    const r = play(s, [['press', 'arp_up'], ['press', 'step_load'], ['press', 'k2']]);
    expect(r.rom).toEqual(r.proto);
    const ed = neoEditBuffer(s.b.machine, 'L');
    const b = ed[PARAM.vco1_pulse.byte];
    const m = messages(r.rom);
    expect(m.slice(0, 4)).toEqual([[0xb1, 99, 1], [0xb1, 98, PARAM.vco1_pulse.byte], [0xb1, 6, b >> 7], [0xb1, 38, b & 0x7f]]);
    if (m.length > 4) expect(m[4]).toEqual([0xb1, 27, 2 << 5]); // VCO1 PWM source = ADSR1 (2-bit enum, CC 27)
    expect(getRaw(ed, 'vco1_pwm_src')).toBe(2);
  });

  it('a mod depth (8-bit) goes out as a 14-bit CC pair', () => {
    const s = boot();
    play(s, [['press', 'edit'], ['press', 'fwd'], ['press', 'fwd']]); // page A
    const r = play(s, [pot('l_a', 0), pot('l_a', 127), pot('l_r', 0), pot('l_r', 70)]);
    expect(r.rom).toEqual(r.proto);
    const v = getRaw(neoEditBuffer(s.b.machine, 'R'), 'modA_depth');
    const m = messages(r.rom);
    expect(m.length).toBeGreaterThan(0);
    expect(m.slice(-2)).toEqual([[0xb0, 12, v >> 1], [0xb0, 44, (v & 1) << 6]]);
  });

  it('leaving EDIT sends "new data available"; recalls send program change and "new step"', () => {
    const s = boot();
    const r = play(s, [['press', 'edit'], ['press', 'edit'], ['press', 'call_r'], ['press', 'k1'], ['press', 'k2'],
      ['press', 'step_enable'], ['press', 'k0'], ['press', 'k5'], ['press', 'fwd']]);
    expect(r.rom).toEqual(r.proto);
    expect(messages(r.rom)).toEqual([[0xf0, 3, 8, 0xf7], [0xc0, 12], [0xf0, 3, 0, 5, 0xf7], [0xf0, 3, 0, 6, 0xf7]]);
  });

  it('nothing goes out when transmit is off; an unchanged value is not sent again', () => {
    const s = boot();
    s.b.machine.bram[NV_GLOBALS + G_TX] = 0;
    s.p.globals.txCtrl = false;
    s.p.globals.txProgram = false;
    s.p.globals.txNotes = false;
    const r = play(s, [['press', 'edit'], pot('r_detune', 0), pot('r_detune', 127), ['press', 'arp_up']]);
    expect(r.rom).toEqual([]);
    expect(r.proto).toEqual([]);
    const t = boot();
    play(t, [['press', 'edit'], pot('r_detune', 0), pot('r_detune', 127)]);
    const again = play(t, [pot('r_detune', 127)]);
    expect(again.rom).toEqual([]);
  });
});

describe('NeoV8 ROM: program parameter CCs received', () => {
  const recv = (s: Both, bytes: number[]) => {
    s.p.midiIn(bytes); s.p.run(20);
    s.b.midiIn(bytes); s.b.run(Math.ceil(bytes.length * 0.32) + 60); // a received CC applies the program (~20 ms main loop)
  };

  it('CC on a side channel sets that edit buffer (scaled), nothing is sent back', () => {
    const s = boot();
    recv(s, [0xb0, 74, 100, 0xb1, 109, 0x40, 0xb0, 26, 120]); // R cutoff, L LFO1 wave = 2, R VCO2 PWM depth = 15
    const R = neoEditBuffer(s.b.machine, 'R'), L = neoEditBuffer(s.b.machine, 'L');
    expect(getRaw(R, 'vcf_fc')).toBe(100);
    expect(getRaw(L, 'lfo1_wave')).toBe(2);
    expect(getRaw(R, 'vco2_pwm_depth')).toBe(15);
    expect([...R]).toEqual([...s.p.edit.R]);
    expect([...L]).toEqual([...s.p.edit.L]);
    s.b.run(50);
    expect(s.b.drainMidiOut()).toEqual([]);
  });

  it('14-bit depth: MSB writes value << 1, LSB sets bit 0; LSB of a 7-bit param and unmapped CCs are ignored', () => {
    const s = boot();
    recv(s, [0xb0, 13, 64, 0xb0, 45, 64]); // bank B depth = 129
    expect(getRaw(neoEditBuffer(s.b.machine, 'R'), 'modB_depth')).toBe(129);
    recv(s, [0xb0, 13, 10]); // MSB alone: LSB back to 0
    expect(getRaw(neoEditBuffer(s.b.machine, 'R'), 'modB_depth')).toBe(20);
    const before = [...neoEditBuffer(s.b.machine, 'R')];
    recv(s, [0xb0, 52, 5, 0xb0, 3, 77, 0xb0, 0, 1, 0xb0, 32, 1]); // LSB of 7-bit CC 20, unmapped 3, bank select
    expect([...neoEditBuffer(s.b.machine, 'R')]).toEqual(before);
    expect([...neoEditBuffer(s.b.machine, 'R')]).toEqual([...s.p.edit.R]);
  });

  it('receive filter off: parameter CCs are ignored', () => {
    const s = boot();
    s.b.machine.bram[NV_GLOBALS + G_RX] &= ~4;
    const before = getRaw(neoEditBuffer(s.b.machine, 'R'), 'vcf_fc');
    s.b.midiIn([0xb0, 74, (before + 9) & 0x7f]);
    s.b.run(30);
    expect(getRaw(neoEditBuffer(s.b.machine, 'R'), 'vcf_fc')).toBe(before);
  });
});
