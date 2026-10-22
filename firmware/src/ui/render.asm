; NeoV8 UI - display and LED rendering (proto.ts display() / ledStates()), blink, debug block UIDBG.
; Text is built in ui_tx (6 ASCII chars, '~' = overline), ui_dpm / ui_blm / ui_dpbm = decimal points,
; blinking digits, blinking decimal points (bit i = digit i, 0 = LEFT tens .. 5 = STEP units).

; UIDBG layout (documented in ui/README.md)
UD_MODE     = UIDBG+0
UD_PAGE     = UIDBG+1
UD_ESIDE    = UIDBG+2
UD_FOCUS    = UIDBG+3
UD_FLAGS    = UIDBG+4       ; b0 edited R, b1 edited L, b2 store armed, b3 entry, b4 comparing, b5 compare side L, b6 A440 tone, b7 mute
UD_ITEM     = UIDBG+5       ; menu item number
UD_CFM      = UIDBG+6
UD_BLINK    = UIDBG+7
UD_DP       = UIDBG+8
UD_DPBLINK  = UIDBG+9
UD_SEG      = UIDBG+10      ; 6 segment bytes before blinking (8279 bit order, DP = bit 0)
UD_LED      = UIDBG+16      ; 4 LED bytes (display RAM 0, 3, 6, 9) before blinking
UD_LEDBLINK = UIDBG+20      ; 4 blink masks
UD_LASTBTN  = UIDBG+24
UD_STDEST   = UIDBG+25
UD_RXCNT    = UIDBG+26
UD_LTPAR    = UIDBG+27
UD_STORE    = UIDBG+28      ; b0 side L, b1 step
UD_ENTRY    = UIDBG+29      ; entry target ($FF none)
UD_SELS     = UIDBG+30      ; keypad selectors: pwm in bits 0-3, lfo in bits 4-7
UD_COUNT    = UIDBG+31      ; renders

ui_render:
        jsr ui_tx_blank
        lda #0
        sta ui_dpm
        sta ui_blm
        sta ui_dpbm
        jsr ui_render_leds
        lda ui_msg_on
        beq @nomsg
        ldx #5
@m:     lda ui_msg_txt,x
        sta ui_tx,x
        dex
        bpl @m
        lda ui_msg_dp
        sta ui_dpm
        lda ui_msg_blk
        beq @mc
        lda #$3f
        sta ui_blm
@mc:    jmp ui_compose
@nomsg: lda ui_st_on
        beq @nost
        jsr ui_disp_store
        jmp ui_compose
@nost:  lda ui_tch_on
        beq @mode
        lda ui_mode
        cmp #UI_SEQ
        beq @tch
        cmp #UI_MENU
        bcs @mode
@tch:
        ldx #5
@t:     lda ui_tch_txt,x
        sta ui_tx,x
        dex
        bpl @t
        jmp ui_compose
@mode:  ldx ui_mode
        lda ui_disp_hi,x
        pha
        lda ui_disp_lo,x
        pha
        rts                         ; mode renderer, returns to ui_render's caller via ui_compose
ui_disp_lo: .byte <(ui_disp_play-1), <(ui_disp_edit-1), <(ui_disp_menu-1), <(ui_disp_tune-1), <(ui_disp_confirm-1), <(ui_disp_receive-1), <(ui_disp_seq-1)
ui_disp_hi: .byte >(ui_disp_play-1), >(ui_disp_edit-1), >(ui_disp_menu-1), >(ui_disp_tune-1), >(ui_disp_confirm-1), >(ui_disp_receive-1), >(ui_disp_seq-1)

; entry text ("--" or "4-") at Y
ui_disp_entry:
        lda ui_ent_n
        bne @d
        lda #'-'
        sta ui_tx,y
        bne @m
@d:     lda ui_ent_d
        ora #'0'
        sta ui_tx,y
@m:     lda #'-'
        sta ui_tx+1,y
        rts

ui_disp_store:
        lda #'S'
        sta ui_tx
        lda #'t'
        sta ui_tx+1
        ldy #2
        lda ui_st_n
        beq @dest
        lda ui_st_d
        ora #'0'
        sta ui_tx+2
        lda #'-'
        sta ui_tx+3
        bne @k
@dest:  lda ui_st_dest
        jsr ui_tx_2d
@k:     lda ui_st_kind
        beq @p
        lda #'S'
        sta ui_tx+4
        lda #'P'
        sta ui_tx+5
        bne @b
@p:     ldx ui_st_side
        lda ui_side_ch,x
        sta ui_tx+5
