; NeoV8 UI - PLAY layer (Normal page): recall, performance buttons, trimmers. proto.ts playKey / onPot.

ui_play_key:
        lda ui_code
        jsr ui_isdigit
        bcc @nd
        jmp ui_play_digit
@nd:    UIDISP ui_play_tab

ui_play_tab:
        UIJ BTN_CALL_L, ui_pk_call
        UIJ BTN_CALL_R, ui_pk_call
        UIJ BTN_STEP_ENABLE, ui_pk_stepen
        UIJ BTN_STEP_LOAD, ui_pk_stepld
        UIJ BTN_FWD, ui_pk_fwdrev
        UIJ BTN_REV, ui_pk_fwdrev
        UIJ BTN_STORE, ui_pk_store
        UIJ BTN_WHOLE, ui_pk_whole
        UIJ BTN_LAYER, ui_pk_layer
        UIJ BTN_SPLIT, ui_pk_split
        UIJ BTN_UNI_L, ui_pk_uni
        UIJ BTN_UNI_R, ui_pk_uni
        UIJ BTN_OCT_L, ui_pk_oct
        UIJ BTN_OCT_R, ui_pk_oct
        UIJ BTN_HOLD_L, ui_pk_hold
        UIJ BTN_HOLD_R, ui_pk_hold
        UIJ BTN_RELDEF_L, ui_pk_reldef
        UIJ BTN_RELDEF_R, ui_pk_reldef
        UIJ BTN_PBDEF_L, ui_pk_pbdef
        UIJ BTN_PBDEF_R, ui_pk_pbdef
        UIJ BTN_ARP_UP, ui_pk_arpup
        UIJ BTN_ARP_DOWN, ui_pk_arpdown
        UIJ BTN_ARP_RANDOM, ui_pk_arprnd
        UIJ BTN_ARP_L, ui_pk_arpl
        UIJ BTN_ARP_R, ui_pk_arpr
        UIJ BTN_ARP_PAUSE, ui_pk_pause
        UIJ BTN_MUTE, ui_pk_mute
        UIJ BTN_AUTOTUNE, ui_pk_tune
        UIJ BTN_TAPE_DUMP, ui_pk_dump
        UIJ BTN_TAPE_LOAD, ui_pk_load
        UIJ $ff, ui_rts

; C=1 when ui_code is the LEFT button of a L/R pair
ui_code_left:
        ldx #(ui_left_codes_end-ui_left_codes-1)
        lda ui_code
@l:     cmp ui_left_codes,x
        beq @y
        dex
        bpl @l
        clc
        rts
@y:     sec
        rts

ui_pk_call:
        jsr ui_code_left
        lda #0
        rol
        tax                         ; side
        lda ui_sh
        beq @f
        jmp ui_init_prog            ; A440+CALL: null program into that edit buffer
@f:     stx ui_focus
        txa
; A = target (0 R, 1 L, 2 S, 3 menu): start a 2-digit entry
ui_entry_start:
        sta ui_ent
        lda #0
        sta ui_ent_n
ui_entry_timer:
        lda #<UI_T_ENTRY
        ldx #>UI_T_ENTRY
        ldy #UI_TM_ENT
        jmp ui_timer_set

; X = side: load the null program into the edit buffer, "InIt L" / "InIt r"
ui_init_prog:
        txa
        pha
        jsr ui_setbuf
        ldy #PROG_SIZE-1
@c:     lda ui_null_prog,y
        sta (ui_buf),y
        dey
        bpl @c
        jsr ui_tx_blank
        ldy #3
@t:     lda ui_s_init,y
        sta ui_tx,y
        dey
        bpl @t
        pla
        tax
        lda ui_side_ch,x
        sta ui_tx+5
        lda #0
        jsr ui_flash_tx
        lda ui_bside
        tax
        jmp ui_apply_prog

ui_pk_stepen:
        lda ui_sh
        beq @f
        lda #50                     ; Rev4 chord: Alternate page -> menu 50
        jmp ui_menu_enter
@f:     lda #2
        sta ui_focus
        jmp ui_entry_start

