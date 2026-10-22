; Sound engine: public API (api.inc) and the control-tick schedule. Sub-modules:
;   apply.asm  program -> static slots, latches, mod matrix, PWM configuration (lead)
;   voice.asm  key assignment, pitch, glide, VCF tracking, velocity, VPK-5 scan  (vx_*)
;   env.asm    16 ADSRs, ADSR->VCA/VCF/PWM, volume gate                          (env_*)
;   lfo.asm    LFO1/LFO2 per side, delay, sync, retrigger, LFO->PWM               (lfo_*)
;   seq.asm    polysequencer (seq_* public, sq_* private)
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
.ifdef STUB_SEQ
        .include "eng/stub_seq.asm"
.else
        .include "eng/seq.asm"
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
        jmp seq_init

; Control tick (IRQ context, interrupts enabled, never re-entered). The stock 3-phase plan ($8127):
;   every tick: MIDI-controller CV (1 of 8), VPK-5 key scan (+ front buttons, debounced in phase 1)
;   phase 0: 16 envelopes + ADSR->PWM + volume gate
;   phase 1: glide voices 4-7, LFO2 both sides, LFO->PWM step, S&H refresh slice
;   phase 2: LFO1 both sides, glide voices 0-3 (RIGHT glide off: an LFO->PWM step instead), refresh slice
eng_tick:
        ldx en_cidx                 ; one MIDI-controller CV per tick (all 8 every 16 ms)
        jsr ctl_out
        inx
        txa
        and #7
        sta en_cidx
        jsr clk_tick                ; arpeggiator clock, clock-out jack, tempo LED
        jsr seq_tick                ; sequencer: metronome pulse, MIDI clock
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
@pw:    jsr lfo_pwmstep             ; (the original: RIGHT glide off -> an extra LFO->PWM step)
@p2e:   jsr eng_refresh
        lda #0
        sta en_phase
        rts
@p1:    lda vpk_hbtn                ; phase 1: VPK-5 REV / FWD debounce and repeat (every 3rd tick);
        ora vb_last                 ; nothing pressed and nothing pending: armed, so nothing to do
        ora vb_stable
        beq @nb
        lda vpk_hbtn
        jsr vk_btn
@nb:    ldx #1
        jsr vx_glide
        jsr lfo_tick2
        jsr lfo_pwmstep             ; (the original does this step at the end of phase 0)
        jsr eng_refresh
        inc en_phase
        rts
@p0:    jsr env_tick                ; phase 0
        inc en_phase
        rts

; Static S&H refresh slice: the next 12 slots of cv_pa/cv_pb/cv_mul, skipping the ones the engine writes
; itself (vx_dyn: envelopes, LFOs, modulated PWM). 24 slots per 3 ticks: every slot within 33 ms
; (stock: voice channels 27.7 ms, other groups 36.9 ms).
EREF_N = 12
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
        jsr seq_service
        jmp vx_service

; Battery program A -> edit buffer of side X (WHOLE 8: RIGHT), program number in PERF, then apply.
eng_load_prog:
        sta en_t0
        lda PERF+PF_KBMODE
        bne @s
        ldx #0
@s:     stx en_t1                   ; side
        lda en_t0
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
        ldx en_t1
        jsr eng_apply_prog
        jmp vx_recall               ; like the original recall: envelopes idle, keyboard CV/gate cleared
edit_lo2:   .byte <EDIT_R, <EDIT_L

; Edit buffer of side X changed (X = 0 RIGHT / 1 LEFT; X >= 2: both). Fast path: only that side (both in
; WHOLE 8, which shares the RIGHT buffer), mod-matrix untouched, unless the buffer's routing bytes ($00-$05,
; $1E) differ from what the matrix holds - then everything is re-applied (ap_all, ~9 ms).
eng_apply_prog:
        cpx #2
        bcs @full
        lda en_shvalid
        beq @full
        jsr mod_changed
        bcs @full
        stx en_t3                   ; (ap_side uses en_t0-2)
        jsr cv_lock
        lda PERF+PF_KBMODE
        bne @one
        ldx #0                      ; WHOLE 8: both sides from the RIGHT buffer
        jsr @side
        ldx #1
        jsr @side
        jmp @done
@one:   ldx en_t3
        jsr @side
@done:  jsr cv_unlock
        jmp vx_refresh
@full:  jsr ap_all
        jsr mod_save
        jmp vx_refresh
@side:  jsr ap_side
        jsr ap_select               ; ap_side's sub-modules may have used en_buf
        jmp ap_depths               ; bank masks unchanged: only the depth values

; C = 1 when edit buffer X's routing bytes differ from those programmed into the matrix.
mod_changed:
        lda edit_lo2,x
        sta en_ptr
        lda #>EDIT_R
        sta en_ptr+1
        txa
        asl
        asl
        asl
        tay                         ; shadow offset: side * 8
        sty en_t0
        ldy #0
@l:     lda mod_bytes,y
        sty en_t1
        tay
        lda (en_ptr),y
        ldy en_t1
        pha
        tya
        clc
        adc en_t0
        tay
        pla
        cmp en_modsh,y
        bne @ch
        ldy en_t1
        iny
        cpy #7
        bne @l
        clc
        rts
@ch:    sec
        rts
mod_bytes:  .byte $00, $01, $02, $03, $04, $05, $1e

; Remember both buffers' routing bytes (after a full apply).
mod_save:
        ldx #0
        jsr @buf
        ldx #1
@buf:   lda edit_lo2,x
        sta en_ptr
        lda #>EDIT_R
        sta en_ptr+1
        txa
        asl
        asl
        asl
        sta en_t0
        ldy #6
@l:     sty en_t1
        lda mod_bytes,y
        tay
        lda (en_ptr),y
        pha
        lda en_t1
        clc
        adc en_t0
        tay
        pla
        sta en_modsh,y
        ldy en_t1
        dey
        bpl @l
        lda #1
        sta en_shvalid
        rts

; Performance (PERF) changed: keyboard mode, unison, octave, defeats... Re-assign and re-apply.
eng_apply_perf:
        jsr clk_rate
        jsr vx_apply_perf
        ldx #2                      ; full apply (matrix, latches, both sides)
        jmp eng_apply_prog

; A program was recalled (after its eng_apply_prog): envelopes idle, keyboard CV / side gate cleared, like
; the stock recall. eng_load_prog does it itself.
eng_recalled:   jmp vx_recall

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
        txa                         ; release rates depend on release defeat: fast path for that side
        sec                         ; (no matrix rebuild: it would mute the VCAs on every pedal press)
        sbc #8
        tax
        jmp eng_apply_prog
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

; AUDIO MUTE: A = 1 mute, 0 unmute. Program volumes go to 0 (the env volume gate writes slots $53/$57 from
; ap_volbase every phase 0), like the stock $5D flag.
eng_mute:
        sta en_mute
        ldx #0
        jsr @side
        ldx #1
@side:  jsr ap_select
        jmp ap_volume

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
