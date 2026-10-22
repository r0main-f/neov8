// Machine back end: the emulated Voyetra (6502 + chips) running a real ROM image behind the panel.
import type { Backend, ButtonId, Frame, PotId } from '../types';
import { POT_MAX } from '../types';
import { Machine, CPU_HZ, POT_MUX_CHANNEL } from './machine';
import { DISPLAY_MAP, decodeSegments } from './panelmap';

/**
 * Internal button codes (= SysEx panel-button numbers, docs/hardware.md §5.1).
 * The 8279 FIFO byte is found by inverting the panel wiring table HW_KEYTAB.
 * A440 is not in the matrix: it drives the 8279 SHIFT input (FIFO bit 6 = 1 when A440 is NOT held).
 */
export const BUTTON_CODE: Partial<Record<ButtonId, number>> = {
  uni_l: 0x00, uni_r: 0x01, kb_split: 0x02, kb_layer: 0x03, hold_l: 0x04, hold_r: 0x05, kb_whole: 0x06,
  k0: 0x08, k1: 0x09, k2: 0x0a, k3: 0x0b, k4: 0x0c, k5: 0x0d, k6: 0x0e, k7: 0x0f, k8: 0x10, k9: 0x11, rev: 0x12, fwd: 0x13,
  oct_r: 0x18, oct_l: 0x19, tape_load: 0x1a, tape_dump: 0x1b, store: 0x1c, edit: 0x1d, autotune: 0x1e,
  call_r: 0x20, call_l: 0x21, step_enable: 0x22, step_load: 0x23,
  pbdef_r: 0x28, pbdef_l: 0x29, mute: 0x2b,
  reldef_r: 0x30, reldef_l: 0x31, arp_right: 0x32, arp_left: 0x33, arp_pause: 0x34,
  arp_down: 0x38, arp_random: 0x39, arp_up: 0x3a,
};
/**
 * Panel wiring: 8279 matrix position (index = RL*8 + SL) -> internal button code. A hardware fact,
 * identical to the stock ROM's KEYTAB at $A0BD (checked by sim/test/stockrom.test.ts).
 */
export const HW_KEYTAB = [
  0x10, 0x0a, 0x0f, 0x09, 0x11, 0x0c, 0x12, 0x0d, 0x05, 0x31, 0x29, 0x0b, 0x04, 0x0e, 0x28, 0x30,
  0x32, 0x33, 0x1e, 0x34, 0x39, 0x38, 0x2a, 0x3a, 0xff, 0x20, 0x22, 0x21, 0x23, 0x19, 0xff, 0x18,
  0x08, 0xff, 0x13, 0x1d, 0x1a, 0x1c, 0x1b, 0x15, 0x03, 0xff, 0x00, 0x06, 0x02, 0x2b, 0x01, 0x14,
];

/** FIFO byte (without the SHIFT bit) for each button. */
export function fifoCodes(): Partial<Record<ButtonId, number>> {
  const out: Partial<Record<ButtonId, number>> = {};
  for (const [id, code] of Object.entries(BUTTON_CODE)) {
    const x = HW_KEYTAB.indexOf(code!);
    if (x >= 0) out[id as ButtonId] = ((x & 7) << 3) | (x >> 3);
  }
  return out;
}

/**
 * Pot index as scanned by the stock ROM (pot table at $E036: Normal page order = 13 53 0A 4A ...,
 * alternating R, L per knob; index 14 = arp speed). Index k -> pot-mux channel is TBD (docs/hardware.md).
 */
export const POT_INDEX: Record<PotId, number> = {
  r_fc: 0, l_fc: 1, r_glide: 2, l_glide: 3, r_lfo: 4, l_lfo: 5, r_a: 6, l_a: 7, r_r: 8, l_r: 9,
  r_detune: 10, l_detune: 11, r_vol: 12, l_vol: 13, arp_speed: 14,
};

export class MachineBackend implements Backend {
  readonly machine: Machine;
  private shift = false;
  private fifo: Partial<Record<ButtonId, number>>;
  private midiOut: number[] = [];
  private carry = 0;

  constructor(readonly name: string, rom: Uint8Array, bram?: Uint8Array) {
    this.machine = new Machine(rom);
    if (bram) this.machine.bram.set(bram);
    this.fifo = fifoCodes();
    this.machine.reset();
  }

  button(id: ButtonId, down: boolean): void {
    if (id === 'a440') { this.shift = down; return; }
    const code = this.fifo[id];
    if (code === undefined || !down) return; // the 8279 queues key closures only
    this.machine.kd.pressKey((this.shift ? 0 : 0x40) | code);
  }
  pot(id: PotId, value: number): void {
    this.machine.potByChannel[POT_MUX_CHANNEL[POT_INDEX[id]]] = Math.max(0, Math.min(POT_MAX, value));
  }
  key(note: number, down: boolean, velocity: number): void {
    if (down) this.machine.keyDown(note, velocity);
    else this.machine.keyUp(note);
  }
  midiIn(bytes: number[]): void { this.machine.acia.receive(bytes); }
  /** VPK-5 keyboard front button REV / FWD pressed / released (the ROM debounces and auto-repeats it). */
  kbdButton(id: 'fwd' | 'rev', down: boolean): void {
    if (id === 'fwd') this.machine.vpkFwd = down;
    else this.machine.vpkRev = down;
  }
  /** Footswitch n (0-5 = PIA2 PB0-PB5: B-L, B-R, A-L, A-R, jack REV, jack FWD) closed / open. */
  footswitch(n: number, closed: boolean): void {
    const p = this.machine.pia2;
    p.inB = closed ? p.inB & ~(1 << n) : p.inB | (1 << n);
  }
  setProtect(on: boolean): void { this.machine.memProtect = on; }
  run(ms: number): void {
    const c = (ms / 1000) * CPU_HZ + this.carry;
    const whole = Math.floor(c);
    this.carry = c - whole;
    this.machine.run(whole);
    if (this.machine.acia.txOut.length) this.midiOut.push(...this.machine.acia.txOut.splice(0));
  }
  frame(): Frame {
    return decodeSegments(this.machine.kd.display);
  }
  inspect(): Record<string, unknown> {
    const m = this.machine;
    return {
      mode: 'machine',
      pc: m.cpu.pc.toString(16), cycles: m.cpu.cycles, irqs: m.irqCount, illegal: m.cpu.illegal,
      displayRam: [...m.kd.display].map((b) => b.toString(16).padStart(2, '0')).join(' '),
      displayMap: DISPLAY_MAP.status,
      progR: m.ram[0x50], progL: m.ram[0x51], step: m.ram[0x52],
      page: ['Normal', 'Edit 1', 'Edit 2', 'Mod A', 'Mod B', 'Mod C', 'Mod D', 'User taper', 'Factory 1', 'Factory 2', 'Factory 3', 'MIDI Pb'][m.ram[0x60a]] ?? m.ram[0x60a],
      voiceCVs: Array.from({ length: 8 }, (_, v) => m.cv[8 * v + 7]).join(' '),
    };
  }
  drainMidiOut(): number[] { const o = this.midiOut; this.midiOut = []; return o; }
}