@b:     lda #$0c
        sta ui_blm
        rts

ui_disp_play:
        ldx #1                      ; LEFT window = side L
        ldy #0
        jsr @win
        ldx #0
        ldy #2
        jsr @win
        ldy #4
        lda ui_ent
        cmp #2
        bne @st
        jsr ui_disp_entry
        jmp @fl
@st:    lda PERF+PF_STEP
        jsr ui_tx_2d
@fl:    ldx ui_ent
        bmi @c
        lda ui_tgt_mask,x
        sta ui_blm
@c:     ldx ui_cmp
        bmi @f
        lda ui_tgt_mask,x
        ora ui_blm
        sta ui_blm
@f:     ldx ui_focus
        lda ui_tgt_dp,x
        sta ui_dpm
        lda #1
        jsr ui_edited
        beq @er
        lda #$02
        jsr ui_dp_blink
@er:    lda #0
        jsr ui_edited
        beq @x
        lda #$08
        jsr ui_dp_blink
@x:     jmp ui_compose
@win:   cpx ui_ent
        bne @w1
        jmp ui_disp_entry
@w1:    cpx ui_cmp
        bne @w2
        lda #'C'
        sta ui_tx,y
        lda #'P'
        sta ui_tx+1,y
        rts
@w2:    lda PERF+PF_PROG_R,x
        jmp ui_tx_2d

; A = digit bit: blinking decimal point (edited flag)
ui_dp_blink:
        pha
        ora ui_dpm
        sta ui_dpm
        pla
        ora ui_dpbm
        sta ui_dpbm
        rts

ui_disp_edit:
        lda ui_eside
        jsr ui_setbuf
        lda ui_cmp
        cmp ui_eside
        bne @id
        lda #'C'
        sta ui_tx
        lda #'P'
        sta ui_tx+1
        lda #$03
        sta ui_blm
        bne @ed
@id:    ldx ui_eside
        lda ui_side_ch,x
        sta ui_tx
        ldx ui_page
        lda ui_pg_char,x
        sta ui_tx+1
@ed:    lda ui_eside
        jsr ui_edited
        beq @rw
        lda #$02
        jsr ui_dp_blink
@rw:    lda ui_eside
        jsr ui_setbuf
        ldx ui_page
        lda ui_pg_inv,x
        cmp #$ff
        beq @prog
        tax                         ; mod page: RIGHT = source, DP = inverted
        lda #$ff
        sta ui_onw
        jsr ui_ison
        bcc @src
        lda ui_dpm
        ora #$04
        sta ui_dpm
@src:   ldx ui_page
        lda ui_mul3,x
        tay
        lda ui_pg_kpt,y
        tax
        ldy #2
        jsr ui_enum_at
        jmp @win
@prog:  ldx ui_eside
        lda PERF+PF_PROG_R,x
        ldy #2
        jsr ui_tx_2d
@win:   ldx ui_page
        lda ui_pg_win,x
        cmp #1
        beq @two
        cmp #2
        bne @x
        lda ui_pg_winp,x            ; param in hex (mod depth)
        tax
        jsr ui_pget
        ldy #4
        jsr ui_tx_hex
@x:     jmp ui_compose
@two:   lda ui_mul3,x               ; one digit per keypad target, DP = the one the keypad edits
        tay
        lda ui_pg_kpt+1,y
        ldy #4
        jsr @key
        ldx ui_page
        lda ui_mul3,x
        tay
        lda ui_pg_kpt+2,y
        ldy #5
        jsr @key
        ldx ui_page
        ldy ui_pg_kpvar,x
        lda ui_sel,y
        ldx #$10
        cmp #1
        beq @dp
        ldx #$20
@dp:    txa
        ora ui_dpm
        sta ui_dpm
        jmp ui_compose
@key:   sty ui_c                    ; A = param -> digit whose keypad value is the param's value, at Y
        tax
        jsr ui_pget
        sta ui_d
        ldx ui_page
        lda ui_mul10,x
        tax
        ldy #0
@k:     lda ui_pg_keys,x
        cmp ui_d
        beq @kf
        inx
        iny
        cpy #10
        bne @k
        lda #'?'
        bne @ks
@kf:    tya
        ora #'0'
@ks:    ldy ui_c
        sta ui_tx,y
        rts

