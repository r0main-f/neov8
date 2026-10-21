// Datasheet-level chip model. Board wiring lives in machine.ts.
// ------------------------------------------------------------------ Intel 8279 keyboard/display
export class I8279 {
  display = new Uint8Array(16); // display RAM as written by the CPU
  private fifo: number[] = [];
  private overrun = false;
  private ramAddr = 0;
  private autoInc = false;
  private readDisplay = false;
  mode = 0; // last keyboard/display mode set
  prescaler = 31;
  irq = false;

  /** A0=1: command/status, A0=0: data */
  read(a0: number): number {
    if (a0) {
      return (this.fifo.length & 7) | (this.fifo.length >= 8 ? 8 : 0) | (this.overrun ? 0x20 : 0);
    }
    if (this.readDisplay) {
      const v = this.display[this.ramAddr];
      if (this.autoInc) this.ramAddr = (this.ramAddr + 1) & 15;
      return v;
    }
    const v = this.fifo.shift() ?? 0;
    this.irq = this.fifo.length > 0;
    return v;
  }

  write(a0: number, v: number) {
    if (!a0) {
      this.display[this.ramAddr] = v;
      if (this.autoInc) this.ramAddr = (this.ramAddr + 1) & 15;
      return;
    }
    switch (v >> 5) {
      case 0: this.mode = v & 0x1f; break; // keyboard/display mode set
      case 1: this.prescaler = v & 0x1f; break; // program clock
      case 2: this.readDisplay = false; break; // read FIFO
      case 3: this.readDisplay = true; this.ramAddr = v & 15; this.autoInc = !!(v & 0x10); break; // read display RAM
      case 4: this.ramAddr = v & 15; this.autoInc = !!(v & 0x10); break; // write display RAM (read mode unchanged)
      case 5: break; // display write inhibit/blanking (not modelled)
      case 6: // clear
        if (v & 2) this.display.fill((v & 0x0c) === 0x0c ? 0xff : 0); // CD bits
        if (v & 1) { this.fifo = []; this.overrun = false; this.irq = false; }
        break;
      case 7: this.irq = this.fifo.length > 0; break; // end interrupt / error mode
    }
  }

  /** Key code as the 8279 reports it in encoded-scan mode: SL2-0 (row) << 3 | RL2-0 (column). */
  pressKey(code: number) {
    if (this.fifo.length >= 8) { this.overrun = true; return; }
    this.fifo.push(code & 0xff);
    this.irq = true;
  }
  get fifoCount() { return this.fifo.length; }
}
