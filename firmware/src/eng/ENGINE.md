# NeoV8 engine — internal contract

Public API: `api.inc` (`eng_*`). Rules: `firmware/ARCHITECTURE.md`.

## Conventions (from the stock code, see docs/hardware.md §3.1 and the corrections below)

- **Side 0 = RIGHT, side 1 = LEFT.** Side s owns voices 4s..4s+3 (RIGHT = voices 0-3, LEFT = 4-7), CD4724
  waveform latch page $61+s, Fc slots $40+8s.., volume/Q $44+8s.., noise $52+4s, program volume $53+4s,
  mod depths $60+4s.., wave compensation $7B+4s. (Some labels in docs/hardware.md assumed the opposite: the
  code is authoritative, the Reference Guide confirms "3,2,1,0 = Right voices".)
- **WHOLE 8** (PF_KBMODE = 0): both sides are processed with the RIGHT edit buffer (stock $E31A).
- Slot values: `cv_pa[s]` = DAC bits 13-7, `cv_pb[s]` = DAC bits 6-0 in bits 7-1, `cv_mul[s]` = DAC1022
  multiplier. The tick refreshes slots from these tables (`eng_refresh`, 12 slots per call, 2 calls per 3
  ticks: every slot within 33 ms). **Exception:** slots marked in `vx_dyn[s]` (non-zero) are written by the
  engine only and never refreshed, like the stock ROM: envelopes $68-$77, LFOs $78-$7A/$7C-$7E, and the PWM
  slots (8v+1, 8v+5) of a side whose PWM source is an LFO or an ADSR (`lfo_apply` sets them from
  `ap_pwm_src`). Their tables are not kept in step (LFO $79+: value without the LFO2 offset, like the stock).
  Other dynamic writers (note-on, glide, kbd gate/CV $50/$55, volume $53/$57) update the table AND write the
  slot (`cv_write`, tick context or DAC locked). Slots 8v+0 / 8v+4 (scale trims) belong to tune.

## Modules

| File | Prefix | Owner | Content |
|---|---|---|---|
| `eng.asm` | `eng_` | lead | public API, tick schedule (3 phases like stock $8127), program load |
| `apply.asm` | `ap_` | lead | program -> static slots, latches, crosspoints, LS670, PWM config, program volume base |
| `voice.asm` | `vx_` | engine agent | key assignment, pitch (incl. autotune CAL), glide/gliss, VCF tracking, velocity/tapers, VPK-5 scan, kbd gate/CV, unison/hold/octave/split/layer |
| `env.asm` | `env_` | engine agent | 16 ADSRs, ADSR2->VCA, ADSR1->VCF, ADSR->PWM, volume gate |
| `lfo.asm` | `lfo_` | engine agent | LFO1/LFO2 x 2 sides, delay, sync, retrigger, kbd tracking, LFO->PWM |

Benches can replace sub-modules: `-D STUB_VX`, `-D STUB_ENV`, `-D STUB_LFO` (files `stub_*.asm`).

## What apply.asm provides (verified equal to stock by sim/test/fw-eng-apply.test.ts)

Called for both sides on every program change (`eng_apply_prog` -> `ap_all`):
- static slots: PW (ch2/ch6 with CAL_PW), PWM ch1/ch5 = $0404, Fc when not tracked, VCO vols, Q, noise,
  mod depths (with bank masks), wave compensation; latches $61xx/$62xx, lin FM $6300/$6301, crosspoints,
  LS670, $6405 Fc-pedal enable, $6400/$6401 pitch-bend enables (PF_PBDEF).
- PWM configuration, index i = vco2*2 + side (vco2 = 1 for VCO2):
  `ap_pwm_src[i]` ($FF none, 0 LFO1, 1 LFO2, 2 ADSR1, 3 ADSR2, 4-7 none), `ap_pwm_kbd[i]` ($FF = PWM kbd
  tracking), `ap_pwm_dep[i]` (depth*16), `ap_pwm_env1[i]`/`ap_pwm_env2[i]` ($FF when ADSR1/ADSR2 source),
  `ap_pwm_mul[v]` VCO1 PWM multiplier of voice v, `ap_pwm_mul[8+v]` VCO2 (= stock $0990+v / $0998+v).
- `ap_volbase[side]` = program volume before the "no voice sounding" gate (stock $DC37 without the /4):
  the env module applies the gate (stock VOLUME_GATE $F90D) and writes slots $53/$57.
- Then, per side (en_side, en_buf set), it calls the sub-modules' parameter hooks:
  `vx_apply (X side)`, `env_apply (X side)`, `lfo_apply (X side)` — e.g. stock APPLY_GLIDE $DE30,
  VCO1 untracked pitch $DA64, pitch base $AEB3 (voice); APPLY_ENV_PARAMS $E521 + modes $E642 (env);
  LFO rates $E4A2, delay $DE5F, waveforms/retrigger $DC56 (lfo).

## Tick schedule (eng_tick, IRQ context, 488.2 Hz)

