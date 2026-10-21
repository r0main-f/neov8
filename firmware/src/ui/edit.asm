; NeoV8 UI - EDIT layer: 6 pages (1 2 A B C D) driven by the generated bindings (spec/pages.yaml),
; keypad enums, value-on-touch, A440+FWD/REV nudge, pot modes. proto.ts editKey / editPot / applyPot.

ui_edit_key:
        lda ui_code
        cmp #BTN_STORE
        bne @n1
        ldx ui_eside
        lda ui_sh
        beq @st
        jmp ui_compare_or_undo
@st:    lda #0
        jmp ui_store_start
@n1:    cmp #BTN_FWD
        beq @fr
        cmp #BTN_REV
        bne @n2
@fr:    lda ui_sh
        beq @page
        lda ui_code                 ; A440+FWD/REV: +-1 on the last touched parameter
        cmp #BTN_FWD
        beq @inc
        lda #$ff
        jmp ui_nudge
@inc:   lda #1
        jmp ui_nudge
@page:  jsr ui_fwdrev_delta         ; 1 or 99
        cmp #1
        beq @pf
        lda #UI_NPAGES-1
@pf:    clc
        adc ui_page
        cmp #UI_NPAGES
        bcc @ps
        sbc #UI_NPAGES
@ps:    sta ui_page
        jmp ui_uncatch
@n2:    jsr ui_isdigit
        bcc @n3
        ldx ui_sh
        beq @kp
        ldx ui_eside                ; A440+digit: jump to page 1-6 (hardware stand-in for EDIT+digit)
        jmp ui_jump_page
@kp:    jmp ui_keypad
@n3:    jsr ui_edit_binding         ; C=1 when the page binds this button
        bcs @r
        lda ui_code
        cmp #BTN_CALL_L
        beq @call
        cmp #BTN_CALL_R
        bne @n4
@call:  jsr ui_code_left
        lda #0
        rol
        tax
        lda ui_sh
        beq @side
        jmp ui_init_prog
@side:  ldy ui_eside                ; CALL L/R switch the edited side
        lda ui_page
        sta ui_lastpg,y
        stx ui_eside
        jmp ui_uncatch
@n4:    cmp #BTN_AUTOTUNE
        bne @r
        lda ui_sh
        beq @r
        jmp ui_tone_toggle
@r:     rts

; digit A on the page keypad: pick an enum value for the selected target
ui_keypad:
        sta ui_d
        ldx ui_page
        lda ui_pg_kpvar,x
        cmp #$fe
        beq @r                      ; no keypad on this page
        lda ui_mul10,x
        clc
        adc ui_d
        tay
        lda ui_pg_keys,y
        cmp #$ff
        bne @ok
        UIFLASH ui_s_none, 0
@r:     rts
@ok:    sta ui_d                    ; raw value
        jsr ui_kp_target
        tax
        lda ui_eside
        jsr ui_setbuf
        lda ui_d
        jsr ui_pset
        jmp ui_touch_apply

; -> A = param the keypad edits on this page (selector var or target 0)
ui_kp_target:
        ldx ui_page
        lda ui_pg_kpvar,x
        bmi @t0
        tay
        lda ui_sel,y
        bne @t
@t0:    lda #0
@t:     clc
        adc ui_mul3,x
        tay
        lda ui_pg_kpt,y
        rts

; X = param: show it (default ON value, no marker) and apply the edit buffer of ui_bside
ui_touch_apply:
        lda #$ff
        sta ui_onw
ui_touch_apply_onw:
        lda #' '
        sta ui_mark
        jsr ui_touch_param
        ldx ui_bside
        jmp ui_apply_prog

; button bound on the current page? C=1 handled
ui_edit_binding:
        ldx ui_page
        lda ui_pg_btn_lo,x
        sta ui_q
        lda ui_pg_btn_hi,x
        sta ui_q+1
        ldy #0
@l:     lda (ui_q),y
        cmp #$ff
        beq @no
        cmp ui_code
        beq @hit
        iny
        iny
        iny
        bne @l
@no:    clc
        rts
@hit:   iny
        lda (ui_q),y
        sta ui_c                    ; kind
        iny
        lda (ui_q),y
        sta ui_pp                   ; param
        lda ui_eside
        jsr ui_setbuf
        lda ui_c
        bpl @nsel
        ; select: the keypad now edits target <value> of selector <var>; show that target
        lsr
        lsr
        lsr
        and #1
        tay
        lda ui_c
        and #7
        sta ui_sel,y
        jsr ui_kp_target
        cmp #$ff
        beq @done
        tax
        lda #$ff
        sta ui_onw
        lda #' '
        sta ui_mark
        jsr ui_touch_param
@done:  sec
        rts
@nsel:  ldx ui_pp
        and #$40
        beq @par
        lda ui_c                    ; field: toggle one bit of a multi-bit param
        and #7
        tay
        lda panel_bitmask,y
        sta ui_d
        jsr ui_pget
        eor ui_d
        jsr ui_pset
        jsr ui_touch_apply
        sec
        rts
@par:   jsr ui_pget                 ; 1-bit param: toggle; ON value from the binding (onWhen)
        eor #1
        jsr ui_pset
        lda ui_c
        lsr
        lsr
        lsr
        lsr
        lsr
        and #1
        sta ui_onw
        jsr ui_touch_apply_onw
        sec
        rts

; A = +1 / -1: nudge the last touched parameter
ui_nudge:
        sta ui_d
        ldx ui_lt_par
        cpx #$ff
        bne @ok
        UIFLASH ui_s_none, 0
        rts
@ok:    lda ui_lt_side
        jsr ui_setbuf
        jsr ui_pget
        ldy ui_d
        bmi @dec
        cmp ui_p_mask,x
        beq @show
        clc
        adc #1
        bne @set
