; NeoV8 UI - programs and steps in battery RAM (stock 40 / 24-byte formats, docs/rev4-ram-map.md),
; recall, store flow, compare, undo (NV_UNDO), memory-protect detection, NeoV8 globals init.

UI_NV_VERSION = 1
UI_NV_STEPEXT = NV_STEPEXT          ; 100 B per-step NeoV8 extension (api.inc):
                                    ; bits 1-0 arp octaves R - 1, bits 3-2 arp octaves L - 1,
                                    ; bits 5-4 HOLD (L R), bit 6 ARP PAUSE (not in the stock step)

; ---------------------------------------------------------------- boot
ui_nv_init:
        lda NV_MAGIC
        cmp #'N'
        bne @init
        lda NV_MAGIC+1
        cmp #'8'
        beq @r
@init:  ldx #G_SIZE-1               ; first boot: globals, empty undo, step extension (programs/steps untouched)
        lda #0
@z:     sta NV_GLOBALS,x
        dex
        bpl @z
        jsr ui_globals_defaults
        ldx #99
        lda #0
@e:     sta UI_NV_STEPEXT,x
        dex
        bpl @e
        lda #$ff
        sta NV_UNDO
        lda #UI_NV_VERSION
        sta NV_VERSION
        lda #'N'
        sta NV_MAGIC
        lda #'8'
        sta NV_MAGIC+1
@r:     rts

; ---------------------------------------------------------------- addresses
; A = program number -> ui_p = PROG_BASE + 40*A
ui_prog_addr:
        ldx #PROG_SIZE
        ldy #>PROG_BASE
        bne ui_addr
; A = step number -> ui_p = STEP_BASE + 24*A
ui_step_addr:
        ldx #STEP_SIZE
        ldy #>STEP_BASE
; A = index, X = stride, Y = base high byte (low byte 0) -> ui_p
ui_addr:
        sty ui_p+1
        ldy #0
        sty ui_p
        tay
        beq @d
@l:     txa
        clc
        adc ui_p
        sta ui_p
        bcc @n
        inc ui_p+1
@n:     dey
        bne @l
@d:     rts

; (ui_p) writable? Memory protect cannot be read: flip the byte, read it back, restore. C=1 writable.
ui_bram_probe:
        ldy #0
        lda (ui_p),y
        sta ui_a
        eor #$ff
        sta (ui_p),y
        cmp (ui_p),y
        php
        lda ui_a
        sta (ui_p),y
        plp
        beq @y
        clc
        rts
@y:     sec
        rts

; ---------------------------------------------------------------- recall
; X = side, A = program: battery program -> edit buffer, apply
ui_load_prog:
        sta PERF+PF_PROG_R,x
        stx ui_d
        pha
        lda ui_eng                  ; recall: after the apply, the engine resets envelopes / kbd CV (stock recall)
        ora #$40
        sta ui_eng
        pla
        jsr ui_prog_addr
        lda ui_d
        jsr ui_setbuf
        ldy #PROG_SIZE-1
@c:     lda (ui_p),y
        sta (ui_buf),y
        dey
        bpl @c
        lda ui_cmp
        cmp ui_d
        bne @nc
        lda #$ff
        sta ui_cmp
@nc:    jsr ui_uncatch
        ldx ui_d
        jmp ui_apply_prog

; A = step: battery step -> PERF, both programs -> edit buffers, apply
ui_recall_step_n:
        sta PERF+PF_STEP
        cmp NV_GLOBALS+G_LAST_STEP
        beq @s
        sta NV_GLOBALS+G_LAST_STEP  ; remembered for power-on (may be refused by memory protect)
@s:     jsr ui_step_addr
        ldy #STEP_SIZE-1
@c:     lda (ui_p),y
        sta ui_stp,y
        dey
        bpl @c
        jsr ui_step_unpack
        ldx PERF+PF_STEP
        lda UI_NV_STEPEXT,x
        and #3
        clc
        adc #1
        sta PERF+PF_ARP_OCT_R
        lda UI_NV_STEPEXT,x
        lsr
        lsr
        and #3
        clc
        adc #1
        sta PERF+PF_ARP_OCT_L
        lda UI_NV_STEPEXT,x
        lsr
        lsr
        lsr
        lsr
        pha
        and #3
        sta PERF+PF_HOLD
        pla
        lsr
        lsr
        and #1
        sta PERF+PF_ARP_PAUSE
        ldx #1
        lda PERF+PF_PROG_L
        jsr ui_load_prog
        ldx #0
        lda PERF+PF_PROG_R
        jsr ui_load_prog
        jmp ui_apply_perf

