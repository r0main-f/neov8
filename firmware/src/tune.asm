; Autotune and calibration restore. docs/autotune.md (algorithm, battery format, error letters, timings).
; Hardware path (docs/hardware.md §2.5, §4, §9): the tune mux ($6302/$6303 + DIGIMOD IC22 DA0-2) sends one
; oscillator to a comparator read on PIA1 PA7 and clocking an LS74 (/PRE = PIA1 CA2, /CLR = PIA1 CB2) whose
; /Q gates PTM T1 (CR1 = $92: continuous, initialised by G↓, counting only while G1 is low). A reading
; therefore counts exactly 1 VCO period, or 4 when CA2 holds the flip-flop preset for 3 more periods.
; PTM T3 (one-shot, latch $FFFF = 32.8 ms) is the "no signal" timeout.

TN_TARGET   = $2343         ; 4 periods at the offset point, in E cycles (886.2 Hz) - stock value
TN_LO       = $16           ; low measuring point (PA) = offset point - 24 semitones
TN_HI       = $2E           ; offset measuring point (PA)
TN_TRIES    = 24            ; readings before "C" (unstable)

; ------------------------------------------------------------------ boot: battery tables -> CAL + trim CVs
tune_restore:
        ldx #$5f
@cp:    lda BRAM_CAL,x
        sta CAL,x
        dex
        bpl @cp
        lda #0
        sta CAL_FAILED
        ldx #15
@tr:    jsr tn_trimslot            ; trim slot 4*osc <- CAL_TRIM_PA/PB (static, refreshed by the tick)
        dex
        bpl @tr
        rts

; X = osc: cv_pa/cv_pb[4*osc] <- CAL trim. X preserved.
tn_trimslot:
        txa
        asl
        asl
        tay
        lda CAL_TRIM_PA,x
        sta cv_pa,y
        lda CAL_TRIM_PB,x
        sta cv_pb,y
        rts

; ------------------------------------------------------------------ AUTO TUNE (blocking, interrupts off)
tune_run:
        php
        sei                         ; like the stock: control tick off, MIDI NMI still runs
        jsr cv_lock
        lda PIA1_CRA
        and #$3f
        sta tn_cra
        lda PIA1_CRB
        and #$3f
        sta tn_crb
        lda #$c3
        sta PTM_CR2                 ; next $6C00 write = CR1
        lda #$01
        sta PTM_CR13                ; CR1: preset all counters
        lda #$92
        sta PTM_CR13                ; CR1: T1 continuous, G↓-initialised, internal clock, no IRQ
        lda #$02
        sta PTM_CR2                 ; CR2: T2 without IRQ; next $6C00 write = CR3
        lda #$22
        sta PTM_CR13                ; CR3: T3 one-shot, internal clock (timeout)
        lda #$3c
        sta PIA1_CRA                ; CA2 high: LS74 preset released
        lda #$3e
        sta PIA1_CRB                ; CB2 high: clear released
        lda #$ff
        sta PIA2_PA                 ; multiplier full scale
        sta $6300                   ; lin FM L/R latches as the stock autotune ($C080)
        sta $6301
        ldx #$40                    ; silence and isolate: VCF, VCAs, mod depths, LFOs at 0 V (S&H only:
@z:     lda #0                      ; the tables are re-sent at the end)
        tay
        jsr tn_dac
        inx
        bpl @z
        sta SH_SLOT                 ; next $64xx write = IC23
        lda #$ff
        sta LATCH_MUX+6             ; IC23 Q6 "mod offset" on during the tune (stock $C0A2)
        lda #0
        sta CAL_FAILED
        sta tn_prot
        lda #$ff
        sta tn_first
        ldx #15
@cr:    sta tune_res,x
        dex
        bpl @cr
        lda #0
        sta tn_k
        ldx #<tn_txt_tu
        ldy #>tn_txt_tu
        jsr panel_text              ; "tU" + v.o; the STEP window keeps the last error (letter + voice)
        sec
        ldx #3
        ldy #9
        jsr panel_led               ; AUTO TUNE LED

