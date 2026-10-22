// NeoV8 navigation prototype: the UX of docs/ux-spec.md implemented directly in TypeScript.
// It works on real 45-byte programs and is driven by the generated parameter/page tables.
// The firmware (Phase 3) must pass the same spec/scenarios as this class.
import { PAGES, PARAMS } from '../gen/params';
import { renderText, DP } from '../font7';
import type { Backend, ButtonId, Frame, PageDef, PotId, ButtonBinding, PotBinding, VoiceView } from '../types';
import { POT_MAX, BUTTONS } from '../types';
import {
  PARAM, NUM_PROGRAMS, getRaw, setRaw, isOn, setOn, enumText, maxOf, demoBank, nullProgram, equal,
  encodeProgramDump, parseSysex, decodeProgramBody, noteName, describe,
} from './patch';
import { MENU, menuByNum, type MenuItem } from './menu';
import { ProtoSeq, QUANT_NAMES, QUANT_TICKS, STATUS_TEXT } from './seq';
import { defaultGlobals, defaultPerf, type Globals, type Perf, type Side, type Trims, type Voice } from './state';

const PAGE_ORDER = ['P1', 'P2', 'A', 'B', 'C', 'D'];
const PAGE_BY_ID = new Map(PAGES.map((p) => [p.id, p]));
const DIGIT: Partial<Record<ButtonId, number>> = { k0: 0, k1: 1, k2: 2, k3: 3, k4: 4, k5: 5, k6: 6, k7: 7, k8: 8, k9: 9 };
const ENTRY_TIMEOUT = 4000;
const MSG_MS = 1300;
const BLINK_PERIOD = 500;

type Mode =
  | { kind: 'play' }
  | { kind: 'edit'; page: string; side: Side }
  | { kind: 'menu'; item: number; back: Mode }
  | { kind: 'tune'; step: number; t0: number; back: Mode }
  | { kind: 'confirm'; what: 'dump' | 'undo' | 'erase'; back: Mode }
  | { kind: 'receive'; back: Mode; count: number }
  | { kind: 'seq' };

interface Entry { target: 'L' | 'R' | 'S' | 'menu'; digits: string; t0: number }
interface Store { kind: 'prog' | 'step'; side: Side; dest: number; digits: string }
interface Touch { mn: string; value: string; until: number }
interface Msg { text: string; until: number; blink?: boolean }

const TRIM_POTS: Record<string, keyof Trims> = { a: 'a', r: 'r', lfo: 'lfo', glide: 'glide', fc: 'fc', detune: 'detune', vol: 'vol' };

export class NeoV8Proto implements Backend {
  readonly name = 'NeoV8 prototype';
  // memory
  programs: Uint8Array[] = demoBank();
  steps: Perf[] = Array.from({ length: NUM_PROGRAMS }, () => defaultPerf());
  globals: Globals = defaultGlobals();
  // live state
  perf: Perf = defaultPerf();
  stepNum = 0;
  edit: Record<Side, Uint8Array> = { L: this.programs[0].slice(), R: this.programs[0].slice() };
  mode: Mode = { kind: 'play' };
  focus: 'L' | 'R' | 'S' = 'R';
  lastPage: Record<Side, string> = { L: 'P1', R: 'P1' };
  sel: Record<string, number> = { pwm: 1, lfo: 1 };
  entry: Entry | null = null;
  store: Store | null = null;
  compare: Side | null = null;
  undo: { index: number; data: Uint8Array } | null = null;
  touch: Touch | null = null;
  msg: Msg | null = null;
  protect = false;
  muted = false;
  a440Tone = false;
  resetArmed = false;
  lastTouched: { param: string; side: Side } | null = null;
  held = new Set<ButtonId>();
  editChordUsed = false;
  lastEditPress = -1e9;
  chordArmed = false;
  pots: Record<string, number> = {};
  caught: Record<string, boolean> = {};
  potAcc: Record<string, number> = {};
  keysDown = new Set<number>();
  voices: Voice[] = Array.from({ length: 8 }, () => ({ note: null, side: null, gate: false, age: 0, lastNote: null }));
  rr: Record<Side, number> = { L: 0, R: 0 };
  ageCounter = 0;
  arp = { phase: 0, idx: { L: 0, R: 0 } as Record<Side, number>, playing: { L: null, R: null } as Record<Side, number | null> };
  lastButton = '';
  lastPotRaw = 0;
  lastMidiByte = -1;
  tuneResults: string[] = [];
  midiOut: number[] = [];
  /** polysequencer (prototype model); playback drives the voices like the keyboard */
  seq = new ProtoSeq((n, on, v) => this.noteEvent(n, on, v));
  /** sequencer page: value field edited by digits / FWD / REV (CALL R tempo, CALL L beat, OCT L quantize, SPLIT song) */
  seqField: 'tempo' | 'beat' | 'quant' | 'song' = 'tempo';
  seqDigits = '';
  log: string[] = [];
  now = 0;

  constructor() {
    this.loadProgram('L', 0);
    this.loadProgram('R', 1);
  }

  // =============================================================== Backend API
  button(id: ButtonId, down: boolean): void {
    if (down) {
      if (this.held.has(id)) return;
      this.held.add(id);
      this.lastButton = id;
      this.onDown(id);
    } else {
      if (!this.held.has(id)) return;
      this.held.delete(id);
      this.onUp(id);
    }
  }

  pot(id: PotId, value: number): void {
    const v = Math.max(0, Math.min(POT_MAX, Math.round(value)));
    const prev = this.pots[id] ?? v;
    this.pots[id] = v;
    this.lastPotRaw = v;
    this.onPot(id, v, prev);
  }

  key(note: number, down: boolean, velocity: number): void {
    if (down) this.keysDown.add(note);
    else this.keysDown.delete(note);
    if (down && this.held.has('kb_split')) {
      this.perf.split = note;
      this.perf.kbMode = 'split';
      this.flash(`SP  ${this.noteText(note)}`);
      this.logEv(`split point ${note}`);
      return;
    }
    if (this.globals.localOn) this.noteEvent(note, down, velocity);
    this.seq.key(note, down, velocity);
    if (this.globals.txNotes) {
      const ch = (note < this.perf.split && this.perf.kbMode === 'split' ? this.globals.midiChL : this.globals.midiChR) - 1;
      this.midiOut.push(down ? 0x90 | ch : 0x80 | ch, note & 127, down ? velocity & 127 : 64);
    }
  }

