// Voyetra Eight Rev4 CPU card + DAC card + panel + VPK-5, at the level the firmware sees it.
// Every behaviour here is taken from docs/hardware.md (decoded from the stock ROM + schematics).
import { Cpu6502 } from './cpu6502';
import { I8279, Pia6821, Ptm6840, Acia6850 } from './chips';

export const CPU_HZ = 2_000_000;

export interface AccessStat { reads: number; writes: number; lastValue: number }

/** pot-mux channel of each stock pot index ($E0CB) — used to place panel pots on the mux */
export const POT_MUX_CHANNEL = [1, 9, 5, 10, 7, 13, 4, 12, 6, 15, 3, 8, 0, 11, 14, 2];

export class Machine {
  readonly ram = new Uint8Array(0x2000); // $0000-$1FFF volatile
  readonly bram = new Uint8Array(0x2000); // $4000-$5FFF battery-backed CMOS
  rom: Uint8Array = new Uint8Array(0x8000); // $8000-$FFFF
  readonly cpu: Cpu6502;
  readonly kd = new I8279(); // $2000 switch panel
  readonly pia1 = new Pia6821(); // $6800: DAC bits, comparator (PB0), VCO detect (PA7)
  readonly pia2 = new Pia6821(); // $6A00: DAC1022 multiplier (PA), footswitches (PB0-5), ext clock (CA1)
  readonly ptm = new Ptm6840(); // $6C00
  readonly acia = new Acia6850(); // $3800 MIDI (NMI)
  memProtect = false;

  /** S&H: 128 slots (+8 MIDI-controller CVs at $3080). Value = 14-bit DAC word; mult = DAC1022 multiplier. */
  readonly cv = new Uint16Array(136);
  readonly cvMult = new Uint8Array(136);
  readonly cvWrites = new Uint32Array(136);
  private slot = 0;
  /** CD4724 addressable latches and other writes in $6000-$67FF: address -> last value (raw log) */
  readonly latches = new Map<number, number>();
  /**
   * Decoded analog-control state (docs/hardware.md §4), used by the parity harness:
   *  bits.ic1/ic2/ic3 = DAC-card CD4724 Q0-7 ($61xx/$62xx/$63xx), ic22/ic23 = DIGIMOD CD4724 ($64xx after
   *  STA $307F / other slot), xpoint[a] = ANA I CD22100 crosspoint $65aa closed (D7), ls670[chip*4+word] = D4-7.
   */
  readonly ctl = { ic1: 0, ic2: 0, ic3: 0, ic22: 0, ic23: 0, xpoint: new Uint8Array(256), ls670: new Uint8Array(8) };
  /** hook for the VCO model (autotune): PIA1 PA7 level; set by sim/src/machine/vco.ts when present */
  vcoDetect: (() => boolean) | null = null;
  /**
   * [autotune hook, owner: tune - sim/src/machine/vco.ts] when set, clocks the PTM itself instead of
   * run() calling ptm.clock(used): the VCO model feeds /G1 (VCO DETECT) edges at exact cycle times.
   * Arguments: absolute cycle count at the start of the instruction, cycles used.
   */
  ptmDriver: ((t0: number, cycles: number) => void) | null = null;
  /** DIGIMOD IC22 latch (pot / tune mux address) — selected when the S&H address is $7F */
  muxLatch = 0; // = ctl.ic22 (pot / tune mux address)
  /** pot voltages by mux channel, 0..1023 */
  readonly potByChannel = new Array<number>(16).fill(512);
  /** VPK-5: notes held, with the cycle the first contact closed and the delay to the second contact */
  private vpk = new Map<number, { t: number; delay: number }>();
  private vpkClock = 0;
  readonly io = new Map<number, AccessStat>();
  irqCount = 0;
  nmiCount = 0;
  private nmiLine = false;

