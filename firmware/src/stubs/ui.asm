; ui stub for module benches. Call-log ids $20-$2F.
ui_init:        rts
ui_key:         STUBCALL $23     ; A = button code, X = raw byte
ui_pot:         STUBCALL $24     ; X = pot index, A = value
ui_service:
        lda panel_dirty
        beq @r
        jsr panel_flush
@r:     rts
ui_recall_prog: STUBCALL $20
ui_recall_step: STUBCALL $21
ui_sysex_in:    STUBCALL $22