  midiIn(bytes: number[]): void {
    if (bytes.length) this.lastMidiByte = bytes[bytes.length - 1];
    // channel messages (simple, no running status needed for the prototype's sources)
    for (let i = 0; i < bytes.length; i++) {
      const s = bytes[i];
      if (s >= 0x80 && s < 0xf0) {
        const ch = (s & 15) + 1;
        const t = s & 0xf0;
        const sideOf = (): Side | null =>
          this.globals.omniR || ch === this.globals.midiChR ? 'R' : this.globals.omniL || ch === this.globals.midiChL ? 'L' : null;
        if ((t === 0x90 || t === 0x80) && i + 2 < bytes.length && this.globals.rxNotes) {
          const n = bytes[i + 1], v = bytes[i + 2];
          if (sideOf()) this.noteEvent(n, t === 0x90 && v > 0, v);
          i += 2;
        } else if (t === 0xb0 && i + 2 < bytes.length) {
          if (this.globals.rxCtrl) {
            if (this.globals.omniR || ch === this.globals.midiChR) this.ccIn('R', bytes[i + 1], bytes[i + 2]);
            if (this.globals.omniL || ch === this.globals.midiChL) this.ccIn('L', bytes[i + 1], bytes[i + 2]);
          }
          i += 2;
        } else if (t === 0xc0 && this.globals.rxProgram) {
          const side = sideOf();
          const p = bytes[i + 1] ?? 0;
          if (p < 100) {
            if (this.globals.pcTarget === 'step') this.recallStep(p);
            else if (side) this.loadProgram(side, p);
          }
          i += 1;
        }
      }
    }
    if (!this.globals.rxSysex) return;
    for (const m of parseSysex(bytes)) {
      if (m.cmd === 1) {
        const d = decodeProgramBody(m.body);
        if (!d) continue;
        if (d.num === 126 || d.num === 127) {
          const side: Side = d.num === 127 ? 'L' : 'R';
          this.edit[side] = d.prog;
        } else if (d.num < NUM_PROGRAMS && m.controller) {
          if (this.protect) { this.flash('PrOtEC'); continue; }
          this.programs[d.num] = d.prog;
        } else continue;
        if (this.mode.kind === 'receive') this.mode.count++;
        this.logEv(`sysex program ${d.num} received`);
      } else if (m.cmd === 6) {
        const n = m.body[0];
        if (n < NUM_PROGRAMS) this.midiOut.push(...encodeProgramDump(n, this.programs[n]));
      }
    }
  }

  setProtect(on: boolean): void {
    this.protect = on;
    this.logEv(`memory protect ${on ? 'ON' : 'off'}`);
  }

  run(ms: number): void {
    const end = this.now + ms;
    while (this.now < end) {
      const dt = Math.min(10, end - this.now);
      this.now += dt;
      this.tick(dt);
    }
  }

  drainMidiOut(): number[] {
    const o = this.midiOut;
    this.midiOut = [];
    return o;
  }

  frame(): Frame {
    const d = this.display();
    const on = this.now % BLINK_PERIOD < BLINK_PERIOD * 0.6;
    const segs = renderText(d.text).map((s, i) => {
      let v = s;
      if (d.dp[i]) v |= DP;
      if (d.blink[i] && !on) v = 0;
      if (d.dpBlink[i] && !on) v &= ~DP;
      return v;
    });
    const leds: Frame['leds'] = {};
    for (const [k, st] of Object.entries(this.ledStates())) leds[k as ButtonId] = st === 'on' || (st === 'blink' && on);
    const oct = (o: number): [boolean, boolean, boolean] => [o > 0, o === 0, o < 0];
    return { segments: segs, leds, octL: oct(this.perf.octL), octR: oct(this.perf.octR) };
  }

  inspect(): Record<string, unknown> {
    const d = this.display();
    return {
      mode: this.mode.kind,
      page: this.mode.kind === 'edit' ? this.mode.page : null,
      editSide: this.mode.kind === 'edit' ? this.mode.side : null,
      menuItem: this.mode.kind === 'menu' ? this.mode.item : null,
      focus: this.focus,
      display: d.text,
      displayBlink: d.blink.map((b) => (b ? '1' : '0')).join(''),
      dp: d.dp.map((b) => (b ? '1' : '0')).join(''),
      leds: this.ledStates(),
      seq: { mode: this.seq.mode, running: this.seq.running, play: this.seq.play, rec: this.seq.rec, tempo: this.seq.tempo,
        quant: this.seq.quant, free: this.seq.free, len: [...this.seq.len], events: [this.seq.data[0].length, this.seq.data[1].length] },
      editedL: this.isEdited('L'),
      editedR: this.isEdited('R'),
      compare: this.compare,
      storing: this.store,
      entry: this.entry,
      progL: this.perf.progL,
      progR: this.perf.progR,
      step: this.stepNum,
      perf: this.perf,
      globals: this.globals,
      protect: this.protect,
      undo: this.undo ? this.undo.index : null,
      voices: this.voiceView(),
      lastTouched: this.lastTouched,
      log: this.log.slice(-40),
    };
  }

  // =============================================================== helpers
  private logEv(s: string) {
    this.log.push(`${(this.now / 1000).toFixed(2)}s ${s}`);
    if (this.log.length > 200) this.log.shift();
  }
  private flash(text: string, blink = false) {
    this.msg = { text, until: this.now + MSG_MS, blink };
  }
  private showTouch(mn: string, value: string) {
    this.touch = { mn: mn.padEnd(2).slice(0, 2), value: value.padStart(4).slice(-4), until: this.now + this.globals.displayHoldMs };
  }
  private shift(): boolean {
    return this.held.has('a440');
  }
  private two(n: number): string {
    return String(n).padStart(2, '0');
  }
  noteText(n: number): string {
    const x = noteName(n);
    return `${x.letter}${x.sharp ? '.' : ''}${x.octave < 0 ? '-' : x.octave % 10}`;
  }
  isEdited(side: Side): boolean {
    return !equal(this.edit[side], this.programs[side === 'L' ? this.perf.progL : this.perf.progR]);
  }
  private progNum(side: Side) {
    return side === 'L' ? this.perf.progL : this.perf.progR;
  }
  private setProgNum(side: Side, n: number) {
    if (side === 'L') this.perf.progL = n;
    else this.perf.progR = n;
  }
  /** Program the side really sounds with (stored copy while comparing). */
  soundingProgram(side: Side): Uint8Array {
    return this.compare === side ? this.programs[this.progNum(side)] : this.edit[side];
  }
  loadProgram(side: Side, n: number) {
    this.setProgNum(side, n);
    this.edit[side] = this.programs[n].slice();
    if (this.compare === side) this.compare = null;
    this.caught = {};
    this.logEv(`program ${this.two(n)} -> ${side}`);
  }
  recallStep(n: number) {
    this.stepNum = n;
    this.perf = structuredClone(this.steps[n]);
    this.loadProgram('L', this.perf.progL);
    this.loadProgram('R', this.perf.progR);
    this.logEv(`step ${this.two(n)} recalled`);
  }
  private page(): PageDef | null {
    return this.mode.kind === 'edit' ? PAGE_BY_ID.get(this.mode.page) ?? null : null;
  }

  // =============================================================== buttons
  private onDown(id: ButtonId) {
    const sh = this.shift();
    if (id === 'a440') return; // SHIFT; does nothing alone
    if (id === 'edit') {
      this.editChordUsed = false;
      this.lastEditPress = this.now;
      this.chordArmed = !sh;
      return; // acts on release so EDIT+digit can be a chord
    }
    // Page jump, as the firmware (no key-up events): EDIT (without A440) arms it, the very next key disarms
    // it, and if that key is a digit 1-6 within 0.6 s it jumps to the page. A440 + digit in EDIT also jumps.
    // Holding EDIT + digit still works in the simulator.
    if (this.chordArmed) {
      this.chordArmed = false;
      const d = DIGIT[id];
      if (d !== undefined && d >= 1 && d <= 6 && this.now - this.lastEditPress < 600) {
        this.editChordUsed = true;
        this.jumpPage(d);
        return;
      }
    }
    if (sh && this.mode.kind === 'edit' && DIGIT[id] !== undefined && DIGIT[id]! >= 1 && DIGIT[id]! <= 6) {
      this.jumpPage(DIGIT[id]!);
      return;
    }
    if (this.held.has('edit') && DIGIT[id] !== undefined) {
      this.editChordUsed = true;
      this.jumpPage(DIGIT[id]!);
      return;
    }
    if (this.held.has('edit')) this.editChordUsed = true;

    // modal overlays first
    if (this.store) return this.storeKey(id, sh);
    switch (this.mode.kind) {
      case 'tune':
        return; // ignore keys while tuning
      case 'confirm':
        return this.confirmKey(id);
      case 'receive':
        if (id === 'tape_load') this.mode = this.mode.back;
        return;
      case 'menu':
        return this.menuKey(id, sh);
      case 'seq':
        return this.seqKey(id, sh);
      case 'edit':
        return this.editKey(id, sh);
      case 'play':
        return this.playKey(id, sh);
    }
  }

