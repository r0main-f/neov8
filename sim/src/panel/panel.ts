// SVG front panel: draws the module, routes mouse input to the back end, renders frames.
import type { Backend, ButtonId, Frame, PotId } from '../types';
import { POT_MAX } from '../types';
import { BUTTONS_GEO, POTS_GEO, DIGITS_GEO, OCT_LEDS, BOXES, ANALOG_KNOBS, WINDOW_TITLES, ROW_LABELS, VIEW } from './layout';
import type { Overlay } from './overlays';
import { LED_BUTTONS } from '../proto/proto';

const NS = 'http://www.w3.org/2000/svg';
function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, parent?: Element): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  parent?.appendChild(e);
  return e;
}

// segment polygons for a 34x56 digit cell (a..g), plus dp
const SEG_PATHS = [
  'M6,2 L28,2 L24,7 L10,7 Z', // a
  'M29,3 L29,26 L25,23 L25,8 Z', // b
  'M29,30 L29,53 L25,48 L25,33 Z', // c
  'M6,54 L28,54 L24,49 L10,49 Z', // d
  'M5,30 L5,53 L9,48 L9,33 Z', // e
  'M5,3 L5,26 L9,23 L9,8 Z', // f
  'M7,28 L11,25 L23,25 L27,28 L23,31 L11,31 Z', // g
];

export class Panel {
  readonly svg: SVGSVGElement;
  private ledEls = new Map<ButtonId, SVGCircleElement>();
  private btnEls = new Map<ButtonId, SVGGElement>();
  private labelEls = new Map<ButtonId, SVGTextElement>();
  private shiftEls = new Map<ButtonId, SVGTextElement>();
  private potEls = new Map<PotId, { ptr: SVGLineElement; label: SVGTextElement; val: SVGTextElement }>();
  private segEls: SVGPathElement[][] = [];
  private dpEls: SVGCircleElement[] = [];
  private octEls: SVGCircleElement[] = [];
  private banner: SVGTextElement;
  readonly potValues = new Map<PotId, number>();
  readonly sticky = new Set<ButtonId>();
  private backend: Backend;

  constructor(host: HTMLElement, backend: Backend) {
    this.backend = backend;
    this.svg = el('svg', { viewBox: `0 0 ${VIEW.w} ${VIEW.h}`, class: 'panel' });
    host.appendChild(this.svg);
    el('rect', { x: 0, y: 0, width: VIEW.w, height: VIEW.h, rx: 10, class: 'faceplate' }, this.svg);
    for (const b of BOXES) {
      el('rect', { x: b.x, y: b.y, width: b.w, height: b.h, rx: 8, class: 'box' }, this.svg);
      if (b.title) {
        const t = el('text', { x: b.x + b.w / 2, y: b.titleAt === 'bottom' ? b.y + b.h - 8 : b.y + 16, class: 'boxtitle' }, this.svg);
        t.textContent = b.title;
      }
    }
    for (const w of [...WINDOW_TITLES, ...ROW_LABELS]) el('text', { x: w.x, y: w.y, class: 'boxtitle' }, this.svg).textContent = w.t;
    const brand = el('text', { x: 1150, y: 58, class: 'brand' }, this.svg);
    brand.textContent = 'VOYETRA EIGHT';
    el('text', { x: 1150, y: 76, class: 'brandsub' }, this.svg).textContent = 'polyphonic synthesizer module  ·  NeoV8';
    this.banner = el('text', { x: VIEW.w / 2, y: VIEW.h - 4, class: 'banner' }, this.svg);
    // fake analog-only controls
    for (const k of ANALOG_KNOBS) {
      el('circle', { cx: k.x, cy: k.y, r: 18, class: 'knob analog' }, this.svg);
      el('text', { x: k.x, y: k.y + 34, class: 'potlabel' }, this.svg).textContent = k.label;
    }
    el('rect', { x: 30, y: 300, width: 50, height: 50, rx: 6, class: 'xlr' }, this.svg);
    el('circle', { cx: 55, cy: 325, r: 16, class: 'xlrhole' }, this.svg);
    el('text', { x: 55, y: 370, class: 'potlabel' }, this.svg).textContent = 'KEYBOARD INPUT';

    this.buildDigits();
    this.buildButtons();
    this.buildPots();
  }

