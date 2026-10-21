# NeoV8 engine — internal contract

Public API: `api.inc` (`eng_*`). Rules: `firmware/ARCHITECTURE.md`.

## Conventions (from the stock code, see docs/hardware.md §3.1 and the corrections below)

- **Side 0 = RIGHT, side 1 = LEFT.** Side s owns voices 4s..4s+3 (RIGHT = voices 0-3, LEFT = 4-7), CD4724
  waveform latch page $61+s, Fc slots $40+8s.., volume/Q $44+8s.., noise $52+4s, program volume $53+4s,
  mod depths $60+4s.., wave compensation $7B+4s. (Some labels in docs/hardware.md assumed the opposite: the
  code is authoritative, the Reference Guide confirms "3,2,1,0 = Right voices".)
- **WHOLE 8** (PF_KBMODE = 0): both sides are processed with the RIGHT edit buffer (stock $E31A).
- Slot values: `cv_pa[s]` = DAC bits 13-7, `cv_pb[s]` = DAC bits 6-0 in bits 7-1, `cv_mul[s]` = DAC1022
  multiplier. The tick refreshes every slot from these tables; a dynamic writer updates the table AND may
  write the slot immediately with `cv_write`/`cv_out` (tick context or DAC locked).

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
cv_refresh (16 slots)   vx_tick (VPK-5 scan, key events)
phase 0: env_tick (16 envelopes, ADSR->PWM, volume gate), lfo_pwm (X = 0 VCO1 / 1 VCO2 alternately)
phase 1: lfo_tick1 (LFO1 both sides), vx_glide (X = 0 RIGHT)
phase 2: vx_glide (X = 1 LEFT), lfo_tick2 (LFO2 both sides)
```
The engine agent may change the schedule to match the stock exactly (document it here).

## Main-loop entry points
`eng_key_on/off` (keyboard routing by PERF), `eng_side_on/off` (MIDI: explicit side), `eng_all_off`,
`eng_apply_perf` (-> `vx_apply_perf`, then full apply), `eng_service` (-> `vx_service`), `vx_refresh`
(after a program change: voices recompute pitch/Fc/velocity).