; ---- one oscillator
tn_next:
        tsx
        stx tn_sp                   ; error exit restores the stack here
        lda tn_k
        eor #1
        sta tn_osc
        jsr tn_select
        jsr tn_show
        ldx tn_osc
        lda #0
        sta tune_res,x
        txa
        lsr
        lda #0
        ror
        sta tn_half                 ; VCO1: + half a semitone (stock $045F)
        lda CAL_OFS_LO,x
        sta tn_ofs
        lda CAL_OFS_HI,x
        bne @o
        lda #$30                    ; blank table: start from the nominal offset
@o:     sta tn_ofs+1
        lda CAL_TRIM_PB,x
        sta tn_trim
        lda CAL_TRIM_PA,x
        beq @tb
        bpl @t
@tb:    lda #$40                    ; blank / invalid: mid scale
@t:     sta tn_trim+1
        lda CAL_PW_LO,x
        sta tn_pw
        clc
        lda CAL_PW_HI,x
        adc #$40                    ; stock: PW slot = $40 + cal
        sta tn_pw+1
        jsr tn_scale
        jsr tn_offset
        jsr tn_pwpass
tn_store:
        ldx tn_osc
        lda tn_ofs+1
        sta CAL_OFS_HI,x
        lda tn_ofs
        sta CAL_OFS_LO,x
        lda tn_trim+1
        sta CAL_TRIM_PA,x
        lda tn_trim
        sta CAL_TRIM_PB,x
        lda tn_pw
        sta CAL_PW_LO,x
        sec
        lda tn_pw+1
        sbc #$40                    ; cal = PA - $40; stock clamp ($C63D): >= $10 -> $F8
        bmi @p
        cmp #$10
        bcc @p
        lda #$f8
@p:     sta CAL_PW_HI,x
        jsr tn_trimslot
        inc tn_k
        lda tn_k
        cmp #16
        bcs tn_end
        jmp tn_next

; ---- error exit (A = letter) from anywhere inside an oscillator: mark the voice, keep safe values
tn_fail:
        ldx tn_sp
        txs
        jsr tn_mark
        lda #$30
        sta tn_ofs+1
        lda #$40
        sta tn_trim+1
        lda #$38
        sta tn_pw+1                 ; -> PW cal $F8 like the stock error path ($C72E)
        lda #0
        sta tn_ofs
        sta tn_trim
        sta tn_pw
        jmp tn_store

; Record error letter A for tn_osc: tune_res, CAL_FAILED, first failure, STEP window "<letter><voice>".
tn_mark:
        ldx tn_osc
        sta tune_res,x
        ldy #4
        jsr panel_putc
        lda tn_first
        bpl @f
        stx tn_first
@f:     txa
        lsr
        tay
        pha
        clc
        adc #'1'
        ldy #5
        jsr panel_putc
        pla
        tay
        lda panel_bitmask,y
        ora CAL_FAILED
        sta CAL_FAILED
        jmp panel_flush

; ---- end: save, restore the hardware for the engine
tn_end:
        ldx #127
@cv:    jsr cv_out                  ; every S&H back to the engine's values (and the new trims)
        dex
        bpl @cv
        sta SH_SLOT                 ; IC23
        lda #0
        sta LATCH_MUX+6
        lda tn_cra
        sta PIA1_CRA
        lda tn_crb
        sta PIA1_CRB
        jsr ptm_init                ; control tick exactly as at boot; T1/T3 stopped
        ldx #$5f
@w:     lda CAL,x
        sta BRAM_CAL,x
        dex
        bpl @w
        ldx #$5f
@v:     lda BRAM_CAL,x              ; read back: memory protect refuses writes silently
        cmp CAL,x
        beq @n
        inc tn_prot
@n:     dex
        bpl @v
        ldx #<tn_txt_ok
        lda tn_prot
        beq @np
        ldx #<tn_txt_prot
@np:    ldy #>tn_txt_ok
        jsr panel_text
        lda tn_prot
        bne @msg
        ldx tn_first
        bmi @msg
        stx tn_osc
        ldx #<tn_txt_err
        ldy #>tn_txt_err
        jsr panel_text
        jsr tn_vo
        ldx tn_osc
        lda tune_res,x
        ldy #4
        jsr panel_putc