  setBackend(b: Backend) {
    this.backend = b;
    for (const [id, v] of this.potValues) b.pot(id, v);
  }

  private buildDigits() {
    DIGITS_GEO.forEach((d, i) => {
      const g = el('g', { transform: `translate(${d.x},${d.y})` }, this.svg);
      el('rect', { x: -2, y: -2, width: 40, height: 62, class: 'digitbg' }, g);
      this.segEls[i] = SEG_PATHS.map((p) => el('path', { d: p, class: 'seg' }, g));
      this.dpEls[i] = el('circle', { cx: 33, cy: 53, r: 2.6, class: 'seg' }, g);
    });
    for (const side of ['L', 'R'] as const) {
      const o = OCT_LEDS[side];
      for (const y of o.ys) this.octEls.push(el('circle', { cx: o.x, cy: y, r: 4, class: 'led' }, this.svg));
    }
    for (const [i, t] of ['up', 'nor', 'dn'].entries()) el('text', { x: 340, y: OCT_LEDS.L.ys[i] + 3, class: 'tiny' }, this.svg).textContent = t;
  }

  private buildButtons() {
    for (const b of BUTTONS_GEO) {
      const g = el('g', { transform: `translate(${b.x},${b.y})`, class: `btn ${b.color}`, 'data-id': b.id }, this.svg);
      el('rect', { x: -15, y: -11, width: 30, height: 22, rx: 3, class: 'cap' }, g);
      if (LED_BUTTONS.has(b.id)) this.ledEls.set(b.id, el('circle', { cx: -9, cy: -5, r: 3, class: 'led' }, g));
      const isKey = /^k\d$/.test(b.id);
      if (isKey || b.id === 'fwd' || b.id === 'rev') {
        const t = el('text', { x: 0, y: 5, class: 'capnum' }, g);
        t.textContent = isKey ? b.id.slice(1) : '';
      }
      const lab = el('text', { x: 0, y: 24, class: 'blabel' }, g);
      this.labelEls.set(b.id, lab);
      const sh = el('text', { x: 0, y: -15, class: 'shiftlabel' }, g);
      this.shiftEls.set(b.id, sh);
      this.btnEls.set(b.id, g);
      g.addEventListener('mousedown', (ev) => {
        ev.preventDefault();
        if (ev.button === 2) return;
        if (ev.shiftKey && b.id !== 'a440') this.backend.button('a440', true);
        this.backend.button(b.id, true);
        const up = () => {
          this.backend.button(b.id, false);
          if (ev.shiftKey && b.id !== 'a440' && !this.sticky.has('a440')) this.backend.button('a440', false);
          window.removeEventListener('mouseup', up);
        };
        if (!this.sticky.has(b.id)) window.addEventListener('mouseup', up);
      });
      g.addEventListener('contextmenu', (ev) => {
        // right click = latch the button down (for chords such as EDIT+digit or holding SPLIT)
        ev.preventDefault();
        if (this.sticky.has(b.id)) {
          this.sticky.delete(b.id);
          this.backend.button(b.id, false);
        } else {
          this.sticky.add(b.id);
          this.backend.button(b.id, true);
        }
      });
    }
  }

