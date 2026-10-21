// Datasheet-level chip model. Board wiring lives in machine.ts.
// ------------------------------------------------------------------ Motorola 6821 PIA
export class Pia6821 {
  ora = 0; orb = 0; ddra = 0; ddrb = 0; cra = 0; crb = 0;
  /** input pin levels supplied by the board */
  inA = 0xff; inB = 0xff;
  onWriteA?: (v: number) => void;
  onWriteB?: (v: number) => void;
  /** CA2/CB2 output change (when programmed as outputs) */
  onCa2?: (level: boolean) => void;
  onCb2?: (level: boolean) => void;

  get irqA() { return ((this.cra & 0x80) && (this.cra & 1)) || ((this.cra & 0x40) && (this.cra & 0x08) && !(this.cra & 0x20)) ? true : false; }
  get irqB() { return ((this.crb & 0x80) && (this.crb & 1)) || ((this.crb & 0x40) && (this.crb & 0x08) && !(this.crb & 0x20)) ? true : false; }

  read(rs: number): number {
    switch (rs & 3) {
      case 0:
        if (!(this.cra & 4)) return this.ddra;
        this.cra &= 0x3f; // reading port A clears the flags
        return (this.ora & this.ddra) | (this.inA & ~this.ddra & 0xff);
      case 1: return this.cra;
      case 2:
        if (!(this.crb & 4)) return this.ddrb;
        this.crb &= 0x3f;
        return (this.orb & this.ddrb) | (this.inB & ~this.ddrb & 0xff);
      default: return this.crb;
    }
  }
  write(rs: number, v: number) {
    switch (rs & 3) {
      case 0:
        if (this.cra & 4) { this.ora = v; this.onWriteA?.(v); } else this.ddra = v;
        return;
      case 1:
        this.cra = (this.cra & 0xc0) | (v & 0x3f);
        if ((v & 0x30) === 0x30) this.onCa2?.(!!(v & 8));
        return;
      case 2:
        if (this.crb & 4) { this.orb = v; this.onWriteB?.(v); } else this.ddrb = v;
        return;
      default:
        this.crb = (this.crb & 0xc0) | (v & 0x3f);
        if ((v & 0x30) === 0x30) this.onCb2?.(!!(v & 8));
    }
  }
  /** Active transition on CA1/CB1 (edge polarity per CRx bit1 is not checked here: caller decides). */
  ca1() { this.cra |= 0x80; }
  cb1() { this.crb |= 0x80; }
  /** Effective output levels on the port pins */
  get portA() { return (this.ora & this.ddra) | (this.inA & ~this.ddra & 0xff); }
  get portB() { return (this.orb & this.ddrb) | (this.inB & ~this.ddrb & 0xff); }
}
