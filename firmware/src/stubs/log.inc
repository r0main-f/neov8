; Call log for module stubs (test benches): every stubbed API call appends [id, A, X, Y] to CALLLOG.
; Tests read it through the emulator (sim/test/helpers.ts: readCallLog). IDs are listed in stubs/*.asm.
CALLLOG     = $0E00         ; 64 entries x 4 bytes (ring)
CALLLOG_N   = $0FE8         ; number of entries written (wraps at 256)

.macro STUBCALL id
        php
        pha
        sta CALLLOG_A
        stx CALLLOG_X
        sty CALLLOG_Y
        lda #id
        jsr stub_log
        pla
        plp
        rts
.endmacro
