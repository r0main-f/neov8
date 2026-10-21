; eng/env: zero page and RAM variables (owned by the env module)
; Envelope index e: 0-7 = ADSR2 (VCA) of voice e (slot $68+e), 8-15 = ADSR1 (VCF) of voice e-8 (slot $68+e).
        .zeropage
env_vec:    .res 2          ; handler vector (jmp (env_vec))
env_rtn:    .res 2          ; where a handler continues (tick loop, or an RTS for single calls)
env_gflag:  .res 1          ; volume gate: $FF = some ADSR2 level is non-zero
env_t0:     .res 1
env_t1:     .res 1

        .segment "BSS2"
env_st:     .res 16         ; state 0 release, 1 decay, 2 sustain, 3 attack, 4 ADR release, 5 idle, 6 ADR end
env_ph:     .res 16         ; curve position, high byte (table index)
env_pl:     .res 16         ; curve position, fraction (bits 7-6 select the interpolated table)
env_lv:     .res 16         ; last level (PA byte written; bit 7 may be set while attacking)
env_ahi:    .res 16         ; attack rate (16 bit)
env_alo:    .res 16
env_dhi:    .res 16         ; decay rate
env_dlo:    .res 16
env_rhi:    .res 16         ; release rate
env_rlo:    .res 16
env_sus:    .res 16         ; sustain level (PA units)
env_mg:     .res 16         ; dispatch base: mode*16 + gate*8
env_mul:    .res 16         ; DAC1022 multiplier of the envelope slot
env_pwm:    .res 16         ; bit7: drives VCO1 PWM (slot 8v+5), bit6: VCO2 PWM (slot 8v+1)
env_mode:   .res 4          ; [side] ADSR2 mode*16, [2+side] ADSR1 mode*16
env_vflag:  .res 2          ; per side: $FF = VCA velocity off
env_depth:  .res 2          ; per side: ADSR1 -> VCF depth * 2
env_idx:    .res 12         ; rate indexes, [k*2+side], k: 0 A2, 1 A1, 2 D2, 3 D1, 4 R2, 5 R1
env_s2:     .res 2          ; per side: ADSR2 sustain
env_s1:     .res 2          ; per side: ADSR1 sustain
        .bss