  private onUp(id: ButtonId) {
    if (id === 'edit' && !this.editChordUsed) this.editPressed();
  }

  /** EDIT on its own: enter edit, or back out one level. A440+EDIT = SYSTEM menu. */
  private editPressed() {
    if (this.shift()) {
      this.enterMenu(10);
      return;
    }
    if (this.store) {
      this.store = null;
      this.flash('CAnCEL');
      return;
    }
    if (this.entry) {
      const typed = this.entry.digits.length > 0;
      this.entry = null;
      if (typed) return; // EDIT cancels a half-typed number; right after CALL it simply enters edit
    }
    switch (this.mode.kind) {
      case 'play': {
        const side: Side = this.focus === 'L' ? 'L' : 'R';
        this.mode = { kind: 'edit', page: this.lastPage[side], side };
        this.caught = {};
        this.logEv(`edit ${side} page ${this.lastPage[side]}`);
        return;
      }
      case 'edit':
        this.lastPage[this.mode.side] = this.mode.page;
        this.mode = { kind: 'play' };
        this.compare = null;
        if (this.globals.rxSysex) this.midiOut.push(0xf0, 0x03, 0x08, 0xf7); // Rev4 "new data available"
        return;
      case 'menu':
        this.mode = this.mode.back;
        return;
      case 'confirm':
      case 'receive':
        this.mode = this.mode.back;
        return;
      case 'seq':
        this.mode = { kind: 'play' };
        return;
      case 'tune':
        return;
    }
  }

  private jumpPage(d: number) {
    const target = PAGE_ORDER[d - 1];
    if (!target) return;
    const side: Side = this.mode.kind === 'edit' ? this.mode.side : this.focus === 'L' ? 'L' : 'R';
    this.mode = { kind: 'edit', page: target, side };
    this.caught = {};
  }

  // ---------------------------------------------------------- PLAY
  private playKey(id: ButtonId, sh: boolean) {
    const p = this.perf;
    const d = DIGIT[id];
    if (d !== undefined) return this.digit(d);
    switch (id) {
      case 'call_l':
      case 'call_r': {
        const side: Side = id === 'call_l' ? 'L' : 'R';
        if (sh) {
          this.edit[side] = nullProgram();
          this.flash(`InIt ${side === 'L' ? 'L' : 'r'} `);
          this.logEv(`init program into ${side} edit buffer`);
          return;
        }
        this.focus = side;
        this.entry = { target: side, digits: '', t0: this.now };
        return;
      }
      case 'step_enable':
        if (sh) return this.enterMenu(50); // legacy: Alternate page
        this.focus = 'S';
        this.entry = { target: 'S', digits: '', t0: this.now };
        return;
      case 'step_load':
        if (sh) return this.flash('rESEt?', true); // Rev4 "reset ALT page" not in prototype
        return this.startStore('step', 'R');
      case 'fwd':
      case 'rev': {
        const delta = id === 'fwd' ? 1 : -1;
        this.entry = null;
        if (this.focus === 'S') this.recallTx('S', (this.stepNum + delta + 100) % 100);
        else this.recallTx(this.focus, (this.progNum(this.focus) + delta + 100) % 100);
        return;
      }
      case 'store':
        if (sh) return this.compareOrUndo(this.focus === 'L' ? 'L' : 'R');
        if (this.focus === 'S') return this.startStore('step', 'R');
        return this.startStore('prog', this.focus);
      case 'kb_whole': p.kbMode = 'whole'; return;
      case 'kb_layer': p.kbMode = 'layer'; p.uniL = p.uniR = false; return;
      case 'kb_split': {
        p.kbMode = 'split';
        if (this.keysDown.size) {
          // ux-spec §3: pressing SPLIT while holding a key sets the split point there and shows it as a note
          p.split = Math.min(...this.keysDown);
          this.flash(`SP  ${this.noteText(p.split)}`);
        }
        return;
      }
      case 'uni_l': if (p.kbMode !== 'layer') p.uniL = !p.uniL; return;
      case 'uni_r': if (p.kbMode !== 'layer') p.uniR = !p.uniR; return;
      case 'oct_l':
      case 'oct_r': {
        const L = id === 'oct_l';
        if (sh) {
          const k = L ? 'arpOctL' : 'arpOctR';
          p[k] = (p[k] % 4) + 1;
          this.flash(`Ao  ${L ? 'L' : 'r'}${p[k]}`);
          return;
        }
        const k = L ? 'octL' : 'octR';
        p[k] = p[k] === 0 ? 1 : p[k] === 1 ? -1 : 0;
        return;
      }
      case 'hold_l': p.holdL = !p.holdL; if (!p.holdL) this.releaseHeld('L'); return;
      case 'hold_r': p.holdR = !p.holdR; if (!p.holdR) this.releaseHeld('R'); return;
      case 'reldef_l': p.relDefL = !p.relDefL; return;
      case 'reldef_r': p.relDefR = !p.relDefR; return;
      case 'pbdef_l': p.pbDefL = !p.pbDefL; return;
      case 'pbdef_r': p.pbDefR = !p.pbDefR; return;
      case 'arp_up': p.arpMode = p.arpMode === 'down' ? 'updown' : 'up'; return;
      case 'arp_down':
        if (sh) return this.enterMenu(10); // legacy: MIDI pages
        p.arpMode = p.arpMode === 'up' ? 'updown' : 'down';
        return;
      case 'arp_random':
        if (sh) return this.enterMenu(40); // legacy: Set page
        p.arpMode = 'random';
        return;
      case 'arp_left': p.arpL = !p.arpL; return;
      case 'arp_right':
        if (sh) { this.mode = { kind: 'seq' }; this.seqField = 'tempo'; this.seqDigits = ''; return; } // sequencer page
        p.arpR = !p.arpR;
        return;
      case 'arp_pause':
        if (sh) return this.seqStartStop(); // sequencer START/STOP from the Normal page
        p.arpPause = !p.arpPause;
        return;
      case 'mute':
        if (sh) return this.enterMenu(21); // legacy: velocity pages
        this.muted = !this.muted;
        return;
      case 'autotune':
        if (sh) {
          this.a440Tone = !this.a440Tone;
          return;
        }
        this.mode = { kind: 'tune', step: 0, t0: this.now, back: this.mode };
        this.tuneResults = [];
        return;
      case 'tape_dump':
        this.mode = { kind: 'confirm', what: 'dump', back: this.mode };
        return;
      case 'tape_load':
        this.mode = { kind: 'receive', back: this.mode, count: 0 };
        return;
    }
  }

  private digit(d: number) {
    const e = this.entry ?? { target: this.focus, digits: '', t0: this.now };
    e.digits += String(d);
    e.t0 = this.now;
    this.entry = e;
    if (e.digits.length < 2) return;
    const n = Number(e.digits);
    this.entry = null;
    if (e.target === 'S' || e.target === 'L' || e.target === 'R') this.recallTx(e.target, n);
  }

  /** Panel recall + MIDI out: program change (per pcTarget; a step on the RIGHT channel), SysEx "new step". */
  private recallTx(target: Side | 'S', n: number) {
    const g = this.globals;
    if (target === 'S') {
      this.recallStep(n);
      if (g.rxSysex) this.midiOut.push(0xf0, 0x03, 0x00, n, 0xf7);
      if (g.txProgram && g.pcTarget === 'step') this.midiOut.push(0xc0 | (g.midiChR - 1), n);
    } else {
      this.loadProgram(target, n);
      if (g.txProgram && g.pcTarget === 'prog') this.midiOut.push(0xc0 | ((target === 'L' ? g.midiChL : g.midiChR) - 1), n);
    }
  }