  constructor(rom?: Uint8Array) {
    if (rom) this.rom = rom;
    this.cpu = new Cpu6502({ read: (a) => this.read(a), write: (a, v) => this.write(a, v) });
    this.bram[0x0fff] = 0xaa; // $4FFF sentinel the stock ROM waits for at boot
    this.pia1.inA = 0x00;
    this.pia1.inB = 0x00;
    this.pia2.inB = 0x3f; // footswitches open (polarity to confirm), cassette low
  }

  reset() { this.cpu.reset(); }

  private stat(a: number, write: boolean, v: number) {
    let s = this.io.get(a);
    if (!s) this.io.set(a, (s = { reads: 0, writes: 0, lastValue: 0 }));
    if (write) s.writes++; else s.reads++;
    s.lastValue = v;
  }

  // ------------------------------------------------------------ bus
  read(a: number): number {
    if (a < 0x2000) return this.ram[a];
    if (a >= 0x8000) return this.rom[a - 0x8000];
    if (a >= 0x4000 && a < 0x6000) return this.bram[a - 0x4000];
    if (a < 0x2800) return this.kd.read(a & 1);
    if (a < 0x3000) return this.potPanel(a & 7, false);
    if (a < 0x3800) return 0xff;
    if (a < 0x4000) return this.acia.read(a & 1);
    if (a >= 0x6800 && a < 0x6a00) {
      this.updateComparator();
      if (this.vcoDetect) this.pia1.inA = (this.pia1.inA & 0x7f) | (this.vcoDetect() ? 0x80 : 0);
      return this.pia1.read(a & 3);
    }
    if (a >= 0x6a00 && a < 0x6c00) return this.pia2.read(a & 3);
    if (a >= 0x6c00 && a < 0x6e00) return this.ptm.read(a & 7);
    this.stat(a, false, 0);
    return 0xff;
  }

  write(a: number, v: number) {
    if (a < 0x2000) { this.ram[a] = v; return; }
    if (a >= 0x8000) return;
    if (a >= 0x4000 && a < 0x6000) { if (!this.memProtect) this.bram[a - 0x4000] = v; return; }
    if (a < 0x2800) { this.kd.write(a & 1, v); return; }
    if (a < 0x3000) { this.potPanel(a & 7, true); return; }
    if (a < 0x3800) {
      this.slot = a & 0xff;
      if (this.slot >= 0x80) this.sample(0x80 + (this.slot & 7)); // MIDI-controller CV bank: no DEMUXEN gating
      return;
    }
    if (a < 0x4000) { this.acia.write(a & 1, v); return; }
    if (a >= 0x6800 && a < 0x6a00) { this.pia1.write(a & 3, v); return; }
    if (a >= 0x6a00 && a < 0x6c00) { this.pia2.write(a & 3, v); return; }
    if (a >= 0x6c00 && a < 0x6e00) { this.ptm.write(a & 7, v); return; }
    if (a >= 0x6000 && a < 0x6800) { this.latches.set(a, v); this.decodeCtl(a, v); return; }
    this.stat(a, true, v);
  }

  private decodeCtl(a: number, v: number) {
    const bit = (cur: number) => (cur & ~(1 << (a & 7))) | (((v >> 7) & 1) << (a & 7));
    const page = a >> 8;
    const c = this.ctl;
    if (page === 0x61) c.ic1 = bit(c.ic1);
    else if (page === 0x62) c.ic2 = bit(c.ic2);
    else if (page === 0x63) c.ic3 = bit(c.ic3);
    else if (page === 0x64 && (a & 0xf8) === 0) {
      if (this.slot === 0x7f) { c.ic22 = bit(c.ic22); this.muxLatch = c.ic22; } // pot/tune mux address
      else c.ic23 = bit(c.ic23);
    } else if (page === 0x65) c.xpoint[a & 0xff] = (v >> 7) & 1;
    else if (page === 0x66 || page === 0x67) c.ls670[(page - 0x66) * 4 + ((a >> 3) & 3)] = (v >> 4) & 0x0f;
  }

