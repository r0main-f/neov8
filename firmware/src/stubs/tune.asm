; tune stub for module benches. Call-log ids $40-$4F.
tune_restore:   rts
; Like the real tuner, the stub keeps the CPU busy with interrupts off (~40 ms) so benches see realistic
; side effects (MIDI piling up in the ring, ticks deferred).
tune_run:
        php
        sei
        ldy #40
@o:     ldx #0
@i:     dex
        bne @i
        dey
        bne @o
        plp
        STUBCALL $40
