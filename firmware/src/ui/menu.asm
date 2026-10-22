; NeoV8 UI - SYSTEM menu (A440+EDIT): numbered items, LEFT = number, RIGHT = mnemonic, STEP = value.
; Items and texts follow sim/src/proto/menu.ts. Globals live in battery RAM (NV_GLOBALS), footswitch
; settings in the stock-compatible records BRAM_FSW (read by the core, fsw.asm), step items in PERF.

MK_RANGE    = 0             ; p1 lo, p2 hi, p3 bias: stored = value - bias
MK_BIT      = 1             ; p1 mask, p2 text pair, p3 invert
MK_CHOICE   = 2             ; p1 count, p2 first text: stored = index
MK_FSW      = 3             ; footswitch function code 0-98, 99 = none ($FF)
MK_VOICES   = 4
MK_RESET    = 5
MK_BTN      = 6
MK_POT      = 7
MK_DISP     = 8
MK_MIDI     = 9
MK_TUNE     = 10
MK_NOTYET   = 11
UI_MROW     = 9

.macro MITEM num, mn, kind, addr, p1, p2, p3
        .byte num
        .byte mn
        .byte kind
        .word addr
        .byte p1, p2, p3
.endmacro

ui_menu_tab:
        MITEM 10, "cL", MK_RANGE, NV_GLOBALS+G_MIDI_CH_L, 1, 16, 1
        MITEM 11, "cr", MK_RANGE, NV_GLOBALS+G_MIDI_CH_R, 1, 16, 1
        MITEM 12, "oL", MK_BIT, NV_GLOBALS+G_OMNI, 2, 0, 0
        MITEM 13, "or", MK_BIT, NV_GLOBALS+G_OMNI, 1, 0, 0
        MITEM 14, "rn", MK_BIT, NV_GLOBALS+G_RX, 1, 0, 0
        MITEM 15, "rP", MK_BIT, NV_GLOBALS+G_RX, 2, 0, 0
        MITEM 16, "rS", MK_BIT, NV_GLOBALS+G_RX, 8, 0, 0
        MITEM 17, "tn", MK_BIT, NV_GLOBALS+G_TX, 1, 0, 0
        MITEM 18, "tP", MK_BIT, NV_GLOBALS+G_TX, 2, 0, 0
        MITEM 19, "PC", MK_CHOICE, NV_GLOBALS+G_PC_TARGET, 2, 4, 0
        MITEM 20, "Lo", MK_BIT, NV_GLOBALS+G_LOCAL, 1, 0, 0
        MITEM 21, "tA", MK_NOTYET, 0, 0, 0, 0
        MITEM 22, "SP", MK_RANGE, PERF+PF_SPLIT, 36, 96, 0
        MITEM 23, "rC", MK_BIT, NV_GLOBALS+G_RX, 4, 0, 0
        MITEM 24, "tC", MK_BIT, NV_GLOBALS+G_TX, 4, 0, 0
        MITEM 30, "Pn", MK_CHOICE, NV_GLOBALS+G_POTMODE, 3, 6, 0
        MITEM 31, "tr", MK_CHOICE, NV_GLOBALS+G_TRIMMODE, 2, 9, 0
        MITEM 32, "dh", MK_RANGE, NV_GLOBALS+G_DISPHOLD, 5, 30, 0
        MITEM 33, "PS", MK_CHOICE, NV_GLOBALS+G_POWERON, 2, 11, 0
        MITEM 40, "F0", MK_FSW, BRAM_FSW+1, 0, 0, 0
        MITEM 41, "F1", MK_FSW, BRAM_FSW+4, 0, 0, 0
        MITEM 42, "F2", MK_FSW, BRAM_FSW+7, 0, 0, 0
        MITEM 43, "F3", MK_FSW, BRAM_FSW+10, 0, 0, 0
        MITEM 44, "t0", MK_BIT, BRAM_FSW+0, $80, 2, 1
        MITEM 45, "t1", MK_BIT, BRAM_FSW+3, $80, 2, 1
        MITEM 46, "t2", MK_BIT, BRAM_FSW+6, $80, 2, 1
        MITEM 47, "t3", MK_BIT, BRAM_FSW+9, $80, 2, 1
        MITEM 50, "AC", MK_CHOICE, NV_GLOBALS+G_ARPCLK, 3, 13, 0
        MITEM 51, "AL", MK_RANGE, PERF+PF_ARP_OCT_L, 1, 4, 0
        MITEM 52, "Ar", MK_RANGE, PERF+PF_ARP_OCT_R, 1, 4, 0
        MITEM 60, "SL", MK_RANGE, PERF+PF_ASSIGN_L, 0, 3, 0
        MITEM 61, "Sr", MK_RANGE, PERF+PF_ASSIGN_R, 0, 3, 0
        MITEM 62, "St", MK_CHOICE, NV_GLOBALS+G_STEAL, 2, 16, 0
        MITEM 63, "ud", MK_RANGE, NV_GLOBALS+G_UNIDETUNE, 0, 15, 0
        MITEM 90, "Ud", MK_VOICES, PERF+PF_VOICEMASK, 0, 0, 0
        MITEM 91, "bt", MK_BTN, 0, 0, 0, 0
        MITEM 92, "Pt", MK_POT, 0, 0, 0, 0
        MITEM 93, "dt", MK_DISP, 0, 0, 0, 0
        MITEM 94, "nn", MK_MIDI, 0, 0, 0, 0
        MITEM 95, "tu", MK_TUNE, 0, 0, 0, 0
        MITEM 99, "rG", MK_RESET, 0, 0, 0, 0
