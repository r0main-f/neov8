// Adapter: reads the NeoV8 UI state out of a running NeoV8 ROM (UI debug block UIDBG $0FC0, PERF, edit
// buffers, battery RAM) and returns the same fields as the prototype's inspect() (sim/src/proto/proto.ts),
// so spec/scenarios/*.yaml can run against the firmware. Layout: firmware/src/ui/README.md.
import type { ButtonId } from '../types';
import type { Machine } from './machine';
import { DISPLAY_MAP, decodeSegments } from './panelmap';
import { segToChar } from '../font7';

export const UIDBG = 0x0fc0;
export const PERF = 0x0880;
export const EDIT_R = 0x0800;
export const EDIT_L = 0x0840;
const NV_GLOBALS = 0x1a80; // battery offset of $5A80
const NV_UNDO = 0x1ac0; // $5AC0
const MODES = ['play', 'edit', 'menu', 'tune', 'confirm', 'receive', 'seq'];
/** sequencer debug block written by the UI (firmware/src/ui/seq.asm SQD_*) */
const SQD = 0x0fe0;
const SQD_LEN = 0x0fec;
const PAGES = ['P1', 'P2', 'A', 'B', 'C', 'D'];
const KB = ['whole', 'split', 'layer'];
const ARP: Record<number, string> = { 0: 'down', 1: 'random', 2: 'up', 3: 'updown', 6: 'played' };

/**
 * LEDs the stock OS never drives on the Normal page ($6A-$6D): the firmware assumes EDIT, STORE, TAPE LOAD,
 * TAPE DUMP in that order (firmware/src/ui/tables.asm LEDL_*) - to confirm on the real unit.
 */
export const NEOV8_EXTRA_LEDS: Partial<Record<ButtonId, [number, number]>> = {
  edit: [3, 6], store: [3, 0], tape_load: [0, 6], tape_dump: [0, 0],
};
const LED_MAP: Partial<Record<ButtonId, [number, number]>> = { ...DISPLAY_MAP.leds, ...NEOV8_EXTRA_LEDS };

const bits = (mask: number) => Array.from({ length: 6 }, (_, i) => ((mask >> i) & 1 ? '1' : '0')).join('');
const signed = (b: number) => (b & 0x80 ? b - 256 : b);

/** Panel-order segment byte (8279 wiring) -> simulator segments (bit0..6 = a..g, bit7 = DP). */
function panelToSim(b: number): number {
  const ram = new Uint8Array(10);
  ram[DISPLAY_MAP.digits[0]] = b;
  return decodeSegments(ram).segments[0];
}

/** Text of 6 simulator segment values (DP ignored). */
export const segText = (segs: number[]) => segs.map((s) => segToChar(s & 127)).join('');

export function neoEditBuffer(m: Machine, side: 'L' | 'R'): Uint8Array {
  const a = side === 'L' ? EDIT_L : EDIT_R;
  return m.ram.slice(a, a + 40);
}

/** Display and LEDs as the UI means them (before blinking), plus the actual panel for comparison. */
export function neoDisplay(m: Machine) {
  const d = m.ram.subarray(UIDBG, UIDBG + 32);
  const segs = Array.from({ length: 6 }, (_, i) => panelToSim(d[10 + i]));
  return { segs, blink: d[7], dp: d[8], dpBlink: d[9], led: [...d.subarray(16, 20)], ledBlink: [...d.subarray(20, 24)] };
}

/**
 * The 8279 display RAM must equal the logical image with the blink applied (all on, or blinking parts off).
 * Returns null when consistent, else a description.
 */
export function neoPanelCheck(m: Machine): string | null {
  const d = m.ram.subarray(UIDBG, UIDBG + 32);
  const ram = m.kd.display;
  const phase = (on: boolean) => {
    for (let i = 0; i < 6; i++) {
      const pos = DISPLAY_MAP.digits[i];
      let v = d[10 + i];
      if (!on) { if (d[7] & (1 << i)) v = 0; else if (d[9] & (1 << i)) v &= 0xfe; }
      if (ram[pos] !== v) return false;
    }
    for (let k = 0; k < 4; k++) {
      const v = on ? d[16 + k] : d[16 + k] & ~d[20 + k];
      const mask = k === 3 ? 0xfb : 0xff; // display byte 9 bit 2 = tempo LED (arp clock, not the UI)
      if ((ram[k * 3] & mask) !== (v & mask)) return false;
    }
    return true;
  };
  if (phase(true) || phase(false)) return null;
  return `panel ${[...ram.subarray(0, 10)].map((x) => x.toString(16)).join(' ')} vs logical ${[...d.subarray(10, 24)].map((x) => x.toString(16)).join(' ')}`;
}