; X = enum param -> its 2-char text at Y (ui_buf). X, Y clobbered.
ui_enum_at:
        sty ui_c
        jsr ui_pget
        sta ui_ml
        lda ui_p_flags,x
        and #7
        tay
        lda ui_ml
        clc
        adc ui_enum_ofs-1,y
        asl
        tax
        ldy ui_c
        lda ui_enum_txt,x
        sta ui_tx,y
        lda ui_enum_txt+1,x
        sta ui_tx+1,y
        rts

ui_disp_menu:
        jsr ui_menu_fields
        lda ui_a
        cmp #MK_DISP
        bne @n
        ldx #5                      ; display test: all segments
        lda #'8'
@d:     sta ui_tx,x
        dex
        bpl @d
        lda #$3f
        sta ui_dpm
        jmp ui_compose
@n:     lda ui_ent
        cmp #3
        bne @num
        ldy #0
        jsr ui_disp_entry
        lda #$03
        sta ui_blm
        bne @mn
@num:   ldy #0
        lda (ui_q),y
        jsr ui_tx_2d
@mn:    jsr ui_menu_row
        ldy #1
        lda (ui_q),y
        sta ui_tx+2
        iny
        lda (ui_q),y
        sta ui_tx+3
        jsr ui_menu_valtxt
        jmp ui_compose

ui_disp_tune:
        lda #'t'
        sta ui_tx
        lda #'U'
        sta ui_tx+1
        jmp ui_compose

ui_disp_confirm:
        lda #$3f
        sta ui_blm
        lda ui_cfm
        cmp #2
        bne @nu
        ldx #5
@e:     lda ui_s_erase,x
        sta ui_tx,x
        dex
        bpl @e
        jmp ui_compose
@nu:    cmp #0
        bne @u
        ldx #5
@s:     lda ui_s_send,x
        sta ui_tx,x
        dex
        bpl @s
        jmp ui_compose
@u:     ldx #3
@c:     lda ui_s_undo,x
        sta ui_tx,x
        dex
        bpl @c
        lda NV_UNDO
        ldy #4
        jsr ui_tx_2d
        jmp ui_compose

ui_disp_receive:
        lda midi_sxstat
        cmp #1
        bne @ld
        ldx #5                      ; a received block was refused: memory protect
@p:     lda ui_s_protec,x
        sta ui_tx,x
        dex
        bpl @p
        lda #$3f
        sta ui_blm
        jmp ui_compose
@ld:    lda #'L'
        sta ui_tx
        lda #'d'
        sta ui_tx+1
        lda midi_sxcount            ; blocks stored since the page opened
        sec
        sbc ui_rxcnt
        ldx #100
        jsr ui_div8
        lda ui_mh
        ldy #4
        jsr ui_tx_2d
        lda #$03
        sta ui_blm
        jmp ui_compose

; ---------------------------------------------------------------- LEDs
; A = LED location (byte index << 3 | bit): on
ui_led_on:
        pha
        lsr
        lsr
        lsr
        tay
        pla
        and #7
        tax
        lda panel_bitmask,x
        ora ui_led,y
        sta ui_led,y
        rts
; A = LED location: blinking
ui_led_blink:
        jsr ui_led_on
        lda panel_bitmask,x
        ora ui_ledb,y
        sta ui_ledb,y
        rts
; A = button code: LED on (if the button has one)
ui_btn_led:
        tax
        lda ui_ledloc,x
        bpl ui_led_on
        rts

ui_render_leds:
        ldx #3
        lda #0
@z:     sta ui_led,x
        sta ui_ledb,x
        dex
        bpl @z
        ldx PERF+PF_OCT_L           ; octave LEDs
        cpx #3
        bcs @o1
        lda ui_octl_loc,x
        jsr ui_led_on
@o1:    ldx PERF+PF_OCT_R
        cpx #3
        bcs @o2
        lda ui_octr_loc,x
        jsr ui_led_on
@o2:    lda ui_st_on
        beq @l1
        lda #LEDL_STORE
        jsr ui_led_blink
@l1:    lda ui_tone
        beq @l2
        lda #LEDL_A440
        jsr ui_led_on
@l2:    lda ui_muted
        beq @l3
        lda #BTN_MUTE
        jsr ui_btn_led
@l3:    ldx ui_mode
        lda ui_ledm_hi,x
        pha
        lda ui_ledm_lo,x
        pha
        rts
ui_ledm_lo: .byte <(ui_leds_play-1), <(ui_leds_edit-1), <(ui_leds_menu-1), <(ui_leds_tune-1), <(ui_leds_confirm-1), <(ui_leds_receive-1), <(ui_leds_seq-1)
ui_ledm_hi: .byte >(ui_leds_play-1), >(ui_leds_edit-1), >(ui_leds_menu-1), >(ui_leds_tune-1), >(ui_leds_confirm-1), >(ui_leds_receive-1), >(ui_leds_seq-1)