@dec:   cmp #0
        beq @show
        sec
        sbc #1
@set:   jsr ui_pset
@show:  jmp ui_touch_apply

; ---------------------------------------------------------------- pots in EDIT
ui_edit_pot:
        ldx ui_page
        lda ui_mul15,x
        clc
        adc ui_pi
        tay
        lda ui_pg_pot,y
        cmp #$ff
        bne @b
        jsr ui_tx_blank             ; unbound: "--  --"
        lda #'-'
        sta ui_tx
        sta ui_tx+1
        sta ui_tx+4
        sta ui_tx+5
        jmp ui_touch_tx
@b:     sta ui_pp
        lda ui_pg_pmode,y
        sta ui_pm
        lda ui_pi
        sta ui_ck
        lda ui_eside
        jsr ui_setbuf
        jsr ui_apply_pot
        ldx ui_bside
        jmp ui_apply_prog

; Apply pot ui_pi (value ui_pv, previous ui_pb) to param ui_pp of ui_buf with mode ui_pm
; (0 absolute with the global pot mode, 1 coarse12, 2 fine12, 3 fine); caught flag ui_ck. Shows the param.
ui_apply_pot:
        lda #$ff
        sta ui_onw
        lda #' '
        sta ui_mark
        ldx ui_pp
        jsr ui_pget
        sta ui_cur
        lda ui_pm
        bne @nabs
        jmp @abs
@nabs:  cmp #1
        bne @n12
        ; coarse12: 12 * round(v*21/127) + cur mod 12
        lda ui_cur
        ldx #12
        jsr ui_div8
        lda ui_mh
        sta ui_d                    ; cur mod 12
        lda ui_pv
        ldx #21
        jsr ui_scale
        ldx #12
        jsr ui_mul8
        lda ui_ml
        clc
        adc ui_d
        sta ui_ml
        bcc @set16
        inc ui_mh
        bcs @set16
@n12:   cmp #2
        bne @fine
        ; fine12: 12 * floor(cur/12) + round(v*11/127)
        lda ui_pv
        ldx #11
        jsr ui_scale
        sta ui_d
        lda ui_cur
        ldx #12
        jsr ui_div8
        ldx #12
        jsr ui_mul8
        lda ui_ml
        clc
        adc ui_d
        sta ui_ml
        bcc @set16
        inc ui_mh
@set16: jsr ui_clamp16
@setv:  ldx ui_pp
        jsr ui_pset
@show:  ldx ui_pp
        jmp ui_touch_param
@fine:  ; fine: relative, one step per 3 pot steps (accumulated per pot)
        ldx ui_pi
        lda ui_pv
        sec
        sbc ui_pb
        clc
        adc ui_pacc,x
        ldy #0
@fl:    cmp #$80
        bcs @fneg
        cmp #3
        bcc @fd
        sbc #3
        iny
        jmp @fl
@fneg:  cmp #$fe
        bcs @fd
        adc #3
        dey
        jmp @fl
@fd:    sta ui_pacc,x
        sty ui_d
        tya
        clc
        adc ui_cur
        sta ui_ml
        lda #0
        ldx ui_d
        bpl @fh
        lda #$ff
@fh:    adc #0
        sta ui_mh
        jmp @set16
@abs:   ; absolute: target = round(v*max/127), before = round(prev*max/127)
        ldx ui_pp
        lda ui_p_mask,x
        tax
        lda ui_pv
        jsr ui_scale
        sta ui_tgt
        ldx ui_pp
        lda ui_p_mask,x
        tax
        lda ui_pb
        jsr ui_scale
        sta ui_bef
        lda NV_GLOBALS+G_POTMODE
        cmp #1
        bne @nj
        lda ui_tgt                  ; jump
        jmp @setv
@nj:    cmp #2
        bne @pick
        lda ui_cur                  ; relative: cur + (target - before)
        clc
        adc ui_tgt
        sta ui_ml
        lda #0
        adc #0
        sta ui_mh
        lda ui_ml
        sec
        sbc ui_bef
        sta ui_ml
        lda ui_mh
        sbc #0
        sta ui_mh
        jmp @set16
@pick:  ; pickup: the pot takes over once it passes (or touches) the stored value
        lda ui_ck
        lsr
        lsr
        lsr
        tay
        lda ui_ck
        and #7
        tax
        lda panel_bitmask,x
        and ui_caught,y
        bne @caught
        lda ui_bef
        cmp ui_cur
        beq @catch
        bcc @below
        lda ui_cur                  ; before > cur: caught if target <= cur
        cmp ui_tgt
        bcs @catch
        bcc @near
@below: lda ui_tgt                  ; before < cur: caught if target >= cur
        cmp ui_cur
        bcs @catch
@near:  lda ui_tgt                  ; |target - cur| <= 1
        sec
        sbc ui_cur
        bcs @np
        eor #$ff
        adc #1
@np:    cmp #2
        bcs @not
@catch: lda panel_bitmask,x
        ora ui_caught,y
        sta ui_caught,y
@caught: lda ui_tgt
        jmp @setv
@not:   lda ui_tgt                  ; not caught: show the stored value and which way to turn
        ldx #'~'                    ; overline = turn down
        cmp ui_cur
        bcc @m
        ldx #'_'
@m:     stx ui_mark
        jmp @show

; ui_mh:ui_ml (signed 16) clamped to 0..max of param ui_pp -> A
ui_clamp16:
        ldx ui_pp
        lda ui_mh
        bmi @zero
        bne @max
        lda ui_ml
        cmp ui_p_mask,x
        bcc @r
@max:   lda ui_p_mask,x
@r:     rts
@zero:  lda #0
        rts
