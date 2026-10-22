; Program -> hardware: everything a program sets up before any note is played.
; Reproduces the stock apply routines (APPLY_PROGRAM_SIDE $DEBA, MOD_HW_INIT $DAC0, APPLY_WAVE_LATCHES $DEF3);
; verified slot-for-slot and latch-for-latch against the stock ROM (sim/test/fw-eng-apply.test.ts).
; Side 0 = RIGHT (voices 0-3, latch page $61, slots $40/$44.., $52/$53), side 1 = LEFT (voices 4-7, $62, $48/$4C.., $56/$57).

; en_buf / en_mbuf for side X (A, X preserved: X = side). WHOLE 8: both sides read the RIGHT buffer.
ap_select:
        stx en_side
        lda #<EDIT_R
        ldy PERF+PF_KBMODE
        beq @set                    ; 0 = WHOLE 8: RIGHT buffer for both sides
        lda edit_lo,x
@set:   sta en_buf
        clc
        adc #$38
        sta en_mbuf
        lda #>EDIT_R
        sta en_buf+1
        sta en_mbuf+1
        rts
edit_lo:    .byte <EDIT_R, <EDIT_L

; ------------------------------------------------------------------ static slots of one side (en_side, en_buf)
; VCF cutoff when keyboard tracking is off (byte $13 bit 7 = 1): slots side*8+$40..$43 = Fc.
ap_fc_static:
        ldy #$13
        lda (en_buf),y
        bpl @r                      ; tracking on: note-on sets the per-voice cutoff
        and #$7f
        pha
        lda en_side
        asl
        asl
        asl
        adc #$43
        tax
        pla
        ldy #3
@l:     sta cv_pa,x
        dex
        dey
        bpl @l
@r:     rts

; VCO1 volume, VCO2 volume, Q: bytes $10, $11, $12 -> slots side*8+$44, $45, $46.
ap_vols:
        lda en_side
        asl
        asl
        asl
        adc #$46
        tax
        ldy #$12
@l:     lda (en_buf),y
        and #$7f
        sta cv_pa,x
        dex
        dey
        cpy #$0f
        bne @l
        rts

; Noise: byte $0C -> slot side*4+$52.
ap_noise:
        lda en_side
        asl
        asl
        adc #$52
        tax
        ldy #$0c
        lda (en_buf),y
        and #$7f
        sta cv_pa,x
        rts

; Mod depths: bytes $06-$09 (8-bit) AND bank mask -> slots side*4+$60..$63 (PA = d>>1, PB bit 7 = d&1).
ap_depths:
        lda en_side
        asl
        asl
        tax                         ; X = side*4: first mask / first slot offset
        ldy #$06
@l:     lda (en_buf),y
        and ap_dmask,x
        lsr
        sta cv_pa+$60,x
        lda #0
        ror
        sta cv_pb+$60,x
        inx
        iny
        cpy #$0a
        bne @l
        rts

; Program volume: byte $21 through the parameter curve -> ap_volbase[side] (gate and slot write: env).
ap_volume:
        ldy #$21
        lda (en_buf),y
        asl
        tax
        lda tb_param_curve,x
        lsr
        ldx en_mute
        beq @m
        lda #0
@m:     ldx en_side
        sta ap_volbase,x
        rts

; ------------------------------------------------------------------ PWM configuration and initial pulse width
ap_pwm:
        lda en_side                 ; reset both VCO entries of this side
        tax
        jsr @clr
        inx
        inx
        jsr @clr
        lda #1                      ; VCO2 (byte $12 bit 7 = pulse, active low)
        sta en_t2
        ldy #$12
        lda (en_buf),y
        bmi @v1
        jsr ap_pwm_vco
@v1:    lda #0                      ; VCO1 (byte $11 bit 7)
        sta en_t2
        ldy #$11
        lda (en_buf),y
        bmi @pw
        jsr ap_pwm_vco
@pw:    jmp ap_init_pw
@clr:   lda #0
        sta ap_pwm_env1,x
        sta ap_pwm_env2,x
        sta ap_pwm_kbd,x
        sta ap_pwm_dep,x
        lda #$ff
        sta ap_pwm_src,x
        rts