; A = side -> A = 1 when the edit buffer differs from its stored program (Z=0), else 0
ui_edited:
        tax
        stx ui_d
        lda PERF+PF_PROG_R,x
        jsr ui_prog_addr
        lda ui_d
        jsr ui_setbuf
        ldy #PROG_SIZE-1
@l:     lda (ui_p),y
        cmp (ui_buf),y
        bne @y
        dey
        bpl @l
        lda #0
        rts
@y:     lda #1
        rts

; ---------------------------------------------------------------- compare / undo
ui_compare_off:
        ldx ui_cmp
        bmi @r
        lda #$ff
        sta ui_cmp
        lda #0
        jmp eng_compare             ; X side, A = 0: hear the edit buffer again
@r:     rts

; A440+STORE, X = side: compare (if edited), else offer to undo the last store
ui_compare_or_undo:
        lda ui_cmp
        bpl ui_compare_off
        stx ui_c
        txa
        jsr ui_edited
        beq @ne
        ldx ui_c
        stx ui_cmp
        lda #1
        jmp eng_compare             ; hear the stored program
@ne:    lda NV_UNDO
        cmp #100
        bcs @none
        lda #1
        jmp ui_confirm_enter        ; "UndO nn", STORE restores
@none:  UIFLASH ui_s_noed, 0
        rts

; ---------------------------------------------------------------- store flow
; A = kind (0 program, 1 step), X = side
ui_store_start:
        ldy #$ff
        sty ui_ent
        ldy ui_cmp
        bmi @ok
        UIFLASH ui_s_cpno, 0        ; storing is refused while comparing
        rts
@ok:    sta ui_st_kind
        stx ui_st_side
        tay
        beq @p
        lda PERF+PF_STEP
        bpl @d
@p:     lda PERF+PF_PROG_R,x
@d:     sta ui_st_dest
        lda #0
        sta ui_st_n
        lda #1
        sta ui_st_on
        rts

ui_store_key:
        lda ui_code
        jsr ui_isdigit
        bcc @nd
        ldx ui_st_n
        bne @two
        inc ui_st_n
        sta ui_st_d
        rts
@two:   sta ui_d
        lda #0
        sta ui_st_n
        lda ui_st_d
        ldx #10
        jsr ui_mul8
        lda ui_ml
        clc
        adc ui_d
        sta ui_st_dest
        rts
@nd:    lda ui_code
        cmp #BTN_FWD
        beq @fr
        cmp #BTN_REV
        bne @ns
@fr:    jsr ui_fwdrev_delta
        clc
        adc ui_st_dest
        jsr ui_mod100
        sta ui_st_dest
        rts
@ns:    cmp #BTN_STORE
        bne @r
        jmp ui_store_commit
@r:     rts

ui_store_commit:
        lda #0
        sta ui_st_on
        lda ui_st_kind
        bne @step
        lda ui_st_dest              ; ---- program
        jsr ui_prog_addr
        jsr ui_bram_probe
        bcc ui_protected
        ldy #PROG_SIZE-1            ; keep the overwritten program for undo
@u:     lda (ui_p),y
        sta NV_UNDO+1,y
        dey
        bpl @u
        lda ui_st_dest
        sta NV_UNDO
        lda ui_st_side
        jsr ui_setbuf
        ldy #PROG_SIZE-1
@w:     lda (ui_buf),y
        sta (ui_p),y
        dey
        bpl @w
        ldx ui_st_side
        lda ui_st_dest
        sta PERF+PF_PROG_R,x
        jmp @ok
@step:  jsr ui_step_pack            ; ---- step
        lda ui_st_dest
        jsr ui_step_addr
        jsr ui_bram_probe
        bcc ui_protected
        ldy #STEP_SIZE-1
@sw:    lda ui_stp,y
        sta (ui_p),y
        dey
        bpl @sw
        ldx ui_st_dest
        lda PERF+PF_ARP_PAUSE
        and #1
        asl
        asl
        ora PERF+PF_HOLD
        asl
        asl
        sta ui_a
        lda PERF+PF_ARP_OCT_L
        sec
        sbc #1
        and #3
        ora ui_a
        asl
        asl
        sta ui_a
        lda PERF+PF_ARP_OCT_R
        sec
        sbc #1
        and #3
        ora ui_a
        sta UI_NV_STEPEXT,x
        stx PERF+PF_STEP
        stx NV_GLOBALS+G_LAST_STEP
@ok:    UIFLASH ui_s_stored, 0
        rts

ui_protected:
        UIFLASH ui_s_protec, 1
        rts

ui_confirm_key:
        lda ui_code
        cmp #BTN_STORE
        bne @r
        jsr ui_pop_mode
        lda ui_cfm
        bne @undo
        lda #1                      ; TAPE DUMP = SysEx dump of the 100 programs (runs in the background)
        jsr midi_dump_all
        UIFLASH ui_s_sent, 0
