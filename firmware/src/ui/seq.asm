; NeoV8 UI - polysequencer page (docs/ux-spec.md §6c, proto.ts seqKey / display / ledStates, contract in
; api.inc "polysequencer"). A440+ARP RIGHT enters, EDIT or ARP RIGHT leaves; A440+ARP PAUSE on the Normal page
; starts/stops. The page writes the switch variables seq_*; the engine (eng/seq.asm) reads them at start/stop.

; Weak links until the engine is linked in (UI-only benches): switch variables and no-op routines.
.ifndef seq_startstop
        .pushseg
        .bss
seq_play:       .res 1
seq_rec:        .res 1
seq_loop:       .res 1
seq_lock:       .res 1
seq_song:       .res 1
seq_reps:       .res 2
seq_inst:       .res 1
seq_metro:      .res 1
seq_metbeat:    .res 1
seq_quant:      .res 1
seq_tempo:      .res 1
seq_clk:        .res 1
seq_extrate:    .res 1
seq_run:        .res 1
seq_mode:       .res 1
seq_free:       .res 2
seq_len:        .res 4
seq_status:     .res 1
        .popseg
seq_startstop:
        lda #2                      ; "nothing selected"
        sta seq_status
        rts
seq_clear:
seq_erase:
seq_tempo_set:
        rts
.endif

; Seq debug block for the simulator / tests (neov8-inspect.ts): $0FE0-$0FE7 and $0FEC-$0FEF (the call log
; uses $0FE8-$0FEB).
SQD_MODE    = $0FE0         ; seq_mode | $80 running
SQD_SW      = $0FE1         ; PLAY bits 0-1, REC bits 2-3, LOOP b4, LOCK b5, SONG b6
SQD_TEMPO   = $0FE2
SQD_QUANT   = $0FE3
SQD_FREE    = $0FE4         ; 2 B
SQD_STATUS  = $0FE6
SQD_FIELD   = $0FE7
SQD_LEN     = $0FEC         ; 2 x 2 B events per channel

SQF_TEMPO   = 0             ; field edited by digits / FWD / REV
SQF_BEAT    = 1
SQF_QUANT   = 2
SQF_SONG    = 3
SQF_CLK     = 4             ; (touch display only)
SQF_RATE    = 5

; ---------------------------------------------------------------- enter / leave
ui_seq_enter:
        lda #UI_SEQ
        sta ui_mode
        lda #SQF_TEMPO
        sta ui_sq_fld
        lda #0
        sta ui_sq_n
        rts

; START/STOP (page and A440+ARP PAUSE on the Normal page): an error is explained on the display
ui_seq_startstop:
        jsr seq_startstop
        lda seq_status
        beq @r
        asl                         ; status 1-5 -> 6-char text
        sta ui_a
        asl
        adc ui_a
        adc #<(ui_s_sqst-6)
        tax
        lda #>(ui_s_sqst-6)
        adc #0
        tay
        lda #1
        jmp ui_flash
@r:     rts

; ---------------------------------------------------------------- keys
ui_seq_key:
        lda ui_code
        jsr ui_isdigit
        bcc @nd
        jmp ui_seq_digit
@nd:    UIDISP ui_seq_tab

ui_seq_tab:
        UIJ BTN_FWD, ui_sq_fwdrev
        UIJ BTN_REV, ui_sq_fwdrev
        UIJ BTN_CALL_R, ui_sq_fld_tempo
        UIJ BTN_CALL_L, ui_sq_fld_beat
        UIJ BTN_OCT_L, ui_sq_fld_quant
        UIJ BTN_SPLIT, ui_sq_fld_song
        UIJ BTN_RELDEF_L, ui_sq_play1
        UIJ BTN_RELDEF_R, ui_sq_play2
        UIJ BTN_PBDEF_L, ui_sq_rec1
        UIJ BTN_PBDEF_R, ui_sq_rec2
        UIJ BTN_HOLD_L, ui_sq_loop
        UIJ BTN_HOLD_R, ui_sq_lock
        UIJ BTN_WHOLE, ui_sq_song
        UIJ BTN_ARP_PAUSE, ui_seq_startstop
        UIJ BTN_ARP_L, ui_sq_clear
        UIJ BTN_ARP_DOWN, ui_sq_inst
        UIJ BTN_ARP_RANDOM, ui_sq_metro
        UIJ BTN_ARP_UP, ui_sq_clk
        UIJ BTN_LAYER, ui_sq_rate
        UIJ BTN_UNI_L, ui_sq_rate
        UIJ BTN_UNI_R, ui_sq_rate
        UIJ BTN_ARP_R, ui_sq_leave
        UIJ BTN_TAPE_DUMP, ui_pk_dump
        UIJ BTN_TAPE_LOAD, ui_pk_load
        UIJ $ff, ui_rts