; en_t2 = 1 VCO2 / 0 VCO1 (pulse on). Depth (byte $25: VCO1 high nibble, VCO2 low), kbd track (bytes $20/$21 bit 7),
; source (byte $20 bits 1-0 VCO1 / 4-3 VCO2).
ap_pwm_vco:
        ldy #$25
        lda (en_buf),y
        ldx en_t2
        bne @lo
        lsr
        lsr
        lsr
        lsr
@lo:    and #$0f
        php                         ; Z = depth 0
        asl
        asl
        asl
        asl
        sta en_t3                   ; depth * 16
        lda en_t2                   ; index i = vco2*2 + side
        asl
        ora en_side
        sta en_t0
        lda en_side                 ; per-voice multipliers: VCO1 -> ap_pwm_mul[side*4..], VCO2 -> [8+side*4..]
        asl
        asl
        ldx en_t2
        beq @m1
        ora #8
@m1:    tax
        ldy #3
        lda en_t3
@ml:    sta ap_pwm_mul,x
        inx
        dey
        bpl @ml
        ldx en_t0
        sta ap_pwm_dep,x
        lda #$20                    ; kbd tracking: byte $20 (VCO1) / $21 (VCO2), bit 7 active low
        ora en_t2
        tay
        lda (en_buf),y
        bmi @nok
        lda #$ff
        sta ap_pwm_kbd,x
@nok:   plp
        beq @r                      ; depth 0: no modulation source
        ldy #$20
        lda (en_buf),y
        ldy en_t2
        beq @s1
        lsr
        lsr
        lsr
@s1:    and #$07                    ; 3 bits like the original: 4-7 (unused bit set) = no modulation
        sta ap_pwm_src,x
        cmp #4
        bcs @r
        cmp #2
        bcc @r
        bne @e2
        lda #$ff
        sta ap_pwm_env1,x
        rts
@e2:    lda #$ff
        sta ap_pwm_env2,x
@r:     rts

; Initial pulse width + autotune PW calibration -> ch6 (VCO1) / ch2 (VCO2) of the side's 4 voices; ch5/ch1 (PWM) = $0404.
; Pulse off -> PW $7F (no calibration). CAL_PW_HI is a signed offset (docs/autotune.md §6).
ap_init_pw:
        ldy #$0f
        lda (en_buf),y
        and #$7f
        sta en_t0                   ; VCO1 PW
        lda #0
        sta en_t2                   ; VCO1 pulse-off flag
        sta en_t3                   ; VCO2 pulse-off flag
        ldy #$11
        lda (en_buf),y
        bpl @v2
        lda #$7f
        sta en_t0
        dec en_t2
@v2:    ldy #$26
        lda (en_buf),y
        and #$7f
        sta en_t1                   ; VCO2 PW
        ldy #$12
        lda (en_buf),y
        bpl @go
        lda #$7f
        sta en_t1
        dec en_t3
@go:    lda en_side                 ; X = last voice's ch6 (side*32 + $1E), Y = oscillator index (side*8 + 7)
        asl
        asl
        asl
        asl
        asl
        adc #$1e
        tax
        lda en_side
        asl
        asl
        asl
        adc #$07
        tay
        lda #3
        sta en_ptr                  ; voice counter
@v:     lda en_t0
        bit en_t2
        jsr @one                    ; VCO1: ch6, ch5
        lda en_t1
        bit en_t3
        jsr @one                    ; VCO2: ch2, ch1
        dec en_ptr
        bpl @v
        rts
@one:   bmi @raw
        pha                         ; signed calibration: pw + (int8)CAL_PW_HI, clamped 0..127. Same as the
        lda CAL_PW_HI,y             ; original for negative values (all its autotune writes); the original
        bmi @neg                    ; zeroed the width for 0..127, i.e. no pulse on a never-tuned unit.
        pla
        clc
        adc CAL_PW_HI,y
        bpl @raw
        lda #$7f
        bne @raw
@neg:   pla
        clc
        adc CAL_PW_HI,y
        bcs @raw
        lda #0
