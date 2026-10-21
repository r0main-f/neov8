; Sound engine: public API (api.inc) and the control-tick schedule. Sub-modules:
;   apply.asm  program -> static slots, latches, mod matrix, PWM configuration (lead)
;   voice.asm  key assignment, pitch, glide, VCF tracking, velocity, VPK-5 scan  (vx_*)
;   env.asm    16 ADSRs, ADSR->VCA/VCF/PWM, volume gate                          (env_*)
;   lfo.asm    LFO1/LFO2 per side, delay, sync, retrigger, LFO->PWM               (lfo_*)
; Internal contract: eng/ENGINE.md.

        .include "eng/apply.asm"
        .include "eng/clock.asm"
.ifdef STUB_VX
        .include "eng/stub_voice.asm"
.else
        .include "eng/voice.asm"
.endif
.ifdef STUB_ENV
        .include "eng/stub_env.asm"
.else
        .include "eng/env.asm"
.endif
.ifdef STUB_LFO
        .include "eng/stub_lfo.asm"
.else
        .include "eng/lfo.asm"
.endif

eng_init:
        lda #1
        sta PERF+PF_OCT_R           ; octaves normal
        sta PERF+PF_OCT_L
        sta PERF+PF_ARP_OCT_R
        sta PERF+PF_ARP_OCT_L
        lda #60
        sta PERF+PF_SPLIT
        jsr ctl_init
        jsr clk_init
        jsr vx_init
        jsr env_init
        jsr lfo_init
        rts

; Control tick (IRQ context, interrupts enabled, never re-entered). The stock 3-phase plan ($8127):
;   every tick: MIDI-controller CV (1 of 8), VPK-5 key scan
;   phase 0: 16 envelopes + ADSR->PWM + volume gate, LFO->PWM step
;   phase 1: glide voices 4-7, LFO2 both sides, S&H refresh slice
;   phase 2: LFO1 both sides, glide voices 0-3 (RIGHT glide off: an LFO->PWM step instead), refresh slice
eng_tick:
        ldx en_cidx                 ; one MIDI-controller CV per tick (all 8 every 16 ms)
        jsr ctl_out
        inx
        txa
        and #7
        sta en_cidx
        jsr clk_tick                ; arpeggiator clock, clock-out jack, tempo LED
        jsr vx_tick                 ; VPK-5 scan, key events
        ldx en_phase
        beq @p0
        dex
        beq @p1
        jsr lfo_tick1               ; phase 2
        lda vx_goff
        bmi @pw
        ldx #0
        jsr vx_glide
        jmp @p2e
@pw:    jsr lfo_pwmstep
@p2e:   jsr eng_refresh
        lda #0
        sta en_phase
        rts
@p1:    ldx #1                      ; phase 1
        jsr vx_glide
        jsr lfo_tick2
        jsr eng_refresh
        inc en_phase
        rts
@p0:    jsr env_tick                ; phase 0
        jsr lfo_pwmstep
        inc en_phase
        rts

; Static S&H refresh slice: the next 16 slots of cv_pa/cv_pb/cv_mul, skipping the ones the engine writes
; itself (vx_dyn: envelopes, LFOs, modulated PWM). 32 slots per 3 ticks: every slot within 24.6 ms.
EREF_N = 16
eng_refresh:
        lda #EREF_N
        sta vx_rcnt
        ldx vx_ridx
@l:     lda vx_dyn,x
        bne @sk
        lda cv_pa,x
        sta PIA1_PA
        lda cv_pb,x
        sta PIA1_PB
        lda cv_mul,x
        sta PIA2_PA
        sta SH_SLOT,x
        nop
        sta SH_SAMPLE
        inx                         ; sample window (~20 cycles)
        txa
        and #$7f
        tax
        nop
        nop
        dec vx_rcnt
        sta SH_HOLD
        bne @l
        beq @e
@sk:    inx
        txa
        and #$7f
        tax
        dec vx_rcnt
        bne @l
@e:     stx vx_ridx
        lda #$ff
        sta PIA2_PA
        rts

; Main-loop work.
eng_service:
        jmp vx_service

; Battery program A -> edit buffer of side X (WHOLE 8: RIGHT), program number in PERF, then apply.
eng_load_prog:
        sta en_t0
        lda PERF+PF_KBMODE
        bne @s
        ldx #0
