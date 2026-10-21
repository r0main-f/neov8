// Datasheet-level chip model. Board wiring lives in machine.ts.
// ------------------------------------------------------------------ Motorola 6840 PTM
//
// Control register (CRx):
//   bit0  CR1: internal reset (all counters held at their latches) · CR2: $6C00 selects CR1 (1) / CR3 (0)
//         CR3: timer 3 clock ÷8 prescaler
//   bit1  clock source: 1 = internal E, 0 = external Cx (not modelled: the Voyetra has no external clocks wired)
//   bit2  1 = dual 8-bit counting, 0 = 16-bit
//   bit5..3 mode: 000/010 continuous, 100/110 single-shot (bit4 = 1: a latch write does NOT initialise the
//         counter), x01/x11 frequency / pulse-width comparison (not used by any Voyetra ROM: treated as continuous)
//   bit6  IRQ enable · bit7 output enable
//
// Gate inputs /G1-/G3 (`gate[t]`, true = high), modelled for continuous and single-shot modes:
//   - a negative transition (G↓) initialises the counter (counter <- latch),
//   - the counter decrements only while the gate is LOW; a high gate holds it.
// The Voyetra grounds /G2 and /G3 (always low). /G1 = "VCO DETECT" (LS74 output, see vco.ts): the stock
// autotune measures VCO periods with T1 in continuous mode, gate-initialised and gate-held (CR1 = $92).
// Board code that drives /G1 with exact edge times calls clock(cycles, g1Events).
export interface GateEvent {
  /** offset in E cycles from the start of this clock() call (may be fractional) */
  at: number;
  level: boolean;
}

export class Ptm6840 {
  cr = [0, 0, 0]; // CR1, CR2, CR3
  latch = [0xffff, 0xffff, 0xffff];
  counter = [0xffff, 0xffff, 0xffff];
  private msbBuf = 0;
  private lsbBuf = 0;
  flags = 0; // status bits 0-2
  private statusRead = 0;
  /** gate input levels /G1-/G3 (true = high). Default low = counting enabled (as /G2, /G3 on the board). */
  gate = [false, false, false];
  outputs = [false, false, false];

  get irq(): boolean {
    for (let i = 0; i < 3; i++) if (this.flags & (1 << i) && this.cr[i] & 0x40) return true;
    return false;
  }

  read(rs: number): number {
    switch (rs & 7) {
      case 1: {
        this.statusRead = this.flags;
        return this.flags | (this.irq ? 0x80 : 0);
      }
      case 2: case 4: case 6: {
        const t = (rs >> 1) - 1;
        if (this.statusRead & (1 << t)) { this.flags &= ~(1 << t); this.statusRead &= ~(1 << t); }
        this.lsbBuf = this.counter[t] & 0xff;
        return this.counter[t] >> 8;
      }
      case 3: case 5: case 7: return this.lsbBuf;
      default: return 0;
    }
  }

  write(rs: number, v: number) {
    switch (rs & 7) {
      case 0:
        if (this.cr[1] & 1) this.cr[0] = v; else this.cr[2] = v;
        return;
      case 1: this.cr[1] = v; return;
      case 2: case 4: case 6: this.msbBuf = v; return;
      case 3: case 5: case 7: {
        const t = (rs >> 1) - 1;
        this.latch[t] = (this.msbBuf << 8) | v;
        this.flags &= ~(1 << t);
        if (!(this.cr[t] & 0x10)) this.counter[t] = this.latch[t]; // "write timer latches" initialises the counter
        return;
      }
    }
  }

  /** G↓-sensitive, gate-held modes (continuous / single-shot) */
  private gated(t: number) { return !(this.cr[t] & 0x08); }

  /**
   * Advance the timers by `cycles` E-clock cycles (internal clock only). `g1Events` (optional, sorted by
   * `at`) are level changes of /G1 inside this interval, at exact (fractional) times.
   */
  clock(cycles: number, g1Events?: GateEvent[]) {
    if (this.cr[0] & 1) { // internal reset: hold counters at their latches
      for (let t = 0; t < 3; t++) this.counter[t] = this.latch[t];
      if (g1Events) for (const e of g1Events) this.gate[0] = e.level;
      return;
    }
    for (let t = 0; t < 3; t++) {
      if (!(this.cr[t] & 2)) continue; // external clock: no external clocks on this board
      if (t === 0 && g1Events && g1Events.length) {
        // E edges at integer offsets 1..cycles: a segment (a, b] holds floor(b) - floor(a) of them
        let a = 0;
        for (const e of g1Events) {
          const b = Math.min(Math.max(e.at, a), cycles);
          if (!this.gate[0] || !this.gated(0)) this.count(0, Math.floor(b) - Math.floor(a));
          if (this.gate[0] && !e.level && this.gated(0)) this.counter[0] = this.latch[0]; // G↓: initialise
          this.gate[0] = e.level;
          a = b;
        }
        if (!this.gate[0] || !this.gated(0)) this.count(0, cycles - Math.floor(a));
        continue;
      }
      if (this.gate[t] && this.gated(t)) continue; // gate high holds the counter
      this.count(t, cycles);
    }
  }

  private count(t: number, cycles: number) {
    if (cycles <= 0) return;
    let n = cycles;
    if (t === 2 && this.cr[2] & 1) n = cycles / 8; // timer 3 prescaler
    const dual8 = !!(this.cr[t] & 4);
    if (!dual8) {
      let c = this.counter[t] - n;
      while (c < 0) {
        this.flags |= 1 << t;
        c += this.latch[t] + 1;
      }
      this.counter[t] = Math.floor(c);
    } else {
      // dual 8-bit: LSB counts E, MSB counts LSB underflows
      const lsbL = this.latch[t] & 0xff, msbL = this.latch[t] >> 8;
      let lsb = this.counter[t] & 0xff, msb = this.counter[t] >> 8;
      let left = n;
      while (left > 0) {
        const step = Math.min(left, lsb + 1);
        lsb -= step; left -= step;
        if (lsb < 0) {
          lsb = lsbL;
          if (msb === 0) { this.flags |= 1 << t; msb = msbL; this.outputs[t] = !this.outputs[t]; }
          else msb--;
        }
      }
      this.counter[t] = (msb << 8) | lsb;
    }
  }
}