@raw:   sta cv_pa,x
        lda CAL_PW_LO,y
        sta cv_pb,x
        dex
        lda #$04                    ; PWM slot: static $0404 (overwritten while modulated)
        sta cv_pa,x
        sta cv_pb,x
        dex
        dex
        dex
        dey
        rts

; ------------------------------------------------------------------ latches (both sides) - DAC locked by caller
; Waveform switches: bytes $14-$1B bit 7 -> CD4724 page $61 (RIGHT) / $62 (LEFT) Q0-Q7, waveform level
; compensation -> slot side*4+$7B, linear FM: byte $22 bit 7 -> $6300+side.
ap_waves:
        lda en_side
        asl
        asl
        tax
        lda #$2e
        sta cv_pa+$7b,x
        ldy #$11                    ; VCO1 pulse on: + $14
        lda (en_buf),y
        bmi @np
        lda cv_pa+$7b,x
        clc
        adc #$14
        sta cv_pa+$7b,x
@np:    lda #$61
        clc
        adc en_side
        sta en_ptr+1
        lda #0
        sta en_ptr
        ldy #7
@l:     tya
        pha
        clc
        adc #$14
        tay
        lda (en_buf),y              ; byte $14+Y
        sta en_t0
        pla
        tay
        lda en_t0
        sta (en_ptr),y              ; latch Q[Y] <- D7
        bmi @n
        cpy #3
        bcs @n
        lda cv_pa+$7b,x             ; sub-oct / tri / saw of VCO1 add their level step
        clc
        adc wave_comp,y
        sta cv_pa+$7b,x
@n:     dey
        bpl @l
        ldx en_side                 ; linear FM
        ldy #$22
        lda (en_buf),y
        and #$80
        sta LATCH_3,x
        rts
wave_comp = tb_wave_comp

; ------------------------------------------------------------------ mod matrix: crosspoints + LS670 (both sides)
; Effective mod bytes for the side: copy of bytes $00-$03 and $1E at en_mbuf, with controllers removed when
; defeated (pressure defeat; MIDI controller enables: NeoV8 TODO), and the bank depth mask.
ap_modcopy:
        ldy #$1e
        lda (en_buf),y
        ldy #4
        sta (en_mbuf),y
        lda #3
        sta en_t0                   ; bank
@b:     ldy en_t0
        lda (en_buf),y
        sta (en_mbuf),y
        jsr ap_bank_has_ctl         ; C=1: the bank uses controllers (or a velocity replacement)
        php
        lda PERF+PF_PRESSDEF        ; pressure defeat for this side removes the pressure controller
        ldx en_side
        and side_bit,x
        beq @np
        ldy en_t0
        lda (en_mbuf),y
        ora #$01
        sta (en_mbuf),y
@np:    plp
        lda #$ff
        bcc @keep                   ; no controllers: modulation always on
        jsr ap_bank_has_ctl
        lda #$ff
        bcs @keep
        lda #0                      ; every controller defeated: depth 0
@keep:  pha
        lda en_side
        asl
        asl
        adc en_t0
        tax
        pla
        sta ap_dmask,x
        dec en_t0
        bpl @b
        rts
side_bit:   .byte $01, $02

; C=1 when bank en_t0 (effective copy) has a controller enabled (bits 3-0 active low) or its velocity replaced.
ap_bank_has_ctl:
        ldy en_t0
        lda (en_mbuf),y
        and #$0f
        eor #$0f
        bne @yes
        ldy #4
        lda (en_mbuf),y
        ldy en_t0
        and repl_bit,y
        bne @no                     ; replacement bit 1 = off (active low)
@yes:   sec
        rts
@no:    clc
        rts
repl_bit:   .byte $80, $40, $20, $10