```
every tick: ctl_out (1 MIDI-controller CV), clk_tick (arp clock), vx_tick (VPK-5 scan)
phase 0: env_tick (16 envelopes ADSR2 v7..0 then ADSR1 v7..0, ADSR->PWM, volume gate, clears vx_rel)
phase 1: vx_glide X=1 (voices 4-7), lfo_tick2 (LFO2 R, L), lfo_pwmstep, eng_refresh
phase 2: lfo_tick1 (LFO1 R, L), vx_glide X=0 (voices 0-3) - or, RIGHT glide off, lfo_pwmstep -, eng_refresh
```
Same order as the stock $8127 (env, then glide R + LFO2, then LFO1 + glide L). Differences: the LFO->PWM step
of phase 0 moved to phase 1 (one tick later; it keeps its 6-tick alternation VCO1/VCO2), the S&H refresh only
runs in phases 1/2 (budget). Main-loop code that shares state with the tick (note-on, envelope restart,
octave change) runs under `cv_lock`.

Measured tick cost (cycles, emulator, `sim/test/fw-eng-env.test.ts`, WHOLE 8, 8 voices), phases
[envelopes | glide 4-7 + LFO2 + refresh | LFO1 + glide 0-3 + refresh]:

| Load | NeoV8 avg / max | Stock Rev4 avg / max (same scenario) |
|---|---|---|
| 16 envelopes releasing, no key down | 3123 / 3202, 2302 / 2436, 2391 / 2562 | 4426 / 4571, 2503 / 2649, 2567 / 2877 |
| 16 envelopes attacking, 8 keys held | 3534 / 3597, 2560 / 2699, 2654 / 2825 | 4670 / 4986, 2791 / 3007, 2943 / 3168 |
| + 16 ADSR->PWM writes | 4358 / 4369, 2501 / 2657, 2594 / 2752 | 5006 / 5229, 2718 / 3007, 2833 / 3232 |

(budget 4097; idle: about 2350 / 2440 / 2560). The VPK-5 scan costs 790 cycles idle, +33 per key held.

## Voice module (voice.asm)

Data per voice (0-7): `vx_key` (note | $80 key down), `vx_nn` (next note | gate), `vx_note` (sounding note |
gate), `vx_new` (to process), `vx_rst` (retrigger envelopes at note-on), `vx_dis` (bit 7: disabled or locked
by HOLD), `vx_vel`, tapers `vx_vca` / `vx_mvel` / `vx_avel`, `vx_gate`/`vx_rel`, glide `vx_cur/frac/tgt`,
pitch bases `vx_b1h/l/f` (VCO1), `vx_b2h/l/f` (VCO2) = (freq + CAL_OFS_HI[osc] + octave - 119)*256 +
CAL_OFS_LO[osc] (+ 2*detune for VCO1), osc 2v+1 VCO1 / 2v VCO2. Pitch PA = clamp(base + MIDI note, 0..127)
(the raw MIDI note, as the stock $EF94/$EFB1; not the key index), PB = base fraction.

