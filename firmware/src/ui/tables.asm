; NeoV8 UI - hand-written tables (hardware LED map, texts, step format, defaults).

; ---- messages (6 chars)
ui_s_cancel:    .byte "CAnCEL"
ui_s_reset:     .byte "rESEt?"
ui_s_clear:     .byte "CLEAr "
ui_s_recon:     .byte "rEC On"
ui_s_erase:     .byte "ErASE?"
ui_s_erased:    .byte "ErASEd"
ui_s_sqst:      .byte "nodAtA", "SEL  ?", "SOnG 2", "rEC On", "FULL  "   ; seq_status 1-5
ui_s_tuneok:    .byte "tU  oK"
ui_s_none:      .byte "--  --"
ui_s_rgno:      .byte "rG  no"
ui_s_reset2:    .byte "rESEt "
ui_s_noed:      .byte "nO Ed "
ui_s_cpno:      .byte "CP  --"
ui_s_stored:    .byte "StOrEd"
ui_s_protec:    .byte "PrOtEC"
ui_s_sent:      .byte "SEnt  "
ui_s_undone:    .byte "UndOnE"
ui_s_send:      .byte "SEnd ?"
ui_s_init:      .byte "InIt"
ui_s_undo:      .byte "UndO"

ui_s_div:       .byte "   4", "   8", "  8t", "  16", " 16t", "  32", " 32t", "  64"   ; MIDI-clock arp divisions
ui_side_ch:     .byte "rL"          ; side 0 RIGHT, 1 LEFT

ui_left_codes:  .byte BTN_CALL_L, BTN_UNI_L, BTN_OCT_L, BTN_HOLD_L, BTN_RELDEF_L, BTN_PBDEF_L, BTN_ARP_L
ui_left_codes_end:

; note names (split point): letter, and DP on digit 4 for sharps
ui_note_ch:     .byte "CCddEFFGGAAb"
ui_note_sharp:  .byte 0, $10, 0, $10, 0, 0, $10, 0, $10, 0, $10, 0

; Normal-page trimmers by knob (pot index / 2): Fc, Glide, LFO, A, R, Detune, Volume
ui_trim_slot:   .byte 2, 3, 4, 0, 1, 5, 6       ; offset in PF_TRIM_* (stock order A R Fc Glide LFO Detune Vol)
ui_trim_mn0:    .byte "FGLArdU"
ui_trim_mn1:    .byte "cLFtEEL"
ui_direct_p1:   .byte UIP_vcf_fc, UIP_glide_time, UIP_lfo1_rate, UIP_adsr1_attack, UIP_adsr1_release, UIP_vco1_detune, UIP_prog_vol
ui_direct_p2:   .byte $ff, $ff, $ff, UIP_adsr2_attack, UIP_adsr2_release, $ff, $ff

ui_mul3:        .byte 0, 3, 6, 9, 12, 15
ui_mul10:       .byte 0, 10, 20, 30, 40, 50
ui_mul15:       .byte 0, 15, 30, 45, 60, 75

; entry / focus target (0 R, 1 L, 2 STEP, 3 menu) -> blinking digits, focus DP (tens digit)
ui_tgt_mask:    .byte $0c, $03, $30, $03
ui_tgt_dp:      .byte $04, $01, $10

; ---- LEDs. Location = LED byte index (0-3 = display RAM 0, 3, 6, 9) << 3 | bit (docs/hardware.md §5.4).
; EDIT / STORE / TAPE LOAD / TAPE DUMP: the 4 bits the stock OS never drives ($6A-$6D, in that order
; assumed = EDIT, STORE, TAPE LOAD, TAPE DUMP) - TO CHECK ON THE UNIT.
LEDL_EDIT       = $0e           ; RAM 3 b6 ($6A)
LEDL_STORE      = $08           ; RAM 3 b0 ($6B)
LEDL_TAPELOAD   = $06           ; RAM 0 b6 ($6C)
LEDL_TAPEDUMP   = $00           ; RAM 0 b0 ($6D)
LEDL_AUTOTUNE   = $1b
LEDL_A440       = $19
ui_led_pos:     .byte 0, 3, 6, 9
ui_octl_loc:    .byte $0a, $0d, $0f     ; OCT L down, normal, up
ui_octr_loc:    .byte $0b, $09, $0c     ; OCT R
; button code -> LED location ($FF = no LED)
ui_ledloc:
        .byte $03, $02, $05, $04, $14, $11, $01, $ff    ; $00 UNI L, UNI R, SPLIT, LAYER, HOLD L, HOLD R, WHOLE
        .byte $ff, $ff, $ff, $ff, $ff, $ff, $ff, $ff    ; $08 digits
        .byte $ff, $ff, $ff, $ff, $ff, $ff, $ff, $ff    ; $10
        .byte $ff, $ff, $06, $00, $08, $0e, $1b, $ff    ; $18 OCT R, OCT L, TAPE LOAD, TAPE DUMP, STORE, EDIT, AUTO TUNE
        .byte $ff, $ff, $ff, $ff, $ff, $ff, $ff, $ff    ; $20 CALL, STEP
        .byte $16, $10, $19, $07, $ff, $ff, $ff, $ff    ; $28 PB DEF R, PB DEF L, A440, MUTE
        .byte $12, $13, $18, $17, $1e, $ff, $ff, $ff    ; $30 REL DEF R, REL DEF L, ARP RIGHT, ARP LEFT, PAUSE
        .byte $1c, $1d, $1f, $ff, $ff, $ff, $ff, $ff    ; $38 DOWN, RANDOM, UP
