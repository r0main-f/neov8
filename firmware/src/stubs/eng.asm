; eng stub for module benches. Call-log ids $10-$1F.
eng_init:       rts
eng_tick:       jmp cv_refresh
eng_service:    rts
eng_load_prog:  STUBCALL $10
eng_apply_prog: STUBCALL $11
eng_apply_perf: STUBCALL $12
eng_key_on:     STUBCALL $13
eng_key_off:    STUBCALL $14
eng_side_on:    STUBCALL $15
eng_side_off:   STUBCALL $16
eng_all_off:    STUBCALL $17
eng_ctrl:       STUBCALL $18
eng_compare:    STUBCALL $19
