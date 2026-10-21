; Switch panel: Intel 8279. Display image in panel::disp (10 bytes = 8279 display RAM 0-9), key FIFO.
; docs/hardware.md §5. LED bytes: disp+0, +3, +6, +9; digits LEFT 1,2  RIGHT 5,4 (reversed)  STEP 7,8.
panel_init:
        lda #$c1
        sta KD_CMD                  ; clear display + FIFO
        ldx #0
@d:     dex
        bne @d                      ; ~1.3 ms for the clear
        lda #$34
        sta KD_CMD                  ; prescaler /20 -> 100 kHz
        lda #$0a
        sta KD_CMD                  ; 16-char display, left entry, encoded scan, N-key rollover
        lda #$40
        sta KD_CMD                  ; read FIFO
        rts

; Copy the display image to the 8279.
panel_flush:
        php
        sei
        lda #$90
        sta KD_CMD                  ; write display RAM from 0, auto-increment
        ldx #0
@l:     lda panel_disp,x
        sta KD_DATA
        inx
        cpx #10
        bne @l
        lda #0
        sta panel_dirty
        plp
        rts

; Display RAM index of LEFT tens, LEFT units, RIGHT tens, RIGHT units, STEP tens, STEP units.
panel_digitPos:   .byte 1, 2, 5, 4, 7, 8

; Show 6 ASCII characters at (X lo, Y hi) in LEFT, RIGHT, STEP. Decimal points cleared. LED bytes kept.
panel_text:
        stx ptr2
        sty ptr2+1
        ldy #0
@l:     lda (ptr2),y
        jsr panel_glyph
        ldx panel_digitPos,y
        sta panel_disp,x
        iny
        cpy #6
        bne @l
        lda #1
        sta panel_dirty
        rts

; Put ASCII A at digit Y (0-5). X preserved.
panel_putc:
        jsr panel_glyph
        stx tmp2
        ldx panel_digitPos,y
        sta panel_disp,x
        ldx tmp2
        lda #1
        sta panel_dirty
        rts

; Set (C=1) or clear (C=0) the decimal point of digit Y (0-5).
panel_dp:
        ldx panel_digitPos,y
        lda panel_disp,x
        and #$fe
        bcc @c
        ora #SEG_DP
@c:     sta panel_disp,x
        lda #1
        sta panel_dirty
        rts

; ASCII in A -> segment byte (X preserved)
panel_glyph:
        sec
        sbc #$20
        bcc @blank
        cmp #$60
        bcs @blank
        stx tmp
        tax
        lda font,x
        ldx tmp
        rts
@blank: lda #0
        rts

; A = 0-15 -> ASCII hex digit
panel_hexdigit:
        and #$0f
        cmp #10
        bcc @n
        adc #'A'-'0'-10-1
@n:     adc #'0'
        rts

; Set (C=1) or clear (C=0) LED bit X of display byte Y (Y = 0, 3, 6 or 9).
panel_led:
        lda panel_bitmask,x
        bcc @off
        ora panel_disp,y
        bne @st
@off:   eor #$ff
        and panel_disp,y
@st:    sta panel_disp,y
        lda #1
        sta panel_dirty
        rts
panel_bitmask:    .byte $01, $02, $04, $08, $10, $20, $40, $80

; Poll the 8279 FIFO. C=1: A = button code (= SysEx panel-button number), X = raw byte (bit6 = 1: A440 up).
panel_poll:
        lda KD_CMD
        and #$20
        beq @noOvr
        lda #$c2
        sta KD_CMD                  ; clear overrun
@noOvr: lda KD_CMD
        and #$07
        bne @read
        clc
        rts
@read:  lda KD_DATA
        pha
        and #$07                    ; RL
        asl
        asl
        asl
        sta tmp
        pla
        pha
        lsr
        lsr
        lsr
        and #$07                    ; SL
        ora tmp                     ; RL*8 + SL
        tax
        lda panel_keytab,x
        cmp #$ff
        beq @none
        tay
        pla
        tax
        tya
        sec
        rts
@none:  pla
        clc
        rts

; Panel wiring: 8279 matrix position (RL*8 + SL) -> button code. docs/hardware.md §5.1 (A440 = SHIFT input).
panel_keytab:
        .byte $10, $0A, $0F, $09, $11, $0C, $12, $0D    ; RL0: 8 2 7 1 9 4 REV 5
        .byte $05, $31, $29, $0B, $04, $0E, $28, $30    ; RL1: HOLD R, REL DEF L, PB DEF L, 3, HOLD L, 6, PB DEF R, REL DEF R
        .byte $32, $33, $1E, $34, $39, $38, $2A, $3A    ; RL2: ARP R, ARP L, AUTO TUNE, PAUSE, RANDOM, DOWN, (A440 tone), UP
        .byte $FF, $20, $22, $21, $23, $19, $FF, $18    ; RL3: -, CALL R, STEP ENABLE, CALL L, STEP LOAD, OCT L, -, OCT R
        .byte $08, $FF, $13, $1D, $1A, $1C, $1B, $15    ; RL4: 0, -, FWD, EDIT, TAPE LOAD, STORE, TAPE DUMP, ($15)
        .byte $03, $FF, $00, $06, $02, $2B, $01, $14    ; RL5: LAYER, -, UNISON L, WHOLE 8, SPLIT, MUTE, UNISON R, ($14)


; Button codes (docs/hardware.md §5.1) — shared by ui, midi (SysEx panel button), footswitches.
BTN_UNI_L = $00
BTN_UNI_R = $01
BTN_SPLIT = $02
BTN_LAYER = $03
BTN_HOLD_L = $04
BTN_HOLD_R = $05
BTN_WHOLE = $06
BTN_0 = $08                         ; digits $08-$11
BTN_REV = $12
BTN_FWD = $13
BTN_OCT_R = $18
BTN_OCT_L = $19
BTN_TAPE_LOAD = $1A
BTN_TAPE_DUMP = $1B
BTN_STORE = $1C
BTN_EDIT = $1D
BTN_AUTOTUNE = $1E
BTN_CALL_R = $20
BTN_CALL_L = $21
BTN_STEP_ENABLE = $22
BTN_STEP_LOAD = $23
BTN_PBDEF_R = $28
BTN_PBDEF_L = $29
BTN_A440TONE = $2A
BTN_MUTE = $2B
BTN_RELDEF_R = $30
BTN_RELDEF_L = $31
BTN_ARP_R = $32
BTN_ARP_L = $33
BTN_ARP_PAUSE = $34
BTN_ARP_DOWN = $38
BTN_ARP_RANDOM = $39
BTN_ARP_UP = $3A

; LED locations: display byte, bit (docs/hardware.md §5.4)
LED_MUTE = 0*256+7
