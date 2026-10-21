// NeoV8 polysequencer, prototype model (the firmware engine reproduces the stock Rev4 sequencer exactly;
// this model gives the UI the same states, rules and messages so the page can be designed and tested).
// Two channels of events at 96 ppqn sharing 1138 event slots (firmware eng/seq.asm; stock: 850 per channel).

export const PPQN = 96;
/** stock quantize settings 0-A, in 96 ppqn ticks (0 = none): 64th, 32T, 32nd, 16T, 16th, 8T, 8th, 4T, 4th, 2T */
export const QUANT_TICKS = [0, 6, 8, 12, 16, 24, 32, 48, 64, 96, 128];
export const QUANT_NAMES = ['--', '64', '32t', '32', '16t', '16', '8t', '8', '4t', '4', '2t'];
/** metronome beat: 0 quarter, 1 eighth, 2 sixteenth */
export const METRO_TICKS = [96, 48, 24];
export const CAPACITY = 1138;

export interface SeqEvent { t: number; note: number; on: boolean; vel: number }

export type SeqStatus = 0 | 1 | 2 | 3 | 4 | 5; // ok, nothing to play, nothing selected, song needs both, song while recording, full
export const STATUS_TEXT = ['', 'nodAtA', 'SEL  ?', 'SOnG 2', 'rEC On', 'FULL  '];

export class ProtoSeq {
  // switches (stock page semantics)
  play = 0; // bit0 PLAY 1, bit1 PLAY 2
  rec = 0; // bit0 REC 1, bit1 REC 2
  loop = false;
  lock = false;
  song = false;
  reps: [number, number] = [1, 1];
  instant = false;
  metro = false;
  metBeat = 0;
  quant = 0;
  tempo = 120;
  clk = 0; // 0 internal, 1 external, 2 MIDI clock
  extRate = 0; // 0 = 96, 1 = 48, 2 = 24 ppqn
  // data and state
  data: [SeqEvent[], SeqEvent[]] = [[], []];
  len: [number, number] = [0, 0]; // channel length in ticks
  running = false;
  waiting = false; // recording armed, waiting for the first key
  recording = 0; // channel mask being recorded
  playing = 0; // channel mask being played
  songCh = 0;
  songLeft = 0;
  pos = 0; // ticks since start of the current pass
  private acc = 0;
  private cursor: [number, number] = [0, 0];
  status: SeqStatus = 0;
  metPulse = false;
  /** notes currently sounding from playback, to release them on stop */
  private sounding = new Set<number>();

  constructor(private out: (note: number, on: boolean, vel: number) => void) {}

  get free(): number {
    return CAPACITY - this.data[0].length - this.data[1].length;
  }
  get mode(): string {
    if (!this.running) return '--';
    if (this.waiting) return 'rE';
    if (this.recording && this.playing) return 'Od';
    if (this.recording) return 'rE';
    return this.song ? 'Sn' : 'PL';
  }

  /** START/STOP. Returns the status (0 = ok). */
  startStop(): SeqStatus {
    this.status = 0;
    if (this.running) {
      this.stop();
      return 0;
    }
    if (this.rec) {
      if (this.song) return (this.status = 4);
      if (this.free <= 0) return (this.status = 5);
      this.recording = this.rec;
      for (const ch of [0, 1]) if (this.rec & (1 << ch)) { this.data[ch] = this.overdubbing(ch) ? this.data[ch] : []; }
      this.playing = this.play & ~this.rec & this.withData();
      this.waiting = !(this.instant || this.metro);
      this.begin();
      return 0;
    }
    if (!this.play) return (this.status = 2);
    if (this.song && (this.withData() & 3) !== 3) return (this.status = 3);
    const p = this.play & this.withData();
    if (!p) return (this.status = 1);
    this.recording = 0;
    this.waiting = false;
    if (this.song) {
      this.songCh = p & 1 ? 0 : 1;
      this.songLeft = this.reps[this.songCh] || 1;
      this.playing = 1 << this.songCh;
    } else this.playing = p;
    this.begin();
    return 0;
  }

  clear() {
    this.stop();
    this.play = this.rec = 0;
    this.loop = this.lock = this.song = this.instant = this.metro = false;
  }

  erase(mask: number) {
    this.stop();
    for (const ch of [0, 1]) if (mask & (1 << ch)) { this.data[ch] = []; this.len[ch] = 0; }
  }