  private buildPots() {
    for (const p of POTS_GEO) {
      const g = el('g', { transform: `translate(${p.x},${p.y})`, class: 'pot', 'data-id': p.id }, this.svg);
      for (let i = 0; i <= 10; i++) {
        const a = ((-135 + i * 27) * Math.PI) / 180;
        el('line', { x1: Math.sin(a) * 25, y1: -Math.cos(a) * 25, x2: Math.sin(a) * 29, y2: -Math.cos(a) * 29, class: 'tick' }, g);
      }
      el('circle', { r: 21, class: 'knob' }, g);
      const ptr = el('line', { x1: 0, y1: 0, x2: 0, y2: -18, class: 'ptr' }, g);
      const label = el('text', { x: 0, y: 44, class: 'potlabel' }, g);
      const val = el('text', { x: 0, y: 4, class: 'potval' }, g);
      this.potEls.set(p.id, { ptr, label, val });
      this.potValues.set(p.id, 512);
      this.drawPot(p.id);
      g.addEventListener('mousedown', (ev) => {
        ev.preventDefault();
        const y0 = ev.clientY;
        const v0 = this.potValues.get(p.id)!;
        g.classList.add('active');
        const move = (e: MouseEvent) => this.setPot(p.id, v0 + (y0 - e.clientY) * (e.shiftKey ? 1 : 5));
        const up = () => {
          g.classList.remove('active');
          window.removeEventListener('mousemove', move);
          window.removeEventListener('mouseup', up);
        };
        window.addEventListener('mousemove', move);
        window.addEventListener('mouseup', up);
      });
      g.addEventListener('wheel', (ev) => {
        ev.preventDefault();
        this.setPot(p.id, this.potValues.get(p.id)! - Math.sign(ev.deltaY) * 16);
      }, { passive: false });
    }
  }

  setPot(id: PotId, v: number) {
    const val = Math.max(0, Math.min(POT_MAX, Math.round(v)));
    this.potValues.set(id, val);
    this.drawPot(id);
    this.backend.pot(id, val);
  }

  private drawPot(id: PotId) {
    const e = this.potEls.get(id)!;
    const v = this.potValues.get(id)!;
    e.ptr.setAttribute('transform', `rotate(${-135 + (v / POT_MAX) * 270})`);
    e.val.textContent = String(Math.round((v / POT_MAX) * 127));
  }

  render(f: Frame, ov: Overlay, held: Set<ButtonId>) {
    f.segments.forEach((s, i) => {
      this.segEls[i].forEach((p, b) => p.classList.toggle('on', !!(s & (1 << b))));
      this.dpEls[i].classList.toggle('on', !!(s & 128));
    });
    [...f.octL, ...f.octR].forEach((on, i) => this.octEls[i].classList.toggle('on', on));
    for (const [id, led] of this.ledEls) led.classList.toggle('on', !!f.leds[id]);
    for (const [id, g] of this.btnEls) {
      g.classList.toggle('held', held.has(id));
      g.classList.toggle('sticky', this.sticky.has(id));
    }
    for (const [id, t] of this.labelEls) setWrapped(t, ov.buttons[id] ?? '', 11);
    for (const [id, t] of this.shiftEls) {
      const s = ov.shift[id] ?? '';
      if (t.textContent !== s) t.textContent = s;
    }
    for (const [id, e] of this.potEls) setWrapped(e.label, ov.pots[id] ?? '', 14);
    if (this.banner.textContent !== ov.banner) this.banner.textContent = ov.banner;
  }
}

/** Writes a label on up to two lines (tspans) so long overlay names don't collide. */
function setWrapped(t: SVGTextElement, s: string, max: number) {
  if (t.dataset.v === s) return;
  t.dataset.v = s;
  while (t.firstChild) t.removeChild(t.firstChild);
  const words = s.split(' ');
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if (cur && (cur + ' ' + w).length > max && lines.length < 1) { lines.push(cur); cur = w; }
    else cur = cur ? `${cur} ${w}` : w;
  }
  if (cur) lines.push(cur);
  const x = t.getAttribute('x') ?? '0';
  lines.forEach((l, i) => {
    const sp = document.createElementNS(NS, 'tspan');
    sp.setAttribute('x', x);
    if (i) sp.setAttribute('dy', '9');
    sp.textContent = l;
    t.appendChild(sp);
  });
}