@s:     lda en_t0
        sta PERF+PF_PROG_R,x
        lda edit_lo2,x
        sta en_ptr
        lda #>EDIT_R
        sta en_ptr+1
        lda #<PROG_BASE             ; ptr2 = PROG_BASE + 40*n
        sta ptr2
        lda #>PROG_BASE
        sta ptr2+1
        ldx en_t0
        beq @copy
@mul:   lda ptr2
        clc
        adc #PROG_SIZE
        sta ptr2
        bcc @nc
        inc ptr2+1
@nc:    dex
        bne @mul
@copy:  ldy #PROG_SIZE-1
@cl:    lda (ptr2),y
        sta (en_ptr),y
        dey
        bpl @cl
        jsr eng_apply_prog
        jmp vx_recall               ; like the original recall: envelopes idle, keyboard CV/gate cleared
edit_lo2:   .byte <EDIT_R, <EDIT_L

; Re-apply both programs (any edit-buffer change).
eng_apply_prog:
        jsr ap_all
        jmp vx_refresh              ; voices pick up new pitch/Fc/velocity parameters

; Performance (PERF) changed: keyboard mode, unison, octave, defeats... Re-assign and re-apply.
eng_apply_perf:
        jsr clk_rate
        jsr vx_apply_perf
        jmp eng_apply_prog

eng_key_on:     jmp vx_key_on       ; A note, Y velocity (keyboard routing by PERF)
eng_key_off:    jmp vx_key_off      ; A note
eng_side_on:    jmp vx_side_on      ; X side, A note, Y velocity (MIDI)
eng_side_off:   jmp vx_side_off
eng_all_off:    jmp vx_all_off

; MIDI controllers (docs/midi-implementation.md). X = 0 -X, 1 +X, 2 Fc pedal, 3 pressure, 4 bend LEFT,
; 6 bend RIGHT: CV bank $3080+X, A = value / bend MSB (0-127), Y = bend LSB. As the stock ($9D7C, $CF1A):
; PA = A >> 1, PB = (A & 1) << 7 | LSB >> 1; multiplier $FF (0-3) or the pitch-bend sensitivity (4-7).
; X = 8 / 9: damper RIGHT / LEFT (A >= 64 on) = release defeat, like the stock's "damper enable".
eng_ctrl:
        cpx #8
        bcs @damper
        pha
        lsr
        sta en_cpa,x
        pla
        and #1
        lsr
        ror                         ; bit 0 -> bit 7
        sta en_cpb,x
        cpx #4
        bcc @w
        tya
        lsr
        ora en_cpb,x
        sta en_cpb,x
@w:     php
        sei
        jsr ctl_out
        plp
        rts
@damper:
        pha
        lda damp_bit-8,x
        tay
        pla
        cmp #64
        tya
        bcs @on
        eor #$ff
        and PERF+PF_RELDEF
        bcc @st
@on:    ora PERF+PF_RELDEF
@st:    sta PERF+PF_RELDEF
        jmp eng_apply_prog          ; release rates depend on release defeat
damp_bit:   .byte $01, $02

; Write controller CV X (interrupts off or tick context). The A7 bank samples until the next $30xx strobe.
ctl_out:
        lda en_cpa,x
        sta PIA1_PA
        lda en_cpb,x
        sta PIA1_PB
        lda #$ff
        cpx #4
        bcc @m
        lda BRAM_PBSENS
@m:     sta PIA2_PA
        sta SH_SLOT,x
        sta SH_MIDICV,x
        lda #$ff
        sta PIA2_PA
        rts

; A440 reference tone on PTM timer 3 (output O3 -> mixer): A = 1 on, 0 off. 2 MHz / (2 x 2273) = 439.9 Hz,
; like the stock ($F1B2). Assumes CR2 bit 0 = 0 (CR3 at $6C00), as left by ptm_init. The autotune stops it.
eng_a440:
        sta en_a440
        php
        sei
        lda #$08
        sta PTM_T3MSB
        lda #$e0
        sta PTM_T3LSB               ; latch $08E0
        lda #$02
        ldx en_a440
        beq @w
        lda #$82                    ; T3 continuous, internal clock, output enabled
@w:     sta PTM_CR13
        plp
        rts

ctl_init:
        ldx #7
@l:     lda #0
        sta en_cpb,x
        cpx #4
        bcc @z
        lda #$20                    ; bends centred
@z:     sta en_cpa,x
        dex
        bpl @l
        rts

; Compare: X side, A = 1 hear the stored program, 0 the edit buffer. The UI swaps buffers itself and calls
; eng_apply_prog; nothing extra is needed here.
eng_compare:
        rts