ui_menu_end:
UI_MENU_N = (ui_menu_end - ui_menu_tab) / UI_MROW

; value texts, 2 chars each
ui_mtxt:    .byte "oFOnnotoPrSPPUJPrLtrdILA00InEHnIodno"

; A = item number -> enter that item (menu mode), C=0. Unknown number: C=1, nothing changes.
ui_menu_enter:
        sta ui_d
        lda ui_item
        pha
        ldx #0
@f:     stx ui_item
        jsr ui_menu_row
        ldy #0
        lda (ui_q),y
        cmp ui_d
        beq @hit
        ldx ui_item
        inx
        cpx #UI_MENU_N
        bcc @f
        pla
        sta ui_item
        sec
        rts
@hit:   pla
        jsr ui_menu_go
        clc
        rts
; X = row index
ui_menu_goidx:
        stx ui_item
ui_menu_go:
        lda ui_mode
        cmp #UI_MENU
        beq @in
        lda #UI_MENU
        jsr ui_push_mode
@in:    lda #$ff
        sta ui_ent
        lda #0
        sta ui_rst
        rts

; ui_item -> ui_q = row. X preserved? no.
ui_menu_row:
        lda ui_item
        ldx #UI_MROW
        jsr ui_mul8
        lda ui_ml
        clc
        adc #<ui_menu_tab
        sta ui_q
        lda ui_mh
        adc #>ui_menu_tab
        sta ui_q+1
        rts

; row fields -> ui_a kind, ui_p address, ui_b p1, ui_c p2, ui_d p3
ui_menu_fields:
        jsr ui_menu_row
        ldy #3
        lda (ui_q),y
        sta ui_a
        iny
        lda (ui_q),y
        sta ui_p
        iny
        lda (ui_q),y
        sta ui_p+1
        iny
        lda (ui_q),y
        sta ui_b
        iny
        lda (ui_q),y
        sta ui_c
        iny
        lda (ui_q),y
        sta ui_d
        rts

; -> A = number of values (1 = not editable)
ui_menu_count:
        jsr ui_menu_fields
        lda ui_a
        bne @n0
        lda ui_c                    ; range: hi - lo + 1
        sec
        sbc ui_b
        clc
        adc #1
        rts
@n0:    cmp #MK_BIT
        bne @n1
        lda #2
        rts
@n1:    cmp #MK_CHOICE
        bne @n2
        lda ui_b
        rts
@n2:    cmp #MK_FSW
        bne @n3
        lda #100
        rts
@n3:    lda #1
        rts

