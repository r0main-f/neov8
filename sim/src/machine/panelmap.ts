// How the 8279's display RAM drives the panel, decoded from the stock ROM (docs/hardware.md §5.2-5.4):
// digits from SEGFONT $A080, LEDs from LEDTAB $A09D, positions from the display writer $A2CA.
import type { ButtonId, Frame } from '../types';

export const DISPLAY_MAP = {
  status: 'decoded from stock ROM',
  /** display-RAM index of LEFT tens, LEFT units, RIGHT tens, RIGHT units, STEP tens, STEP units (RIGHT is wired reversed) */
  digits: [1, 2, 5, 4, 7, 8],
  /** source bit for segment a, b, c, d, e, f, g, dp  (font bits: 7=a 6=c 5=f 4=b 3=e 2=d 1=g 0=dp) */
  segBits: [7, 4, 6, 2, 3, 5, 1, 0],
  /** button LEDs: [display RAM index, bit] */
  leds: {
    mute: [0, 7], kb_split: [0, 5], kb_layer: [0, 4], uni_l: [0, 3], uni_r: [0, 2], kb_whole: [0, 1],
    arp_left: [6, 7], pbdef_r: [6, 6], hold_l: [6, 4], reldef_l: [6, 3], reldef_r: [6, 2], hold_r: [6, 1], pbdef_l: [6, 0],
    arp_up: [9, 7], arp_pause: [9, 6], arp_random: [9, 5], arp_down: [9, 4], autotune: [9, 3], a440: [9, 1], arp_right: [9, 0],
  } as Partial<Record<ButtonId, [number, number]>>,
  /** octave LEDs [up, normal, down] (flags $6E + 2*state + side; state 0 = down, 2 = up) */
  octL: [[3, 7], [3, 5], [3, 2]] as [number, number][],
  octR: [[3, 4], [3, 1], [3, 3]] as [number, number][],
  /** LED bits never driven on the Normal page ($6A-$6D): probably EDIT, STORE, TAPE LOAD, TAPE DUMP — order unknown */
  unknown: [[0, 6], [0, 0], [3, 6], [3, 0]] as [number, number][],
};

/** Buttons that physically have an LED on the Rev4 panel (as far as the ROM shows). */
export const BUTTONS_WITH_LED = new Set<ButtonId>(Object.keys(DISPLAY_MAP.leds) as ButtonId[]);

export function decodeSegments(ram: Uint8Array): Frame {
  const m = DISPLAY_MAP;
  const segments = m.digits.map((i) => {
    const b = ram[i];
    let s = 0;
    m.segBits.forEach((src, dst) => { if (b & (1 << src)) s |= 1 << dst; });
    return s;
  });
  const bit = ([i, b]: [number, number]) => !!(ram[i] & (1 << b));
  const leds: Frame['leds'] = {};
  for (const [id, loc] of Object.entries(m.leds)) leds[id as ButtonId] = bit(loc!);
  const oct = (l: [number, number][]): [boolean, boolean, boolean] => [bit(l[0]), bit(l[1]), bit(l[2])];
  return { segments, leds, octL: oct(m.octL), octR: oct(m.octR) };
}