  /** A panel edit: set the parameter and send it when its byte changed. */
  private setParam(side: Side, pid: string, raw: number) {
    const prog = this.edit[side];
    const before = prog[PARAM[pid].byte];
    setRaw(prog, pid, raw);
    this.txParam(side, pid, before);
  }

  /** MIDI out of a changed parameter (txCtrl): its CC (8-bit: 14-bit pair), or NRPN with the raw byte (switches). */
  private txParam(side: Side, pid: string, before: number) {
    const p = PARAM[pid];
    const prog = this.edit[side];
    if (prog[p.byte] === before || !this.globals.txCtrl) return;
    const st = 0xb0 | ((side === 'L' ? this.globals.midiChL : this.globals.midiChR) - 1);
    if (p.cc === null) {
      const b = prog[p.byte];
      this.midiOut.push(st, 99, side === 'L' ? 1 : 0, st, 98, p.byte, st, 6, b >> 7, st, 38, b & 0x7f);
      return;
    }
    const v = getRaw(prog, pid);
    if (p.width === 8) this.midiOut.push(st, p.cc, v >> 1, st, p.cc + 32, (v & 1) << 6);
    else this.midiOut.push(st, p.cc, v << (7 - p.width));
  }

  /** MIDI in: a program parameter CC (rxCtrl) on the side's channel; nothing is sent back. */
  private ccIn(side: Side, cc: number, v: number) {
    const lsb = cc >= 32 && cc < 64;
    const n = lsb ? cc - 32 : cc;
    const p = n ? PARAMS.find((q) => q.cc === n) : undefined;
    if (!p) return;
    const prog = this.edit[side];
    if (p.width === 8) {
      if (lsb) setRaw(prog, p.id, (getRaw(prog, p.id) & 0xfe) | (v >> 6));
      else setRaw(prog, p.id, v << 1);
    } else if (!lsb) setRaw(prog, p.id, v >> (7 - p.width));
  }

  // ---------------------------------------------------------- STORE / COMPARE / UNDO
  private startStore(kind: 'prog' | 'step', side: Side) {
    this.entry = null;
    if (this.compare) {
      this.flash('CP  --');
      return;
    }
    const dest = kind === 'step' ? this.stepNum : this.progNum(side);
    this.store = { kind, side, dest, digits: '' };
  }

  private storeKey(id: ButtonId, _sh: boolean) {
    const s = this.store!;
    const d = DIGIT[id];
    if (d !== undefined) {
      s.digits += String(d);
      if (s.digits.length === 2) {
        s.dest = Number(s.digits);
        s.digits = '';
      }
      return;
    }
    if (id === 'fwd') s.dest = (s.dest + 1) % 100;
    else if (id === 'rev') s.dest = (s.dest + 99) % 100;
    else if (id === 'store') this.commitStore();
  }

  private commitStore() {
    const s = this.store!;
    this.store = null;
    if (this.protect) {
      this.flash('PrOtEC', true);
      this.logEv('store refused: memory protect');
      return;
    }
    if (s.kind === 'prog') {
      this.undo = { index: s.dest, data: this.programs[s.dest].slice() };
      this.programs[s.dest] = this.edit[s.side].slice();
      this.setProgNum(s.side, s.dest);
      this.logEv(`stored ${s.side} edit buffer -> program ${this.two(s.dest)}`);
    } else {
      this.steps[s.dest] = structuredClone(this.perf);
      this.stepNum = s.dest;
      this.logEv(`stored performance -> step ${this.two(s.dest)}`);
    }
    this.flash('StOrEd');
  }

  /** A440+STORE: compare when the buffer is edited, otherwise offer to undo the last store. */
  private compareOrUndo(side: Side) {
    if (this.compare) {
      this.compare = null;
      return;
    }
    if (this.isEdited(side)) {
      this.compare = side;
      this.logEv(`compare ${side}: hearing stored program`);
      return;
    }
    if (this.undo) {
      this.mode = { kind: 'confirm', what: 'undo', back: this.mode };
      return;
    }
    this.flash('nO Ed ');
  }

  private confirmKey(id: ButtonId) {
    const m = this.mode as Extract<Mode, { kind: 'confirm' }>;
    if (id !== 'store') return; // EDIT (cancel) is handled on release
    this.mode = m.back;
    if (m.what === 'erase') {
      this.seq.erase(this.seq.rec || 3);
      this.flash('ErASEd');
      return;
    }
    if (m.what === 'dump') {
      for (let i = 0; i < NUM_PROGRAMS; i++) this.midiOut.push(...encodeProgramDump(i, this.programs[i]));
      this.flash('SEnt  ');
      this.logEv('SysEx bulk dump of 100 programs sent');
    } else if (m.what === 'undo' && this.undo) {
      if (this.protect) return this.flash('PrOtEC', true);
      this.programs[this.undo.index] = this.undo.data;
      for (const side of ['L', 'R'] as Side[]) if (this.progNum(side) === this.undo.index) this.edit[side] = this.undo.data.slice();
      this.logEv(`undo: program ${this.two(this.undo.index)} restored`);
      this.undo = null;
      this.flash('UndOnE');
    }
  }

