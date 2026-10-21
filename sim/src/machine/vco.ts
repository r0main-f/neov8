// VCO bank model for the autotune: 16 CEM3340 oscillators with seeded analog imperfections, the tune
// comparator mux, the LS74 divider and the PTM /G1 "VCO DETECT" gate. docs/autotune.md §2, hardware.md §2.5/§4.
//
// Signal path (schematic DAC card p21, decoded with the stock ROM $C043-$C10E, $C3FA, $C55E):
//   VCO card waveform mix (saw when its latch bit is on, else the pulse output)
//     -> tune mux: DIGIMOD IC22 Q0-2 = voice (written after STA $307F), IC3 $6302 /VCO2 SEL, $6303 /VCO1 SEL
//     -> LM339 comparator ("OSC SENSE") = PIA1 PA7 (raw, undivided: the stock counts PA7 high/low times
//        in software for the pulse-width pass)
//     -> LS74 flip-flop toggled by each rising edge; /PRE = PIA1 CA2, /CLR = PIA1 CB2 (active low)
//     -> /Q = PTM /G1. With CR1 = $92 (continuous, gate-initialised) T1 is re-initialised at G↓ and counts
//        only while /G1 is low, so a read after the next rising edge returns exactly ONE VCO period
//        (stock "mode 1"). Holding CA2 low for three more periods keeps /Q low (preset) and the count spans
//        FOUR periods (stock "mode 4"). In normal operation CA2 is low (Q preset) so T1 runs freely.
//
// Oscillator law (osc i: voice v = i >> 1, odd = VCO1 slots 8v+4..7, even = VCO2 slots 8v+0..3):
//   x = pitch slot / 128 (semitones, 14-bit DAC: 1 LSB = 1/128 semitone)
//   s = scale_i * (1 + TRIM_GAIN * (trim slot - 8192) / 8192)            (trim at mid scale = nominal)
//   period = REF_PERIOD * 2^(-(s * x - tune_i) / 12)  E cycles         (REF_PERIOD at x = tune_i, s = 1)
//   duty   = 0.5 + (pw slot - pw50_i) / PW_SPAN, clamped; 0 or 1 = no pulse (stock writes PA $7F = off)
// Slot values are the S&H levels the machine sampled (DAC word x DAC1022 multiplier / 255). No droop, no
// settling time: the CV acts instantly.
import type { Machine } from './machine';
import type { GateEvent } from './ptm6840';

/** E cycles of one period at the reference pitch: the stock offset target is 4 periods = $2343 cycles. */
export const REF_PERIOD = 0x2343 / 4;
export const TRIM_GAIN = 0.25;
export const PW_SPAN = 48 * 128;

export type VcoFault = 'dead' | 'unstable' | 'stuck' | 'noscale';

export interface OscParams {
  /** semitones (pitch slot / 128) where the osc plays REF_PERIOD at s = 1: 94 ± 3 -> calibrated offset ≈ $30 */
  tune: number;
  /** V/oct scale error at trim mid scale (1 = perfect) */
  scale: number;
  /** pulse-width slot value (14-bit) giving a 50 % duty cycle */
  pw50: number;
  /** relative period jitter (gaussian sigma), 0 = clean */
  jitter: number;
  fault?: VcoFault;
}