; -> A = current value index (clamped)
ui_menu_get:
        jsr ui_menu_count
        sta ui_ml                   ; count
        ldy #0
        lda (ui_p),y
        ldx ui_a
        bne @g1
        clc                         ; range: stored + bias - lo
        adc ui_d
        sec
        sbc ui_b
        bcs @clamp
        lda #0
        rts
@g1:    cpx #MK_BIT
        bne @g2
        and ui_b
        beq @b0
        lda #1
@b0:    eor ui_d
        rts
@g2:    cpx #MK_FSW
        bne @clamp
        cmp #99
        bcc @r
        lda #99
@r:     rts
@clamp: cmp ui_ml
        bcc @r
        ldx ui_ml
        dex
        txa
        rts

; A = value index -> store it
ui_menu_set:
        pha
        jsr ui_menu_fields
        pla
        ldx ui_a
        bne @s1
        clc                         ; range: index + lo - bias
        adc ui_b
        sec
        sbc ui_d
        jmp @st
@s1:    cpx #MK_BIT
        bne @s2
        eor ui_d
        tax
        ldy #0
        lda ui_b
        eor #$ff
        and (ui_p),y
        cpx #0
        beq @st
        ora ui_b
        jmp @st
@s2:    cpx #MK_FSW
        bne @st
        cmp #99
        bcc @st
        lda #$ff
@st:    ldy #0
        sta (ui_p),y
        lda ui_p+1
        cmp #>PERF
        bne @r
        jmp ui_apply_perf
@r:     rts

; A = +1 / -1 (A440+FWD/REV): change the value, clamped
ui_menu_step:
        sta ui_tgt
        jsr ui_menu_fields
        lda ui_a
        cmp #MK_RESET
        bne @n
        lda ui_rst
        eor #1
        sta ui_rst
        rts
@n:     jsr ui_menu_count
        cmp #2
        bcc @r
        sta ui_cur
        jsr ui_menu_get
        clc
        adc ui_tgt
        bmi @r                      ; below 0
        cmp ui_cur
        bcs @r                      ; above count-1
        jmp ui_menu_set
@r:     rts

; ARP SPEED pot (ui_pv) is the data-entry knob
ui_menu_pot:
        jsr ui_menu_fields
        lda ui_a
        cmp #MK_RESET
        bne @n
        ldx #0
        lda ui_pv
        cmp #64
        bcc @s
        inx
@s:     stx ui_rst
        rts
@n:     jsr ui_menu_count
        cmp #2
        bcc @r
        tax
        dex
        lda ui_pv
        jsr ui_scale
        jmp ui_menu_set
@r:     rts

ui_menu_key:
        jsr ui_menu_fields
        lda ui_code
        jsr ui_isdigit
        bcs @dig
        jmp @nd
@dig:   sta ui_tgt
        lda ui_a
        cmp #MK_VOICES
        bne @ent
        lda ui_ent
        bpl @ent
        ldx ui_tgt                  ; menu 90: keys 0-7 toggle a voice
        cpx #8
        bcs @r
        lda panel_bitmask,x
        eor PERF+PF_VOICEMASK
        sta PERF+PF_VOICEMASK
        and panel_bitmask,x
        sta ui_cur
        lda #'9'
        sta ui_tx
        lda #'0'
        sta ui_tx+1
        lda #'U'
        sta ui_tx+2
        txa
        ora #'0'
        sta ui_tx+3
        ldx #'O'                    ; "On" / "oF"
        ldy #'n'
        lda ui_cur
        beq @on
        ldx #'o'
        ldy #'F'
@on:    stx ui_tx+4
        sty ui_tx+5
        lda #0
        jsr ui_flash_tx
        jmp ui_apply_perf
@ent:   lda ui_ent                  ; 2 digits jump to an item
        bpl @e2
        lda #3
        jsr ui_entry_start
        jmp @e3
@e2:    jsr ui_entry_timer
@e3:    lda ui_ent_n
        bne @two
        inc ui_ent_n
        lda ui_tgt
        sta ui_ent_d