Flow: tick `vx_tick` scans the VPK-5 (61 keys, velocity timer from the first to the second contact, events to a
FIFO) -> main loop `vx_service`: FIFO -> taper (user / factory 1-3 of the side's program byte $27) -> MIDI
out (`midi_note_out`) -> side queue (SPLIT: below `PF_SPLIT` = LEFT) -> poly / unison assigner -> voice data
(tapers) -> LAYER copy -> side update (gates, note-on CVs, envelope retrigger, kbd gate $50 / CV $55, LFO
retrigger, arpeggiator clock retrigger). Assign modes, unison stack, hold lock, voice-disable mask
(`CAL_FAILED | PF_VOICEMASK`), voice stealing: exactly the stock algorithms ($B2AA-$B361, $F9E8, $FA15, $FC27,
$EB58, $ED97, $A3B1-$A446).

Entry points: `vx_key_on/off` (A note, Y velocity 0-127 used as is; routed by the split point; marks the key
for `eng_lowest_held`), `vx_side_on/off` (X side, A note, Y velocity - MIDI: like the stock, the queue gets the
raw MIDI velocity, no taper; outside SPLIT everything plays on the RIGHT side; a note-off for a note not
playing is ignored), `vx_all_off` (every key-down voice gets its key-up, queues and unison stacks emptied;
held voices keep sounding), `vx_apply` (X side: pitch bases, glide, fixed VCO1 pitch), `vx_refresh` (after an
apply: glide fractions nudged, every voice's note-on CVs recomputed, one per main-loop pass), `vx_apply_perf`
(keyboard mode / unison change: queues cleared, gates closed, flags recomputed, envelopes reset, key resync;
voice mask change: same + held keys played again; HOLD change: lock / release), `vx_recall` (program recall:
envelopes idle, kbd CV / side gate cleared - called by `eng_load_prog` after `eng_apply_prog`, like the stock
recall; any other recall path should call it too), `eng_lowest_held` (A = lowest key held on the VPK-5 or via
`eng_key_on`, MIDI note; $FF none).

Arpeggiator (stock $FA7F-$FC1B): runs on a side when `PF_ARP_ON` has its bit and `PF_ARP_PAUSE` = 0. One step
per rising edge of the side's clock: RIGHT `en_aphase` bit 7 (clock.asm), LEFT the same or the sign of the
LEFT LFO1/LFO2 phase (`PF_ARP_CLK_L` 1/2). Modes `PF_ARP_MODE_R/L` (0 down, 1 random, 2 up, 3 up/down); notes
= keys held on the side, each played on the voice that holds it; `PF_ARP_AUTOOCT` (bit per side) steps
`PF_OCT_R/L` (0-2 cycle, both sides in LAYER) at each wrap - the engine writes PERF there, the UI should redraw;
`PF_KBDGATE` (bit0 RIGHT, bit1 LEFT: the held chord gated by the clock); `PF_ARP_RETRIG` (non-zero: the first
key down restarts the clock high: `vx_clkretrig` writes clock.asm's en_tdiv6/en_tcount and calls clk_out);
`PF_ARP_SYNC` (non-zero: the RIGHT side's first key restarts the LEFT LFO used as LEFT arp clock). Unison +
arpeggiator: the unison note restarts on every rising edge. Not done: `PF_ARP_OCT_R/L` ranges 2-4 (behave as 1).

## Envelope module (env.asm)

Envelope e: 0-7 ADSR2 of voice e (slot $68+e, multiplier `vx_vca | VCA-velocity-off flag`), 8-15 ADSR1 of voice
e-8 (slot $70+v, multiplier = depth*2). State machine = the stock one ($8900 tables, `env_jt` here, one page,
`.align 256`): states release / decay / sustain / attack / ADR release / idle / ADR end, modes normal /
unconditional / ADR / reset-to-zero (program byte $1F, active low), 16-bit position walking the ROM level curves
(`tb_env_*`). `env_apply` (X side): rate indexes 127 - p + 3, release defeat (`PF_RELDEF`, WHOLE 8: RIGHT bit;
release cut = index 127 or = decay with "release gets decay"), sustains, fixed rates when velocity->attack /
kbd tracking are off, VCA-velocity flag, ADSR1 depth, modes, PWM routing, program volume table value.
`env_note` (note-on rates), `env_vel` / `env_gate` (X voice: multipliers / dispatch base), `env_restart` (X
voice: stock $A61B, DAC locked), `env_reset` (all idle). Volume gate (stock $F90D): slots $53/$57 =
`ap_volbase` while some ADSR2 level is non-zero, /4 otherwise.

## LFO module (lfo.asm)

LFO L = lfo#*2 + side; 16-bit phase bouncing at the extremes (increment: high byte complemented, low byte
negated, like the stock), rate = `tb_env_pa1/pb1[rate*2 + kbd]` (kbd = side's keyboard CV key index, /2 for
half tracking), waveforms sine (quarter-wave from `tb_env_pa0..3`), triangle, saw, S&H (8-bit LFSR `lfo_rnd`,
shared with the arpeggiator random mode), outputs $79+Y (LFO1, x delay-fade multiplier, offset slot $78+Y) /
$7A+Y (LFO2, offset added), Y = side*4. LEFT LFOs: WHOLE 8 copy the RIGHT ones; `PF_LFOSYNC` bit0/bit1 makes
the LEFT LFO1/LFO2 follow the RIGHT phase. Key retrigger (`lfo_key`, byte $1F bits 6/5 active low), LFO1 delay
(byte $1D low nibble: fade rate = ADSR rate[(d+1)*8] >> 6), LFO1 square latches $6305/$6306, LFO->PWM
(`lfo_pwmstep`: VCO1 / VCO2 alternately, the LFO value x 2 with the voices' PWM multipliers).

## Parity (sim/test/fw-eng-voice/env/lfo.test.ts)

Stock and NeoV8 boot on the same battery image, the stock is driven with panel buttons (+ RAM pokes for
Alternate/SET-page settings), NeoV8 through the test port, both receive the same VPK-5 key events. Voice state is
compared exactly; S&H levels are sampled every 2 ms and compared with a time window (W = 10 samples = 20 ms for
voices/envelopes, 8 for LFOs) and a level tolerance (0.002-0.004; envelopes/LFOs: a NeoV8 sample must lie within
the range of the stock samples of the window). Why the window: both ROMs handle key events in their main
loops, phase-locked to the 3-tick cycle with different phases (key -> gate latency: stock 3-5 ms, NeoV8 3-12 ms),
plus the 6.1 ms envelope/LFO update period. Known, inherent to that latency: an event landing in a fast segment
(e.g. key up during an attack followed by a slow release, or an LFO rate change mid-cycle) gives a lasting
offset; the VPK-5 velocity timer may count one frame more or less on either ROM (ticks deferred while the main
loop holds the DAC), so velocity-sensitive tests use velocities at the flat ends of the tapers.

## Main-loop entry points
`eng_key_on/off` (keyboard routing by PERF), `eng_side_on/off` (MIDI: explicit side), `eng_all_off`,
`eng_apply_perf` (-> `vx_apply_perf`, then full apply), `eng_service` (-> `vx_service`), `vx_refresh`
(after a program change: voices recompute pitch/Fc/velocity), `eng_lowest_held`.
