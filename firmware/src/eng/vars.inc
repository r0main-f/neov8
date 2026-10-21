; eng: zero page and RAM variables. Sub-modules (voice, env, lfo) have their own vars_*.inc.
        .zeropage
en_side:    .res 1          ; side being processed: 0 = RIGHT, 1 = LEFT
en_buf:     .res 2          ; edit buffer of en_side (WHOLE 8: always EDIT_R)
en_mbuf:    .res 2          ; effective mod-bank copy of en_side (en_buf + $38, 5 bytes)
en_t0:      .res 1          ; temporaries (engine only, never across module calls)
en_t1:      .res 1
en_t2:      .res 1
en_t3:      .res 1
en_ptr:     .res 2
en_phase:   .res 1          ; 3-phase round robin of the control tick
en_pwmalt:  .res 1          ; alternates LFO->PWM VCO1 / VCO2 in phase 0
en_mute:    .res 1          ; AUDIO MUTE: program volume 0

        .bss
; ---- PWM configuration (written by apply, read by env and lfo). Index i = vco2*2 + side (vco2: 1 = VCO2).
ap_pwm_src: .res 4          ; $FF none (pulse off or depth 0), 0 LFO1, 1 LFO2, 2 ADSR1, 3 ADSR2, 4-7 none
ap_pwm_kbd: .res 4          ; $FF = PWM keyboard tracking on
ap_pwm_dep: .res 4          ; depth * 16 (DAC1022 multiplier for the PWM slot)
ap_pwm_env1: .res 4         ; $FF when the source is ADSR1
ap_pwm_env2: .res 4         ; $FF when the source is ADSR2
ap_pwm_mul: .res 16         ; per voice: [0..7] VCO1 PWM multiplier, [8..15] VCO2 (= depth*16)
; ---- program volume (before the "no voice sounding" gate applied by env)
ap_volbase: .res 2          ; per side: PARAM_EXP[vol*2] >> 1, 0 when muted
; ---- mod-bank depth masks per side*4 + bank ($FF on, 0 = all controllers of the bank defeated)
ap_dmask:   .res 8

        .include "eng/vars_voice.inc"
        .include "eng/vars_env.inc"
        .include "eng/vars_lfo.inc"
