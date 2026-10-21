// Front-panel geometry, after the Rev4 Reference Guide p.4 drawing (module front panel).
// Units: SVG user units, viewBox 0 0 1400 440.
import type { ButtonId, PotId } from '../types';

export interface BtnGeo { id: ButtonId; x: number; y: number; label: string; color: 'blue' | 'white' | 'grey' | 'red' }
export interface PotGeo { id: PotId; x: number; y: number; label: string; analog?: boolean }
export interface BoxGeo { x: number; y: number; w: number; h: number; title?: string; titleAt?: 'top' | 'bottom' }

export const VIEW = { w: 1400, h: 440 };

const keypad: BtnGeo[] = [];
const kp: [ButtonId, string][][] = [
  [['k1', '1'], ['k2', '2'], ['k3', '3']],
  [['k4', '4'], ['k5', '5'], ['k6', '6']],
  [['k7', '7'], ['k8', '8'], ['k9', '9']],
  [['fwd', 'FWD'], ['k0', '0'], ['rev', 'REV']],
];
kp.forEach((row, r) => row.forEach(([id, label], c) => keypad.push({ id, x: 283 + c * 50, y: 212 + r * 52, label, color: 'white' })));

export const BUTTONS_GEO: BtnGeo[] = [
  { id: 'mute', x: 55, y: 70, label: 'AUDIO MUTE', color: 'grey' },
  { id: 'kb_whole', x: 140, y: 75, label: 'WHOLE 8 VOICE', color: 'blue' },
  { id: 'kb_split', x: 140, y: 135, label: 'SPLIT', color: 'blue' },
  { id: 'kb_layer', x: 140, y: 195, label: 'LAYER', color: 'blue' },
  { id: 'uni_l', x: 140, y: 305, label: 'UNISON L', color: 'blue' },
  { id: 'uni_r', x: 140, y: 365, label: 'UNISON R', color: 'blue' },
  { id: 'call_l', x: 228, y: 64, label: 'CALL', color: 'red' },
  { id: 'oct_l', x: 283, y: 64, label: 'OCTAVE', color: 'grey' },
  { id: 'oct_r', x: 392, y: 64, label: 'OCTAVE', color: 'grey' },
  { id: 'call_r', x: 447, y: 64, label: 'CALL', color: 'red' },
  { id: 'step_load', x: 508, y: 64, label: 'LOAD', color: 'grey' },
  { id: 'step_enable', x: 560, y: 64, label: 'ENABLE', color: 'red' },
  { id: 'edit', x: 220, y: 212, label: 'EDIT', color: 'red' },
  { id: 'store', x: 220, y: 264, label: 'STORE', color: 'red' },
  { id: 'tape_load', x: 220, y: 316, label: 'TAPE LOAD', color: 'grey' },
  { id: 'tape_dump', x: 220, y: 368, label: 'TAPE DUMP', color: 'grey' },
  ...keypad,
  { id: 'reldef_l', x: 460, y: 255, label: 'REL DEF', color: 'grey' },
  { id: 'pbdef_l', x: 520, y: 255, label: 'BEND DEF', color: 'grey' },
  { id: 'hold_l', x: 580, y: 255, label: 'HOLD', color: 'grey' },
  { id: 'reldef_r', x: 460, y: 335, label: '', color: 'grey' },
  { id: 'pbdef_r', x: 520, y: 335, label: '', color: 'grey' },
  { id: 'hold_r', x: 580, y: 335, label: '', color: 'grey' },
  { id: 'arp_up', x: 650, y: 62, label: 'UP', color: 'white' },
  { id: 'arp_down', x: 730, y: 62, label: 'DOWN', color: 'white' },
  { id: 'arp_random', x: 810, y: 62, label: 'RANDOM', color: 'white' },
  { id: 'arp_left', x: 650, y: 128, label: 'LEFT', color: 'white' },
  { id: 'arp_pause', x: 730, y: 128, label: 'PAUSE', color: 'white' },
  { id: 'arp_right', x: 810, y: 128, label: 'RIGHT', color: 'white' },
  { id: 'autotune', x: 960, y: 125, label: 'AUTO TUNE', color: 'grey' },
  { id: 'a440', x: 1020, y: 125, label: 'A 440', color: 'grey' },
];

const TRIM_LABELS = ['A', 'R', 'LFO RATE', 'GLIDE', 'Fc', 'DETUNE', 'VOLUME'];
const TRIM_IDS = ['a', 'r', 'lfo', 'glide', 'fc', 'detune', 'vol'];
export const POTS_GEO: PotGeo[] = [
  ...TRIM_IDS.map((t, i) => ({ id: `l_${t}` as PotId, x: 720 + i * 95, y: 235, label: TRIM_LABELS[i] })),
  ...TRIM_IDS.map((t, i) => ({ id: `r_${t}` as PotId, x: 720 + i * 95, y: 330, label: TRIM_LABELS[i] })),
  { id: 'arp_speed', x: 875, y: 95, label: 'SPEED' },
];
export const ANALOG_KNOBS = [
  { x: 55, y: 165, label: 'KEYBOARD INPUT' },
  { x: 1130, y: 112, label: 'MASTER TUNE' },
  { x: 1220, y: 112, label: 'MASTER VOLUME' },
];

export const DIGITS_GEO = [
  { x: 200, y: 98 }, { x: 240, y: 98 }, // LEFT
  { x: 365, y: 98 }, { x: 405, y: 98 }, // RIGHT
  { x: 495, y: 98 }, { x: 535, y: 98 }, // STEP
];
export const OCT_LEDS = { L: { x: 330, ys: [106, 124, 142] }, R: { x: 350, ys: [106, 124, 142] } };

export const BOXES: BoxGeo[] = [
  { x: 100, y: 25, w: 80, h: 230, title: 'KBD MODE' },
  { x: 100, y: 265, w: 80, h: 150, title: 'UNISON' },
  { x: 190, y: 25, w: 405, h: 140 },
  { x: 190, y: 180, w: 230, h: 235, title: 'PROGRAMMER', titleAt: 'bottom' },
  { x: 430, y: 200, w: 175, h: 215 },
  { x: 615, y: 25, w: 290, h: 140, title: 'ARPEGGIATOR' },
  { x: 915, y: 25, w: 470, h: 140 },
  { x: 615, y: 180, w: 770, h: 235, title: 'PROGRAM PARAMETER TRIMMERS', titleAt: 'bottom' },
];

export const ROW_LABELS = [{ x: 440, y: 259, t: 'L' }, { x: 440, y: 339, t: 'R' }, { x: 640, y: 239, t: 'LEFT' }, { x: 640, y: 334, t: 'RIGHT' }];

export const WINDOW_TITLES = [
  { x: 255, y: 37, t: 'LEFT' }, { x: 420, y: 37, t: 'RIGHT' }, { x: 534, y: 37, t: 'STEP' },
];