; Crosspoints for the side: one source switch per bank (mono X0-X3 DC, LFO2, LFO1, LFO1 square at side*$90 +
; bank*4; poly VCO1, VCO2, ADSR1, ADSR2 at +$10), the controller switches (ap_xpt_repl), and per destination
; (VCO1, VCO2, Fc, Q) one switch: $6530 + bank*16 + side*$90 + dest*4 + (not inverted ? 2 : 0) + (dest off ? 1 : 0)
; (x0 = bank VCA "+" output, x2 = "−" output into the inverting destination summer, x1/x3 = ground).
; Every write closes its switch (ap_modhw); the data written is whatever is in A, as in the stock code.
ap_xpt:
        lda en_side
        beq @s0
        lda #$90
@s0:    sta en_t1                   ; side offset
        lda #3
        sta en_t0                   ; bank
@bank:  lda en_t0
        asl
        asl
        ora en_t1
        sta en_t2                   ; bank*4 + side offset
        jsr ap_xpt_repl
        ldy en_t0                   ; source byte: bits 6-4 select a switch (written with its own address as data)
        lda (en_mbuf),y
        eor #$0f
        sta en_t3                   ; bit 7 = invert flag (active low: 1 = not inverted)
        lsr
        lsr
        lsr
        lsr
        pha
        and #$04
        asl
        asl
        clc
        adc en_t2
        sta en_ptr
        pla
        and #$03
        ora en_ptr
        tax
        txa
        sta $6500,x                 ; closes the source switch (the data is not used)
        lda en_t0                   ; destinations: bank A,B -> byte $04, C,D -> byte $05; A/C high nibble
        lsr
        php
        clc
        adc #$04
        tay
        lda (en_buf),y
        eor #$ff
        plp
        bcs @low
        lsr
        lsr
        lsr
        lsr
@low:   and #$0f
        sta en_ptr+1                ; dest bits: 0 VCO1, 1 VCO2, 2 Fc, 3 Q
        lda en_t0
        asl
        asl
        asl
        asl
        clc
        adc #$30
        adc en_t1
        sta en_ptr                  ; $65xx base for this bank and side
        ldx #0
@dest:  txa
        asl
        asl
        bit en_t3
        bpl @ni
        adc #2                      ; invert bit = 1 (the original adds 2 then; 0 = inverted wiring)
@ni:    lsr en_ptr+1
        bcs @on
        adc #1                      ; destination off
@on:    clc
        adc en_ptr
        tay
        lda #$ff
        sta $6500,y
        inx
        cpx #4
        bne @dest
        dec en_t0
        bpl @bank
        rts

; Controller switches of bank en_t0 (en_t2 = bank*4 + side offset), CD22100 "VEL" chip: X0 velocity, X1 unity
; (+12.5 V), X2 LF noise, X3 ADSR1 CTRL. A0 = active controllers << 4 (bit 7 velocity, 6 +X, 5 -X, 4 pressure).
; Replacement on (byte $1E bit 7-4 = 0): banks A, B close X3, bank C closes X2; bank D's pedal comes in through the
; LS670 (D7). Otherwise X0 closes when the velocity controller is on, and X1 (unity) when no controller is on.
ap_xpt_repl:
        ldy en_t0
        lda (en_mbuf),y
        eor #$0f
        asl
        asl
        asl
        asl
        sta en_t3                   ; A0
        ldy #4
        lda (en_mbuf),y
        ldx en_t0
        and repl_bit,x
        bne @off
        cpx #3
        beq @vel                    ; bank D: velocity switch rule only
        lda repl_ofs,x
        clc
        adc en_t2
        tax
        txa
        sta $6520,x
        rts
@off:   lda en_t3
        bne @vel
        ldx en_t2
        sta $6521,x                 ; X1 unity: closes (no controller at all)
@vel:   lda en_t3
        and #$80
        beq @r
        ldx en_t2
        sta $6520,x                 ; X0 velocity: closes
@r:     rts
repl_ofs:   .byte 3, 3, 2

; DIGIMOD 74LS670: one word per bank (A3/A4), data D4-D6 = inverted bits 2-0 of the bank byte; bank D word
; also carries D7 = pedal replacement on. RIGHT -> $67xx, LEFT -> $66xx. Words: D=0, C=1, B=2, A=3.
ap_ls670:
        lda en_side
        eor #1
        clc
        adc #$66
        sta en_ptr+1
        lda #0
        sta en_ptr
        ldy #3
