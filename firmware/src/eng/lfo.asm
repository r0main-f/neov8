; lfo module: LFO1/LFO2 x 2 sides (slots $78-$7A / $7C-$7E), delay fade-in, L-R sync, key retrigger,
; keyboard rate tracking, LFO1 square latches ($6305/$6306), LFO -> PWM. Behaviour of the stock Rev4 engine.
;
; Each LFO is a 16-bit signed phase that moves by its increment every 3 ticks and bounces at the extremes
; (the increment changes sign: that edge is the LFO1 square and the S&H clock). Waveforms are computed from
; the phase: triangle = phase, saw = phase folded by direction, sine = the envelope curve tables used as a
; quarter-wave, S&H = random value held between bounces. LFO2 output carries its DC offset in the slot,
; LFO1 has a separate offset slot; both are scaled by the LFO1 delay fade (multiplier).

lfo_init:
        lda #1
        sta lfo_alt
        lda #0
        sta lfo_rnd
        ldx #3
@l:     sta lfo_ihi,x
        sta lfo_ilo,x
        sta lfo_phi,x
        sta lfo_plo,x
        sta lfo_flag,x
        sta lfo_wave,x
        sta lfo_sh,x
        sta lfo_retrig,x
        dex
        bpl @l
        ldx #1
@d:     lda #$ff
        sta lfo_dhi,x
        sta lfo_fade,x
        lda #0
        sta lfo_dlo,x
        sta lfo_fhi,x
        sta lfo_flo,x
        sta lfo_fon,x
        dex
        bpl @d
        rts

; ------------------------------------------------------------------ program parameters (X = side, en_buf)
lfo_apply:
        stx en_side
        jsr lfo_rates0
        ; LFO1 delay: nibble d = 15 - (byte $1D & 15); 15 = none. Fade rate = ADSR rate[(d+1)*8] >> 6.
        ldx en_side
        ldy #$1d
        lda (en_buf),y
        eor #$ff
        and #$0f
        cmp #$0f
        bne @dl
        lda #$ff
        sta lfo_dhi,x
        bne @wv
@dl:    clc
        adc #1
        asl
        asl
        asl
        tay
        lda tb_adsr_rate_hi,y
        sta lfo_t0
        lda tb_adsr_rate_lo,y
        ldy #6
@sh:    lsr lfo_t0
        ror
        dey
        bne @sh
        sta lfo_dlo,x
        lda lfo_t0
        sta lfo_dhi,x
@wv:    ldy #$1d                    ; waveforms: LFO1 byte $1D bits 6-5, LFO2 byte $1E bits 3-2
        lda (en_buf),y
        lsr
        lsr
        lsr
        lsr
        lsr
        and #3
        sta lfo_wave,x
        ldy #$1e
        lda (en_buf),y
        lsr
        lsr
        and #3
        sta lfo_wave+2,x
        ldy #$1f                    ; key retrigger: bit 6 LFO1, bit 5 LFO2 (active low)
        lda (en_buf),y
        sta lfo_t0
        lda #0
        bit lfo_t0
        bvs @r1
        lda #$ff
@r1:    sta lfo_retrig,x
        lda lfo_t0
        and #$20
        beq @r2on
        lda #0
        beq @r2
@r2on:  lda #$ff
@r2:    sta lfo_retrig+2,x
        ; PWM slots modulated by an LFO or an ADSR are written by the engine, not refreshed
        lda #0                      ; VCO1: i = side
        jsr lfo_dyn
        lda #2                      ; VCO2: i = 2 + side
lfo_dyn:
        ora en_side
        tay
        lda ap_pwm_src,y            ; 0-3 = modulated
        cmp #4
        lda #0
        bcs @st
        lda #$ff
@st:    sta lfo_t0
        lda en_side
        asl
        asl
        asl
        asl
        asl                         ; side*32
        cpy #2
        bcs @c1
        ora #4                      ; VCO1 PWM = ch5, VCO2 = ch1
@c1:    ora #1
        tax
        ldy #3
@dy:    lda lfo_t0
        sta vx_dyn,x
        txa
        clc
        adc #8
        tax
        dey
        bpl @dy
        rts