ui_sq_leave:
        lda #UI_PLAY
        sta ui_mode
        rts

; switch toggles
ui_sq_play1:
        lda #1
        bne ui_sq_play
ui_sq_play2:
        lda #2
ui_sq_play:
        eor seq_play
        sta seq_play
        rts
ui_sq_rec1:
        lda #1
        bne ui_sq_rec
ui_sq_rec2:
        lda #2
ui_sq_rec:
        eor seq_rec
        sta seq_rec
        rts
ui_sq_loop:
        lda seq_loop
        jsr ui_sq_not
        sta seq_loop
        rts
ui_sq_lock:
        lda seq_lock
        jsr ui_sq_not
        sta seq_lock
        rts
ui_sq_song:
        lda seq_song
        jsr ui_sq_not
        sta seq_song
        rts
ui_sq_inst:
        lda seq_inst
        jsr ui_sq_not
        sta seq_inst
        rts
ui_sq_metro:
        lda seq_metro
        jsr ui_sq_not
        sta seq_metro
        rts
; A -> A = 1 when A was 0, else 0
ui_sq_not:
        cmp #1
        lda #0
        rol
        eor #1
        rts

ui_sq_clear:
        lda ui_sh
        beq @c
        lda #2                      ; A440+ARP LEFT: erase the recorded data, after confirmation
        jmp ui_confirm_enter
@c:     jsr seq_clear
        UIFLASH ui_s_clear, 0
        rts

ui_sq_clk:
        ldx seq_clk                 ; internal -> external -> MIDI clock
        inx
        cpx #3
        bcc @s
        ldx #0
@s:     stx seq_clk
        lda #SQF_CLK
        jmp ui_sq_touch

ui_sq_rate:
        lda ui_code                 ; LAYER 96, UNI L 48, UNI R 24 ppqn
        ldx #0
        cmp #BTN_LAYER
        beq @s
        inx
        cmp #BTN_UNI_L
        beq @s
        inx
@s:     stx seq_extrate
        lda #SQF_RATE
        jmp ui_sq_touch

ui_sq_fld_tempo:
        lda #SQF_TEMPO
        beq ui_sq_setfld
ui_sq_fld_beat:
        lda #SQF_BEAT
        bne ui_sq_setfld
ui_sq_fld_quant:
        lda #SQF_QUANT
        bne ui_sq_setfld
ui_sq_fld_song:
        lda #SQF_SONG
ui_sq_setfld:
        sta ui_sq_fld
        ldx #0
        stx ui_sq_n
        jmp ui_sq_touch

; C = 1 while recording (or armed): quantize changes would rearrange the take (Rev4 problem) -> "rEC On"
ui_sq_recq:
        lda seq_run
        beq @n
        lda seq_mode
        and #6
        beq @n
        UIFLASH ui_s_recon, 1
        sec
        rts
@n:     clc
        rts

ui_sq_fwdrev:
        lda #0
        sta ui_sq_n
        ldx ui_sq_fld
        lda ui_code
        cmp #BTN_FWD
        beq @up
        cpx #SQF_TEMPO              ; ---- REV
        bne @d1
        lda seq_tempo
        cmp #21
        bcc @t
        sbc #1
        bcs @tset
