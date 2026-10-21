; Shared by all stubs: append [id, A, X, Y] to the call log. Preserves X, Y.
CALLLOG_A = $0FE9
CALLLOG_X = $0FEA
CALLLOG_Y = $0FEB
stub_log:
        sta CALLLOG_A+3             ; scratch: id
        txa
        pha
        lda CALLLOG_N
        and #$3f
        asl
        asl
        tax
        lda CALLLOG_A+3
        sta CALLLOG,x
        lda CALLLOG_A
        sta CALLLOG+1,x
        lda CALLLOG_X
        sta CALLLOG+2,x
        lda CALLLOG_Y
        sta CALLLOG+3,x
        inc CALLLOG_N
        pla
        tax
        rts