; LFO rates of side X (keyboard tracking from the side's last keyboard CV note). Buffer selected here.
lfo_rates:
        stx en_side
        jsr ap_select
lfo_rates0:
        php
        sei
        ldx en_side
        ldy #$0b                    ; LFO1 rate
        lda #$40                    ; tracking bit (active low), half bit $10
        sta lfo_t0
        jsr @one
        ldx en_side
        inx
        inx
        ldy #$23                    ; LFO2 rate
        lda #$20                    ; tracking bit $20, half bit $08
        sta lfo_t0
        jsr @one
        plp
        rts
; X = LFO, Y = rate byte. Increment = curve(rate*2 + tracking) (16 bit), keeping the current direction.
@one:   lda (en_buf),y
        asl
        sta lfo_lo
        ldy #$24
        lda (en_buf),y
        and lfo_t0
        bne @nt                     ; tracking off
        lda lfo_t0
        lsr
        lsr
        and (en_buf),y              ; half bit ($10 / $08), active low
        php
        txa
        and #1
        tay
        lda vx_kcvs,y
        plp
        bne @full
        lsr
@full:  clc
        adc lfo_lo
        bcc @ok
        lda #$ff
        bne @ok
@nt:    lda lfo_lo
@ok:    tay
        lda tb_env_pa1,y
        sta lfo_hi
        lda tb_env_pb1,y
        bne @lo
        lda #1
@lo:    ldy lfo_ihi,x
        bpl @pos
        eor #$ff
        sta lfo_ilo,x
        lda lfo_hi
        eor #$ff
        sta lfo_ihi,x
        rts
@pos:   sta lfo_ilo,x
        lda lfo_hi
        sta lfo_ihi,x
        rts

; Key retrigger of LFO X (when its side's first key goes down): phase 0, direction negative.
lfo_key:
        lda lfo_retrig,x
        bne lfo_reset
        rts
lfo_reset:
        lda lfo_ihi,x
        bmi @z
        eor #$ff
        sta lfo_ihi,x
        lda lfo_ilo,x
        eor #$ff
        clc
        adc #1
        sta lfo_ilo,x
        bcc @z
        inc lfo_ihi,x
@z:     lda #0
        sta lfo_plo,x
        sta lfo_phi,x
        rts

; ------------------------------------------------------------------ control tick
lfo_tick1:                          ; LFO1 RIGHT, LEFT
        ldx #0
        jsr lfo_upd
        ldx #1
        bne lfo_tk
lfo_tick2:                          ; LFO2 RIGHT, LEFT
        ldx #2
        jsr lfo_upd
        ldx #3
lfo_tk: jsr lfo_upd
        sta SH_HOLD
        lda #$ff
        sta PIA2_PA
        rts

lfo_upd:
        txa
        lsr
        bcc @own                    ; RIGHT side LFOs always run
        lda PERF+PF_KBMODE
        bne @nw
        ; WHOLE 8: the LEFT outputs copy the RIGHT LFO (own multiplier slot)
        lda #$ff
        sta PIA2_PA
        cpx #1
        bne @m
        lda lfo_fade
        sta PIA2_PA
@m:     dex
        jsr lfo_offset
        inx
        txa
        lsr
        tay                         ; lfo#
        lda cv_pa+$79,y
        sta lfo_hi
        lda cv_pb+$79,y
        sta lfo_lo
        iny
        iny
        iny
        iny                         ; LEFT slot index
        cpx #2
        bcs @o2
        jsr lfo_out1
        lda #0
        sta lfo_src
        lda lfo_flag
        sta lfo_flag+1
        jmp lfo_sq
@o2:    jmp lfo_out2
@nw:    txa
        lsr
        tay
        lda PERF+PF_LFOSYNC         ; L-R sync: the LEFT LFO follows the RIGHT phase
        and side_bit,y
        beq @own
        lda lfo_flag-1,x
        sta lfo_flag,x
        lda #0
        sta lfo_src
        txa
        tay
        dey
        jmp @wave
@own:   lda #0
        sta lfo_flag,x
        stx lfo_src
        jsr lfo_step
        txa
        tay
@wave:  jsr lfo_value
        txa                         ; slot index side*4 + lfo#
        and #1
        asl
        asl
        sta lfo_t0
        txa
        lsr
        ora lfo_t0
        tay
        sta SH_HOLD
        lda #$ff
        sta PIA2_PA
        cpx #2
        bcs @l2
        jsr lfo_delay
        jsr lfo_offset
        jsr lfo_out1
        jmp lfo_sq
@l2:    jsr lfo_offset
        jmp lfo_out2

; Phase step of LFO X; a bounce reverses the increment (high byte complemented, low byte negated).
lfo_step:
        jsr @add
        bvc @r
        lda #$ff
        sta lfo_flag,x
        lda lfo_ilo,x
        eor #$ff
        clc
        adc #1
        sta lfo_ilo,x
        lda lfo_ihi,x
        eor #$ff
        sta lfo_ihi,x
@add:   clc
        lda lfo_ilo,x
        adc lfo_plo,x
        sta lfo_plo,x
        lda lfo_ihi,x
        adc lfo_phi,x
        sta lfo_phi,x
@r:     rts

; Waveform of LFO X from the phase of LFO Y -> lfo_hi (PA), lfo_lo (PB). X preserved.
lfo_value:
        lda lfo_wave,x
        beq @sine
        cmp #2
        beq @saw
        bcc @tri
        lda lfo_flag,y              ; S&H: new random value on each bounce
        beq @hold
        jsr lfo_random
        sta lfo_sh,x
@hold:  lda lfo_sh,x
        lsr
        adc lfo_sh,x
        ror
        sta lfo_hi
        lda #0
        ror
        jmp @sh2
@tri:   lda lfo_phi,y
        eor #$7f
        sta lfo_hi
        lda lfo_plo,y
        eor #$ff
@sh2:   lsr lfo_hi
        ror
@sh1:   lsr lfo_hi
        ror
        sta lfo_lo
        rts
@saw:   lda lfo_ihi,y
        bpl @sup
        lda lfo_phi,y
        bpl @sdp
        eor #$80
        sta lfo_hi
        lda lfo_plo,y
        jsr @sh3
        lda #$30
        bne @sadd
@sdp:   sta lfo_hi
        lda lfo_plo,y
        eor #$ff
@sh3:   lsr lfo_hi
        ror
        lsr lfo_hi
        ror
        lsr lfo_hi
        ror
        sta lfo_lo
        rts
@sup:   lda lfo_phi,y
        eor #$7f
        sta lfo_hi
        lda lfo_plo,x               ; (the original reads this LFO's own fraction here)
        eor #$ff
        jsr @sh3
        lda #$10
@sadd:  clc
        adc lfo_hi
        sta lfo_hi
        rts
@sine:  lda lfo_plo,y               ; quarter-wave from the envelope curve: fraction picks the table
        eor #$ff
        sta lfo_t0
        lda lfo_phi,y
        bmi @sneg
        eor #$7f
        jsr @tab
        lda (lfo_ptr),y
        sec
        sbc #$7c
        sta lfo_hi
        inc lfo_ptr+1
        lda (lfo_ptr),y
        sta lfo_lo
        rts
@sneg:  eor #$80
        jsr @tab
        lda #$30
        sec
        sbc (lfo_ptr),y
        sta lfo_hi
        inc lfo_ptr+1
        lda (lfo_ptr),y
        eor #$ff
        sta lfo_lo
        rts
@tab:   pha                         ; fraction bits 7-6 of lfo_t0 select the table pa0..pa3 (pb = pa + 256)
        lda lfo_t0
        rol
        rol
        rol
        and #3
        tay
        lda lfo_tablo,y
        sta lfo_ptr
        lda lfo_tabhi,y
        sta lfo_ptr+1
        pla
        tay
        rts

lfo_random:                         ; 8-bit LFSR (S&H)
        lda lfo_rnd
        bne @n
        lda #$aa
@n:     asl
        bcc @s
        eor #$1d
@s:     sta lfo_rnd
        rts

; DC offset of LFO X's waveform -> lfo_off. X preserved.
lfo_offset:
        lda lfo_wave,x
        beq @sine
        lda #$20
        cpx #2
        bcc @s
        lda #$0e
        bne @s
@sine:  lda #$1a
        cpx #2
        bcc @s
        lda #$12
@s:     sta lfo_off
        rts

; LFO1 delay fade of side X (multiplier ramps 0 -> $FF after the side's first key down). Sets mDAC.
lfo_delay:
        lda lfo_dhi,x
        cmp #$ff
        beq @out
        lda lfo_fhi,x
        beq @g
        sec
        lda lfo_flo,x
        sbc lfo_dlo,x
        sta lfo_flo,x
        lda lfo_fhi,x
        sbc lfo_dhi,x
        sta lfo_fhi,x
        bcs @g
        lda #0
        sta lfo_fhi,x
@g:     lda vx_sgate,x
        bne @on
        sta lfo_fon,x
        beq @f
@on:    lda lfo_fon,x
        bne @f
        inc lfo_fon,x
        lda #$ff
        sta lfo_fhi,x
@f:     lda lfo_fhi,x
        eor #$ff
@out:   sta SH_HOLD
        sta PIA2_PA
        sta lfo_fade,x
        rts

; LFO1 output to slot $79+Y (value) and $78+Y (offset), with the current multiplier.
lfo_out1:
        sta SH_HOLD
        lda lfo_lo
        sta cv_pb+$79,y
        sta PIA1_PB
        lda lfo_hi
        sta PIA1_PA
        sta SH_SLOT+$79,y
        sta SH_SAMPLE
        sta cv_pa+$79,y
        nop
        nop
        sta SH_HOLD
        lda lfo_off
        sta PIA1_PA
        sta PIA1_PB
        sta SH_SLOT+$78,y
        sta SH_SAMPLE
        sta SH_HOLD
        rts

; LFO2 output to slot $79+Y: value + offset (the table keeps the value without offset, like the original).
lfo_out2:
        sta SH_HOLD
        lda lfo_lo
        sta cv_pb+$79,y
        sta PIA1_PB
        lda lfo_hi
        sta cv_pa+$79,y
        clc
        adc lfo_off
        sta PIA1_PA
        sta SH_SLOT+$79,y
        sta SH_SAMPLE
        nop
        nop
        sta SH_HOLD
        rts

; LFO1 square latch of LFO X ($6305/$6306 D7 = direction of the driving LFO), on a bounce.
lfo_sq:
        lda lfo_flag,x
        bpl @r
        ldy lfo_src
        lda lfo_ihi,y
        sta LATCH_3+5,x
@r:     rts

; ------------------------------------------------------------------ LFO -> PWM
; One call per tick-phase slot: VCO1 and VCO2 alternately (stock $75 alternation).
lfo_pwmstep:
        dec lfo_alt
        bpl @v1
        lda #1
        sta lfo_alt
        ldx #1
        bne lfo_pwm
@v1:    ldx #0
; X = 0 VCO1 (ch5) / 1 VCO2 (ch1): for each side whose PWM source is an LFO, the LFO value x 2 goes to the
; 4 voices' PWM slots with their PWM multipliers.
lfo_pwm:
        stx lfo_t0                  ; vco2
        ldx #1                      ; LEFT, then RIGHT
@side:  stx lfo_t1
        lda lfo_t0
        asl
        ora lfo_t1
        tay
        lda ap_pwm_src,y
        cmp #2
        bcs @next
        sta lfo_hi                  ; 0 LFO1, 1 LFO2
        lda lfo_t1
        asl
        asl
        sta lfo_lo                  ; side*4
        ora lfo_hi
        tay                         ; LFO slot index
        lda cv_pb+$79,y
        asl
        sta PIA1_PB
        lda cv_pa+$79,y
        rol
        sta PIA1_PA
        lda lfo_t0
        asl
        asl
        asl
        ora lfo_lo
        clc
        adc #3
        tay                         ; multiplier of the side's last voice
        lda #$19                    ; its PWM slot: ch1 (VCO2) / ch5 (VCO1) of voice 3 / 7
        ldx lfo_t1
        beq @s0
        ora #$20
@s0:    ldx lfo_t0
        bne @c
        ora #$04
@c:     tax
        lda #3
        sta lfo_hi
@w:     sta SH_SLOT,x
        lda ap_pwm_mul,y
        sta PIA2_PA
        sta SH_SAMPLE
        txa
        sec
        sbc #8
        tax
        dey
        sta SH_HOLD
        dec lfo_hi
        bpl @w
@next:  ldx lfo_t1
        dex
        bpl @side
        lda #$ff
        sta PIA2_PA
        rts

lfo_tablo:  .byte <tb_env_pa0, <tb_env_pa1, <tb_env_pa2, <tb_env_pa3
lfo_tabhi:  .byte >tb_env_pa0, >tb_env_pa1, >tb_env_pa2, >tb_env_pa3
