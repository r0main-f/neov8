// Datasheet-level chip model. Board wiring lives in machine.ts.
// ------------------------------------------------------------------ Motorola 6850 ACIA
// Voyetra Eight Rev4: E = 2 MHz, RxCLK = TxCLK = 500 kHz (docs/hardware.md), MIDI = 31250 baud = 500 kHz / 16.
//  - Control register: CR1-0 counter divide (00 /1, 01 /16, 10 /64, 11 master reset), CR4-2 word select,
//    CR6-5 transmit control (01 = RTS low + TX IRQ enabled), CR7 RX IRQ enable.
//  - Status: b0 RDRF, b1 TDRE, b4 FE, b5 OVRN, b7 IRQ.
//  - Transmit is double-buffered (TDR + shift register): TDRE comes back as soon as the TDR is moved
//    into an idle shift register, so two writes can be accepted back to back.
//  - Receive overrun: the byte already in the RDR is kept, the new one is lost, OVRN is set until the
//    RDR is read (datasheet). Lost bytes are counted in `rxLost` so tests can assert zero loss.
//  - Received bytes are only decoded with the /16 divider (the line runs at 31250 baud): with another
//    divider they are counted as framing errors and dropped.
export class Acia6850 {
  control = 0;
  private rx: number[] = [];
  private rdr = 0;
  private rdrf = false;
  private overrun = false;
  private framing = false;
  private inReset = true;
  /** transmit data register (waiting for the shift register) */
  private tdr = 0;
  private tdrFull = false;
  /** cycles left for the byte in the shift register; 0 = idle */
  private shiftBusy = 0;
  private rxTimer = 0;
  /** bytes put on MIDI OUT (when they start shifting) */
  txOut: number[] = [];
  /** bytes lost on MIDI IN because the RDR was still full (overrun) */
  rxLost = 0;
  /** bytes received with a wrong divider (framing errors) */
  rxFramingErrors = 0;
  /** TDR writes while the TDR was still full (the previous byte is overwritten and lost) */
  txOverwrites = 0;
  /** 10 bits per MIDI byte at 31250 baud = 320 us = 640 cycles at 2 MHz */
  static readonly BYTE_CYCLES = 640;

  get tdre(): boolean { return !this.tdrFull && !this.inReset; }

  get irq(): boolean {
    if (this.inReset) return false;
    const rie = !!(this.control & 0x80);
    const tie = (this.control & 0x60) === 0x20;
    return (rie && (this.rdrf || this.overrun)) || (tie && this.tdre);
  }

  /** cycles per transmitted byte with the current divider and word length (500 kHz ACIA clock) */
  private byteCycles(): number {
    const div = [1, 16, 64, 16][this.control & 3];
    const ws = (this.control >> 2) & 7;
    const bits = [11, 11, 10, 10, 11, 10, 11, 11][ws]; // start + data + parity + stop(s): 7E2 7O2 7E1 7O1 8N2 8N1 8E1 8O1
    return Math.round((bits * div * 2_000_000) / 500_000);
  }

  read(rs: number): number {
    if (rs & 1) {
      const v = this.rdr;
      this.rdrf = false;
      this.overrun = false;
      this.framing = false;
      return v;
    }
    return (this.rdrf ? 1 : 0) | (this.tdre ? 2 : 0) | (this.framing ? 0x10 : 0) | (this.overrun ? 0x20 : 0) | (this.irq ? 0x80 : 0);
  }

  write(rs: number, v: number) {
    if (rs & 1) {
      if (this.inReset) return;
      if (this.tdrFull) this.txOverwrites++;
      this.tdr = v;
      this.tdrFull = true;
      this.startShift();
      return;
    }
    this.control = v;
    if ((v & 3) === 3) { // master reset
      this.inReset = true;
      this.rdrf = false; this.overrun = false; this.framing = false;
      this.tdrFull = false; this.shiftBusy = 0;
    } else {
      this.inReset = false;
    }
  }

  private startShift() {
    if (this.shiftBusy > 0 || !this.tdrFull) return;
    this.txOut.push(this.tdr);
    this.tdrFull = false;
    this.shiftBusy = this.byteCycles();
  }

  /** queue bytes arriving on MIDI IN; they are delivered one per byte-time (back to back at 31250 baud) */
  receive(bytes: number[]) { this.rx.push(...bytes); }

  clock(cycles: number) {
    if (this.shiftBusy > 0) {
      this.shiftBusy -= cycles;
      if (this.shiftBusy <= 0) { this.shiftBusy = 0; this.startShift(); }
    }
    if (this.rx.length) {
      this.rxTimer -= cycles;
      if (this.rxTimer <= 0) {
        this.rxTimer += Acia6850.BYTE_CYCLES;
        if (this.rxTimer <= 0) this.rxTimer = Acia6850.BYTE_CYCLES;
        const b = this.rx.shift()!;
        if (this.inReset) return;
        if ((this.control & 3) !== 1) { this.rxFramingErrors++; this.framing = true; return; }
        if (this.rdrf) { this.overrun = true; this.rxLost++; return; }
        this.rdr = b;
        this.rdrf = true;
      }
    } else if (this.rxTimer < 0) {
      this.rxTimer = 0;
    }
  }
}