@r:     rts
@undo:  lda NV_UNDO
        cmp #100
        bcs @r
        jsr ui_prog_addr
        jsr ui_bram_probe
        bcc ui_protected
        ldy #PROG_SIZE-1
@c:     lda NV_UNDO+1,y
        sta (ui_p),y
        dey
        bpl @c
        lda NV_UNDO                 ; sides playing that program get it back in their edit buffer
        cmp PERF+PF_PROG_R
        bne @l
        ldx #0
        jsr ui_load_prog
@l:     lda NV_UNDO
        cmp PERF+PF_PROG_L
        bne @e
        ldx #1
        jsr ui_load_prog
@e:     lda #$ff
        sta NV_UNDO
        UIFLASH ui_s_undone, 0
        rts

; ---------------------------------------------------------------- step format (stock, 24 bytes)
; PERF -> ui_stp
ui_step_pack:
        ldx #0                      ; VCA velocity comes from the programs (as the stock StepStore)
        lda EDIT_R+$1C
        bmi @v1
        inx
@v1:    lda EDIT_L+$1C
        bmi @v2
        inx
        inx
@v2:    stx PERF+PF_VCAVEL
        ldx #STEP_SIZE-1
        lda #0
@z:     sta ui_stp,x
        dex
        bpl @z
        lda PERF+PF_KBMODE
        bne @k1
        lda #$80                    ; WHOLE 8
        bne @k2
@k1:    cmp #1
        bne @k3
        lda #$40                    ; SPLIT (LAYER = neither)
@k2:    sta ui_stp
@k3:    ldx #0                      ; single-bit flags
@f:     ldy ui_stf_perf,x
        lda PERF,y
        and ui_stf_pmask,x
        beq @fn
        ldy ui_stf_byte,x
        lda ui_stp,y
        ora ui_stf_smask,x
        sta ui_stp,y
@fn:    inx
        cpx #UI_STF_N
        bne @f
        ldx #0                      ; multi-bit fields
@m:     ldy ui_stm_perf,x
        lda PERF,y
        and ui_stm_mask,x
        ldy ui_stm_shift,x
        beq @ms
@sh:    asl
        dey
        bne @sh
@ms:    ldy ui_stm_byte,x
        ora ui_stp,y
        sta ui_stp,y
        inx
        cpx #UI_STM_N
        bne @m
        lda PERF+PF_SPLIT           ; split point: key index = MIDI note - 12 (stock default $24 = C3)
        sec
        sbc #12
        bcs @s1
        lda #0
@s1:    cmp #64
        bcc @s2
        lda #63
@s2:    ora ui_stp+4
        sta ui_stp+4
        ldx #13
@t:     lda PERF+PF_TRIM_R,x
        sta ui_stp+6,x
        dex
        bpl @t
        lda ui_stp+20
        eor #$30
        sta ui_stp+20
        rts

; ui_stp -> PERF
ui_step_unpack:
        lda ui_stp+20
        eor #$30
        sta ui_stp+20
        ldx #UI_STF_N-1
        lda #0
@c:     ldy ui_stf_perf,x
        sta PERF,y
        dex
        bpl @c
        ldx #0
@f:     ldy ui_stf_byte,x
        lda ui_stp,y
        and ui_stf_smask,x
        beq @fn
        ldy ui_stf_perf,x
        lda PERF,y
        ora ui_stf_pmask,x
        sta PERF,y
@fn:    inx
        cpx #UI_STF_N
        bne @f
        ldx #0
@m:     ldy ui_stm_byte,x
        lda ui_stp,y
        ldy ui_stm_shift,x
        beq @ms
@sh:    lsr
        dey
        bne @sh
@ms:    and ui_stm_mask,x
        ldy ui_stm_perf,x
        sta PERF,y
        inx
        cpx #UI_STM_N
        bne @m
        ldx #2                      ; keyboard mode
        lda ui_stp
        bpl @k1
        ldx #0
        beq @k2
@k1:    and #$40
        beq @k2
        ldx #1
@k2:    stx PERF+PF_KBMODE
        lda ui_stp+4
        and #$3f
        clc
        adc #12
        sta PERF+PF_SPLIT
        ldx #13
@t:     lda ui_stp+6,x
        sta PERF+PF_TRIM_R,x
        dex
        bpl @t
        ldx #1                      ; sanitize
@cl:    lda PERF+PF_PROG_R,x
        cmp #100
        bcc @p
        lda #99
        sta PERF+PF_PROG_R,x
@p:     lda PERF+PF_OCT_R,x
        cmp #3
        bcc @o
        lda #2
        sta PERF+PF_OCT_R,x
@o:     dex
        bpl @cl
        rts
