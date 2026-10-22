// NeoV8 SYSTEM menu: one numbered list replaces Rev4's Alternate / Set / Velocity / MIDI pages.
// Display: LEFT = item number, RIGHT = 2-char mnemonic, STEP = 2-char value.
import type { Globals, Perf } from './state';

export interface MenuCtx { g: Globals; perf: Perf }
export interface MenuItem {
  num: number;
  mn: string;
  name: string;
  /** number of selectable values (0..count-1) */
  count: number;
  get(c: MenuCtx): number;
  set(c: MenuCtx, v: number): void;
  fmt(v: number): string; // 2 chars
  /** special behaviours handled by the prototype */
  special?: 'voices' | 'reset' | 'btnTest' | 'potTest' | 'dispTest' | 'midiMon' | 'tuneReport' | 'notYet';
  /** item changes a Step (performance) value rather than a global */
  perf?: boolean;
}

const two = (n: number) => String(n).padStart(2, '0');
const bool = (num: number, mn: string, name: string, key: keyof Globals, on = 'On', off = 'oF'): MenuItem => ({
  num, mn, name, count: 2,
  get: (c) => (c.g[key] ? 1 : 0),
  set: (c, v) => { (c.g as unknown as Record<string, unknown>)[key] = v === 1; },
  fmt: (v) => (v ? on : off),
});
const choice = <const T,>(num: number, mn: string, name: string, opts: [T, string][], get: (c: MenuCtx) => T, set: (c: MenuCtx, v: T) => void, perf = false): MenuItem => ({
  num, mn, name, count: opts.length, perf,
  get: (c) => Math.max(0, opts.findIndex(([v]) => v === get(c))),
  set: (c, i) => set(c, opts[i][0]),
  fmt: (i) => opts[i]?.[1] ?? '--',
});
const range = (num: number, mn: string, name: string, lo: number, hi: number, get: (c: MenuCtx) => number, set: (c: MenuCtx, v: number) => void, perf = false, fmt = two): MenuItem => ({
  num, mn, name, count: hi - lo + 1, perf,
  get: (c) => get(c) - lo,
  set: (c, i) => set(c, i + lo),
  fmt: (i) => fmt(i + lo),
});
const info = (num: number, mn: string, name: string, special: MenuItem['special']): MenuItem => ({
  num, mn, name, count: 1, special, get: () => 0, set: () => {}, fmt: () => '--',
});

export const MENU: MenuItem[] = [
  // 1x MIDI
  range(10, 'cL', 'MIDI channel Left', 1, 16, (c) => c.g.midiChL, (c, v) => (c.g.midiChL = v)),
  range(11, 'cr', 'MIDI channel Right', 1, 16, (c) => c.g.midiChR, (c, v) => (c.g.midiChR = v)),
  bool(12, 'oL', 'Omni Left (saved, unlike Rev4)', 'omniL'),
  bool(13, 'or', 'Omni Right', 'omniR'),
  bool(14, 'rn', 'Receive notes', 'rxNotes'),
  bool(15, 'rP', 'Receive program change', 'rxProgram'),
  bool(16, 'rS', 'Receive SysEx (Rev4 "MX")', 'rxSysex'),
  bool(17, 'tn', 'Transmit notes', 'txNotes'),
  bool(18, 'tP', 'Transmit program change', 'txProgram'),
  choice(19, 'PC', 'Program change selects', [['prog', 'Pr'], ['step', 'SP']], (c) => c.g.pcTarget, (c, v) => (c.g.pcTarget = v)),
  // 2x keyboard / velocity
  bool(20, 'Lo', 'Local control', 'localOn'),
  info(21, 'tA', 'User velocity taper (Rev4 page) - not in prototype yet', 'notYet'),
  range(22, 'SP', 'Split point (also: hold SPLIT + key)', 36, 96, (c) => c.perf.split, (c, v) => (c.perf.split = v), true, (n) => two(n % 100)),
  bool(23, 'rC', 'Receive parameter CC / NRPN', 'rxCtrl'),
  bool(24, 'tC', 'Transmit panel edits as CC (switches: NRPN)', 'txCtrl'),
  // 3x pots / UI
  choice(30, 'Pn', 'Pot mode', [['pickup', 'PU'], ['jump', 'JP'], ['relative', 'rL']], (c) => c.g.potMode, (c, v) => (c.g.potMode = v)),
  choice(31, 'tr', 'Normal-page trimmers', [['trim', 'tr'], ['direct', 'dI']], (c) => c.g.trimMode, (c, v) => (c.g.trimMode = v)),
  range(32, 'dh', 'Display hold (x100 ms)', 5, 30, (c) => Math.round(c.g.displayHoldMs / 100), (c, v) => (c.g.displayHoldMs = v * 100)),
  choice(33, 'PS', 'Power-on step', [['last', 'LA'], ['zero', '00']], (c) => c.g.powerOnStep, (c, v) => (c.g.powerOnStep = v)),
  // 4x footswitches (Rev4 Set page function codes)
  ...[0, 1, 2, 3].map((i) => range(40 + i, `F${i}`, `Footswitch ${['B Left', 'B Right', 'A Left', 'A Right'][i]} function`, 0, 99, (c) => c.g.fsw[i], (c, v) => (c.g.fsw[i] = v))),
  ...[0, 1, 2, 3].map((i) => choice(44 + i, `t${i}`, `Footswitch ${i} momentary/toggle`, [[false, 'no'], [true, 'to']], (c) => c.g.fswToggle[i], (c, v) => (c.g.fswToggle[i] = v))),
  // 5x arpeggiator / clock
  choice(50, 'AC', 'Arp clock', [['int', 'In'], ['ext', 'EH'], ['midi', 'nI']], (c) => c.g.arpClock, (c, v) => (c.g.arpClock = v)),
  range(51, 'AL', 'Arp octaves Left', 1, 4, (c) => c.perf.arpOctL, (c, v) => (c.perf.arpOctL = v), true),
  range(52, 'Ar', 'Arp octaves Right', 1, 4, (c) => c.perf.arpOctR, (c, v) => (c.perf.arpOctR = v), true),
  // 6x voice assignment
  range(60, 'SL', 'Key assign Left (0 norm,1 norm+same,2 circ,3 circ+same)', 0, 3, (c) => c.perf.assignL, (c, v) => (c.perf.assignL = v), true),
  range(61, 'Sr', 'Key assign Right', 0, 3, (c) => c.perf.assignR, (c, v) => (c.perf.assignR = v), true),
  choice(62, 'St', 'Voice stealing', [['oldest', 'od'], ['none', 'no']], (c) => c.g.steal, (c, v) => (c.g.steal = v)),
  range(63, 'ud', 'Unison detune spread', 0, 15, (c) => c.g.uniDetune, (c, v) => (c.g.uniDetune = v)),
  // 9x service
  { ...info(90, 'Ud', 'Voice disable: keys 0-7 toggle a voice', 'voices') },
  info(91, 'bt', 'Button test: shows the code of the last button', 'btnTest'),
  info(92, 'Pt', 'Pot test: shows the raw value of the last pot', 'potTest'),
  info(93, 'dt', 'Display test: all segments', 'dispTest'),
  info(94, 'nn', 'MIDI monitor: last byte received (hex)', 'midiMon'),
  info(95, 'tu', 'Autotune report', 'tuneReport'),
  { ...choice(99, 'rG', 'Reset globals (patches untouched): set YE, press STORE', [[false, 'no'], [true, 'YE']], () => false, () => {}), special: 'reset' },
];

export const menuByNum = new Map(MENU.map((m) => [m.num, m]));