  // ---------------------------------------------------------- SEQUENCER PAGE
  private seqStartStop() {
    const st = this.seq.startStop();
    if (st) this.flash(STATUS_TEXT[st], true);
    this.logEv(`sequencer ${this.seq.running ? 'started (' + this.seq.mode + ')' : 'stopped'}${st ? ' status ' + st : ''}`);
  }
  private seqTouch(f: 'tempo' | 'beat' | 'quant' | 'song' | 'clk' | 'rate') {
    const mn = { tempo: 'bP', beat: 'nb', quant: 'qU', song: 'S1', clk: 'CL', rate: 'rt' }[f];
    this.showTouch(mn, this.seqValue(f));
  }
  seqValue(f: 'tempo' | 'beat' | 'quant' | 'song' | 'clk' | 'rate'): string {
    const q = this.seq;
    switch (f) {
      case 'tempo': return String(q.tempo).padStart(4);
      case 'beat': return String([4, 8, 16][q.metBeat]).padStart(4);
      case 'quant': return QUANT_NAMES[q.quant].padStart(4);
      case 'song': return this.two(q.reps[0]) + this.two(q.reps[1]);
      case 'clk': return ['  In', '  EH', '  nI'][q.clk];
      case 'rate': return String([96, 48, 24][q.extRate]).padStart(4);
    }
  }
  private seqKey(id: ButtonId, sh: boolean) {
    const q = this.seq;
    const d = DIGIT[id];
    if (d !== undefined) {
      this.seqDigits += String(d);
      const f = this.seqField;
      if (f === 'tempo' && this.seqDigits.length === 3) { q.tempo = Math.max(20, Math.min(251, Number(this.seqDigits))); this.seqDigits = ''; }
      else if (f === 'beat') { q.metBeat = Math.min(2, d); this.seqDigits = ''; }
      else if (f === 'quant') {
        this.seqDigits = '';
        if (q.running && q.recording) return this.flash('rEC On', true); // would rearrange the take (Rev4 problem)
        q.quant = Math.min(QUANT_TICKS.length - 1, d);
      }
      else if (f === 'song' && this.seqDigits.length === 4) {
        q.reps = [Math.max(1, Number(this.seqDigits.slice(0, 2))), Math.max(1, Number(this.seqDigits.slice(2)))];
        this.seqDigits = '';
      }
      const shown = f === 'song' && this.seqDigits ? (this.seqDigits + '----').slice(0, 4) : f === 'tempo' && this.seqDigits ? (this.seqDigits + '--').slice(0, 3).padStart(4) : this.seqValue(f);
      this.showTouch({ tempo: 'bP', beat: 'nb', quant: 'qU', song: 'S1' }[f], shown);
      return;
    }
    switch (id) {
      case 'fwd': case 'rev': {
        const dlt = id === 'fwd' ? 1 : -1;
        this.seqDigits = '';
        if (this.seqField === 'tempo') q.tempo = Math.max(20, Math.min(251, q.tempo + dlt));
        else if (this.seqField === 'beat') q.metBeat = (q.metBeat + dlt + 3) % 3;
        else if (this.seqField === 'quant') {
          if (q.running && q.recording) return this.flash('rEC On', true);
          q.quant = Math.max(0, Math.min(QUANT_TICKS.length - 1, q.quant + dlt));
        }
        else q.reps[0] = Math.max(1, Math.min(99, q.reps[0] + dlt));
        return this.seqTouch(this.seqField);
      }
      case 'call_r': this.seqField = 'tempo'; this.seqDigits = ''; return this.seqTouch('tempo');
      case 'call_l': this.seqField = 'beat'; this.seqDigits = ''; return this.seqTouch('beat');
      case 'oct_l': this.seqField = 'quant'; this.seqDigits = ''; return this.seqTouch('quant');
      case 'kb_split': this.seqField = 'song'; this.seqDigits = ''; return this.seqTouch('song');
      case 'reldef_l': q.play ^= 1; return;
      case 'reldef_r': q.play ^= 2; return;
      case 'pbdef_l': q.rec ^= 1; return;
      case 'pbdef_r': q.rec ^= 2; return;
      case 'hold_l': q.loop = !q.loop; return;
      case 'hold_r': q.lock = !q.lock; return;
      case 'kb_whole': q.song = !q.song; return;
      case 'arp_pause': return this.seqStartStop();
      case 'arp_left':
        if (sh) { this.mode = { kind: 'confirm', what: 'erase', back: this.mode }; return; }
        q.clear();
        return this.flash('CLEAr ');
      case 'arp_down': q.instant = !q.instant; return;
      case 'arp_random': q.metro = !q.metro; return;
      case 'arp_up': q.clk = (q.clk + 1) % 3; return this.seqTouch('clk');
      case 'kb_layer': q.extRate = 0; return this.seqTouch('rate');
      case 'uni_l': q.extRate = 1; return this.seqTouch('rate');
      case 'uni_r': q.extRate = 2; return this.seqTouch('rate');
      case 'arp_right': this.mode = { kind: 'play' }; return;
      case 'tape_dump': this.mode = { kind: 'confirm', what: 'dump', back: this.mode }; return;
      case 'tape_load': this.mode = { kind: 'receive', back: this.mode, count: 0 }; return;
    }
  }

  // ---------------------------------------------------------- EDIT
  private editKey(id: ButtonId, sh: boolean) {
    const m = this.mode as Extract<Mode, { kind: 'edit' }>;
    const pg = this.page()!;
    const prog = this.edit[m.side];

    if (id === 'store') {
      if (sh) return this.compareOrUndo(m.side);
      return this.startStore('prog', m.side);
    }
    if (id === 'fwd' || id === 'rev') {
      const delta = id === 'fwd' ? 1 : -1;
      if (sh) return this.nudge(delta);
      const i = (PAGE_ORDER.indexOf(m.page) + delta + PAGE_ORDER.length) % PAGE_ORDER.length;
      this.mode = { ...m, page: PAGE_ORDER[i] };
      this.caught = {};
      return;
    }
    const d = DIGIT[id];
    if (d !== undefined) {
      const kp = pg.keypad;
      if (!kp) return;
      const raw = kp.keys[String(d)];
      if (raw === undefined) return this.flash('--  --');
      const target = kp.var ? kp.targets[String(this.sel[kp.var])] : kp.targets['0'];
      this.setParam(m.side, target, raw);
      this.touchParam(target, m.side);
      return;
    }
    const b: ButtonBinding | undefined = pg.buttons[id];
    if (b) {
      if (b.select) {
        this.sel[b.select.var] = b.select.value;
        const target = pg.keypad?.targets[String(b.select.value)];
        if (target) this.touchParam(target, m.side);
        return;
      }
      if (b.field) {
        const raw = getRaw(prog, b.field.param);
        this.setParam(m.side, b.field.param, raw ^ (1 << b.field.bit));
        this.touchParam(b.field.param, m.side);
        return;
      }
      if (b.param) {
        const before = prog[PARAM[b.param].byte];
        setOn(prog, b.param, !isOn(prog, b.param, b.onWhen), b.onWhen);
        this.txParam(m.side, b.param, before);
        this.touchParam(b.param, m.side, b.onWhen);
        return;
      }
    }
    if (id === 'call_l' || id === 'call_r') {
      const side: Side = id === 'call_l' ? 'L' : 'R';
      if (sh) {
        this.edit[side] = nullProgram();
        this.flash(`InIt ${side === 'L' ? 'L' : 'r'} `);
        return;
      }
      this.lastPage[m.side] = m.page;
      this.mode = { ...m, side };
      this.caught = {};
      return;
    }
    if (id === 'autotune' && sh) this.a440Tone = !this.a440Tone;
  }

  private nudge(delta: number) {
    const t = this.lastTouched;
    if (!t) return this.flash('--  --');
    const p = PARAM[t.param];
    const prog = this.edit[t.side];
    this.setParam(t.side, t.param, Math.max(0, Math.min(maxOf(p), getRaw(prog, t.param) + delta)));
    this.touchParam(t.param, t.side);
  }

  private touchParam(id: string, side: Side, onWhen?: number, marker = ' ') {
    const p = PARAM[id];
    const prog = this.edit[side];
    const raw = getRaw(prog, id);
    let value: string;
    if (p.enum) value = '  ' + enumText(id, raw);
    else if (p.width === 1) value = isOn(prog, id, onWhen) ? '  On' : ' OFF';
    else value = String(raw).padStart(3);
    if (value.length < 4) value = marker + value;
    else if (marker !== ' ') value = marker + value.slice(1);
    this.showTouch(p.mn, value);
    this.lastTouched = { param: id, side };
  }

  // ---------------------------------------------------------- POTS
  private onPot(id: PotId, v: number, prev: number) {
    if (this.mode.kind === 'menu') {
      if (id === 'arp_speed') this.menuSetFromPot(v);
      return;
    }
    if (this.mode.kind === 'edit') return this.editPot(id, v, prev);
    if (this.mode.kind === 'seq' && id === 'arp_speed') {
      this.seq.tempo = 20 + Math.round((v / POT_MAX) * 231);
      this.seqField = 'tempo';
      return this.seqTouch('tempo');
    }
    if (this.mode.kind !== 'play') return;
    if (id === 'arp_speed') {
      this.perf.arpSpeed = Math.round((v / POT_MAX) * 127);
      this.showTouch('AS', String(this.perf.arpSpeed));
      return;
    }
    // trimmers
    const side: Side = id.startsWith('l_') ? 'L' : 'R';
    const which = TRIM_POTS[id.slice(2)];
    if (this.globals.trimMode === 'trim') {
      const t = side === 'L' ? this.perf.trimL : this.perf.trimR;
      t[which] = Math.round((v / POT_MAX) * 127) - 64;
      const label = { a: 'At', r: 'rE', lfo: 'LF', glide: 'GL', fc: 'Fc', detune: 'dE', vol: 'UL' }[which];
      this.showTouch(label, (t[which] > 0 ? '+' : '') + t[which]);
    } else {
      // Direct: the trimmer edits the program parameter itself (absolute)
      const map: Record<keyof Trims, string[]> = {
        a: ['adsr1_attack', 'adsr2_attack'], r: ['adsr1_release', 'adsr2_release'], lfo: ['lfo1_rate'],
        glide: ['glide_time'], fc: ['vcf_fc'], detune: ['vco1_detune'], vol: ['prog_vol'],
      };
      const ids = map[which];
      for (const pid of ids) this.applyPot(`${id}:${pid}`, pid, side, v, prev, undefined);
    }
  }