@d1:    cpx #SQF_BEAT
        bne @d2
        ldx seq_metbeat
        dex
        bpl @bset
        ldx #2
        bne @bset
@d2:    cpx #SQF_QUANT
        bne @d3
        jsr ui_sq_recq
        bcs @r
        lda seq_quant
        beq @t
        dec seq_quant
        jmp @t
@d3:    lda seq_reps
        cmp #2
        bcc @t
        dec seq_reps
        jmp @t
@up:    cpx #SQF_TEMPO              ; ---- FWD
        bne @u1
        lda seq_tempo
        cmp #251
        bcs @t
        adc #1
@tset:  jsr ui_sq_tempo
        jmp @t
@u1:    cpx #SQF_BEAT
        bne @u2
        ldx seq_metbeat
        inx
        cpx #3
        bcc @bset
        ldx #0
@bset:  stx seq_metbeat
        jmp @t
@u2:    cpx #SQF_QUANT
        bne @u3
        jsr ui_sq_recq
        bcs @r
        lda seq_quant
        cmp #10
        bcs @t
        inc seq_quant
        jmp @t
@u3:    lda seq_reps
        cmp #99
        bcs @t
        inc seq_reps
@t:     lda ui_sq_fld
        jmp ui_sq_touch
@r:     rts

; A = BPM -> tempo (engine timer)
ui_sq_tempo:
        sta seq_tempo
        jmp seq_tempo_set

ui_seq_digit:
        sta ui_d                    ; digit
        ldx ui_sq_fld
        cpx #SQF_BEAT
        bne @n1
        cmp #3                      ; 0 quarter, 1 eighth, 2+ sixteenth
        bcc @b
        lda #2
@b:     sta seq_metbeat
        jmp @done