ui_pk_stepld:
        lda ui_sh
        beq @f
        UIFLASH ui_s_reset, 1       ; Rev4 "reset" chord: not implemented (as the prototype)
        rts
@f:     lda #1
        ldx #0
        jmp ui_store_start

ui_pk_fwdrev:
        lda #$ff
        sta ui_ent
        jsr ui_fwdrev_delta         ; A = +1 / 99
        ldx ui_focus
        cpx #2
        bne @p
        clc
        adc PERF+PF_STEP
        bcc @m                      ; always (A < 200)
@p:     clc
        adc PERF+PF_PROG_R,x
@m:     jsr ui_mod100
        jmp ui_recall_tx

; A = 1 for FWD, 99 for REV (add then mod 100)
ui_fwdrev_delta:
        lda ui_code
        cmp #BTN_FWD
        beq @f
        lda #99
        rts
@f:     lda #1
        rts

; A (0-198) -> A mod 100
ui_mod100:
        cmp #100
        bcc @r
        sbc #100
@r:     rts

ui_pk_store:
        ldx ui_focus
        lda ui_sh
        beq @s
        cpx #1
        beq @c
        ldx #0
@c:     jmp ui_compare_or_undo
@s:     lda #0
        cpx #2
        bne @p
        lda #1
        ldx #0
@p:     jmp ui_store_start

ui_pk_whole:
        lda #0
        beq ui_set_kb
ui_pk_layer:
        lda #0
        sta PERF+PF_UNISON
        lda #2
ui_set_kb:
        sta PERF+PF_KBMODE
        jmp ui_apply_perf

; SPLIT: keyboard split; the lowest held key (stock: hold a key, press SPLIT) becomes the split point
ui_pk_split:
        lda #1
        sta PERF+PF_KBMODE
        jsr eng_lowest_held
        cmp #$80
        bcs @r
        sta PERF+PF_SPLIT
        jsr ui_split_msg
@r:     jmp ui_apply_perf

; "SP  C3" message for the split point in PERF (sharp = decimal point)
ui_split_msg:
        jsr ui_tx_blank
        lda #'S'
        sta ui_tx
        lda #'P'
        sta ui_tx+1
        lda PERF+PF_SPLIT
        ldx #12
        jsr ui_div8                 ; A = octave + 1, ui_mh = note in octave
        sec
        sbc #1
        bcs @o
        lda #'-'
        bne @st
@o:     cmp #10
        bcc @o2
        sbc #10
@o2:    ora #'0'
@st:    sta ui_tx+5
        ldx ui_mh
        lda ui_note_ch,x
        sta ui_tx+4
        lda ui_note_sharp,x
        tax                         ; DP on digit 4 when sharp
        lda #0
        jmp ui_flash_txdp

ui_pk_uni:
        lda PERF+PF_KBMODE
        cmp #2
        beq @r                      ; no unison in LAYER
        lda #PF_UNISON
        jmp ui_toggle_side
@r:     rts

; A = PERF offset of a side-bit byte: toggle the bit of the pressed button's side, apply
ui_toggle_side:
        pha
        jsr ui_code_left
        lda #1
        bcc @r
        asl
@r:     sta ui_a
        pla
        tax
        lda PERF,x
        eor ui_a
        sta PERF,x
        jmp ui_apply_perf

ui_pk_hold:
        lda #PF_HOLD
        jmp ui_toggle_side
ui_pk_reldef:
        lda #PF_RELDEF
        jmp ui_toggle_side
ui_pk_pbdef:
        lda #PF_PBDEF
        jmp ui_toggle_side

ui_pk_oct:
        jsr ui_code_left
        lda #0
        rol
        tax                         ; side
        lda ui_sh
        beq @oct
        lda PERF+PF_ARP_OCT_R,x     ; A440+OCTAVE: arp octave range 1-4
        cmp #4
        bcc @i
        lda #0