  private editPot(id: PotId, v: number, prev: number) {
    const m = this.mode as Extract<Mode, { kind: 'edit' }>;
    const b: PotBinding | undefined = this.page()!.pots[id];
    if (!b) return this.showTouch('--', '  --');
    this.applyPot(`${m.page}:${id}`, b.param, m.side, v, prev, b.mode);
  }

  /** Applies a pot movement to a parameter with the global pot mode (pickup/jump/relative). */
  private applyPot(key: string, pid: string, side: Side, v: number, prev: number, mode: PotBinding['mode']) {
    const p = PARAM[pid];
    const prog = this.edit[side];
    const max = maxOf(p);
    const cur = getRaw(prog, pid);
    if (mode === 'fine') {
      this.potAcc[key] = (this.potAcc[key] ?? 0) + (v - prev) / 24;
      const step = Math.trunc(this.potAcc[key]);
      if (step) {
        this.potAcc[key] -= step;
        this.setParam(side, pid, Math.max(0, Math.min(max, cur + step)));
      }
      return this.touchParam(pid, side);
    }
    if (mode === 'coarse12') {
      this.setParam(side, pid, Math.min(max, Math.round((v / POT_MAX) * 21) * 12 + (cur % 12)));
      return this.touchParam(pid, side);
    }
    if (mode === 'fine12') {
      this.setParam(side, pid, Math.min(max, Math.floor(cur / 12) * 12 + Math.round((v / POT_MAX) * 11)));
      return this.touchParam(pid, side);
    }
    const target = Math.round((v / POT_MAX) * max);
    const before = Math.round((prev / POT_MAX) * max);
    switch (this.globals.potMode) {
      case 'jump':
        this.setParam(side, pid, target);
        return this.touchParam(pid, side);
      case 'relative':
        this.setParam(side, pid, Math.max(0, Math.min(max, cur + (target - before))));
        return this.touchParam(pid, side);
      case 'pickup': {
        const ck = `${key}:${side}`;
        if (!this.caught[ck] && ((before - cur) * (target - cur) <= 0 || Math.abs(target - cur) <= 1)) this.caught[ck] = true;
        if (this.caught[ck]) {
          this.setParam(side, pid, target);
          return this.touchParam(pid, side);
        }
        // not caught yet: show the stored value and which way to turn
        return this.touchParam(pid, side, undefined, target < cur ? '‾' : '_');
      }
    }
  }

  // ---------------------------------------------------------- MENU
  enterMenu(item: number) {
    const back: Mode = this.mode.kind === 'menu' ? this.mode.back : this.mode;
    this.mode = { kind: 'menu', item, back };
    this.entry = null;
    this.resetArmed = false;
  }
  private menuItem(): MenuItem {
    return menuByNum.get((this.mode as Extract<Mode, { kind: 'menu' }>).item)!;
  }
  private menuKey(id: ButtonId, sh: boolean) {
    const m = this.mode as Extract<Mode, { kind: 'menu' }>;
    const it = this.menuItem();
    const d = DIGIT[id];
    if (d !== undefined) {
      if (it.special === 'voices' && !this.entry) {
        if (d <= 7) {
          this.globals.voiceMask ^= 1 << d;
          const off = !!(this.globals.voiceMask & (1 << d));
          this.flash(`90U${d}${off ? 'oF' : 'On'}`);
          this.logEv(`voice ${d} ${off ? 'disabled' : 'enabled'}`);
        }
        return;
      }
      const e = this.entry ?? { target: 'menu' as const, digits: '', t0: this.now };
      e.digits += String(d);
      e.t0 = this.now;
      this.entry = e;
      if (e.digits.length === 2) {
        this.entry = null;
        const n = Number(e.digits);
        if (menuByNum.has(n)) this.enterMenu(n);
        else this.flash(`${e.digits}  --`);
      }
      return;
    }
    if (id === 'fwd' || id === 'rev') {
      const delta = id === 'fwd' ? 1 : -1;
      if (sh) return this.menuStep(it, delta);
      const i = MENU.findIndex((x) => x.num === m.item);
      const next = MENU[(i + delta + MENU.length) % MENU.length];
      this.enterMenu(next.num);
      return;
    }
    if (id === 'store' && it.special === 'reset') {
      if (!this.resetArmed) return this.flash('rG  no');
      const keep = this.globals.voiceMask;
      this.globals = defaultGlobals();
      this.globals.voiceMask = keep;
      this.resetArmed = false;
      this.flash('rESEt ');
      this.logEv('globals reset to defaults');
    }
  }
  private ctx() {
    return { g: this.globals, perf: this.perf };
  }
  private menuStep(it: MenuItem, delta: number) {
    if (it.special === 'reset') {
      this.resetArmed = !this.resetArmed;
      return;
    }
    if (it.count <= 1) return;
    const v = Math.max(0, Math.min(it.count - 1, it.get(this.ctx()) + delta));
    it.set(this.ctx(), v);
  }
  private menuSetFromPot(v: number) {
    const it = this.menuItem();
    if (it.special === 'reset') {
      this.resetArmed = v > POT_MAX / 2;
      return;
    }
    if (it.count <= 1) return;
    it.set(this.ctx(), Math.round((v / POT_MAX) * (it.count - 1)));
  }
  private menuValueText(it: MenuItem): string {
    switch (it.special) {
      case 'voices': return String(8 - popcount(this.globals.voiceMask)).padStart(2, '0');
      case 'reset': return this.resetArmed ? 'YE' : 'no';
      case 'btnTest': return this.two(BUTTONS.indexOf(this.lastButton as ButtonId) % 100);
      case 'potTest': return this.lastPotRaw.toString(16).padStart(3, '0').slice(-2).toUpperCase();
      case 'midiMon': return this.lastMidiByte < 0 ? '--' : this.lastMidiByte.toString(16).padStart(2, '0').toUpperCase();
      case 'tuneReport': return this.tuneResults.length ? (this.tuneResults.every((r) => r === 'ok') ? 'oK' : 'Er') : '--';
      case 'notYet': return '--';
      default: return it.fmt(it.get(this.ctx()));
    }
  }

