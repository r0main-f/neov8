; Footswitches: PIA2 PB0-5 (closed = 0), battery config at BRAM_FSW, 6 records [mode, code1, code2]
; (stock-compatible: docs/hardware.md §8, rev4-ram-map.md). Records 0-3 = jacks B-L, B-R, A-L, A-R
; (programmable), 4-5 = FWD/REV jack. A switch fires its two button codes when released, and also when
; pressed if mode bit 7 = 1 ("both edges"). Codes >= $80 and AUTO TUNE are ignored.

fsw_init:
        lda BRAM_FSW_MAGIC
        cmp #$a5
        beq @jack
        ldx #17                     ; first boot (or stock never initialised it): defaults
@d:     lda fsw_defaults,x
        sta BRAM_FSW,x
        dex
        bpl @d
        lda #$a5
        sta BRAM_FSW_MAGIC
@jack:  ldx #5                      ; the FWD/REV jack records are fixed (rewritten every boot, as the stock)
@j:     lda fsw_defaults+12,x
        sta BRAM_FSW+12,x
        dex
        bpl @j
        lda PIA2_PB
        and #$3f
        sta fsw_stable
        sta fsw_last
        lda #1                      ; VPK-5 REV / FWD: not armed until both are seen released (voice.asm vk_btn)
        sta vb_stable
        rts

; Main loop: debounce (two equal reads), then fire the changed switches.
fsw_poll:
        lda PIA2_PB
        and #$3f
        cmp fsw_last
        beq @same
        sta fsw_last
        rts
@same:  cmp fsw_stable
        bne @chg
        rts
@chg:   sta fsw_state
        eor fsw_stable
        sta fsw_changed
        lda fsw_state
        sta fsw_stable
        ldy #0                      ; record offset
@sw:    lsr fsw_changed
        bcc @next
        lda fsw_state
        lsr
        bcs @fire                   ; released (input back to 1): always fires
        lda BRAM_FSW,y
        bpl @next                   ; pressed: only in "both edges" mode
@fire:  tya
        pha
        lda BRAM_FSW+1,y
        jsr fsw_send
        pla
        pha
        tay
        lda BRAM_FSW+2,y
        jsr fsw_send
        pla
        tay
@next:  lsr fsw_state
        iny
        iny
        iny
        cpy #18
        bne @sw
        rts

; VPK-5 front buttons REV / FWD: presses found by the tick (voice.asm vk_btn: debounce, auto-repeat) are
; sent here like the panel's REV / FWD (stock $FCAC).
vpk_btn_poll:
        lda vb_pend
        beq @r
        php
        sei
        lda vb_pend
        ldx #0
        stx vb_pend
        plp
        sta vb_f
        bit vb_f                    ; N = REV, V = FWD
        bpl @nf
        lda #BTN_REV
        jsr fsw_send
@nf:    bit vb_f
        bvc @r
        lda #BTN_FWD
        jmp fsw_send
@r:     rts

fsw_send:
        bmi @r                      ; >= $80: no function
        cmp #BTN_AUTOTUNE
        beq @r
        ldx #$40                    ; raw byte: A440 up
        jmp ui_key
@r:     rts

; defaults: FS B-L Rel Def R+L (both edges), B-R Arp Pause, A-L Hold L+R (both edges), A-R Unison L+R (both edges),
; jack REV, jack FWD
fsw_defaults:
        .byte $ff, BTN_RELDEF_R, BTN_RELDEF_L
        .byte $00, BTN_ARP_PAUSE, $ff
        .byte $ff, BTN_HOLD_L, BTN_HOLD_R
        .byte $ff, BTN_UNI_L, BTN_UNI_R
        .byte $00, BTN_REV, $ff
        .byte $00, BTN_FWD, $ff