ui_leds_tune:
        lda #LEDL_AUTOTUNE
        jmp ui_led_blink
ui_leds_receive:
        lda #LEDL_TAPELOAD
        jmp ui_led_blink
ui_leds_confirm:
        lda #LEDL_STORE
        jsr ui_led_blink
        lda ui_cfm
        bne @r
        lda #LEDL_TAPEDUMP
        jmp ui_led_blink
@r:     rts
ui_leds_menu:
        lda #LEDL_EDIT
        jsr ui_led_blink
        jsr ui_menu_fields
        lda ui_a
        cmp #MK_DISP
        bne @r
        ldx #3
@a:     lda #$ff                    ; display test: every LED steady on
        sta ui_led,x
        lda #0
        sta ui_ledb,x
        dex
        bpl @a
@r:     rts

ui_leds_play:
        ldx PERF+PF_KBMODE
        cpx #3
        bcs @k
        lda ui_kbmode_btn,x
        jsr ui_btn_led
@k:     ldx #0                      ; side-bit flags: [PERF offset, R button, L button]
@f:     stx ui_d
        ldy ui_pflag_tab,x
        lda PERF,y
        sta ui_c
        lsr ui_c
        bcc @fl
        lda ui_pflag_tab+1,x
        jsr ui_btn_led
@fl:    lsr ui_c
        bcc @fn
        ldx ui_d
        lda ui_pflag_tab+2,x
        jsr ui_btn_led
@fn:    ldx ui_d
        inx
        inx
        inx
        cpx #UI_PFLAG_N*3
        bne @f
        lda PERF+PF_ARP_MODE_R      ; arp mode LEDs (0 down, 1 random, 2 up, 3 up/down, 6 as played: UP blinks)
        and #4
        beq @a0
        ldx #BTN_ARP_UP
        lda ui_ledloc,x
        jsr ui_led_blink
        jmp @a3
@a0:    lda PERF+PF_ARP_MODE_R
        cmp #1
        bne @a1
        lda #BTN_ARP_RANDOM
        jsr ui_btn_led
        jmp @a3
@a1:    cmp #0
        beq @a2
        lda #BTN_ARP_UP
        jsr ui_btn_led
        lda PERF+PF_ARP_MODE_R
        cmp #3
        bne @a3
@a2:    lda #BTN_ARP_DOWN
        jsr ui_btn_led
@a3:    lda PERF+PF_ARP_PAUSE
        beq @cp
        lda #BTN_ARP_PAUSE
        jsr ui_btn_led
@cp:    lda ui_cmp
        bmi @r
        lda #LEDL_STORE
        jmp ui_led_blink
@r:     rts

ui_leds_edit:
        lda #LEDL_EDIT
        ldx ui_cmp
        bmi @e
        jsr ui_led_blink
        lda #LEDL_STORE
        jsr ui_led_blink
        jmp @b
@e:     jsr ui_led_on
@b:     lda ui_eside                ; page bindings
        jsr ui_setbuf
        ldx ui_page
        lda ui_pg_btn_lo,x
        sta ui_q
        lda ui_pg_btn_hi,x
        sta ui_q+1
        ldy #0
@l:     sty ui_d
        lda (ui_q),y
        cmp #$ff
        beq @r
        tax
        lda ui_ledloc,x
        bmi @next                   ; no LED on that button
        sta ui_tgt
        ldy ui_d
        iny
        lda (ui_q),y
        sta ui_c                    ; kind
        iny
        lda (ui_q),y
        tax                         ; param
        lda ui_c
        bpl @nsel
        lsr                         ; select: on when the selector has this value
        lsr
        lsr
        and #1
        tay
        lda ui_c
        and #7
        cmp ui_sel,y
        beq @on
        bne @next
@nsel:  and #$40
        beq @par
        jsr ui_pget                 ; field: bit b == onWhen
        sta ui_cur
        lda ui_c
        and #7
        tay
        lda panel_bitmask,y
        and ui_cur
        beq @f0
        lda #$20
@f0:    sta ui_cur
        lda ui_c
        and #$20
        cmp ui_cur
        beq @on
        bne @next
@par:   jsr ui_pget                 ; flag: raw == onWhen
        asl
        asl
        asl
        asl
        asl
        sta ui_cur
        lda ui_c
        and #$20
        cmp ui_cur
        bne @next