@i:     clc
        adc #1
        sta PERF+PF_ARP_OCT_R,x
        pha
        jsr ui_tx_blank
        lda #'A'
        sta ui_tx
        lda #'o'
        sta ui_tx+1
        lda ui_side_ch,x
        sta ui_tx+4
        pla
        ora #'0'
        sta ui_tx+5
        lda #0
        jsr ui_flash_tx
        jmp ui_apply_perf
@oct:   lda PERF+PF_OCT_R,x         ; normal -> up -> down -> normal (1 -> 2 -> 0 -> 1)
        clc
        adc #1
        cmp #3
        bcc @s
        lda #0
@s:     sta PERF+PF_OCT_R,x
        jmp ui_apply_perf

; arpeggiator mode (stock encoding 0 down, 1 random, 2 up, 3 up/down), set for both sides
ui_pk_arpup:
        ldx #2
        lda PERF+PF_ARP_MODE_R
        bne ui_set_arpmode          ; was not DOWN
        ldx #3
        bne ui_set_arpmode
ui_pk_arpdown:
        lda ui_sh
        beq @f
        lda #10                     ; Rev4 chord: MIDI page -> menu 10
        jmp ui_menu_enter
@f:     ldx #0
        lda PERF+PF_ARP_MODE_R
        cmp #2
        bne ui_set_arpmode
        ldx #3
        bne ui_set_arpmode
ui_pk_arprnd:
        lda ui_sh
        beq @f
        lda #40                     ; Rev4 chord: Set page -> menu 40
        jmp ui_menu_enter
@f:     ldx #1
ui_set_arpmode:
        stx PERF+PF_ARP_MODE_R
        stx PERF+PF_ARP_MODE_L
        jmp ui_apply_perf

ui_pk_arpl:
        lda #PF_ARP_ON
        jmp ui_toggle_side
ui_pk_arpr:
        lda ui_sh
        beq @f
        jmp ui_seq_enter            ; A440+ARP RIGHT: sequencer page
@f:     lda #PF_ARP_ON
        jmp ui_toggle_side

ui_pk_pause:
        lda ui_sh
        beq @f
        jmp ui_seq_startstop        ; A440+ARP PAUSE: sequencer START/STOP from the Normal page
@f:     lda PERF+PF_ARP_PAUSE
        eor #1
        sta PERF+PF_ARP_PAUSE
        jmp ui_apply_perf

ui_pk_mute:
        lda ui_sh
        beq @f
        lda #21                     ; Rev4 chord: velocity pages -> menu 21
        jmp ui_menu_enter
@f:     lda ui_muted
        eor #1
        sta ui_muted
        jmp eng_mute

ui_pk_tune:
        lda ui_sh
        beq @t
        jmp ui_tone_toggle
@t:     lda #UI_TUNE
        jsr ui_push_mode
        jsr ui_render               ; "tU" + AUTO TUNE LED while tune_run (blocking) works
        jsr panel_flush
        jsr autotune                ; core: tune_run, MIDI input flush, eng_all_off
        jsr ui_now
        jsr ui_pop_mode
        lda #1
        sta ui_tuned
        lda CAL_FAILED
        bne @fail
        UIFLASH ui_s_tuneok, 0
        rts
@fail:  ldx #0                      ; first disabled voice: "tU  E3"
@v:     lsr
        bcs @f2
        inx
        bne @v
@f2:    jsr ui_tx_blank
        lda #'t'
        sta ui_tx
        lda #'U'
        sta ui_tx+1
        lda #'E'
        sta ui_tx+4
        txa
        clc
        adc #'1'
        sta ui_tx+5
        lda #1
        jmp ui_flash_tx

ui_pk_dump:
        lda #0
; A = 0 SysEx dump, 1 undo
ui_confirm_enter:
        sta ui_cfm
        lda #UI_CONFIRM
        jmp ui_push_mode