  // =============================================================== voices / arp
  private pool(side: Side): number[] {
    const p = this.perf;
    let v: number[];
    if (p.kbMode === 'whole') v = side === 'R' ? [0, 1, 2, 3, 4, 5, 6, 7] : [];
    else v = side === 'L' ? [4, 5, 6, 7] : [0, 1, 2, 3];
    return v.filter((i) => !(this.globals.voiceMask & (1 << i)));
  }
  private sidesFor(note: number): Side[] {
    const p = this.perf;
    if (p.kbMode === 'whole') return ['R'];
    if (p.kbMode === 'layer') return ['L', 'R'];
    return [note < p.split ? 'L' : 'R'];
  }
  private noteEvent(note: number, down: boolean, vel: number) {
    for (const side of this.sidesFor(note)) {
      const arpOn = side === 'L' ? this.perf.arpL : this.perf.arpR;
      if (arpOn) continue; // arp reads keysDown
      const n = note + 12 * (side === 'L' ? this.perf.octL : this.perf.octR);
      if (down) this.voiceOn(side, n);
      else this.voiceOff(side, n);
    }
    void vel;
  }
  private voiceOn(side: Side, note: number) {
    const pool = this.pool(side);
    if (!pool.length) return;
    const uni = side === 'L' ? this.perf.uniL : this.perf.uniR;
    if (uni) {
      for (const i of pool) Object.assign(this.voices[i], { note, side, gate: true, age: ++this.ageCounter, lastNote: note });
      return;
    }
    const mode = side === 'L' ? this.perf.assignL : this.perf.assignR;
    const same = mode === 1 || mode === 3;
    const circular = mode >= 2;
    let pick = -1;
    if (same) pick = pool.find((i) => this.voices[i].lastNote === note && !this.voices[i].gate) ?? -1;
    if (pick < 0) {
      const free = pool.filter((i) => !this.voices[i].gate);
      if (free.length) {
        if (circular) {
          const start = this.rr[side];
          pick = [...free].sort((a, b) => ((a - start + 8) % 8) - ((b - start + 8) % 8))[0];
          this.rr[side] = (pick + 1) % 8;
        } else pick = free[0];
      } else if (this.globals.steal === 'oldest') {
        pick = pool.reduce((a, b) => (this.voices[a].age <= this.voices[b].age ? a : b));
      }
    }
    if (pick < 0) return;
    Object.assign(this.voices[pick], { note, side, gate: true, age: ++this.ageCounter, lastNote: note });
  }
  private voiceOff(side: Side, note: number) {
    const hold = side === 'L' ? this.perf.holdL : this.perf.holdR;
    if (hold) return;
    for (const v of this.voices) if (v.side === side && v.note === note) v.gate = false;
  }
  private releaseHeld(side: Side) {
    for (const v of this.voices) if (v.side === side && v.note !== null && !this.keysDown.has(v.note)) v.gate = false;
  }
  private voiceView(): VoiceView[] {
    return this.voices.map((v, i) => ({ note: v.note, side: v.side, gate: v.gate, disabled: !!(this.globals.voiceMask & (1 << i)) }));
  }
  private arpTick(dt: number) {
    const p = this.perf;
    if (!(p.arpL || p.arpR) || p.arpPause) return;
    const hz = 1 + (p.arpSpeed / 127) * 15;
    this.arp.phase += (dt / 1000) * hz;
    if (this.arp.phase < 1) return;
    this.arp.phase -= 1;
    for (const side of ['L', 'R'] as Side[]) {
      if (!(side === 'L' ? p.arpL : p.arpR)) continue;
      const notes = [...this.keysDown].filter((n) => this.sidesFor(n).includes(side)).sort((a, b) => a - b);
      const prevNote = this.arp.playing[side];
      if (prevNote !== null) for (const v of this.voices) if (v.side === side && v.note === prevNote) v.gate = false;
      if (!notes.length) { this.arp.playing[side] = null; continue; }
      const octs = side === 'L' ? p.arpOctL : p.arpOctR;
      const seq: number[] = [];
      for (let o = 0; o < octs; o++) for (const n of notes) seq.push(n + 12 * o);
      let order = seq;
      if (p.arpMode === 'down') order = [...seq].reverse();
      if (p.arpMode === 'updown') order = seq.length > 1 ? [...seq, ...seq.slice(1, -1).reverse()] : seq;
      let i = this.arp.idx[side] % order.length;
      if (p.arpMode === 'random') i = Math.floor(Math.random() * order.length);
      this.arp.idx[side] = i + 1;
      const n = order[i] + 12 * (side === 'L' ? p.octL : p.octR);
      this.voiceOn(side, n);
      this.arp.playing[side] = n;
    }
  }

  // =============================================================== time
  private tick(dt: number) {
    if (this.entry && this.now - this.entry.t0 > ENTRY_TIMEOUT) this.entry = null;
    if (this.touch && this.now > this.touch.until) this.touch = null;
    if (this.msg && this.now > this.msg.until) this.msg = null;
    if (this.mode.kind === 'tune') {
      const step = Math.floor((this.now - this.mode.t0) / 120);
      const total = 16;
      if (step >= total) {
        const back = this.mode.back;
        this.mode = back;
        this.tuneResults = Array.from({ length: 16 }, (_, i) => (this.globals.voiceMask & (1 << (i >> 1)) ? 'off' : 'ok'));
        this.flash('tU  oK');
        this.logEv('autotune done: 16 oscillators ok');
      } else this.mode.step = step;
    }
    this.arpTick(dt);
    this.seq.run(dt);
  }

  // =============================================================== display
  display(): { text: string; blink: boolean[]; dp: boolean[]; dpBlink: boolean[] } {
    const blink = [false, false, false, false, false, false];
    const dp = [false, false, false, false, false, false];
    const dpBlink = [false, false, false, false, false, false];
    const prog2 = (side: Side) => {
      const n = this.two(this.progNum(side));
      return n;
    };
    let text = '';
    const editedDp = (side: Side, digit: number) => {
      if (this.isEdited(side)) {
        dp[digit] = true;
        dpBlink[digit] = true;
      }
    };

    if (this.msg) {
      if (this.msg.blink) blink.fill(true);
      return { text: this.msg.text.replace(/\./g, '').padEnd(6).slice(0, 6), blink, dp: dpFromDots(this.msg.text), dpBlink };
    }
    if (this.store) {
      const s = this.store;
      const dest = s.digits ? `${s.digits}-` : this.two(s.dest);
      text = `St${dest}${s.kind === 'step' ? 'SP' : s.side === 'L' ? ' L' : ' r'}`;
      blink[2] = blink[3] = true;
      if (this.shift() && s.kind === 'prog') {
        text = text.slice(0, 4) + 'Au';
        blink[4] = blink[5] = true;
      }
      return { text, blink, dp, dpBlink };
    }
    if (this.touch && (this.mode.kind === 'play' || this.mode.kind === 'edit' || this.mode.kind === 'seq')) {
      return { text: this.touch.mn + this.touch.value, blink, dp, dpBlink };
    }
    switch (this.mode.kind) {
      case 'tune': {
        const s = this.mode.step;
        text = `tU${(s >> 1) + 1}${(s & 1) + 1}  `;
        dp[2] = true;
        return { text, blink, dp, dpBlink };
      }
      case 'confirm':
        if (this.mode.what === 'dump') text = 'SEnd ?';
        else if (this.mode.what === 'erase') text = 'ErASE?';
        else text = `UndO${this.two(this.undo?.index ?? 0)}`;
        blink.fill(true);
        return { text, blink, dp, dpBlink };
      case 'receive':
        text = `Ld  ${this.two(this.mode.count % 100)}`;
        blink[0] = blink[1] = true;
        return { text, blink, dp, dpBlink };
      case 'seq': {
        const q = this.seq;
        const st = q.mode;
        if (q.waiting) blink[0] = blink[1] = true;
        if (q.running && q.recording && !q.waiting) text = st + String(q.free).padStart(4);
        else text = st + this.seqValue('tempo');
        return { text, blink, dp, dpBlink };
      }
      case 'menu': {
        const it = this.menuItem();
        if (it.special === 'dispTest') return { text: '888888', blink, dp: [true, true, true, true, true, true], dpBlink };
        const num = this.entry ? `${this.entry.digits}-` : this.two(it.num);
        if (this.entry) blink[0] = blink[1] = true;
        text = `${num}${it.mn.padEnd(2)}${this.menuValueText(it).padStart(2)}`;
        return { text, blink, dp, dpBlink };
      }
      case 'edit': {
        const m = this.mode;
        const pg = PAGE_BY_ID.get(m.page)!;
        const sideCh = m.side === 'L' ? 'L' : 'r';
        const pageCh = { P1: '1', P2: '2', A: 'A', B: 'b', C: 'c', D: 'd' }[m.page] ?? '?';
        text = this.compare === m.side ? 'CP' : `${sideCh}${pageCh}`;
        if (this.compare === m.side) blink[0] = blink[1] = true;
        editedDp(m.side, 1);
        if (pg.window?.param && pg.keypad) {
          // mod pages, like the Rev4 overlay: RIGHT = SOURCE (DP = inverted), STEP = MOD DEPTH (hex)
          const src = pg.keypad.targets['0'];
          const bank = src.slice(3, 4);
          text += enumText(src, getRaw(this.edit[m.side], src)).padEnd(2).slice(0, 2);
          if (isOn(this.edit[m.side], `mod${bank}_inv`)) dp[2] = true;
        } else text += prog2(m.side);
        text += this.windowText(pg, m.side, dp);
        return { text, blink, dp, dpBlink };
      }
      case 'play': {
        const e = this.entry;
        const win = (side: Side) => {
          if (e && e.target === side) return e.digits ? `${e.digits}-` : '--';
          if (this.compare === side) return 'CP';
          return prog2(side);
        };
        text = win('L') + win('R');
        text += e && e.target === 'S' ? (e.digits ? `${e.digits}-` : '--') : this.two(this.stepNum);
        if (e) {
          const at = e.target === 'L' ? 0 : e.target === 'R' ? 2 : 4;
          blink[at] = blink[at + 1] = true;
        }
        if (this.compare) blink[this.compare === 'L' ? 0 : 2] = blink[this.compare === 'L' ? 1 : 3] = true;
        dp[this.focus === 'L' ? 0 : this.focus === 'R' ? 2 : 4] = true; // focus (the stock OS also marks it with a DP)
        editedDp('L', 1);
        editedDp('R', 3);
        return { text, blink, dp, dpBlink };
      }
    }
  }