@on:    lda ui_tgt
        jsr ui_led_on
@next:  ldy ui_d
        iny
        iny
        iny
        bne @l
@r:     rts

; ---------------------------------------------------------------- compose: text + LEDs -> panel_disp
ui_compose:
        ldx #0                      ; blink phase
        lda ui_blk
        cmp #UI_BLINK_ON
        bcs @ph
        inx
@ph:    stx ui_bon
        ldx #0
@d:     stx ui_d
        lda ui_tx,x
        cmp #'~'
        bne @g
        lda #$80                    ; overline = segment a
        bne @g2
@g:     sec
        sbc #$20
        tay
        lda font,y
@g2:    sta ui_c
        lda panel_bitmask,x
        and ui_dpm
        beq @nd
        lda ui_c
        ora #SEG_DP
        sta ui_c
@nd:    lda ui_c
        sta UD_SEG,x
        lda ui_bon
        bne @put
        lda panel_bitmask,x
        and ui_blm
        beq @nb
        lda #0
        sta ui_c
        beq @put
@nb:    lda panel_bitmask,x
        and ui_dpbm
        beq @put
        lda ui_c
        and #$fe
        sta ui_c
@put:   lda panel_digitPos,x
        tax
        lda ui_c
        cmp panel_disp,x
        beq @same
        sta panel_disp,x
        lda #1
        sta panel_dirty
@same:  ldx ui_d
        inx
        cpx #6
        bne @d
        ldx #3                      ; LEDs
@l:     lda ui_led,x
        sta UD_LED,x
        lda ui_ledb,x
        sta UD_LEDBLINK,x
        ldy ui_bon
        bne @lon
        eor #$ff
        and ui_led,x
        jmp @ls
@lon:   lda ui_led,x
@ls:    ldy ui_led_pos,x
        cpx #3
        bne @lw
        and #$fb                    ; display byte 9 bit 2 = tempo LED, owned by the arp clock (IRQ)
        sta ui_c
        php
        sei
        lda panel_disp+9
        and #$04
        ora ui_c
        cmp panel_disp+9
        beq @l9
        sta panel_disp+9
        lda #1
        sta panel_dirty
@l9:    plp
        jmp @lsame
@lw:    cmp panel_disp,y
        beq @lsame
        sta panel_disp,y
        lda #1
        sta panel_dirty
@lsame: dex
        bpl @l
        ; debug block
        lda ui_mode
        sta UD_MODE
        lda ui_page
        sta UD_PAGE
        lda ui_eside
        sta UD_ESIDE
        lda ui_focus
        sta UD_FOCUS
        lda ui_blm
        sta UD_BLINK
        lda ui_dpm
        sta UD_DP
        lda ui_dpbm
        sta UD_DPBLINK
        lda ui_lastbtn
        sta UD_LASTBTN
        lda ui_st_dest
        sta UD_STDEST
        lda midi_sxcount
        sec
        sbc ui_rxcnt
        sta UD_RXCNT
        lda ui_lt_par
        sta UD_LTPAR
        lda ui_st_kind
        asl
        ora ui_st_side
        sta UD_STORE
        lda ui_ent
        sta UD_ENTRY
        lda ui_sel+1
        asl
        asl
        asl
        asl
        ora ui_sel
        sta UD_SELS
        lda ui_cfm
        sta UD_CFM
        jsr ui_menu_row
        ldy #0
        lda (ui_q),y
        sta UD_ITEM
        lda #0                      ; flags
        jsr ui_edited
        sta ui_c                    ; b0 edited R
        lda #1
        jsr ui_edited
        beq @f1
        lda #$02
        ora ui_c
        sta ui_c
@f1:    lda ui_st_on
        beq @f2
        lda #$04
        ora ui_c
        sta ui_c
@f2:    lda ui_ent
        bmi @f3
        lda #$08
        ora ui_c
        sta ui_c
@f3:    lda ui_cmp
        bmi @f4
        beq @f3r
        lda #$20
        ora ui_c
        sta ui_c
@f3r:   lda #$10
        ora ui_c
        sta ui_c
@f4:    lda ui_tone
        beq @f5
        lda #$40
        ora ui_c
        sta ui_c
@f5:    lda ui_muted
        beq @f6
        lda #$80
        ora ui_c
        sta ui_c
@f6:    lda ui_c
        sta UD_FLAGS
        inc UD_COUNT
        jmp ui_seq_dbg