export function neoInspect(m: Machine): Record<string, unknown> {
  const r = m.ram;
  const d = r.subarray(UIDBG, UIDBG + 32);
  const P = (o: number) => r[PERF + o];
  const G = (o: number) => m.bram[NV_GLOBALS + o];
  const mode = MODES[d[0]] ?? `?${d[0]}`;
  const disp = neoDisplay(m);
  const leds: Partial<Record<ButtonId, 'on' | 'blink' | 'off'>> = {};
  for (const [id, loc] of Object.entries(LED_MAP) as [ButtonId, [number, number]][]) {
    const k = loc[0] / 3;
    const bit = 1 << loc[1];
    leds[id] = disp.ledBlink[k] & bit ? 'blink' : disp.led[k] & bit ? 'on' : 'off';
  }
  const flags = d[4];
  const trims = (base: number) => {
    const t = [...r.subarray(PERF + base, PERF + base + 7)].map(signed);
    return { a: t[0], r: t[1], fc: t[2], glide: t[3], lfo: t[4], detune: t[5], vol: t[6] };
  };
  const undo = m.bram[NV_UNDO];
  return {
    mode,
    page: mode === 'edit' ? PAGES[d[1]] : null,
    editSide: mode === 'edit' ? (d[2] ? 'L' : 'R') : null,
    menuItem: mode === 'menu' ? d[5] : null,
    focus: ['R', 'L', 'S'][d[3]],
    display: segText(disp.segs),
    displayBlink: bits(disp.blink),
    dp: bits(disp.dp),
    dpBlink: bits(disp.dpBlink),
    leds,
    editedR: !!(flags & 1),
    editedL: !!(flags & 2),
    storing: flags & 4 ? { kind: d[28] & 2 ? 'step' : 'prog', side: d[28] & 1 ? 'L' : 'R', dest: d[25] } : null,
    entry: flags & 8 ? { target: ['R', 'L', 'S', 'menu'][d[29]] } : null,
    compare: flags & 16 ? (flags & 32 ? 'L' : 'R') : null,
    a440Tone: !!(flags & 64),
    muted: !!(flags & 128),
    progR: P(0),
    progL: P(1),
    step: P(2),
    undo: undo < 100 ? undo : null,
    lastTouched: d[27] === 0xff ? null : d[27],
    perf: {
      progR: P(0), progL: P(1), kbMode: KB[P(3)], split: P(4),
      uniR: !!(P(5) & 1), uniL: !!(P(5) & 2), octR: P(6) - 1, octL: P(7) - 1,
      holdR: !!(P(8) & 1), holdL: !!(P(8) & 2), relDefR: !!(P(9) & 1), relDefL: !!(P(9) & 2),
      pbDefR: !!(P(10) & 1), pbDefL: !!(P(10) & 2), arpR: !!(P(11) & 1), arpL: !!(P(11) & 2),
      arpMode: ARP[P(12)], arpPause: !!P(14), arpSpeed: P(15), assignR: P(17), assignL: P(18),
      arpOctR: P(42), arpOctL: P(43), trimR: trims(28), trimL: trims(35), voiceMask: P(27),
    },
    globals: {
      midiChR: G(0) + 1, midiChL: G(1) + 1, omniR: !!(G(2) & 1), omniL: !!(G(2) & 2),
      rxNotes: !!(G(3) & 1), rxProgram: !!(G(3) & 2), rxSysex: !!(G(3) & 8), txNotes: !!(G(4) & 1), txProgram: !!(G(4) & 2),
      rxCtrl: !!(G(3) & 4), txCtrl: !!(G(4) & 4),
      pcTarget: G(5) ? 'step' : 'prog', localOn: !!G(6), potMode: ['pickup', 'jump', 'relative'][G(7)],
      trimMode: G(8) ? 'direct' : 'trim', displayHoldMs: G(9) * 100, powerOnStep: G(10) ? 'zero' : 'last',
      arpClock: ['int', 'ext', 'midi'][G(11)], steal: G(12) ? 'none' : 'oldest', uniDetune: G(13),
      voiceMask: P(27), // NeoV8 keeps the voice-disable mask in the step (stock byte 22), not in the globals
    },
    seq: neoSeq(m),
    renders: d[31],
  };
}

/** Sequencer state in the prototype's inspect().seq shape. len = events per channel (the firmware keeps no tick length). */
export function neoSeq(m: Machine) {
  const r = m.ram;
  const md = r[SQD];
  const sw = r[SQD + 1];
  const running = !!(md & 0x80);
  const mode = !running ? '--' : md & 4 ? 'rE' : (md & 3) === 3 ? 'Od' : md & 2 ? 'rE' : md & 8 ? 'Sn' : 'PL';
  const w = (a: number) => r[a] | (r[a + 1] << 8);
  const events = [w(SQD_LEN), w(SQD_LEN + 2)];
  return {
    mode, running, play: sw & 3, rec: (sw >> 2) & 3, loop: !!(sw & 16), lock: !!(sw & 32), song: !!(sw & 64),
    tempo: r[SQD + 2], quant: r[SQD + 3], free: w(SQD + 4), status: r[SQD + 6], len: events, events,
  };
}
