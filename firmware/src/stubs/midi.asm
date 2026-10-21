; midi stub for module benches. Call-log ids $30-$3F.
midi_init:
        lda #$03
        sta ACIA_CTRL
        lda #$95
        sta ACIA_CTRL
        rts
midi_nmi:
        pha
        lda ACIA_CTRL
        lsr
        bcc @out
        lda ACIA_DATA
@out:   pla
        rti
midi_poll:      rts
midi_tx:        STUBCALL $30
midi_note_out:  STUBCALL $31