; TAPE LOAD = SYSEX RECEIVE: accept dumps (also NeoV8's own, sent without the controller flag), count them
ui_pk_load:
        lda #UI_RECEIVE
        jsr ui_push_mode
        lda midi_sxcount
        sta ui_rxcnt                ; count shown = midi_sxcount - this
        lda #0
        sta midi_sxstat
        lda #1
        sta midi_rxall
        rts

ui_receive_key:
        lda ui_code
        cmp #BTN_TAPE_LOAD
        bne ui_rts2
        jsr ui_pop_mode
ui_receive_off:
        lda ui_mode
        cmp #UI_RECEIVE
        beq ui_rts2
        lda #0
        sta midi_rxall
ui_rts2:
        rts

; digits on the Normal page: 2 digits recall a program (or step) on the focus, CALL not needed again
ui_play_digit:
        sta ui_d
        lda ui_ent
        bpl @e
        lda ui_focus
        jsr ui_entry_start
@e:     jsr ui_entry_timer
        lda ui_ent_n
        bne @two
        inc ui_ent_n
        lda ui_d
        sta ui_ent_d
        rts
@two:   lda ui_ent_d
        ldx #10
        jsr ui_mul8
        lda ui_ml
        clc
        adc ui_d
        ldx ui_ent
        ldy #$ff
        sty ui_ent
        jmp ui_recall_tx

; ---------------------------------------------------------------- pots on the Normal page
ui_play_pot:
        ldx ui_pi
        cpx #14
        bne @trim
        lda ui_pv                   ; ARP SPEED
        sta PERF+PF_ARP_SPEED
        jsr ui_tx_blank
        lda #'A'
        sta ui_tx
        lda #'S'
        sta ui_tx+1
        lda NV_GLOBALS+G_ARPCLK
        cmp #2
        beq @div
        lda ui_pv
        jsr ui_tx_num3
@as:    jsr ui_touch_tx
        jmp ui_apply_perf
@div:   lda ui_pv                   ; MIDI clock: ARP SPEED picks the division (speed >> 4)
        lsr
        lsr
        lsr
        lsr
        asl
        asl
        tay
        ldx #0
@dv:    lda ui_s_div,y
        sta ui_tx+2,x
        iny
        inx
        cpx #4
        bne @dv
        beq @as
@trim:  txa
        and #1
        sta ui_d                    ; side (even index = RIGHT)
        txa
        lsr
        tay                         ; knob 0-6: Fc, glide, LFO, A, R, detune, vol
        lda NV_GLOBALS+G_TRIMMODE
        bne @direct
        ; Trim: signed offset in the step, stock order A, R, Fc, Glide, LFO, Detune, Volume
        lda ui_trim_slot,y
        ldx ui_d
        beq @tr
        clc
        adc #7
@tr:    tax
        lda ui_pv
        sec
        sbc #64
        sta PERF+PF_TRIM_R,x
        sta ui_c
        sty ui_b
        jsr ui_tx_blank
        ldy ui_b
        lda ui_trim_mn0,y
        sta ui_tx
        lda ui_trim_mn1,y
        sta ui_tx+1
        lda ui_c                    ; "+12" / "-64" / "0", right aligned
        beq @z
        bpl @pos
        eor #$ff
        clc
        adc #1
        ldx #'-'
        bne @abs
@pos:   ldx #'+'
@abs:   stx ui_c                    ; sign char
        jsr ui_dec3
        ora #'0'
        sta ui_tx+5
        ldy #4
        lda ui_b
        beq @sg
        ora #'0'
        sta ui_tx+4
        dey
@sg:    lda ui_c
        sta ui_tx,y
        jmp @show
@z:     lda #'0'
        sta ui_tx+5
@show:  jsr ui_touch_tx
        jmp ui_apply_perf
@direct: ; Direct: the trimmer edits the program parameter(s) with the pot mode (pickup/jump/relative)
        tya
        pha                         ; knob
        lda ui_d
        jsr ui_setbuf
        lda #0
        sta ui_pm
        pla
        pha
        tay
        lda ui_direct_p1,y
        sta ui_pp
        lda ui_pi
        sta ui_ck
        jsr ui_apply_pot
        pla
        tay
        lda ui_direct_p2,y
        bmi @dd
        sta ui_pp
        lda ui_pi
        ora #16
        sta ui_ck
        jsr ui_apply_pot
@dd:    ldx ui_bside
        jmp ui_apply_prog
