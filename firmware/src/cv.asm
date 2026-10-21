; CV path: 14-bit DAC (PIA1) x DAC1022 multiplier (PIA2 PA) -> 128 sample-and-holds. docs/hardware.md §3.
; cv_pa/cv_pb/cv_mul hold the static value of every slot; the control tick refreshes them round-robin.

REFRESH_PER_TICK = 16               ; 128 slots every 8 ticks (16.4 ms)

cv_init:
        ldx #0
        lda #$ff
@l:     sta cv_mul,x
        inx
        bpl @l
        rts

; Main-loop DAC ownership. While locked the IRQ only counts ticks; unlock runs the ones that piled up.
cv_lock:
        inc dacLock
        rts
cv_unlock:
        dec dacLock
        bne @r
        php
        sei
        lda tickPend
        ora seq_cpend               ; (sequencer clock events, eng/seq.asm)
        beq @p
        lda tickBusy
        bne @p
        jsr run_ticks
@p:     plp
@r:     rts

; Store a 14-bit value for slot X: A = bits 13-7 (0-127), Y = bits 6-0 (0-127). Refreshed by the tick.
cv_set:
        sta cv_pa,x
        tya
        asl
        sta cv_pb,x
        rts

; Write slot X now (A = PA byte, Y = PB byte, mul[X] as multiplier) and remember it. Tick context only
; (or with the DAC locked).
cv_write:
        sta cv_pa,x
        tya
        sta cv_pb,x
cv_out: lda cv_pa,x
        sta PIA1_PA
        lda cv_pb,x
        sta PIA1_PB
        lda cv_mul,x
        sta PIA2_PA
        sta SH_SLOT,x               ; address the slot
        nop
        nop                         ; settle
        sta SH_SAMPLE               ; the S&H tracks the DAC
        nop
        nop
        nop
        nop
        nop
        nop
        nop
        nop                         ; sample window ~20 cycles
        sta SH_HOLD
        rts

; Refresh the next REFRESH_PER_TICK slots (tick context).
cv_refresh:
        lda #REFRESH_PER_TICK
        sta tmp2
        ldx cv_refIdx
@l:     jsr cv_out
        inx
        txa
        and #$7f
        tax
        dec tmp2
        bne @l
        stx cv_refIdx
        rts

