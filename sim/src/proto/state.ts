// State shapes of the NeoV8 prototype.

export type Side = 'L' | 'R';
export type KbMode = 'whole' | 'split' | 'layer';
export type ArpMode = 'up' | 'down' | 'updown' | 'random';

export interface Trims { a: number; r: number; lfo: number; glide: number; fc: number; detune: number; vol: number }
export const ZERO_TRIMS: Trims = { a: 0, r: 0, lfo: 0, glide: 0, fc: 0, detune: 0, vol: 0 };

/**
 * A Step (performance). The real Rev4 30-byte layout is decoded in Phase 0 (docs/rev4-ram-map.md);
 * until then the prototype keeps it as an object with the fields the Reference Guide lists.
 */
export interface Perf {
  progL: number; progR: number;
  kbMode: KbMode; split: number; // MIDI note of the first key of the right side
  uniL: boolean; uniR: boolean;
  octL: number; octR: number; // -1, 0, +1
  holdL: boolean; holdR: boolean;
  relDefL: boolean; relDefR: boolean;
  pbDefL: boolean; pbDefR: boolean;
  arpMode: ArpMode; arpL: boolean; arpR: boolean; arpPause: boolean;
  arpOctL: number; arpOctR: number; // 1..4
  arpSpeed: number; // 0..127
  assignL: number; assignR: number; // Rev4 key assign modes 0..3
  trimL: Trims; trimR: Trims;
}

export function defaultPerf(): Perf {
  return {
    progL: 0, progR: 0, kbMode: 'whole', split: 60,
    uniL: false, uniR: false, octL: 0, octR: 0,
    holdL: false, holdR: false, relDefL: false, relDefR: false, pbDefL: false, pbDefR: false,
    arpMode: 'up', arpL: false, arpR: false, arpPause: false, arpOctL: 1, arpOctR: 1, arpSpeed: 64,
    assignL: 0, assignR: 0, trimL: { ...ZERO_TRIMS }, trimR: { ...ZERO_TRIMS },
  };
}

export type PotMode = 'pickup' | 'jump' | 'relative';

export interface Globals {
  midiChL: number; midiChR: number; omniL: boolean; omniR: boolean;
  rxNotes: boolean; rxProgram: boolean; rxSysex: boolean; txNotes: boolean; txProgram: boolean;
  pcTarget: 'prog' | 'step';
  localOn: boolean;
  potMode: PotMode;
  trimMode: 'trim' | 'direct';
  displayHoldMs: number;
  powerOnStep: 'last' | 'zero';
  fsw: [number, number, number, number]; // footswitch function codes (Rev4 Set page codes)
  fswToggle: [boolean, boolean, boolean, boolean];
  arpClock: 'int' | 'ext' | 'midi';
  steal: 'oldest' | 'none';
  uniDetune: number; // 0..15
  voiceMask: number; // bit set = voice disabled
}

export function defaultGlobals(): Globals {
  return {
    midiChL: 2, midiChR: 1, omniL: false, omniR: false,
    rxNotes: true, rxProgram: true, rxSysex: true, txNotes: true, txProgram: true,
    pcTarget: 'prog', localOn: true,
    potMode: 'pickup', trimMode: 'trim', displayHoldMs: 1500, powerOnStep: 'last',
    fsw: [34, 35, 52, 99], fswToggle: [false, false, true, false],
    arpClock: 'int', steal: 'oldest', uniDetune: 3, voiceMask: 0,
  };
}

export interface Voice { note: number | null; side: Side | null; gate: boolean; age: number; lastNote: number | null }
