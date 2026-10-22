// VPK-5-style 61-key keyboard (C1..C6 = MIDI 36..96), computer-keyboard shortcuts and Web MIDI input.
import type { Backend, ButtonId } from '../types';
import type { Panel } from './panel';

const NS = 'http://www.w3.org/2000/svg';
const LOW = 36;
const HIGH = 96;
const isBlack = (n: number) => [1, 3, 6, 8, 10].includes(n % 12);

// computer keys -> semitone offset from the current base C
const NOTE_KEYS: Record<string, number> = { z: 0, s: 1, x: 2, d: 3, c: 4, v: 5, g: 6, b: 7, h: 8, n: 9, j: 10, m: 11, ',': 12, l: 13, '.': 14 };
// computer keys -> panel buttons
export const PANEL_KEYS: Record<string, ButtonId> = {
  '1': 'k1', '2': 'k2', '3': 'k3', '4': 'k4', '5': 'k5', '6': 'k6', '7': 'k7', '8': 'k8', '9': 'k9', '0': 'k0',
  ']': 'fwd', '[': 'rev', Escape: 'edit', Enter: 'store', Shift: 'a440',
  q: 'call_l', w: 'call_r', e: 'step_enable', r: 'step_load', t: 'kb_split', y: 'kb_whole', u: 'kb_layer',
};

export class Keyboard {
  readonly svg: SVGSVGElement;
  private keyEls = new Map<number, SVGRectElement>();
  private down = new Set<number>();
  base = 60;
  velocity = 100;
  private backend: Backend;
  held = new Set<ButtonId>();
  private syntheticShift = new Set<ButtonId>();

  constructor(host: HTMLElement, backend: Backend, private panel: Panel) {
    this.backend = backend;
    const whites = [];
    for (let n = LOW; n <= HIGH; n++) if (!isBlack(n)) whites.push(n);
    const W = 22;
    const fr = document.createElement('div'); // VPK-5 front buttons
    fr.className = 'kbd-btns';
    for (const [id, label] of [['rev', 'REV'], ['fwd', 'FWD']] as const) {
      const b = document.createElement('button');
      b.textContent = label;
      b.title = `keyboard ${label} (hold: auto-repeat on the ROM)`;
      b.addEventListener('mousedown', (ev) => {
        ev.preventDefault();
        this.backend.kbdButton?.(id, true);
        const up = () => { this.backend.kbdButton?.(id, false); window.removeEventListener('mouseup', up); };
        window.addEventListener('mouseup', up);
      });
      fr.appendChild(b);
    }
    host.appendChild(fr);
    this.svg = document.createElementNS(NS, 'svg');
    this.svg.setAttribute('viewBox', `0 0 ${whites.length * W} 110`);
    this.svg.setAttribute('class', 'keyboard');
    host.appendChild(this.svg);
    const mk = (n: number, x: number, w: number, h: number, cls: string) => {
      const r = document.createElementNS(NS, 'rect');
      Object.entries({ x, y: 0, width: w, height: h, rx: 2, class: cls }).forEach(([k, v]) => r.setAttribute(k, String(v)));
      r.addEventListener('mousedown', (ev) => {
        ev.preventDefault();
        this.noteOn(n);
        const up = () => { this.noteOff(n); window.removeEventListener('mouseup', up); };
        window.addEventListener('mouseup', up);
      });
      this.svg.appendChild(r);
      this.keyEls.set(n, r);
    };
    whites.forEach((n, i) => mk(n, i * W, W - 1, 110, 'wkey'));
    let wi = 0;
    for (let n = LOW; n <= HIGH; n++) {
      if (isBlack(n)) mk(n, wi * W - 7, 14, 68, 'bkey');
      else wi++;
    }
    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
  }

  setBackend(b: Backend) { this.backend = b; }

  noteOn(n: number) {
    if (this.down.has(n)) return;
    this.down.add(n);
    this.keyEls.get(n)?.classList.add('down');
    this.backend.key(n, true, this.velocity);
  }
  noteOff(n: number) {
    if (!this.down.has(n)) return;
    this.down.delete(n);
    this.keyEls.get(n)?.classList.remove('down');
    this.backend.key(n, false, 64);
  }

  private onKey(e: KeyboardEvent, isDown: boolean) {
    if ((e.target as HTMLElement)?.tagName === 'INPUT' || e.metaKey || e.ctrlKey) return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (k === 'ArrowLeft' || k === 'ArrowRight') {
      if (isDown) this.base = Math.max(LOW, Math.min(HIGH - 12, this.base + (k === 'ArrowLeft' ? -12 : 12)));
      e.preventDefault();
      return;
    }
    const btn = PANEL_KEYS[e.key] ?? PANEL_KEYS[k];
    if (btn) {
      e.preventDefault();
      if (e.repeat) return;
      if (isDown) this.held.add(btn); else this.held.delete(btn);
      // Shift+key without a separate Shift keydown (some keyboards/automation): synthesize the A440 hold
      if (btn !== 'a440' && isDown && e.shiftKey && !this.held.has('a440')) {
        this.syntheticShift.add(btn);
        this.backend.button('a440', true);
      }
      if (!(btn === 'a440' && this.panel.sticky.has('a440'))) this.backend.button(btn, isDown);
      if (!isDown && this.syntheticShift.delete(btn)) this.backend.button('a440', false);
      return;
    }
    if (k in NOTE_KEYS) {
      e.preventDefault();
      if (e.repeat) return;
      const n = this.base + NOTE_KEYS[k];
      if (isDown) this.noteOn(n); else this.noteOff(n);
    }
  }

  async connectMidi(status: (s: string) => void) {
    const nav = navigator as Navigator & { requestMIDIAccess?: (o?: { sysex: boolean }) => Promise<MIDIAccess> };
    if (!nav.requestMIDIAccess) return status('Web MIDI not available in this browser (use Chrome/Edge)');
    try {
      const access = await nav.requestMIDIAccess({ sysex: true });
      const names: string[] = [];
      access.inputs.forEach((inp) => {
        names.push(inp.name ?? 'input');
        inp.onmidimessage = (m) => {
          const d = Array.from(m.data ?? []);
          const t = d[0] & 0xf0;
          if (t === 0x90 && d[2] > 0) { this.velocity = d[2]; this.noteOn(d[1]); }
          else if (t === 0x80 || (t === 0x90 && d[2] === 0)) this.noteOff(d[1]);
          else this.backend.midiIn(d);
        };
      });
      status(names.length ? `MIDI in: ${names.join(', ')}` : 'no MIDI inputs found');
    } catch (err) {
      status(`MIDI refused: ${(err as Error).message}`);
    }
  }
}