@msg:   clc
        ldx #3
        ldy #9
        jsr panel_led
        jsr panel_flush
        plp
        jsr cv_unlock
        ldx #0
        jsr eng_apply_prog          ; waveform latches, lin FM, PW... back to the programs
        ldx #1
        jmp eng_apply_prog

tn_txt_ok:   .byte "tU  oK"
tn_txt_prot: .byte "PrOtEC"
tn_txt_err:  .byte "Er    "
tn_txt_tu:   .byte "tU    "
        .assert >tn_txt_ok = >tn_txt_prot, error, "tune texts must share a page"

; Progress "tU v.o": voice 1-8, oscillator 1 = VCO1, 2 = VCO2.
tn_show:
        jsr tn_vo
        jmp panel_flush
tn_vo:  lda tn_osc
        lsr
        clc
        adc #'1'
        ldy #2
        jsr panel_putc
        sec
        jsr panel_dp
        lda tn_osc
        and #1
        eor #1
        clc
        adc #'1'                    ; odd = VCO1 -> '1', even = VCO2 -> '2'
        ldy #3
        jmp panel_putc

; Tune mux: comparator select ($6302 /VCO2 SEL, $6303 /VCO1 SEL, active low) and voice (IC22 Q0-2).
; Waveforms: everything off except both sawtooths (stock $C17F), so the comparator sees a clean edge.
tn_select:
        lda tn_osc
        lsr                         ; C = VCO1
        lda #0
        ror
        sta $6302
        eor #$ff
        sta $6303
        sta SH_SLOT+$7f             ; next $64xx writes = IC22
        lda tn_osc
        asl
        asl
        asl
        asl                         ; voice bit 2 -> bit 7
        ldx #2
@m:     sta LATCH_MUX,x             ; Q2 = voice bit 2, Q1 = bit 1, Q0 = bit 0
        asl
        dex
        bpl @m
        jsr tn_waveoff
        lda #0
        sta LATCH_L+2
        sta LATCH_R+2
        sta LATCH_L+6
        sta LATCH_R+6
        rts
tn_waveoff:
        ldx #7
        lda #$ff
@w:     sta LATCH_L,x
        sta LATCH_R,x
        dex
        bpl @w
        rts

; ------------------------------------------------------------------ pass 1: scale (stock $C348)
; 1 period at TN_LO vs 4 periods at TN_HI (24 semitones up) must be equal. trim += err (x2 when |err| >= 8),
; up to 32 iterations (stock $C1CA).
tn_scale:
        lda #32
        sta tn_iter
@it:    lda #0
        sta tn_mode
        lda #TN_LO
        jsr tn_measure
        lda tn_cnt
        sta tn_err
        lda tn_cnt+1
        sta tn_err+1
        inc tn_mode
        lda #TN_HI
        jsr tn_measure
        sec
        lda tn_cnt
        sbc tn_err
        sta tn_err
        lda tn_cnt+1
        sbc tn_err+1
        sta tn_err+1
        jsr tn_abs
        cmp #3                      ; |err| <= 2 (stock < 2: readings are +-1, the mean of two +-0.5)
        bcc @ok
        cmp #8
        bcc @add
        asl tn_err
        rol tn_err+1
@add:   ldx #tn_trim
        jsr tn_add
        dec tn_iter
        bne @it
        lda #$40                    ; no convergence: mid scale, go on with the offset ("d" like the stock)
        sta tn_trim+1
        lda #0
        sta tn_trim
        lda #'d'
        jmp tn_mark
@ok:    rts

; ------------------------------------------------------------------ pass 2: offset (stock $C2D5)
; 4 periods at TN_HI + offset must last TN_TARGET cycles. ofs += err / 2 (near dead-beat).
tn_offset:
        lda #32
        sta tn_iter
