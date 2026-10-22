// Shared types between the panel (view) and the back ends (Prototype now, Machine later).

export const BUTTONS = [
  'mute',
  'kb_whole', 'kb_split', 'kb_layer', 'uni_l', 'uni_r',
  'call_l', 'oct_l', 'oct_r', 'call_r', 'step_load', 'step_enable',
  'edit', 'store', 'tape_load', 'tape_dump',
  'k1', 'k2', 'k3', 'k4', 'k5', 'k6', 'k7', 'k8', 'k9', 'fwd', 'k0', 'rev',
  'reldef_l', 'pbdef_l', 'hold_l', 'reldef_r', 'pbdef_r', 'hold_r',
  'arp_up', 'arp_down', 'arp_random', 'arp_left', 'arp_pause', 'arp_right',
  'autotune', 'a440',
] as const;
export type ButtonId = (typeof BUTTONS)[number];

export const POTS = [
  'l_a', 'l_r', 'l_lfo', 'l_glide', 'l_fc', 'l_detune', 'l_vol',
  'r_a', 'r_r', 'r_lfo', 'r_glide', 'r_fc', 'r_detune', 'r_vol',
  'arp_speed',
] as const;
export type PotId = (typeof POTS)[number];

export const POT_MAX = 1023;

export type LedState = 'off' | 'on' | 'blink';

/** What the panel needs to draw one frame. Segments: bit0..6 = a..g (standard), bit7 = DP. */
export interface Frame {
  segments: number[]; // 6 digits: LEFT(0,1) RIGHT(2,3) STEP(4,5)
  leds: Partial<Record<ButtonId, boolean>>; // already resolved for blinking
  octL: [boolean, boolean, boolean]; // up, normal, down
  octR: [boolean, boolean, boolean];
}

export interface VoiceView {
  note: number | null;
  side: 'L' | 'R' | null;
  gate: boolean;
  disabled: boolean;
}

export interface Backend {
  readonly name: string;
  button(id: ButtonId, down: boolean): void;
  pot(id: PotId, value: number): void;
  key(note: number, down: boolean, velocity: number): void;
  midiIn(bytes: number[]): void;
  setProtect(on: boolean): void;
  run(ms: number): void;
  frame(): Frame;
  /** free-form state for the inspector and the tests */
  inspect(): Record<string, unknown>;
  /** VPK-5 keyboard front buttons REV / FWD (the same as the panel's; the ROM adds auto-repeat) */
  kbdButton?(id: 'fwd' | 'rev', down: boolean): void;
  /** bytes the instrument sends to MIDI OUT (SysEx dumps etc.) since the last call */
  drainMidiOut(): number[];
}

export interface EnumDef { v: number; t: string; name: string }
export interface ParamDef {
  id: string; name: string; mn: string;
  byte: number; shift: number; width: number;
  activeLow: boolean; enum: string | null;
  conf: string; note: string | null; bank: string | null;
  /** MIDI CC (multi-bit params; an 8-bit param also uses cc + 32 for the LSB). null = switch, sent as NRPN. */
  cc: number | null;
}
export interface ButtonBinding {
  param?: string; onWhen?: number;
  field?: { param: string; bit: number; onWhen: number };
  select?: { var: string; value: number };
  label: string;
}
export interface PotBinding { param: string; mode?: 'fine' | 'coarse12' | 'fine12'; label: string }
export interface PageDef {
  id: string; title: string; disp: string;
  buttons: Partial<Record<ButtonId, ButtonBinding>>;
  keypad?: { var?: string; targets: Record<string, string>; keys: Record<string, number>; label: string };
  window?: { var?: string; show?: string; param?: string };
  pots: Partial<Record<PotId, PotBinding>>;
}