@l:     lda (en_mbuf),y
        eor #$ff
        asl
        asl
        asl
        asl
        and #$70
        cpy #3
        bne @w
        sta en_t0
        sty en_t1
        ldy #4
        lda (en_mbuf),y
        ldy en_t1
        and #$10
        bne @nd
        lda en_t0
        ora #$80
        bne @w
@nd:    lda en_t0
@w:     ldx #0
        sta (en_ptr,x)
        lda en_ptr
        clc
        adc #8
        sta en_ptr
        dey
        bpl @l
        rts

; Whole mod hardware: VCAs muted, matrix cleared, both sides programmed, Fc-pedal enable. DAC locked by caller.
; Crosspoint writes ($65xx, only while $6307 = 0) store the level of $6405 (IC23 Q5) in the addressed CD22100
; switch: 0 = open (the clear), $FF = close (the programming). The data byte itself is ignored.
ap_modhw:
        jsr ap_vca_mute
        jsr ap_vca_mute
        lda #0
        sta SH_SLOT                 ; next $64xx writes -> DIGIMOD IC23
        sta LATCH_MUX+5             ; Fc pedal enable off
        sta LATCH_3+7               ; matrix control off while reprogramming
        ldx #$ff
@clr:   sta $6500,x
        dex
        bne @clr
        sta $6500
        lda #$ff                    ; the crosspoints' DATA line is IC23 Q5 ($6405), not D7 (ANA I S p18: "D7 = Fc PED
        sta LATCH_MUX+5             ; on/off" through a 4503): from here every $65xx write closes its switch (stock $DAE8)
        ldx #0
        jsr @side
        ldx #1
        jsr @side
        lda #$ff
        sta LATCH_3+7
        lda EDIT_R+$1e              ; Fc pedal enable = bank D replacement on (RIGHT, or LEFT when split/layer)
        ldx PERF+PF_KBMODE
        beq @w
        and EDIT_L+$1e
@w:     asl
        asl
        asl
        eor #$80
        sta LATCH_MUX+5
        lda PERF+PF_PBDEF           ; pitch-bend enables (IC23 Q0 RIGHT, Q1 LEFT; WHOLE 8: LEFT follows RIGHT)
        lsr
        php
        lda #0
        ror                         ; bit 7 = RIGHT defeat
        eor #$80
        sta LATCH_MUX+0
        plp
        ldx PERF+PF_KBMODE
        beq @pl
        lda PERF+PF_PBDEF
        asl
        asl
        asl
        asl
        asl
        asl                         ; bit 1 -> bit 7
        and #$80
        eor #$80
@pl:    sta LATCH_MUX+1
        rts
@side:  jsr ap_select
        jsr ap_modcopy
        jsr ap_xpt
        jsr ap_ls670
        jmp ap_depths

; ADSR2 -> VCA slots $68-$6F to 0 V (silence while the matrix is rewritten), as the original.
ap_vca_mute:
        lda #0
        sta PIA1_PA
        sta PIA1_PB
        ldx #7
@l:     sta SH_SLOT+$68,x
        sta SH_SAMPLE
        pha
        pla
        dex
        bpl @l
        sta SH_HOLD
        rts

; ------------------------------------------------------------------ entry points
; Apply both programs completely (latches, matrix, static slots, sub-module parameters).
ap_all:
        jsr cv_lock
        ldx #0
        jsr ap_side
        ldx #1
        jsr ap_side
        jsr ap_modhw
        jsr cv_unlock
        rts

; One side: static slots, latches, then each sub-module's parameters.
ap_side:
        jsr ap_select
        jsr ap_fc_static
        jsr ap_vols
        jsr ap_noise
        jsr ap_volume
        jsr ap_pwm
        jsr ap_waves
        ldx en_side
        jsr vx_apply                ; pitch base, glide, tracking (voice module)
        ldx en_side
        jsr env_apply               ; envelope parameters and modes (env module)
        ldx en_side
        jmp lfo_apply               ; LFO rates, waveforms, delay, retrigger (lfo module)