@r:     rts
@two:   lda #$ff
        sta ui_ent
        lda ui_ent_d
        ldx #10
        jsr ui_mul8
        lda ui_ml
        clc
        adc ui_tgt
        sta ui_cur
        jsr ui_menu_enter
        bcc @r
        jsr ui_tx_blank             ; "nn  --"
        lda ui_cur
        ldy #0
        jsr ui_tx_2d
        lda #'-'
        sta ui_tx+4
        sta ui_tx+5
        lda #0
        jmp ui_flash_tx
@nd:    lda ui_code
        cmp #BTN_FWD
        beq @fr
        cmp #BTN_REV
        bne @ns
@fr:    lda ui_sh
        beq @walk
        lda ui_code
        cmp #BTN_FWD
        beq @p1
        lda #$ff
        jmp ui_menu_step
@p1:    lda #1
        jmp ui_menu_step
@walk:  ldx ui_item
        lda ui_code
        cmp #BTN_FWD
        beq @nx
        dex
        bpl @go
        ldx #UI_MENU_N-1
        bne @go
@nx:    inx
        cpx #UI_MENU_N
        bcc @go
        ldx #0
@go:    jmp ui_menu_goidx
@ns:    cmp #BTN_STORE
        bne @r2
        lda ui_a
        cmp #MK_RESET
        bne @r2
        lda ui_rst
        bne @reset
        UIFLASH ui_s_rgno, 0
@r2:    rts
@reset: lda #0
        sta ui_rst
        jsr ui_globals_defaults
        UIFLASH ui_s_reset2, 0
        rts

; menu value text -> ui_tx+4, +5 (row fields loaded)
ui_menu_valtxt:
        jsr ui_menu_fields
        lda ui_a
        cmp #MK_VOICES
        bne @v1
        lda PERF+PF_VOICEMASK       ; enabled voices = 8 - popcount
        ldx #8
@pc:    asl
        bcc @pz
        dex
@pz:    cmp #0
        bne @pc
        txa
        jmp @two
@v1:    cmp #MK_RESET
        bne @v2
        ldx #'n'
        ldy #'o'
        lda ui_rst
        beq @xy
        ldx #'Y'
        ldy #'E'
        bne @xy
@v2:    cmp #MK_BTN
        bne @v3
        lda ui_lastbtn
        jmp @two
@v3:    cmp #MK_POT
        bne @v4
        lda ui_lastpot
        jmp @hex
@v4:    cmp #MK_MIDI
        bne @v5
        lda midi_mon                ; last channel status received
        beq @dash
        jmp @hex
@v5:    cmp #MK_TUNE
        bne @v6
        lda ui_tuned
        beq @dash
        ldx #'o'
        ldy #'K'
        lda CAL_FAILED
        beq @xy
        ldx #'E'
        ldy #'r'
        bne @xy
@v6:    cmp #MK_NOTYET+1
        bcs @dash
        cmp #MK_VOICES
        bcs @dash                   ; disp / notyet
        jsr ui_menu_get
        sta ui_cur
        lda ui_a
        cmp #MK_BIT
        beq @text
        cmp #MK_CHOICE
        beq @text
        lda ui_cur
        ldx ui_a
        bne @two                    ; FSW: index
        clc                         ; range: index + lo, mod 100
        adc ui_b
        jsr ui_mod100
@two:   ldy #4
        jmp ui_tx_2d
@hex:   ldy #4
        jmp ui_tx_hex
@text:  lda ui_cur
        clc
        adc ui_c
        asl
        tax
        lda ui_mtxt,x
        ldy ui_mtxt+1,x
        tax
@xy:    stx ui_tx+4
        sty ui_tx+5
        rts
@dash:  ldx #'-'
        ldy #'-'
        bne @xy

; NeoV8 globals defaults (menu 99, first boot). G_LAST_STEP and the voice mask (PERF) are kept,
; footswitch records are left alone (stock-compatible, initialised by the core).
ui_globals_defaults:
        ldx #UI_GDEF_N-1
@l:     lda ui_gdef,x
        sta NV_GLOBALS,x
        dex
        bpl @l
        rts