  // ------------------------------------------------------------ pot panel strobes $2800-$2807
  private potPanel(n: number, isWrite: boolean): number {
    switch (n) {
      case 0: this.vpkClock++; return 0; // VPK-5 shift clock
      case 1: this.vpkClock = 0; return 0; // DSTR: frame start
      case 4: if (isWrite) this.sample(this.slot & 0x7f); return 0; // DEMUXEN active = SAMPLE
      case 5: return this.vpkLine('A');
      case 6: return this.vpkLine('B');
      default: return 0; // 2 ASTR, 3 HOLD (idle), 7 ACKOFF
    }
  }

  private sample(slot: number) {
    this.cv[slot] = ((this.pia1.portA & 0x7f) << 7) | (this.pia1.portB >> 1);
    this.cvMult[slot] = this.pia2.portA;
    this.cvWrites[slot]++;
  }

  /** LM339: pot voltage vs DAC (8-bit SAR on PA6..0 + PB7). PB0 = 1 when the DAC is above the pot. */
  private updateComparator() {
    const dac8 = ((this.pia1.portA & 0x7f) << 1) | ((this.pia1.orb >> 7) & 1);
    const pot8 = Math.round((this.potByChannel[this.muxLatch & 15] / 1023) * 255);
    this.pia1.inB = (this.pia1.inB & 0xfe) | (dac8 > pot8 ? 1 : 0);
  }

  // ------------------------------------------------------------ VPK-5
  /** Header = 7 clocks after DSTR (traced); then key X (60..0) is read before its clock: position = 7 + (60 - X). */
  private vpkLine(line: 'A' | 'B'): number {
    // line B (second contact) of a key is read just after that key's clock, so one position later than A
    const pos = this.vpkClock - 7 - (line === 'B' ? 1 : 0);
    if (pos < 0) return 0x80; // header buttons (FWD/REV, active low): not pressed
    const x = 60 - pos;
    if (x < 0 || x > 60) return line === 'A' ? 0 : 0x80;
    const note = (x ^ 0x3f) + 0x21;
    const k = this.vpk.get(note);
    if (line === 'A') return k ? 0x80 : 0; // first contact closed
    const closed = k && this.cpu.cycles - k.t >= k.delay;
    return closed ? 0 : 0x80; // second contact: 0 = closed
  }
  /** velocity 1..127 -> time between the two contacts (fast strike = short) */
  keyDown(note: number, velocity: number) {
    if (note < 36 || note > 96) return;
    const ticks = 1 + Math.round(((127 - Math.max(1, Math.min(127, velocity))) / 126) * 40);
    this.vpk.set(note, { t: this.cpu.cycles, delay: ticks * 4097 });
  }
  keyUp(note: number) { this.vpk.delete(note); }

  // ------------------------------------------------------------ run
  run(cycles: number) {
    const end = this.cpu.cycles + cycles;
    while (this.cpu.cycles < end) {
      const used = this.cpu.step();
      if (this.ptmDriver) this.ptmDriver(this.cpu.cycles - used, used); // [autotune hook] see ptmDriver
      else this.ptm.clock(used);
      this.acia.clock(used);
      const irq = this.pia1.irqA || this.pia1.irqB || this.pia2.irqA || this.pia2.irqB || this.ptm.irq;
      if (irq && !this.cpu.irqLine) this.irqCount++;
      this.cpu.irqLine = irq;
      const nmi = this.acia.irq;
      if (nmi && !this.nmiLine) this.nmiCount++;
      this.nmiLine = nmi;
      this.cpu.setNmi(nmi);
    }
  }
}

/** Parses Intel HEX into `out` at `base` offset. */
export function parseIntelHex(text: string, out: Uint8Array, base = 0) {
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith(':') || line.length < 11) continue;
    const n = parseInt(line.slice(1, 3), 16);
    const addr = parseInt(line.slice(3, 7), 16);
    const type = parseInt(line.slice(7, 9), 16);
    if (type !== 0) continue;
    for (let i = 0; i < n; i++) out[base + addr + i] = parseInt(line.slice(9 + 2 * i, 11 + 2 * i), 16);
  }
}