@n1:    cpx #SQF_QUANT
        bne @n2
        lda #0
        sta ui_sq_n
        jsr ui_sq_recq
        bcs @r
        lda ui_d
        sta seq_quant               ; 0-9 (the table's 10 = 2T is reached with FWD)
        jmp @done
@n2:    ldy ui_sq_n                 ; tempo (3 digits), song (4 digits: repeats ch1, ch2)
        sta ui_sq_dig,y
        iny
        sty ui_sq_n
        cpx #SQF_TEMPO
        bne @song
        cpy #3
        bne @typing
        lda ui_sq_dig               ; d0*100 + d1*10 + d2, clamped 20-251
        cmp #3
        bcs @tmax
        ldx #100
        jsr ui_mul8
        lda ui_sq_dig+1
        ldx #10
        jsr ui_sq_mac
        lda ui_sq_dig+2
        ldx #1
        jsr ui_sq_mac
        lda ui_sq_acc+1
        bne @tmax
        lda ui_sq_acc
        cmp #252
        bcs @tmax
        cmp #20
        bcs @tset
        lda #20
        bne @tset
@tmax:  lda #251
@tset:  jsr ui_sq_tempo
        jmp @done
@song:  cpy #4
        bne @typing
        lda ui_sq_dig
        ldx ui_sq_dig+1
        jsr ui_sq_2d
        sta seq_reps
        lda ui_sq_dig+2
        ldx ui_sq_dig+3
        jsr ui_sq_2d
        sta seq_reps+1
@done:  lda #0
        sta ui_sq_n
@typing: lda ui_sq_fld
        jmp ui_sq_touch
@r:     rts

; A tens, X units -> A = max(1, 10A + X)
ui_sq_2d:
        stx ui_c
        asl
        sta ui_b
        asl
        asl
        adc ui_b
        adc ui_c
        bne @r
        lda #1
@r:     rts

; ui_sq_acc (16-bit) = ui_ml/mh (after ui_mul8) + A * X  (first call: product of ui_mul8 is the start)
ui_sq_mac:
        pha
        lda ui_ml
        sta ui_sq_acc
        lda ui_mh
        sta ui_sq_acc+1
        pla
        jsr ui_mul8
        lda ui_ml
        clc
        adc ui_sq_acc
        sta ui_ml
        sta ui_sq_acc
        lda ui_mh
        adc ui_sq_acc+1
        sta ui_mh
        sta ui_sq_acc+1
        rts

; ---------------------------------------------------------------- pot: ARP SPEED = tempo 20-251
ui_seq_pot:
        cpx #14
        bne @r
        lda ui_pv
        ldx #231
        jsr ui_scale
        clc
        adc #20
        jsr ui_sq_tempo
        lda #SQF_TEMPO
        sta ui_sq_fld
        lda #0
        sta ui_sq_n
        jmp ui_sq_touch
@r:     rts

; ---------------------------------------------------------------- texts
; A = field -> value-on-touch "mn" + value (digits being typed shown with '-')
ui_sq_touch:
        sta ui_d
        jsr ui_tx_blank
        lda ui_d
        asl
        tax
        lda ui_sq_mn,x
        sta ui_tx
        lda ui_sq_mn+1,x
        sta ui_tx+1
        lda ui_sq_n
        beq @val
        ldx #0                      ; typing: tempo "  9-" at +3, song "12--" at +2
        ldy #3
        lda ui_d
        cmp #SQF_SONG
        bne @dl
        ldy #2
@dl:    lda #'-'
        cpx ui_sq_n
        bcs @ds
        lda ui_sq_dig,x
        ora #'0'
@ds:    sta ui_tx,y
        inx
        iny
        cpy #6
        bne @dl
        jmp ui_touch_tx
@val:   jsr ui_sq_value
        jmp ui_touch_tx

; ui_d = field -> value text at ui_tx+2..5
ui_sq_value:
        ldx ui_d
        bne @n0
        lda seq_tempo               ; tempo
@num:   jmp ui_tx_num3
@n0:    dex
        bne @n1
        ldx seq_metbeat             ; beat 4 / 8 / 16
        lda ui_sq_beatv,x
        bne @num
@n1:    dex
        bne @n2
        lda seq_quant               ; quantize name, 3 chars
        cmp #11
        bcc @q
        lda #0
@q:     sta ui_c
        asl
        adc ui_c
        tax
        ldy #3
@ql:    lda ui_sq_qn,x
        sta ui_tx,y
        inx
        iny
        cpy #6
        bne @ql
        rts
@n2:    dex
        bne @n3
        lda seq_reps                ; song repeats "0102"
        ldy #2
        jsr ui_tx_2d
        lda seq_reps+1
        jmp ui_tx_2d
@n3:    dex
        bne @n4
        lda seq_clk                 ; clock In / EH / nI
        asl
        tax
        lda ui_sq_clkn,x
        sta ui_tx+4
        lda ui_sq_clkn+1,x
        sta ui_tx+5
        rts
@n4:    ldx seq_extrate             ; external rate 96 / 48 / 24
        lda ui_sq_ratev,x
        bne @num

ui_sq_mn:       .byte "bPnbqUS1CLrt"
ui_sq_beatv:    .byte 4, 8, 16
ui_sq_ratev:    .byte 96, 48, 24
ui_sq_qn:       .byte " --", " 64", "32t", " 32", "16t", " 16", " 8t", "  8", " 4t", "  4", " 2t"
ui_sq_clkn = ui_mtxt+26               ; "InEHnI" (menu texts)

; ---------------------------------------------------------------- display: mode + tempo (free events while
; recording); the mode blinks while recording waits for the first key
ui_disp_seq:
        jsr ui_sq_mode
        stx ui_tx
        sty ui_tx+1
        lda seq_run
        beq @tempo
        lda seq_mode
        tax
        and #4
        beq @nw
        lda #$03
        sta ui_blm
        bne @tempo
@nw:    txa
        and #2
        beq @tempo
        lda seq_free                ; free events, 4 digits right aligned (up to 1700)
        sta ui_ml
        lda seq_free+1
        sta ui_mh
        ldx #100
        jsr ui_div16
        sta ui_d                    ; hundreds
        lda ui_mh
        ldx ui_d
        bne @big
        jsr ui_tx_num3
        jmp ui_compose
@big:   pha
        txa
        jsr ui_dec3
        ldy #3
        ora #'0'
        sta ui_tx,y
        lda ui_b
        beq @lo
        ora #'0'
        sta ui_tx+2
@lo:    pla
        ldy #4
        jsr ui_tx_2d
        jmp ui_compose
@tempo: lda seq_tempo
        jsr ui_tx_num3
        jmp ui_compose

; -> X/Y = the 2 mode characters (-- rE Od Sn PL)
ui_sq_mode:
        lda seq_run
        beq @stop
        lda seq_mode
        ldx #2                      ; rE
        bit ui_sq_b4
        bne @m
        and #3
        cmp #3
        bne @n1
        ldx #4                      ; Od
        bne @m
@n1:    cmp #2
        beq @m
        ldx #6                      ; Sn
        lda seq_mode
        and #8
        bne @m
        ldx #8                      ; PL
        bne @m
@stop:  ldx #0
@m:     lda ui_sq_modes+1,x
        tay
        lda ui_sq_modes,x
        tax
        rts
ui_sq_b4:       .byte 4
ui_sq_modes:    .byte "--rEOdSnPL"

; ---------------------------------------------------------------- LEDs
.macro SQLED var, btn
        lda var
        beq :+
        lda #btn
        jsr ui_btn_led
:
.endmacro
ui_leds_seq:
        lda #LEDL_EDIT
        jsr ui_led_on
        lda seq_play
        ldx #BTN_RELDEF_L
        ldy #BTN_RELDEF_R
        jsr @pair
        lda seq_rec
        ldx #BTN_PBDEF_L
        ldy #BTN_PBDEF_R
        jsr @pair
        SQLED seq_loop, BTN_HOLD_L
        SQLED seq_lock, BTN_HOLD_R
        SQLED seq_song, BTN_WHOLE
        SQLED seq_inst, BTN_ARP_DOWN
        SQLED seq_metro, BTN_ARP_RANDOM
        lda seq_clk
        beq @p
        lda #BTN_ARP_UP
        jsr ui_btn_led
        lda seq_clk
        cmp #1
        bne @p
        ldx seq_extrate             ; external clock: the rate button
        lda ui_sq_ratebtn,x
        jsr ui_btn_led
@p:     lda seq_run
        beq @r
        lda seq_mode
        and #4
        bne @bl
        lda #BTN_ARP_PAUSE
        jmp ui_btn_led
@bl:    ldx #BTN_ARP_PAUSE          ; waiting for the first key
        lda ui_ledloc,x
        jmp ui_led_blink
@r:     rts
@pair:  stx ui_c                    ; A = bits (bit0 LEFT button X, bit1 RIGHT button Y)
        sty ui_d
        sta ui_b
        lsr ui_b
        bcc @p2
        lda ui_c
        jsr ui_btn_led
@p2:    lsr ui_b
        bcc @pr
        lda ui_d
        jmp ui_btn_led
@pr:    rts

ui_sq_ratebtn:  .byte BTN_LAYER, BTN_UNI_L, BTN_UNI_R

; ---------------------------------------------------------------- debug block (every render)
ui_seq_dbg:
        lda seq_mode
        ldx seq_run
        beq @m
        ora #$80
@m:     sta SQD_MODE
        lda seq_rec
        asl
        asl
        ora seq_play
        ldx seq_loop
        beq @l
        ora #$10
@l:     ldx seq_lock
        beq @k
        ora #$20
@k:     ldx seq_song
        beq @s
        ora #$40
@s:     sta SQD_SW
        lda seq_tempo
        sta SQD_TEMPO
        lda seq_quant
        sta SQD_QUANT
        lda seq_free
        sta SQD_FREE
        lda seq_free+1
        sta SQD_FREE+1
        lda seq_status
        sta SQD_STATUS
        lda ui_sq_fld
        sta SQD_FIELD
        ldx #3
@n:     lda seq_len,x
        sta SQD_LEN,x
        dex
        bpl @n
        rts