  private windowText(pg: PageDef, side: Side, dp: boolean[]): string {
    const prog = this.edit[side];
    const w = pg.window;
    if (!w) return '  ';
    if (w.param) {
      // mod depth shown in hex like the Rev4 MOD DEPTH window
      return getRaw(prog, w.param).toString(16).toUpperCase().padStart(2, '0');
    }
    if (w.var && pg.keypad) {
      // like Rev4: one digit per target (PWM1 PWM2 / LFO1 LFO2), DP marks the one the keypad edits
      const keyOf = (t: string) => Object.entries(pg.keypad!.keys).find(([, v]) => v === getRaw(prog, t))?.[0] ?? '?';
      dp[this.sel[w.var] === 1 ? 4 : 5] = true;
      return keyOf(pg.keypad.targets['1']) + keyOf(pg.keypad.targets['2']);
    }
    return '  ';
  }

  // =============================================================== LEDs
  ledStates(): Partial<Record<ButtonId, 'on' | 'blink' | 'off'>> {
    const L: Partial<Record<ButtonId, 'on' | 'blink' | 'off'>> = {};
    const on = (id: ButtonId, c: boolean | 'blink') => (L[id] = c === 'blink' ? 'blink' : c ? 'on' : 'off');
    const p = this.perf;
    if (this.store) on('store', 'blink');
    if (this.a440Tone) on('a440', true);
    if (this.muted) on('mute', true);
    switch (this.mode.kind) {
      case 'edit': {
        const m = this.mode;
        const pg = PAGE_BY_ID.get(m.page)!;
        const prog = this.edit[m.side];
        on('edit', this.compare ? 'blink' : true);
        if (this.compare) on('store', 'blink');
        for (const [id, b] of Object.entries(pg.buttons) as [ButtonId, ButtonBinding][]) {
          if (b.select) on(id, this.sel[b.select.var] === b.select.value);
          else if (b.field) on(id, ((getRaw(prog, b.field.param) >> b.field.bit) & 1) === b.field.onWhen);
          else if (b.param) on(id, isOn(prog, b.param, b.onWhen));
        }
        break;
      }
      case 'menu': {
        on('edit', 'blink');
        if (this.menuItem().special === 'dispTest') for (const b of BUTTONS) on(b, true);
        break;
      }
      case 'tune':
        on('autotune', 'blink');
        break;
      case 'confirm':
        on('store', 'blink');
        if (this.mode.what === 'dump') on('tape_dump', 'blink');
        break;
      case 'receive':
        on('tape_load', 'blink');
        break;
      case 'seq': {
        const q = this.seq;
        on('reldef_l', !!(q.play & 1)); on('reldef_r', !!(q.play & 2));
        on('pbdef_l', !!(q.rec & 1)); on('pbdef_r', !!(q.rec & 2));
        on('hold_l', q.loop); on('hold_r', q.lock);
        on('arp_pause', q.waiting ? 'blink' : q.running);
        on('arp_down', q.instant); on('arp_random', q.metro); on('arp_up', q.clk !== 0);
        on('kb_whole', q.song);
        on('kb_layer', q.clk === 1 && q.extRate === 0); on('uni_l', q.clk === 1 && q.extRate === 1); on('uni_r', q.clk === 1 && q.extRate === 2);
        on('edit', true);
        break;
      }
      case 'play': {
        on('kb_whole', p.kbMode === 'whole');
        on('kb_split', p.kbMode === 'split');
        on('kb_layer', p.kbMode === 'layer');
        on('uni_l', p.uniL); on('uni_r', p.uniR);
        on('hold_l', p.holdL); on('hold_r', p.holdR);
        on('reldef_l', p.relDefL); on('reldef_r', p.relDefR);
        on('pbdef_l', p.pbDefL); on('pbdef_r', p.pbDefR);
        on('arp_up', p.arpMode === 'up' || p.arpMode === 'updown');
        on('arp_down', p.arpMode === 'down' || p.arpMode === 'updown');
        on('arp_random', p.arpMode === 'random');
        on('arp_left', p.arpL); on('arp_right', p.arpR); on('arp_pause', p.arpPause);
        if (this.compare) on('store', 'blink');
        break;
      }
    }
    for (const k of Object.keys(L) as ButtonId[]) if (!LED_BUTTONS.has(k)) delete L[k];
    return L;
  }
}

/**
 * Buttons with a physical LED (docs/hardware.md §5.4). EDIT, STORE, TAPE LOAD, TAPE DUMP are the probable
 * owners of the 4 LED bits the stock OS never drives on the Normal page: to confirm on the real unit.
 */
export const LED_BUTTONS = new Set<ButtonId>([
  'mute', 'kb_split', 'kb_layer', 'uni_l', 'uni_r', 'kb_whole', 'arp_left', 'pbdef_r', 'hold_l', 'reldef_l', 'reldef_r',
  'hold_r', 'pbdef_l', 'arp_up', 'arp_pause', 'arp_random', 'arp_down', 'autotune', 'a440', 'arp_right',
  'edit', 'store', 'tape_load', 'tape_dump',
]);

function popcount(n: number) {
  let c = 0;
  while (n) { c += n & 1; n >>= 1; }
  return c;
}
function dpFromDots(t: string): boolean[] {
  const dp: boolean[] = [];
  for (const ch of t) {
    if (ch === '.' && dp.length) dp[dp.length - 1] = true;
    else dp.push(false);
  }
  while (dp.length < 6) dp.push(false);
  return dp.slice(0, 6);
}

export { describe };
