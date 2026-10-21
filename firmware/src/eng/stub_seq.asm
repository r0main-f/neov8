; polysequencer stub (benches: -D STUB_SEQ, and the eng stub). Variables: eng/vars_seq.inc.
seq_init:
seq_tick:
seq_clock:
seq_service:
seq_clear:
seq_erase:
seq_tempo_set:
seq_retune:
seq_dump:
seq_sysex:
        rts
seq_tap:                            ; A preserved
        rts
seq_startstop:
        lda #2
        sta seq_status
        rts
