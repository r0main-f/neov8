; Pot ADC: software successive approximation (as the stock ROM $CE4E) - docs/hardware.md §6.
; DAC on one LM339 input, pot mux on the other; PIA1 PB0 = 1 when the DAC is above the pot.

; A = pot-mux channel (0-15) -> A = 8-bit value. Takes the DAC: run with the DAC locked.
adc_read:
        sta tmp
        jsr cv_lock
        sta SH_HOLD                 ; every S&H holds while the DAC is borrowed
        sta SH_SLOT+$7F             ; next $6400 writes go to the pot-mux address latch (IC22)
        lda tmp
        ldx #7
@sel:   sta LATCH_MUX,x             ; Q[x] <- D7
        asl
        dex
        bpl @sel
        ldx #40                     ; mux + RC settling
@set:   dex
        bne @set
        lda #$ff
        sta PIA2_PA                 ; multiplier full scale
        lda #0
        sta tmp                     ; result
        lda #$80
        sta tmp2                    ; trial bit
@bit:   lda tmp
        ora tmp2
        pha
        lsr                         ; bits 7..1 -> PA6..0
        sta PIA1_PA
        pla
        pha
        ror                         ; bit 0 -> C
        lda #0
        ror
        sta PIA1_PB                 ; PB7 = bit 0
        nop
        nop
        nop
        nop
        nop
        nop                         ; settle
        lda PIA1_PB
        lsr                         ; comparator -> C
        pla
        bcs @high                   ; DAC above the pot: drop this bit
        sta tmp
@high:  lsr tmp2
        bcc @bit
        jsr cv_unlock
        lda tmp
        rts

