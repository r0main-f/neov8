; env module: 16 ADSRs (ADSR2 -> VCA slots $68-$6F, ADSR1 -> VCF slots $70-$77), ADSR -> PWM, volume gate.
; Behaviour of the stock Rev4 engine (envelope law = the ROM's level curve tables tb_env_*), new code.
;
; Envelope e: 0-7 = ADSR2 of voice e, 8-15 = ADSR1 of voice e-8; its S&H slot is $68+e.
; Each envelope walks a position (env_ph.env_pl, 16 bit) DOWN by its segment rate every 3 ticks; the level
; written is a curve lookup: attack = complement of the curve (fast rise), decay = sustain + curve, release =
; curve. The two top bits of the fraction pick one of 4 interpolated tables (tb_env_pa0..3 / pb0..3).
; States: 0 release, 1 decay, 2 sustain, 3 attack, 4 release while the key is held (ADR mode), 5 idle,
; 6 end of an ADR release (key still held). The next action is chosen by (mode, gate, state):
; modes 0 normal, 1 unconditional (attack/decay finish after key up), 2 ADR (no sustain), 3 reset-to-zero
; (re-attack starts from 0).

ENV_REL = 0*3                       ; states are offsets in a dispatch group (3-byte JMPs)
ENV_DEC = 1*3
ENV_SUS = 2*3
ENV_ATT = 3*3
ENV_ADR = 4*3
ENV_IDLE = 5*3
ENV_END = 6*3
ENV_GATE = $20                      ; dispatch group: mode*64 + gate*32

env_init:
        lda #>env_jt
        sta env_vec+1
        jsr env_reset
        ldx #15
@l:     lda #0
        sta env_mg,x
        sta env_pwm,x
        lda #$ff
        sta env_mul,x
        dex
        bpl @l
        lda #0
        sta env_gflag
        rts

; All envelopes idle at level 0 (program recall, keyboard-mode change: stock ENV_RESET_ALL).
env_reset:
        php
        sei
        ldx #15
@l:     lda #0
        sta env_ph,x
        sta env_pl,x
        sta env_lv,x
        lda #ENV_IDLE
        sta env_st,x
        dex
        bpl @l
        plp
        rts

; ------------------------------------------------------------------ program parameters (X = side, en_buf)
env_apply:
        stx en_side
        ldy #$15                    ; ADSR2: A $15, D $16, R $17, S $18
        lda #0
        jsr env_par
        ldx en_side
        sta env_s2,x
        ldy #$19                    ; ADSR1: A $19, D $1A, R $1B, S $1C
        lda #2
        jsr env_par
        ldx en_side
        sta env_s1,x
        ldy #$1c                    ; VCA velocity off (bit 7 = 1, active low)
        lda (en_buf),y
        asl
        lda #0
        bcc @vf
        lda #$ff
@vf:    sta env_vflag,x
        ldy #$14                    ; ADSR1 -> VCF depth
        lda (en_buf),y
        asl
        sta env_depth,x
        ldy #$1f                    ; modes: bits 1-0 ADSR1, 3-2 ADSR2 (active low: bit0 = unconditional, bit1 = ADR)
        lda (en_buf),y
        eor #$ff
        pha
        and #$03
        lsr
        ror
        ror                         ; mode * 64
        sta env_mode+2,x
        pla
        asl
        asl
        asl
        asl
        and #$c0
        sta env_mode,x
        ; per voice of the side
        txa
        asl
        asl
        tax                         ; first voice
        lda #3
        sta en_t3
@v:     jsr env_vset                ; multipliers, dispatch base, PWM routing
        txa
        pha
        ldy en_side
        lda env_s2,y
        sta env_sus,x
        lda env_s1,y
        sta env_sus+8,x
        ldy #$0a                    ; velocity -> attack off: fixed attack rates now
        lda (en_buf),y
        bpl @nva
        ldy en_side
        lda env_idx+0,y
        jsr env_ratea               ; ADSR2 (e = v)
        txa
        ora #8
        tax
        ldy en_side
        lda env_idx+2,y
        jsr env_ratea               ; ADSR1
        txa
        and #7
        tax
@nva:   ldy #$0c                    ; decay/release keyboard tracking off: fixed rates now
        lda (en_buf),y
        bpl @nkt
        lda #0
        jsr env_dr
@nkt:   pla
        tax
        inx
        dec en_t3
        bpl @v
        ; program volume table value (the slot is written by the gate when it changes)
        ldx en_side
        jsr env_volval
        ldy env_slv,x
        sta cv_pa,y
        rts

; Rate indexes and sustain of one ADSR: Y = first byte (attack), A = 0 ADSR2 / 2 ADSR1.
; Index = 127 - p + 3 (max 127). Release defeat: index 127, or the decay's when "release gets decay".
; Returns A = sustain (0-127).
env_par:
        clc
        adc en_side
        tax                         ; env_idx offset: k*2 + side
        jsr @one                    ; attack
        inx
        inx
        inx
        inx
        iny
        jsr @one                    ; decay
        inx
        inx
        inx
        inx
        iny
        stx en_t0
        ldx en_side
        lda PERF+PF_KBMODE          ; WHOLE 8: the RIGHT release defeat for both sides
        bne @sd
        ldx #0
@sd:    lda PERF+PF_RELDEF
        and side_bit,x
        ldx en_t0
        cmp #0
        beq @rn
        sty en_t1
        ldy #$20                    ; bit 6: 1 = release cut off (fastest), 0 = release gets the decay
        lda (en_buf),y
        ldy en_t1
        and #$40
        beq @rd
        lda #$7f
        sta env_idx,x
        bne @sus
@rd:    dey
        jsr @one
        iny
        bne @sus
@rn:    jsr @one                    ; release
@sus:   iny
        lda (en_buf),y
        and #$7f
        rts
@one:   lda (en_buf),y
        and #$7f
        eor #$7f
        clc
        adc #3
        bpl @o
        lda #$7f
@o:     sta env_idx,x
        rts

; Attack rate of envelope X from rate index A (0-127).
env_ratea:
        tay
        lda tb_adsr_rate_hi,y
        sta env_ahi,x
        lda tb_adsr_rate_lo,y
        sta env_alo,x
        rts

; Decay and release rates of voice X (both ADSRs) from the side's indexes + A (keyboard tracking offset).
; Y is preserved? no. en_side = side of the voice's parameters.
env_dr:
        sta en_t0
        ldy en_side
        lda env_idx+4,y             ; D2
        jsr @add
        lda tb_adsr_rate_hi,y
        sta env_dhi,x
        lda tb_adsr_rate_lo,y
        sta env_dlo,x
        ldy en_side
        lda env_idx+6,y             ; D1
        jsr @add
        lda tb_adsr_rate_hi,y
        sta env_dhi+8,x
        lda tb_adsr_rate_lo,y
        sta env_dlo+8,x
        ldy en_side
        lda env_idx+8,y             ; R2
        jsr @add
        lda tb_adsr_rate_hi,y
        sta env_rhi,x
        lda tb_adsr_rate_lo,y
        sta env_rlo,x
        ldy en_side
        lda env_idx+10,y            ; R1
        jsr @add
        lda tb_adsr_rate_hi,y
        sta env_rhi+8,x
        lda tb_adsr_rate_lo,y
        sta env_rlo+8,x
        rts
@add:   clc
        adc en_t0
        bpl @a
        lda #$7f
@a:     tay
        rts

; Note-on rates of voice X (main loop, from voice.asm): en_side = parameter side, A = attack velocity offset
; ($FF = no velocity->attack), env_t0 unused. Keyboard tracking offset in Y ($FF = none).
env_note:
        sty env_t0
        cmp #$ff
        beq @nk
        pha
        ldy en_side
        clc
        adc env_idx+0,y
        bpl @a2
        lda #$7f
@a2:    jsr env_ratea
        pla
        ldy en_side
        clc
        adc env_idx+2,y
        bpl @a1
        lda #$7f
@a1:    pha
        txa
        ora #8
        tax
        pla
        jsr env_ratea
        txa
        and #7
        tax
@nk:    lda env_t0
        cmp #$ff
        beq @r
        jmp env_dr
@r:     rts

; Voice X: envelope multipliers, dispatch bases (keeps the gate) and PWM routing. X preserved.
env_vset:
        jsr env_vel
        lda vx_gate,x
        jsr env_gate
        ; PWM routing: i = vco2*2 + side
        ldy #0
        cpx #4
        bcc @s
        iny
@s:     lda #0
        sta en_t0
        sta en_t1
        lda ap_pwm_env2,y           ; VCO1 by ADSR2
        and #$80
        sta en_t0
        lda ap_pwm_env2+2,y         ; VCO2 by ADSR2
        and #$40
        ora en_t0
        sta env_pwm,x
        lda ap_pwm_env1,y
        and #$80
        sta en_t1
        lda ap_pwm_env1+2,y
        and #$40
        ora en_t1
        sta env_pwm+8,x
        rts

; Voice X: envelope multipliers (VCA: velocity scale | velocity-off flag, VCF: depth). X, Y preserved.
env_vel:
        cpx #4
        bcs @l
        lda vx_vca,x
        ora env_vflag
        sta env_mul,x
        lda env_depth
        sta env_mul+8,x
        rts
@l:     lda vx_vca,x
        ora env_vflag+1
        sta env_mul,x
        lda env_depth+1
        sta env_mul+8,x
        rts

; Voice X gate: A = 0 off / non-zero on. Updates both envelopes' dispatch bases. X, Y preserved.
env_gate:
        cmp #0
        beq @off
        lda #ENV_GATE
@off:   sta env_t1
        cpx #4
        bcs @l
        ora env_mode
        sta env_mg,x
        lda env_t1
        ora env_mode+2
        sta env_mg+8,x
        rts
@l:     ora env_mode+1
        sta env_mg,x
        lda env_t1
        ora env_mode+3
        sta env_mg+8,x
        rts

; ------------------------------------------------------------------ control tick, phase 0
env_tick:
        lda #<env_tret
        sta env_rtn
        lda #>env_tret
        sta env_rtn+1
        ldx #7                      ; ADSR2 v7..v0, then ADSR1 v7..v0 (stock order)
env_tl: sta SH_HOLD
        lda env_mul,x
        sta PIA2_PA
        sta SH_SLOT+$68,x
        lda env_mg,x
        ora env_st,x
        sta env_vec
        jmp (env_vec)
env_tret:
        lda env_pwm,x
        bne env_tpwm
env_tnext:
        dex
        bmi @to15
        cpx #7
        bne env_tl
        sta SH_HOLD
        lda #$ff
        sta PIA2_PA
        lda #0                      ; "released since the last envelope pass" flags
        ldx #7
@cr:    sta vx_rel,x
        dex
        bpl @cr
        jmp env_volgate
@to15:  ldx #15
        bne env_tl

; ADSR -> PWM: the envelope value still on the DAC goes to the voice's PWM slot(s) with the PWM multiplier.
env_tpwm:
        asl
        sta env_t0
        bcc @n1
        sta SH_HOLD
        ldy env_tv,x
        lda ap_pwm_mul,y
        sta PIA2_PA
        ldy env_ts5,x
        sta SH_SLOT,y
        sta SH_SAMPLE
@n1:    asl env_t0
        bcc @n2
        sta SH_HOLD
        ldy env_tv,x
        lda ap_pwm_mul+8,y
        sta PIA2_PA
        ldy env_ts1,x
        sta SH_SLOT,y
        sta SH_SAMPLE
@n2:    jmp env_tnext

; Volume gate (stock VOLUME_GATE): program volume / 4 while no ADSR2 is above 0.
env_volgate:
        lda #0
        ldx #7
@l:     ora env_lv,x
        dex
        bpl @l
        cmp #0
        beq @z
        lda #$ff
@z:     cmp env_gflag
        beq @r
        sta env_gflag
        ldx #0
        jsr @side
        ldx #1
@side:  jsr env_volval
        pha
        lda env_slv,x
        tax
        ldy cv_pb,x
        pla
        jmp cv_write
@r:     rts
env_slv:    .byte $53, $57

; A = program volume of side X after the gate (X preserved).
env_volval:
        lda ap_volbase,x
        ldy env_gflag
        bne @r
        lsr
        lsr
@r:     rts

; Re-run the envelopes of voice X once now (stock note-on retrigger): the "key up" action of the current state
; (e.g. attack -> release from the current level), the next tick then re-attacks. Main loop, DAC locked.
env_restart:
        stx env_t0
        lda #<env_rts
        sta env_rtn
        lda #>env_rts
        sta env_rtn+1
        txa
        ora #8
        tax
        sta SH_SLOT+$68,x           ; ADSR1
        lda env_mul,x
        sta PIA2_PA
        jsr env_call0
        sta SH_HOLD
        ldx env_t0                  ; ADSR2
        lda env_mul,x
        sta PIA2_PA
        sta SH_SLOT+$68,x
        jsr env_call0
        sta SH_HOLD
        lda #$ff
        sta PIA2_PA
        ldx env_t0
        rts
env_call0:
        lda env_mg,x
        and #<~ENV_GATE
        ora env_st,x
        sta env_vec
        jmp (env_vec)
env_rts:
        rts

; ------------------------------------------------------------------ segment handlers (X = envelope)
eh_hold:                            ; output the held level (both DAC bytes = level, like the original)
        lda env_lv,x
        sta PIA1_PA
        sta PIA1_PB
        sta SH_SAMPLE
        jmp (env_rtn)

eh_ea:                              ; key up: release from the current level (no sample this pass)
        lda env_lv,x
        sta PIA1_PA
        asl
        tay
        lda tb_env_inv,y
        sta env_ph,x
        lda #ENV_REL
        sta env_st,x
        jmp (env_rtn)

eh_z0:                              ; ADR, key up during the held release: plain release
        lda #ENV_REL
        sta env_st,x
        lda env_lv,x
        sta PIA1_PA
        jmp (env_rtn)

eh_zf:                              ; ADR end, key up: idle
        lda #ENV_IDLE
        sta env_st,x
        lda env_lv,x
        sta PIA1_PA
        jmp (env_rtn)

eh_zc:                              ; ADR: sustain reached with the key held -> release
        lda #ENV_ADR
        sta env_st,x
        lda env_lv,x
        sta PIA1_PA
        asl
        tay
        lda tb_env_inv,y
        sta env_ph,x
        jmp (env_rtn)

eh_z9:                              ; reset-to-zero mode: attack from 0
        lda #ENV_ATT
        sta env_st,x
        lda #$ff
        sta env_ph,x
        jmp eh_att

eh_eb:                              ; key down: attack from the current level
        lda #ENV_ATT
        sta env_st,x
        lda env_lv,x
        asl
        eor #$ff
        tay
        lda tb_env_inv,y
        sta env_ph,x
eh_att:                             ; attack: level = complement of the curve, position going down
        sec
        lda env_pl,x
        sbc env_alo,x
        sta env_pl,x
        lda env_ph,x
        sbc env_ahi,x
        bcc @end
        beq @end
        sta env_ph,x
        tay
        lda env_pl,x
        rol
        bcs @h
        bmi @t1
        lda tb_env_pa0,y
        eor #$ff
        sta PIA1_PA
        sta env_lv,x
        lda tb_env_pb0,y
        eor #$ff
        sta PIA1_PB
        sta SH_SAMPLE
        jmp (env_rtn)
@t1:    lda tb_env_pa1,y
        eor #$ff
        sta PIA1_PA
        sta env_lv,x
        lda tb_env_pb1,y
        eor #$ff
        sta PIA1_PB
        sta SH_SAMPLE
        jmp (env_rtn)
@h:     bmi @t3
        lda tb_env_pa2,y
        eor #$ff
        sta PIA1_PA
        sta env_lv,x
        lda tb_env_pb2,y
        eor #$ff
        sta PIA1_PB
        sta SH_SAMPLE
        jmp (env_rtn)
@end:   lda #ENV_DEC                ; top reached: decay starts where sustain + curve = full level
        sta env_st,x
        lda env_sus,x
        eor #$ff
        asl
        tay
        lda tb_env_inv,y
        sta env_ph,x
        ldy #0
@t3:    lda tb_env_pa3,y
        eor #$ff
        sta PIA1_PA
        sta env_lv,x
        lda tb_env_pb3,y
        eor #$ff
        sta PIA1_PB
        sta SH_SAMPLE
        jmp (env_rtn)

eh_dec:                             ; decay: level = sustain + curve
        sec
        lda env_pl,x
        sbc env_dlo,x
        sta env_pl,x
        lda env_ph,x
        sbc env_dhi,x
        bcc @end
@go:    sta env_ph,x
        tay
        lda env_pl,x
        rol
        bcs @h
        bmi @t1
        lda env_sus,x
        adc tb_env_pa0,y
        sta PIA1_PA
        sta env_lv,x
        lda tb_env_pb0,y
        sta PIA1_PB
        sta SH_SAMPLE
        jmp (env_rtn)
@t1:    lda env_sus,x
        adc tb_env_pa1,y
        sta PIA1_PA
        sta env_lv,x
        lda tb_env_pb1,y
        sta PIA1_PB
        sta SH_SAMPLE
        jmp (env_rtn)
@h:     clc
        bmi @t3
        lda env_sus,x
        adc tb_env_pa2,y
        sta PIA1_PA
        sta env_lv,x
        lda tb_env_pb2,y
        sta PIA1_PB
        sta SH_SAMPLE
        jmp (env_rtn)
@t3:    lda env_sus,x
        adc tb_env_pa3,y
        sta PIA1_PA
        sta env_lv,x
        lda tb_env_pb3,y
        sta PIA1_PB
        sta SH_SAMPLE
        jmp (env_rtn)
@end:   lda #ENV_SUS
        sta env_st,x
        lda #0
        beq @go

eh_rel:                             ; release: level = curve
        sec
        lda env_pl,x
        sbc env_rlo,x
        sta env_pl,x
        lda env_ph,x
        sbc env_rhi,x
        bcc @end
@go:    sta env_ph,x
        tay
        lda env_pl,x
        rol
        bcs @h
        bmi @t1
        lda tb_env_pa0,y
        sta PIA1_PA
        sta env_lv,x
        lda tb_env_pb0,y
        sta PIA1_PB
        sta SH_SAMPLE
        jmp (env_rtn)
@t1:    lda tb_env_pa1,y
        sta PIA1_PA
        sta env_lv,x
        lda tb_env_pb1,y
        sta PIA1_PB
        sta SH_SAMPLE
        jmp (env_rtn)
@h:     bmi @t3
        lda tb_env_pa2,y
        sta PIA1_PA
        sta env_lv,x
        lda tb_env_pb2,y
        sta PIA1_PB
        sta SH_SAMPLE
        jmp (env_rtn)
@t3:    lda tb_env_pa3,y
        sta PIA1_PA
        sta env_lv,x
        lda tb_env_pb3,y
        sta PIA1_PB
        sta SH_SAMPLE
        jmp (env_rtn)
@end:   lda env_st,x
        bne @e6
        lda #ENV_IDLE
        sta env_st,x
        lda #0
        beq @go
@e6:    lda #ENV_END
        sta env_st,x
        lda #0
        beq @go

; Dispatch table: one page, group (mode*2 + gate) every 32 bytes, entry = state (3-byte JMPs).
.macro ENV_GROUP h0, h1, h2, h3, h4, h5, h6
        jmp h0
        jmp h1
        jmp h2
        jmp h3
        jmp h4
        jmp h5
        jmp h6
        .res 11, $ff
.endmacro
        .align 256
env_jt: ENV_GROUP eh_rel, eh_ea,  eh_ea,   eh_ea,  eh_rel, eh_hold, eh_hold    ; normal, key up
        ENV_GROUP eh_eb,  eh_dec, eh_hold, eh_att, eh_eb,  eh_eb,   eh_eb      ; normal, key down
        ENV_GROUP eh_rel, eh_dec, eh_ea,   eh_att, eh_rel, eh_hold, eh_hold    ; unconditional, key up
        ENV_GROUP eh_eb,  eh_dec, eh_hold, eh_att, eh_eb,  eh_eb,   eh_eb      ; unconditional, key down
        ENV_GROUP eh_rel, eh_ea,  eh_ea,   eh_ea,  eh_z0,  eh_hold, eh_zf      ; ADR, key up
        ENV_GROUP eh_eb,  eh_dec, eh_zc,   eh_att, eh_rel, eh_eb,   eh_hold    ; ADR, key down
        ENV_GROUP eh_rel, eh_ea,  eh_ea,   eh_ea,  eh_rel, eh_hold, eh_hold    ; reset to zero, key up
        ENV_GROUP eh_z9,  eh_dec, eh_hold, eh_att, eh_rel, eh_z9,   eh_z9      ; reset to zero, key down

env_tv:     .byte 0,1,2,3,4,5,6,7, 0,1,2,3,4,5,6,7                 ; voice of envelope e
env_ts5:    .byte 5,13,21,29,37,45,53,61, 5,13,21,29,37,45,53,61   ; its VCO1 PWM slot
env_ts1:    .byte 1,9,17,25,33,41,49,57, 1,9,17,25,33,41,49,57     ; its VCO2 PWM slot