ui_kbmode_btn:  .byte BTN_WHOLE, BTN_SPLIT, BTN_LAYER
; PERF side-bit flags shown on button LEDs in PLAY: offset, RIGHT button, LEFT button
ui_pflag_tab:
        .byte PF_UNISON, BTN_UNI_R, BTN_UNI_L
        .byte PF_HOLD, BTN_HOLD_R, BTN_HOLD_L
        .byte PF_RELDEF, BTN_RELDEF_R, BTN_RELDEF_L
        .byte PF_PBDEF, BTN_PBDEF_R, BTN_PBDEF_L
        .byte PF_ARP_ON, BTN_ARP_R, BTN_ARP_L
UI_PFLAG_N = 5

; ---- NeoV8 globals defaults (NV_GLOBALS offsets 0..15; G_LAST_STEP and above are not reset)
ui_gdef:
        .byte 0                 ; G_MIDI_CH_R  channel 1
        .byte 1                 ; G_MIDI_CH_L  channel 2
        .byte 0                 ; G_OMNI
        .byte $1f               ; G_RX notes, PC, CC/NRPN, SysEx, bend/mod/pressure
        .byte $03               ; G_TX notes, PC
        .byte 0                 ; G_PC_TARGET programs
        .byte 1                 ; G_LOCAL on
        .byte 0                 ; G_POTMODE pickup
        .byte 0                 ; G_TRIMMODE trim
        .byte 15                ; G_DISPHOLD 1.5 s
        .byte 0                 ; G_POWERON last step
        .byte 0                 ; G_ARPCLK internal
        .byte 0                 ; G_STEAL oldest
        .byte 3                 ; G_UNIDETUNE
        .byte 0                 ; G_PARAM_TX off
        .byte 2                 ; G_BEND_RANGE
UI_GDEF_N = 16

; ---- stock step format (docs/rev4-ram-map.md §4): single-bit flags
;                 step byte, step mask, PERF offset, PERF mask
ui_stf_byte:    .byte 0, 0, 0, 0, 1, 2, 3, 3, 3, 3, 20, 20, 20, 20, 20, 20, 21, 21, 21, 23, 23
ui_stf_smask:   .byte $20, $10, $08, $04, $80, $80, $20, $10, $08, $04, $80, $40, $20, $10, $08, $04, $40, $20, $10, $02, $01
ui_stf_perf:    .byte PF_UNISON, PF_UNISON, PF_ARP_ON, PF_ARP_ON, PF_PBDEF, PF_PBDEF, PF_LFOSYNC, PF_LFOSYNC
                .byte PF_ARP_RETRIG, PF_ARP_SYNC, PF_ARP_AUTOOCT, PF_ARP_AUTOOCT, PF_VCAVEL, PF_VCAVEL
                .byte PF_PRESSDEF, PF_PRESSDEF, PF_KBDGATE, PF_KBDGATE, PF_CVLEFT, PF_RELDEF, PF_RELDEF
ui_stf_pmask:   .byte 2, 1, 2, 1, 1, 2, 2, 1, 1, 1, 2, 1, 2, 1, 1, 2, 2, 1, 1, 2, 1   ; byte 21: bit6 LEFT, bit5 RIGHT (stock $824E)
UI_STF_N = 21
; multi-bit fields: step byte, shift, mask, PERF offset
ui_stm_byte:    .byte 0, 1, 2, 3, 3, 4, 5, 20, 21, 21, 22
ui_stm_shift:   .byte 0, 0, 0, 6, 0, 6, 0, 0, 2, 0, 0
ui_stm_mask:    .byte 3, $7f, $7f, 3, 3, 3, $7f, 3, 3, 3, $ff
ui_stm_perf:    .byte PF_ARP_MODE_R, PF_PROG_R, PF_PROG_L, PF_OCT_R, PF_ARP_CLK_L, PF_OCT_L, PF_ARP_SPEED
                .byte PF_ARP_MODE_L, PF_ASSIGN_L, PF_ASSIGN_R, PF_VOICEMASK
UI_STM_N = 11