@it:    lda #1
        sta tn_mode
        lda #TN_HI
        jsr tn_measure
        sec
        lda tn_cnt
        sbc #<TN_TARGET
        sta tn_err
        lda tn_cnt+1
        sbc #>TN_TARGET
        sta tn_err+1
        jsr tn_abs
        cmp #3                      ; |err| <= 2 cycles of 9027: 0.4 cent (stock: < 4). One offset unit
                                    ; moves the count ~2 cycles and readings are +-1: 2 is reachable
        bcc @ok
        jsr tn_asr                  ; one offset unit (1/256 semitone) moves the count by ~2.04 cycles
        clc
        lda tn_ofs
        adc tn_err
        sta tn_ofs
        lda tn_ofs+1
        adc tn_err+1
        and #$7f
        sta tn_ofs+1
        dec tn_iter
        bne @it
        lda #'b'
        jmp tn_fail
@ok:    rts

; ------------------------------------------------------------------ pass 3: pulse-width symmetry (stock $C55E)
; Sawtooths off: the comparator sees the pulse. The low time, then the high time of the next period are
; counted in software at TN_LO (one loop, 18 cycles per count, for both: no bias from code placement);
; pw += (low - high) * 4 until |low - high| < 2. No error letter (stock), except "A" when no edge comes.
tn_pwpass:
        jsr tn_waveoff
        lda #TN_LO
        jsr tn_setpitch
        lda #16
        sta tn_iter
@it:    jsr tn_write4
        lda #$80
        jsr tn_count                ; low time
        lda tn_cnt
        sta tn_prev
        lda tn_cnt+1
        sta tn_prev+1
        lda #0
        jsr tn_count                ; high time
        sec
        lda tn_prev
        sbc tn_cnt
        sta tn_err
        lda tn_prev+1
        sbc tn_cnt+1
        sta tn_err+1
        jsr tn_abs
        cmp #2
        bcc @ok
        asl tn_err
        rol tn_err+1
        asl tn_err
        rol tn_err+1
        ldx #tn_pw
        jsr tn_add
        dec tn_iter
        bne @it
@ok:    rts

; Count (18-cycle units) one high (A = 0) or low (A = $80) phase of PA7 -> tn_cnt. Syncs on its start edge.
tn_pol = tn_try                     ; free during the PW pass
tn_count:
        sta tn_pol
        jsr tn_timeout_rst
        lda #0
        sta tn_cnt
        sta tn_cnt+1
@s1:    lda PTM_CR2
        and #$04
        bne @to
        lda PIA1_PA
        eor tn_pol
        bmi @s1                     ; inside the phase: wait for its end
@s2:    lda PTM_CR2
        and #$04
        bne @to
        lda PIA1_PA
        eor tn_pol
        bpl @s2                     ; wait for the phase to start
@c:     inc tn_cnt
        bne @x
        inc tn_cnt+1
        beq @to
@x:     lda PIA1_PA
        eor tn_pol
        bmi @c
        rts
@to:    jmp tn_noedge

; ------------------------------------------------------------------ measurement
; A = PA of the measuring point: tn_pit = tn_ofs + A*256 + tn_half.
tn_setpitch:
        sta tn_pit+1
        clc
        lda tn_ofs
        adc tn_half
        sta tn_pit
        lda tn_ofs+1
        adc tn_pit+1
        sta tn_pit+1
        rts

; Measure at point A (tn_mode: 0 = 1 period, 1 = 4 periods) -> tn_cnt = mean of two readings that agree
; within 2 cycles. TN_TRIES readings without agreement -> "C".
tn_measure:
        jsr tn_setpitch
        lda #TN_TRIES
        sta tn_try
        jsr tn_read
@again: lda tn_cnt
        sta tn_prev
        lda tn_cnt+1
        sta tn_prev+1
        dec tn_try
        beq tn_unstable
        jsr tn_read
        sec
        lda tn_cnt
        sbc tn_prev
        tax
        lda tn_cnt+1
        sbc tn_prev+1
        beq @pos
        cmp #$ff
        bne @again
        cpx #$fe
        bcs @good
        bcc @again
@pos:   cpx #3
        bcs @again
