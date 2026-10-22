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
midi_flush:     rts
midi_tx:        STUBCALL $30
midi_note_out:  STUBCALL $31
midi_pc_out:    STUBCALL $32     ; X side, A program
midi_cc_out:    STUBCALL $33     ; X side, A controller, Y value
midi_nrpn_out:  STUBCALL $34     ; X side, A byte number, Y raw byte
midi_sx_event:  STUBCALL $35     ; A command, X data ($FF none)