export interface VcoOptions {
  seed?: number;
  /** ± semitone spread of `tune` around 94 (default 3) */
  tuneSpread?: number;
  /** ± spread of `scale` around 1 (default 0.04) */
  scaleSpread?: number;
  /** ± spread of pw50 in PA units around $38 (default 4) */
  pwSpread?: number;
  jitter?: number;
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class VcoBank {
  readonly osc: OscParams[] = [];
  private rnd: () => number;
  // selected-oscillator waveform state (absolute E-cycle times)
  private key = '';
  private active = false;
  private level = true;
  private period = REF_PERIOD;
  private duty = 0.5;
  private lastRise = 0;
  private nextRise = Infinity;
  private nextFall = Infinity;
  private curOsc = -1;
  // LS74
  private q = true;
  private gate = false;
  /** rising edges seen on the comparator (stats) */
  edges = 0;

  constructor(opts: VcoOptions = {}) {
    this.rnd = mulberry32(opts.seed ?? 1);
    const u = () => this.rnd() * 2 - 1;
    for (let i = 0; i < 16; i++) {
      this.osc.push({
        tune: 94 + u() * (opts.tuneSpread ?? 3),
        scale: 1 + u() * (opts.scaleSpread ?? 0.04),
        pw50: (0x38 + u() * (opts.pwSpread ?? 4)) * 128,
        jitter: opts.jitter ?? 0,
      });
    }
  }

  private gauss() {
    const u = Math.max(1e-12, this.rnd()), v = this.rnd();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /** effective scale for a trim slot value (14-bit) */
  scaleAt(i: number, trim14: number): number {
    const o = this.osc[i];
    if (o.fault === 'noscale') return o.scale;
    return o.scale * (1 + (TRIM_GAIN * (trim14 - 8192)) / 8192);
  }
  /** period in E cycles for given pitch / trim slot values (14-bit); Infinity = no oscillation */
  periodAt(i: number, pitch14: number, trim14: number): number {
    const o = this.osc[i];
    if (o.fault === 'dead') return Infinity;
    const x = o.fault === 'stuck' ? o.tune - 2 : pitch14 / 128;
    const s = o.fault === 'stuck' ? 1 : this.scaleAt(i, trim14);
    return REF_PERIOD * Math.pow(2, -(s * x - o.tune) / 12);
  }
  freqAt(i: number, pitch14: number, trim14: number): number {
    return 2_000_000 / this.periodAt(i, pitch14, trim14);
  }
  dutyAt(i: number, pw14: number): number {
    return Math.min(1, Math.max(0, 0.5 + (pw14 - this.osc[i].pw50) / PW_SPAN));
  }

  /** Slot base of oscillator i: 8v+4 for VCO1 (odd), 8v+0 for VCO2 (even). */
  static slotBase(i: number) { return 8 * (i >> 1) + (i & 1 ? 4 : 0); }

  // ------------------------------------------------------------------ board
  private m: Machine | null = null;

  attach(m: Machine) {
    this.m = m;
    m.vcoDetect = () => this.levelAt(m.cpu.cycles - 1);
    m.ptmDriver = (t0, n) => this.clock(t0, n);
    return this;
  }
  detach() {
    if (!this.m) return;
    this.m.vcoDetect = null;
    this.m.ptmDriver = null;
    this.m = null;
  }

  private slot(s: number) {
    const m = this.m!;
    return (m.cv[s] * m.cvMult[s]) / 255;
  }

  /** Which oscillator the tune mux selects (-1 = none) and its waveform setup, from the latch state. */
  private config(t: number) {
    const m = this.m!;
    const c = m.ctl;
    const vco1 = !(c.ic3 & 0x08), vco2 = !(c.ic3 & 0x04); // /VCO1 SEL ($6303), /VCO2 SEL ($6302)
    const v = c.ic22 & 7;
    const i = vco1 ? 2 * v + 1 : vco2 ? 2 * v : -1; // both selected: VCO1 wins (not used by any ROM)
    let key = `${i}`;
    let period = Infinity, duty = 0.5, constLevel = true;
    if (i >= 0) {
      const base = VcoBank.slotBase(i);
      const wave = v < 4 ? c.ic1 : c.ic2; // IC1 = LEFT voices 0-3, IC2 = RIGHT 4-7; active low
      const saw = !(wave & (i & 1 ? 0x04 : 0x40)) || !(wave & (i & 1 ? 0x02 : 0x20)); // saw or triangle on
      const pitch = this.slot(base + 3), trim = this.slot(base), pw = this.slot(base + 2);
      key += `/${pitch}/${trim}/${pw}/${saw}`;
      if (key === this.key) return;
      period = this.periodAt(i, pitch, trim);
      duty = saw ? 0.5 : this.dutyAt(i, pw);
      if (!isFinite(period)) constLevel = false;
      else if (duty <= 0) constLevel = false;
      else if (duty >= 1) constLevel = true;
    } else if (key === this.key) return;
    this.key = key;
    this.rebase(t, i, period, duty, constLevel);
  }

  private rebase(t: number, i: number, period: number, duty: number, constLevel: boolean) {
    const oscillating = isFinite(period) && duty > 0 && duty < 1;
    let phase = 0;
    if (this.active && i === this.curOsc) phase = Math.min(0.999999, Math.max(0, (t - this.lastRise) / this.period));
    else if (oscillating) phase = this.rnd(); // the newly selected osc runs at an unknown phase
    this.curOsc = i;
    this.active = oscillating;
    if (!oscillating) {
      this.setLevel(t, constLevel);
      this.nextRise = this.nextFall = Infinity;
      return;
    }
    this.period = period;
    this.duty = duty;
    this.lastRise = t - phase * period;
    this.nextRise = this.lastRise + period;
    this.nextFall = phase < duty ? this.lastRise + duty * period : Infinity;
    this.setLevel(t, phase < duty);
  }

  private pending: GateEvent[] = [];
  private t0 = 0;
  private setLevel(t: number, l: boolean) {
    if (l === this.level) return;
    this.level = l;
    if (l) this.rise(t);
  }
  private rise(t: number) {
    this.edges++;
    if (this.preset || this.clear) return;
    this.q = !this.q;
    this.setGate(t, !this.q);
  }
  private setGate(t: number, g: boolean) {
    if (g === this.gate) return;
    this.gate = g;
    this.pending.push({ at: t - this.t0, level: g });
  }

  private preset = false;
  private clear = false;
  /** PIA1 CA2 / CB2 levels (manual output mode; any other mode = released, high) */
  private async(t: number) {
    const p = this.m!.pia1;
    this.preset = (p.cra & 0x38) === 0x30; // CA2 output, low
    this.clear = (p.crb & 0x38) === 0x30; // CB2 output, low
    if (this.preset && this.clear) { this.q = true; this.setGate(t, true); } // LS74: both outputs high
    else if (this.clear) { this.q = false; this.setGate(t, true); }
    else if (this.preset) { this.q = true; this.setGate(t, false); }
  }

  private levelAt(t: number): boolean {
    let l = this.level, f = this.nextFall, r = this.nextRise;
    while (Math.min(f, r) <= t) {
      if (f <= r) { l = false; f = Infinity; } else { l = true; f = r + this.duty * this.period; r += this.period; }
    }
    return l;
  }

  private clock(t0: number, n: number) {
    const m = this.m!;
    this.t0 = t0;
    this.pending.length = 0;
    this.async(t0);
    this.config(t0);
    const t1 = t0 + n;
    while (this.active) {
      const f = this.nextFall, r = this.nextRise;
      const e = Math.min(f, r);
      if (e > t1) break;
      if (f <= r) {
        this.level = false;
        this.nextFall = Infinity;
      } else {
        this.level = true;
        this.lastRise = r;
        const o = this.osc[this.curOsc];
        const j = o.fault === 'unstable' ? 0.03 : o.jitter;
        const p = j ? this.period * (1 + j * this.gauss()) : this.period;
        this.nextRise = r + p;
        this.nextFall = r + this.duty * p;
        this.rise(r);
      }
    }
    m.ptm.clock(n, this.pending.length ? this.pending : undefined);
  }
}

/** Attach a seeded VCO bank to a machine (PIA1 PA7 + PTM /G1). */
export function attachVcoBank(m: Machine, opts: VcoOptions = {}): VcoBank {
  return new VcoBank(opts).attach(m);
}
