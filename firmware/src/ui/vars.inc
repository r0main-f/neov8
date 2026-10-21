; ui: zero page and RAM variables (see ui/README.md). Zero page: 10 bytes (budget 40).
        .zeropage
ui_buf:     .res 2          ; edit buffer of the side being worked on (EDIT_R / EDIT_L)
ui_p:       .res 2          ; pointer: battery program / step, tables
ui_q:       .res 2          ; second pointer
ui_a:       .res 1          ; scratch (not preserved across ui calls)
ui_b:       .res 1
ui_c:       .res 1
ui_d:       .res 1

        .bss
; ---- time
ui_tn:      .res 2          ; ticks sampled at the entry of ui_key / ui_pot / ui_service
ui_last:    .res 2          ; ticks at the last ui_service
ui_blk:     .res 1          ; blink phase 0..UI_BLINK_T-1
ui_bon:     .res 1          ; blink phase on (1) / off (0) at the last render
ui_rtick:   .res 1          ; ticks since the last periodic render
ui_redraw:  .res 1          ; render at the next ui_service
ui_eng:     .res 1          ; engine update pending: bit7 perf, bit0 program R, bit1 program L
ui_dl_lo:   .res 4          ; timer deadlines (UI_TM_*)
ui_dl_hi:   .res 4
; ---- mode
ui_mode:    .res 1          ; UI_PLAY .. UI_RECEIVE
ui_back:    .res 1          ; mode to return to from menu / confirm / receive / tune
ui_back2:   .res 1          ; and the one below it
ui_page:    .res 1          ; edit page 0-5 (1 2 A B C D)
ui_eside:   .res 1          ; edited side (0 R, 1 L)
ui_lastpg:  .res 2          ; last edit page per side
ui_focus:   .res 1          ; 0 R, 1 L, 2 STEP
ui_code:    .res 1          ; button being handled
ui_sh:      .res 1          ; 1 = A440 (SHIFT) held with this button
ui_bside:   .res 1          ; side of ui_buf
; ---- number entry
ui_ent:     .res 1          ; $FF none, else target 0 R, 1 L, 2 STEP, 3 menu
ui_ent_n:   .res 1          ; digits typed (0/1)
ui_ent_d:   .res 1          ; first digit
; ---- overlays
ui_tch_on:  .res 1          ; value-on-touch shown
ui_tch_txt: .res 6
ui_msg_on:  .res 1          ; message shown
ui_msg_txt: .res 6
ui_msg_dp:  .res 1          ; decimal points of the message (bit i = digit i)
ui_msg_blk: .res 1          ; message blinks
ui_chord:   .res 1          ; EDIT pressed recently: a digit jumps to a page
ui_chside:  .res 1          ; side for that jump
ui_st_on:   .res 1          ; store armed
ui_st_kind: .res 1          ; 0 program, 1 step
ui_st_side: .res 1
ui_st_dest: .res 1
ui_st_n:    .res 1          ; digits typed
ui_st_d:    .res 1
ui_cmp:     .res 1          ; side being compared, $FF none
ui_cfm:     .res 1          ; confirm: 0 SysEx dump, 1 undo
ui_rxcnt:   .res 1          ; midi_sxcount when the SysEx receive page opened
; ---- edit
ui_sel:     .res 2          ; keypad selector per var (pwm, lfo): 1 or 2
ui_lt_par:  .res 1          ; last touched param ($FF none)
ui_lt_side: .res 1
ui_onw:     .res 1          ; ON value for the param being shown ($FF = default)
ui_mark:    .res 1          ; pickup marker ' ', '~' (turn down) or '_' (turn up)
; ---- misc state
ui_muted:   .res 1
ui_tone:    .res 1
ui_rst:     .res 1          ; menu 99 armed
ui_item:    .res 1          ; menu item index (table row)
ui_lastbtn: .res 1
ui_lastpot: .res 1
ui_tuned:   .res 1          ; an autotune ran since boot
; ---- pots
ui_pprev:   .res 15         ; last value per pot ($FF = unknown)
ui_pacc:    .res 15         ; fine-mode accumulators
ui_caught:  .res 4          ; pickup: caught flags (bit per pot / pot+16)
ui_pv:      .res 1          ; pot value (7-bit)
ui_pb:      .res 1          ; previous pot value
ui_pi:      .res 1          ; pot index
ui_pp:      .res 1          ; param
ui_pm:      .res 1          ; pot mode
ui_ck:      .res 1          ; caught-flag index
ui_tgt:     .res 1          ; scaled pot value
ui_bef:     .res 1          ; scaled previous pot value
ui_cur:     .res 1          ; current param value
; ---- arithmetic / text
ui_ml:      .res 1
ui_mh:      .res 1
ui_tx:      .res 6          ; text builder
ui_txt:     .res 6          ; rendered text
ui_dpm:     .res 1          ; rendered decimal points
ui_blm:     .res 1          ; blinking digits
ui_dpbm:    .res 1          ; blinking decimal points
ui_led:     .res 4          ; LED bytes (display RAM 0, 3, 6, 9)
ui_ledb:    .res 4          ; blinking LEDs
ui_stp:     .res 24         ; step pack/unpack buffer
