; eng/voice: zero page and RAM variables (owned by the voice module)
        .zeropage
vx_s:       .res 1          ; side being processed (0 RIGHT, 1 LEFT)
vx_b:       .res 1          ; first voice of the side (0 / 4)
vx_top:     .res 1          ; voices of the side - 1 (3, or 7 for WHOLE 8 / unison over 8 voices)
vx_cnt:     .res 1          ; voices available to the poly assigner (4 / 8)
vx_hold:    .res 1          ; unison: hold of the side
vx_asg:     .res 1          ; assign mode of the side (0-3)
vx_n:       .res 1          ; current event: note | $80 = key on
vx_v:       .res 1          ; current event: velocity (0-127)
vx_kcv:     .res 1          ; keyboard CV candidate (key index) for the side
vx_g:       .res 1          ; $20 = some voice of the side gated
vx_t0:      .res 1
vx_t1:      .res 1
vx_t2:      .res 1
vx_t3:      .res 1
vx_bp:      .res 2          ; edit buffer of the side being processed
vx_k:       .res 1          ; key index (3-63) of the note being set
vx_c:       .res 1          ; its rounding carry (0/1)
vx_y:       .res 1
vx_pend:    .res 1
vx_akey:    .res 1          ; $FF: some key down on the side (this update)
vx_af5:     .res 1          ; arpeggio direction: $7F up, 0 down ($FF random)
vx_abest:   .res 1          ; arpeggio search: best note, its voice, previous note
vx_ay:      .res 1
vx_aprv:    .res 1
vx_force:   .res 1          ; $FF: run the side updates even without new notes
vx_clo:     .res 1          ; velocity clip of the side: low, high, $FF = clip VCA/attack, $FF = clip mod
vx_chi:     .res 1
vx_cv:      .res 1
vx_cm:      .res 1
; tick context only (never touched by main-loop code)
vg_rate:    .res 1          ; glide: rate, VCO1 untracked flag (bit 7), glide (not gliss) mask
vg_trk:     .res 1
vg_gm:      .res 1
vg_pb:      .res 1
vg_t:       .res 1
vx_rcnt:    .res 1          ; S&H refresh: slots left, next slot
vk_id:      .res 1          ; VPK-5 frame number
vk_na:      .res 1
vk_ty:      .res 1
vx_ridx:    .res 1

        .segment "BSS2"
; ---- per voice (0-7)
vx_key:     .res 8          ; note | $80 while its key is down
vx_dis:     .res 8          ; bit 7: voice not assignable (disabled, or locked by HOLD)
vx_new:     .res 8          ; non-zero: voice has a new note / key up to process
vx_rst:     .res 8          ; non-zero: retrigger the envelopes at the next note-on
vx_nn:      .res 8          ; next note | $80 gate
vx_vel:     .res 8          ; velocity of the note (0-127)
vx_note:    .res 8          ; sounding note | $80 gate
vx_mvel:    .res 8          ; velocity through the modulation taper
vx_gate:    .res 8          ; $20 gate on
vx_rel:     .res 8          ; $FF: released since the last envelope pass
vx_vca:     .res 8          ; velocity through the VCA taper (ADSR2 multiplier)
vx_avel:    .res 8          ; velocity through the attack taper
vx_cur:     .res 8          ; glide: current note
vx_frac:    .res 8          ; glide: fraction
vx_tgt:     .res 8          ; glide: target note
vx_b1h:     .res 8          ; VCO1 pitch base (24 bit: semitone in b1l, fraction in b1f)
vx_b1l:     .res 8
vx_b1f:     .res 8
vx_b2h:     .res 8          ; VCO2 pitch base
vx_b2l:     .res 8
vx_b2f:     .res 8
; ---- per side
vx_goff:    .res 2          ; $FF: glide off
vx_grate:   .res 2          ; glide rate
vx_e4:      .res 2          ; circular assigner position
vx_sgate:   .res 2          ; $20: some voice of the side is gated (LFO delay / retrigger, kbd gate)
vx_kcvs:    .res 2          ; keyboard CV (key index) of the side
vx_stk:     .res 16         ; unison: notes held under the sounding one (8 per side)
vx_stn:     .res 2
vx_qr:      .res 2          ; event queues: read / write index (events of 2 bytes, 32 per side)
vx_qw:      .res 2
vx_q:       .res 128        ; [side*64 + i]: note | $80 on, velocity
vx_ref:     .res 1          ; voice whose note-on CVs are refreshed next ($FF none)
vx_busy:    .res 1          ; a note-on was computed in this side pass
vx_pmode:   .res 1          ; shadows of PERF: keyboard mode, unison, hold (change detection)
vx_puni:    .res 1
vx_phold:   .res 1
vx_pmask:   .res 1
vx_aedge:   .res 2          ; arpeggiator clock level last seen per side
vx_alast:   .res 2          ; voice of the last arpeggio note per side
vx_adir:    .res 2          ; up/down direction state per side
vx_akeyp:   .res 2          ; key-down state of the previous side update
        .bss
vx_dyn:     .res 128        ; per S&H slot: non-zero = written by the engine, not refreshed
; ---- VPK-5 keyboard (key index k = 0-60, note = (k ^ $3F) + $21: k = 60 -> 36)
vk_st:      .res 61         ; 0 idle, 1 first contact (timing), 2 down
vk_cnt:     .res 61         ; velocity timer ($C0 + ticks between the two contacts)
vk_down:    .res 61         ; $80: key held (keyboard or eng_key_on)
vk_fifo:    .res 64         ; tick -> main loop events: k | $80 on, timer
vk_act:     .res 61         ; keys in progress (state 1/2), vk_na of them (tick only)
vk_k:       .res 1          ; key index during the scan
vk_seen:    .res 61         ; frame number when the first contact was last seen closed
vk_fr:      .res 1
vk_fw:      .res 1
