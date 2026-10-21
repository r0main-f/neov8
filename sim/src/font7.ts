// 7-segment font. Bits: a=0 (top) b=1 (top right) c=2 (bottom right) d=3 (bottom)
// e=4 (bottom left) f=5 (top left) g=6 (middle), dp=7.
// Lower/upper case are distinct where a 7-seg can show both (b/B -> b, c/C, h/H, o/O, u/U, n, r, t, q ...).
const a = 1, b = 2, c = 4, d = 8, e = 16, f = 32, g = 64;

const FONT: Record<string, number> = {
  ' ': 0,
  '0': a | b | c | d | e | f, '1': b | c, '2': a | b | d | e | g, '3': a | b | c | d | g,
  '4': b | c | f | g, '5': a | c | d | f | g, '6': a | c | d | e | f | g, '7': a | b | c,
  '8': a | b | c | d | e | f | g, '9': a | b | c | d | f | g,
  A: a | b | c | e | f | g, b: c | d | e | f | g, C: a | d | e | f, c: d | e | g, d: b | c | d | e | g,
  E: a | d | e | f | g, F: a | e | f | g, G: a | c | d | e | f, H: b | c | e | f | g, h: c | e | f | g,
  I: e | f, i: e, J: b | c | d, L: d | e | f, N: a | b | c | e | f, n: c | e | g, O: a | b | c | d | e | f,
  o: c | d | e | g, P: a | b | e | f | g, q: a | b | c | f | g, r: e | g, S: a | c | d | f | g,
  t: d | e | f | g, U: b | c | d | e | f, u: c | d | e, Y: b | c | d | f | g, y: b | c | d | f | g,
  '-': g, _: d, '‾': a, '+': e | f | g, '=': d | g, "'": f, '"': b | f, '?': a | b | e | g,
};
// common aliases
for (const [k, v] of Object.entries({ B: 'b', D: 'd', K: 'H', M: 'N', m: 'n', Q: 'q', R: 'r', T: 't', V: 'U', v: 'u', W: 'U', w: 'u', X: 'H', x: 'H', Z: '2', z: '2', a: 'A', e: 'E', f: 'F', g: 'G', j: 'J', l: 'L', p: 'P', s: 'S', k: 'H' }))
  FONT[k] = FONT[v];

export const DP = 128;

export function seg(ch: string): number {
  return FONT[ch] ?? FONT['?'];
}

/** Render a 6-char string (3 windows of 2). A '.' after a char sets that digit's DP. */
export function renderText(text: string): number[] {
  const out: number[] = [];
  for (const ch of text) {
    if (ch === '.' && out.length) out[out.length - 1] |= DP;
    else out.push(seg(ch));
  }
  while (out.length < 6) out.push(0);
  return out.slice(0, 6);
}

/** Reverse map for tests/inspector: segments -> best char. */
export function segToChar(s: number): string {
  const m = s & 127;
  for (const [k, v] of Object.entries(FONT)) if (v === m) return k;
  return '?';
}