  /** keyboard event (while recording) */
  key(note: number, on: boolean, vel: number) {
    if (!this.running || !this.recording) return;
    if (this.waiting) {
      if (!on) return;
      this.waiting = false;
      this.pos = 0;
      this.acc = 0;
    }
    if (this.free <= 0) { this.status = 5; this.stop(); return; }
    let t = this.pos;
    const q = QUANT_TICKS[this.quant];
    if (q && on) t = Math.round(t / q) * q;
    const ch = this.recording & 1 ? 0 : 1; // double-channel recording fills channel 1
    this.data[ch].push({ t, note, on, vel });
  }

  /** advance by ms of real time (internal clock) */
  run(ms: number) {
    if (!this.running || this.clk !== 0) return;
    this.acc += (ms * this.tempo * PPQN) / 60000;
    while (this.acc >= 1) { this.acc -= 1; this.tick(); }
  }

  /** one 96-ppqn tick (internal clock, or external/MIDI clock pulses scaled by the caller) */
  tick() {
    if (!this.running || this.waiting) return;
    this.metPulse = this.metro && this.pos % METRO_TICKS[this.metBeat] === 0;
    for (const ch of [0, 1]) {
      if (!(this.playing & (1 << ch))) continue;
      const ev = this.data[ch];
      while (this.cursor[ch] < ev.length && ev[this.cursor[ch]].t <= this.pos) {
        const e = ev[this.cursor[ch]++];
        this.out(e.note, e.on, e.vel);
        if (e.on) this.sounding.add(e.note); else this.sounding.delete(e.note);
      }
    }
    this.pos++;
    const playLen = Math.max(...[0, 1].filter((c) => this.playing & (1 << c)).map((c) => this.len[c]), 0);
    if (this.playing && playLen && this.pos >= playLen) this.wrap();
  }

  private wrap() {
    this.allOff();
    if (this.recording) {
      // overdub over a looping channel: the take has the playing channel's length
      for (const ch of [0, 1]) if (this.recording & (1 << ch)) { this.len[ch] = this.pos; this.sortCh(ch); }
      if (this.lock) {
        // continuous overdub: the channels bounce (the new take plays, the other records)
        const r = this.recording;
        this.recording = this.playing;
        this.playing = r;
        for (const ch of [0, 1]) if (this.recording & (1 << ch)) this.data[ch] = [];
      } else if (!this.loop) return this.stop();
    } else if (this.song) {
      if (--this.songLeft <= 0) {
        this.songCh ^= 1;
        this.songLeft = this.reps[this.songCh] || 1;
        this.playing = 1 << this.songCh;
      }
    } else if (!this.loop) return this.stop();
    this.pos = 0;
    this.cursor = [0, 0];
  }

  private begin() {
    this.running = true;
    this.pos = 0;
    this.acc = 0;
    this.cursor = [0, 0];
  }

  private stop() {
    if (!this.running) return;
    const recorded = this.recording;
    for (const ch of [0, 1]) if (recorded & (1 << ch) && !this.waiting) {
      if (!this.len[ch] || !(this.playing)) this.len[ch] = Math.max(this.pos, 1);
      this.closeHanging(ch);
      this.sortCh(ch);
    }
    this.allOff();
    this.running = false;
    this.waiting = false;
    this.recording = 0;
    this.playing = 0;
    // auto-playback: REC + PLAY on the same channel plays the new take as soon as recording stops
    const auto = recorded & this.play;
    this.rec &= ~recorded; // REC turns off after a take (stock)
    if (auto && !this.song) {
      this.playing = auto;
      this.begin();
    }
  }

  private overdubbing(_ch: number) { return false; }
  private withData() { return (this.data[0].length ? 1 : 0) | (this.data[1].length ? 2 : 0); }
  private sortCh(ch: number) { this.data[ch].sort((a, b) => a.t - b.t || Number(a.on) - Number(b.on)); }
  private closeHanging(ch: number) {
    const open = new Set<number>();
    for (const e of this.data[ch]) if (e.on) open.add(e.note); else open.delete(e.note);
    for (const n of open) this.data[ch].push({ t: Math.max(this.pos - 1, 0), note: n, on: false, vel: 0 });
  }
  private allOff() {
    for (const n of this.sounding) this.out(n, false, 0);
    this.sounding.clear();
  }
}