@good:  clc
        lda tn_cnt
        adc tn_prev
        sta tn_cnt
        lda tn_cnt+1
        adc tn_prev+1
        ror
        sta tn_cnt+1
        ror tn_cnt
        rts
tn_unstable:
        lda #'C'
        jmp tn_fail

; One reading: refresh the 4 slots, sync on a rising edge, clear the LS74, then T1 counts from the next
; rising edge to the one after (mode 0) or, with the flip-flop held preset by CA2, to the 4th (mode 1).
tn_read:
        jsr tn_write4
        jsr tn_timeout_rst
        jsr tn_rise
        lda #$36
        sta PIA1_CRB                ; CB2 low: clear the LS74 (/Q high: T1 held)
        lda #$3e
        sta PIA1_CRB
        jsr tn_rise                 ; Q -> 1, /G1 falls: T1 <- $FFFF and counts
        lda tn_mode
        beq @one
        jsr tn_fall
        lda #$34
        sta PIA1_CRA                ; CA2 low: preset holds Q = 1 (T1 keeps counting)
        jsr tn_rise
        jsr tn_rise
        jsr tn_rise
        jsr tn_fall
        lda #$3c
        sta PIA1_CRA
@one:   jsr tn_rise                 ; Q -> 0, /G1 rises: T1 holds
        lda PTM_T1
        eor #$ff
        sta tn_cnt+1
        lda PTM_T1+1
        eor #$ff
        sta tn_cnt
        rts

; T1 latch and T3 (timeout) <- $FFFF; the T3 latch write restarts the one-shot and clears its flag.
tn_timeout_rst:
        lda #$ff
        sta PTM_T1
        sta PTM_T1+1
        sta PTM_T3LSB
        rts

tn_noedge:
        lda #'A'
        jmp tn_fail
tn_rise:
        jsr tn_waitlo
tn_waithi:
        lda PTM_CR2
        and #$04                    ; T3 timed out: no signal
        bne tn_noedge
        bit PIA1_PA
        bpl tn_waithi
        rts
tn_fall:
        jsr tn_waithi
tn_waitlo:
        lda PTM_CR2
        and #$04
        bne tn_noedge
        bit PIA1_PA
        bmi tn_waitlo
        rts

; Write the 4 slots of tn_osc: trim, PWM ($0404 = engine static value), PW, pitch.
tn_write4:
        lda tn_osc
        asl
        asl
        tax
        lda tn_trim+1
        ldy tn_trim
        jsr tn_dac
        inx
        lda #$04
        tay
        jsr tn_dac
        inx
        lda tn_pw+1
        ldy tn_pw
        jsr tn_dac
        inx
        lda tn_pit+1
        ldy tn_pit
; Slot X <- A (PA byte) / Y (PB byte), multiplier left at $FF, long settle and sample like the stock $C4FC.
tn_dac:
        sta PIA1_PA
        sty PIA1_PB
        sta SH_SLOT,x
        jsr tn_dly
        sta SH_SAMPLE
        jsr tn_dly
        sta SH_HOLD
tn_dly: rts

; ------------------------------------------------------------------ 16-bit helpers
; A = min(|tn_err|, 255)
tn_abs:
        lda tn_err+1
        bmi @neg
        bne @big
        lda tn_err
        rts
@neg:   sec
        lda #0
        sbc tn_err
        tay
        lda #0
        sbc tn_err+1
        bne @big
        tya
        rts
@big:   lda #$ff
        rts

; tn_err >>= 1 (arithmetic)
tn_asr:
        lda tn_err+1
        cmp #$80
        ror tn_err+1
        ror tn_err
        rts

; zp word at X += tn_err, clamped to 0..$7FFF (a 14-bit DAC value in PA:PB form)
tn_add:
        clc
        lda 0,x
        adc tn_err
        sta 0,x
        lda 1,x
        adc tn_err+1
        bpl @st
        lda tn_err+1                ; out of range: clamp on the side of the correction
        bmi @lo
        lda #$fe
        sta 0,x
        lda #$7f
        bne @st
@lo:    lda #0
        sta 0,x
@st:    sta 1,x
        rts
