; voice module: VPK-5 keyboard scan, key events, voice assignment (poly / unison / layer / split, assign modes,
; hold, voice disable), note-on CVs (pitch with autotune offsets, glide/gliss, VCF tracking, velocity slots,
; velocity/keyboard-tracked envelope rates, PWM keyboard tracking), keyboard gate/CV.
; Behaviour of the stock Rev4 engine (key events $B116, assigners $F9E8/$FA15/$FC27, side update $EB58,
; note-on $ED97, glide $AD30, pitch base $AEB3), new code.
;
; Voices 0-3 belong to side 0 (RIGHT), 4-7 to side 1 (LEFT); WHOLE 8 runs all 8 voices as side 0, LAYER
; assigns side 0 and copies voices 0-3 to 4-7. Key events go to a queue per side (split point decides),
; the main loop (vx_service) assigns them; the control tick only scans the keyboard and glides.

; ------------------------------------------------------------------ init
vx_init:
        ldx #7
@v:     lda #$3d                    ; like the original after reset: every voice on note 61, gate off
        sta vx_key,x
        sta vx_nn,x
        sta vx_note,x
        dex
        bpl @v
        lda #$ff
        sta vx_goff
        sta vx_goff+1
        sta vx_ref
        ldx #$68                    ; envelope and LFO slots are written by the engine only
@d:     lda #$ff
        cpx #$7b
        bne @d1
        lda #0
@d1:    sta vx_dyn,x
        inx
        cpx #$7f
        bne @d
        jsr vx_shadow
        jsr vx_flags
        jmp vx_split_latch

; ------------------------------------------------------------------ helpers
; X = voice of relative index Y (vx_b + Y).
vx_abs:
        tya
        clc
        adc vx_b
        tax
        rts

; Key index of note A (stock $ED83): note - 33 clamped to 3..63. C = 0 when clamped low, else 1.
vx_kidx:
        and #$7f
        sec
        sbc #$21
        bmi @lo
        cmp #$40
        bcs @hi
        cmp #3
        bcc @lo
        rts
@hi:    lda #$3f
        rts
@lo:    lda #3
        clc
        rts

; Parameter edit buffer of side X -> vx_bp (WHOLE 8: RIGHT).
vx_selbuf:
        lda #<EDIT_R
        ldy PERF+PF_KBMODE
        beq @s
        cpx #0
        beq @s
        lda #<EDIT_L
@s:     sta vx_bp
        lda #>EDIT_R
        sta vx_bp+1
        rts

; Side context: vx_s, vx_b, vx_asg, vx_bp, velocity clip (from the side's own buffer byte $27).
vx_ctx:
        stx vx_s
        txa
        asl
        asl
        sta vx_b
        lda PERF+PF_ASSIGN_R,x
        and #3
        sta vx_asg
        jsr vx_selbuf
        ldx vx_s
        rts

; Velocity clip of side vx_s (its own buffer's byte $27: taper select, clip enables).
vx_clipset:
        ldx vx_s
        lda EDIT_R+$27
        cpx #0
        beq @b
        lda EDIT_L+$27
@b:     sta vx_t0
        and #3
        eor #3
        tay
        beq @user
        lda BRAM_CLIP+4,y
        sta vx_chi
        lda BRAM_CLIP,y
        sta vx_clo
        jmp @f
@user:  lda #0
        sta vx_clo
        lda #$7f
        sta vx_chi
@f:     lda #0
        sta vx_cv
        sta vx_cm
        lda vx_t0
        and #$08                    ; clip VCA/attack (active low)
        bne @c1
        dec vx_cv
@c1:    lda vx_t0
        and #$10                    ; clip mod (active low)
        bne @c2
        dec vx_cm
@c2:    ldx vx_s
        rts

; Velocity tapers (A = velocity 0-127): VCA (rescaled to the clip window), modulation, attack.
vx_tvca:
        bit vx_cv
        bpl @t
        jsr vx_clip
        sec
        sbc vx_chi
        clc
        adc #$7f
@t:     tay
        lda tb_vel_vca,y
        rts
vx_tmod:
        bit vx_cm
        bpl @t
        jsr vx_clip
@t:     tay
        lda tb_vel_mod,y
        rts
vx_tatt:
        bit vx_cv
        bpl @t
        jsr vx_clip
@t:     tay
        lda tb_vel_att,y
        rts
vx_clip:
        cmp vx_chi
        bcc @l
        lda vx_chi
        rts
@l:     cmp vx_clo
        bcs @r
        lda vx_clo
@r:     rts

; Disabled-voice mask (autotune failures | voice disable) -> vx_t1 (bit v = voice v).
vx_mask:
        lda CAL_FAILED
        ora PERF+PF_VOICEMASK
        sta vx_t1
        rts

; Voice X disabled by the mask (vx_t1)? C = 1 if yes. X, Y preserved.
vx_isdis:
        lda vx_bit,x
        and vx_t1
        cmp #1
        rts
vx_bit:     .byte $01, $02, $04, $08, $10, $20, $40, $80

; ------------------------------------------------------------------ VPK-5 keyboard, control tick
.macro VK_KEY k
        .local ret
        lda VPK_A                   ; D7 = first contact closed
        sta VPK_CLK
        bpl ret
        lda vk_id
        sta vk_seen+k
        lda vk_st+k
        cmp #2
        beq ret                     ; held
        ldx #k
        jsr vk_closed
ret:
.endmacro

vx_tick:
        lda VPK_ACKOFF
        lda VPK_DSTR                ; frame start
        ldx #7                      ; header: 7 clocks (VPK-5 front buttons not read)
@h:     sta VPK_CLK
        nop
        dex
        bne @h
.ifndef STUB_MIDI
        lda midi_kbd_off            ; keyboard disabled by a controller (SysEx): no scan
        beq vx_tscan
        jmp vx_tend
vx_tscan:
.endif
        inc vk_id
        .repeat 61, I
        VK_KEY (60-I)
        .endrepeat
        ; keys in progress whose first contact was not seen closed in this frame: released
        ldy vk_na
@a:     dey
        bmi vx_tend
        ldx vk_act,y
        lda vk_seen,x
        cmp vk_id
        beq @a
        lda vk_st,x
        cmp #2
        lda #0
        sta vk_st,x                 ; (state 1: released before the second contact, no event)
        bcc @rm
        sta vk_down,x
        sty vk_ty
        txa
        jsr vk_push                 ; key up
        ldy vk_ty
@rm:    ldx vk_na                   ; remove from the list (last entry moves here)
        dex
        stx vk_na
        lda vk_act,x
        sta vk_act,y
        jmp @a
vx_tend:
        lda VPK_ASTR
        rts

; Key X has its first contact closed in this frame.
vk_closed:
        cmp #0
        beq @new
        bit VPK_B                   ; timing: second contact (active low) closes = note on
        bpl @on
        inc vk_cnt,x
        bne @r
        dec vk_cnt,x
@r:     rts
@on:    lda #2
        sta vk_st,x
        lda #$80
        sta vk_down,x
        txa
        ora #$80
        jmp vk_push
@new:   lda #1                      ; first contact: start timing
        sta vk_st,x
        lda #$c0
        sta vk_cnt,x
        ldy vk_na
        txa
        sta vk_act,y
        inc vk_na
        rts

; Event A = key | $80 on, timer of key (A&$7F) -> main-loop FIFO. Tick context (or SEI).
vk_push:
        ldy vk_fw
        sta vk_fifo,y
        and #$7f
        tax
        lda vk_cnt,x
        sta vk_fifo+1,y
        tya
        clc
        adc #2
        and #63
        cmp vk_fr
        beq @full
        sta vk_fw
@full:  rts

; ------------------------------------------------------------------ event queues (main loop)
; Push event vx_n / vx_v to side X's queue.
vx_qpush:
        txa
        asl
        asl
        asl
        asl
        asl
        asl
        sta vx_t0                   ; side*64
        lda vx_qw,x
        clc
        adc #2
        and #63
        cmp vx_qr,x
        beq @full
        pha
        lda vx_qw,x
        ora vx_t0
        tay
        lda vx_n
        sta vx_q,y
        lda vx_v
        sta vx_q+1,y
        pla
        sta vx_qw,x
@full:  rts

; Pop side vx_s's next event into vx_n / vx_v. C = 1 if empty.
vx_qpop:
        ldx vx_s
        lda vx_qr,x
        cmp vx_qw,x
        beq @e
        txa
        asl
        asl
        asl
        asl
        asl
        asl
        ora vx_qr,x
        tay
        lda vx_q,y
        sta vx_n
        lda vx_q+1,y
        sta vx_v
        lda vx_qr,x
        clc
        adc #2
        and #63
        sta vx_qr,x
        clc
        rts
@e:     sec
        rts

; Z = 0 if any key event is waiting (queues or keyboard FIFO).
vx_pending:
        lda vk_fr
        eor vk_fw
        bne @r
        lda vx_qr
        eor vx_qw
        bne @r
        lda vx_qr+1
        eor vx_qw+1
@r:     rts

; Keyboard FIFO -> side queues (split point), velocity taper, MIDI out.
vx_drain:
        ldx vk_fr
        cpx vk_fw
        bne @go
        rts
@go:    lda vk_fifo,x
        sta vx_t3                   ; k | on
        lda vk_fifo+1,x
        sta vx_t2                   ; timer
        txa
        clc
        adc #2
        and #63
        sta vk_fr
        lda vx_t3
        and #$7f
        eor #$3f
        clc
        adc #$21
        sta vx_n                    ; note
        jsr vx_route                ; X = side
        lda #0
        sta vx_v
        bit vx_t3
        bpl @send
        lda vx_t2                   ; velocity: ticks between the contacts (0-31) through the taper
        sec
        sbc #$c0
        cmp #$1f
        bcc @tc
        lda #$1f
@tc:    jsr vx_taper
        sta vx_v
@send:  stx vx_t1
.ifndef STUB_MIDI
        ldy vx_v
        bit vx_t3
        bpl @off
        cpy #0
        bne @mo
        iny
        bne @mo
@off:   ldy #0
@mo:    lda vx_n
        jsr midi_note_out
.endif
        ldx vx_t1
        lda vx_t3
        and #$80
        ora vx_n
        sta vx_n
        jsr vx_qpush
        jmp vx_drain

; Side of note vx_n for keyboard routing -> X (SPLIT: below the split point = LEFT).
vx_route:
        ldx #0
        lda PERF+PF_KBMODE
        cmp #1
        bne @r
        lda vx_n
        cmp PERF+PF_SPLIT
        bcs @r
        inx
@r:     rts

; Keyboard taper: A = speed 0-31 (0 fastest), X = side (buffer byte $27 selects user / factory 1-3).
vx_taper:
        sta vx_t0
        lda EDIT_R+$27
        cpx #0
        beq @b
        lda EDIT_L+$27
@b:     and #3
        eor #3
        beq @user
        sec
        sbc #1
        asl
        asl
        asl
        asl
        asl
        ora vx_t0
        tay
        lda tb_taper_fact,y
        rts
@user:  lda vx_t0                   ; user taper: 15 speed buckets
        cmp #6
        bcc @u
        cmp #$10
        bcc @u2
        cmp #$1c
        bcc @u4
        lda #$0e
        bne @u
@u4:    lsr
        lsr
        clc
        adc #7
        bne @u
@u2:    lsr
        clc
        adc #3
@u:     tay
        lda BRAM_TAPER,y
        rts

; ------------------------------------------------------------------ public key entry points (main loop)
; Keyboard-routed note on: A note, Y velocity (0-127, used as is: no taper).
vx_key_on:
        sta vx_n
        sty vx_v
        lda #$80
        sta vx_t0
        jsr vx_mark
        jmp vx_kr
vx_key_off:
        sta vx_n
        lda #0
        sta vx_v
        sta vx_t0
        jsr vx_mark
vx_kr:  jsr vx_route
        lda vx_n
        ora vx_t0
        sta vx_n
        jmp vx_qpush
; vk_down of note vx_n (test port / UI keys, for the held-key query): A = $80 down / 0 up.
vx_mark:
        pha
        lda vx_n
        sec
        sbc #$21
        cmp #3
        bcc @r
        cmp #64
        bcs @r
        eor #$3f
        tax
        pla
        sta vk_down,x
        rts
@r:     pla
        rts

; MIDI: X side, A note, Y velocity. Outside SPLIT everything plays on the RIGHT queue.
vx_side_on:
        sta vx_n
        sty vx_v
        lda #$80
        ora vx_n
        sta vx_n
        bne vx_sq
vx_side_off:
        sta vx_n
        lda #0
        sta vx_v
vx_sq:  lda PERF+PF_KBMODE
        cmp #1
        beq @s
        ldx #0
@s:     cpx #2
        bcs @r
        jmp vx_qpush
@r:     rts

; All notes off: every key-down voice gets its key-up (held voices keep sounding), queues emptied.
vx_all_off:
        lda #0
        sta vx_stn
        sta vx_stn+1
        ldx #1
@q:     lda vx_qw,x
        sta vx_qr,x
        dex
        bpl @q
        ldx #7
@v:     lda vx_key,x
        bpl @n
        and #$7f
        sta vx_key,x
        lda #$ff
        sta vx_new,x
        lda vx_dis,x
        bmi @n
        lda vx_key,x
        sta vx_nn,x
@n:     dex
        bpl @v
        rts

; Lowest held keyboard key: A = MIDI note, or $FF (no key down). For the UI's split point.
eng_lowest_held:
        ldx #60
@l:     lda vk_down,x
        bmi @f
        dex
        bpl @l
        lda #$ff
        rts
@f:     txa
        eor #$3f
        clc
        adc #$21
        rts

; ------------------------------------------------------------------ main loop: assignment and voice update
vx_service:
        jsr vx_drain
        lda PERF+PF_KBMODE
        cmp #1
        beq @split
        ldx #0
        jsr vx_ctx
        lda PERF+PF_UNISON
        lsr
        bcc @poly
        lda PERF+PF_HOLD            ; unison over 8 voices (WHOLE 8) / 4+4 (LAYER)
        and #1
        sta vx_hold
        lda #0
        sta vx_e4
        jsr vx_uproc
        lda #7
        sta vx_top
        jsr vx_uasg
        lda PERF+PF_KBMODE
        bne @lay2
        jmp vx_update               ; WHOLE 8 (top 7)
@poly:  lda #4
        ldy PERF+PF_KBMODE
        bne @p4
        lda #8                      ; WHOLE 8: one 8-voice side
@p4:    sta vx_cnt
        jsr vx_pproc
        lda #7
        ldy PERF+PF_KBMODE
        beq @t7
        lda #3
@t7:    sta vx_top
        jsr vx_assign
        lda PERF+PF_KBMODE
        bne @lay
        jmp vx_update
@lay:   jsr vx_lcopy
@lay2:  lda #3
        sta vx_top
        jmp vx_both
@split: lda #3
        sta vx_top
        ldx #0
        jsr @side
        ldx #1
        jsr @side
        jmp vx_both
@side:  jsr vx_ctx
        ldx vx_s
        lda PERF+PF_UNISON
        and side_bit,x
        beq @sp
        lda PERF+PF_HOLD
        and side_bit,x
        sta vx_hold
        txa
        bne @nz
        sta vx_e4                   ; (the original resets the RIGHT position only)
@nz:    jsr vx_uproc
        jmp vx_uasg
@sp:    lda #4
        sta vx_cnt
        jsr vx_pproc
        jmp vx_assign
vx_both:
        ldx #0
        jsr vx_ctx
        jsr vx_update
        ldx #1
        jsr vx_ctx
        jmp vx_update

; ---- poly assigner: process side vx_s's queue over vx_cnt voices from vx_b
vx_pproc:
@next:  jsr vx_qpop
        bcc @ev
        rts
@ev:    lda vx_n
        bmi @on
        ldy vx_cnt                  ; key up: every voice with this key down
@ku:    dey
        bmi @next
        jsr vx_abs
        lda vx_key,x
        bpl @ku
        and #$7f
        cmp vx_n
        bne @ku
        sta vx_key,x
        lda #$ff
        sta vx_new,x
        lda vx_dis,x
        bmi @ku
        lda vx_n
        sta vx_nn,x
        jmp @ku
@on:    lda #0
        sta vx_t2                   ; pass 0: free voices only, pass 1: steal
@retry: lda vx_cnt
        sta vx_t1
        ldx vx_s
        ldy vx_e4,x
        lda vx_asg
        and #2
        bne @srch
        ldy vx_cnt                  ; modes 0/1: a voice that last played this note first
@same:  dey
        bmi @s0
        jsr vx_abs
        lda vx_key,x
        ora #$80
        cmp vx_n
        bne @same
        lda vx_dis,x
        bmi @same
        jmp @set
@s0:    ldx vx_s
        ldy vx_e4,x
@srch:  lda vx_asg
        lsr
        bcs @l308                   ; modes 1/3 may reuse the last voice
@l307:  dey
@l308:  bpl @try
        ldy vx_cnt
        bne @l307
@try:   dec vx_t1
        bmi @none
        jsr vx_abs
        lda vx_t2
        bne @p2
        lda vx_key,x
        bmi @l307
@p2:    lda vx_dis,x
        bmi @l307
        tya
        ldx vx_s
        sta vx_e4,x
        jsr vx_abs
@set:   lda vx_n
        sta vx_key,x
        sta vx_new,x
        sta vx_nn,x
        lda vx_v
        sta vx_vel,x
        lda vx_gate,x
        ora vx_rel,x
        beq @nx
        lda #$ff
        sta vx_rst,x
@nx:    jmp @next
@none:  lda vx_t2
        beq @p1
        rts                         ; no voice at all: the event is dropped, the rest waits
@p1:    inc vx_t2
        jmp @retry

; ---- unison: one voice (vx_b) with a stack of the keys held under it
vx_uproc:
@next:  jsr vx_qpop
        bcc @ev
        rts
@ev:    ldx vx_b
        lda vx_n
        bpl @off
        lda vx_hold
        beq @h
        rts                         ; held: new keys are ignored
@h:     lda vx_key,x
        bpl @free
        and #$7f
        jsr vx_spush
        ldx vx_b
        lda vx_asg
        cmp #1
        beq @set
        bne @rst
@free:  lda vx_gate,x
        ora vx_rel,x
        beq @set
@rst:   lda #$ff
        sta vx_rst,x
@set:   lda vx_n
        sta vx_key,x
        sta vx_new,x
        sta vx_nn,x
        lda vx_v
        sta vx_vel,x
        jmp @next
@off:   lda vx_key,x
        and #$7f
        cmp vx_n
        bne @stk
        sta vx_key,x
        ldy vx_hold
        bne @stk
        sta vx_nn,x
        lda #$ff
        sta vx_new,x
@stk:   jsr vx_sdel                 ; forget the key in the stack
        ldx vx_b
        lda vx_key,x
        bmi @nx
        ldy vx_s
        lda vx_stn,y
        beq @nx
        jsr vx_spop                 ; the previous held key sounds again
        ora #$80
        ldx vx_b
        sta vx_key,x
        ldy vx_hold
        bne @nx
        sta vx_new,x
        sta vx_nn,x
        lda vx_asg
        cmp #1
        beq @nx
        lda #$ff
        sta vx_rst,x
@nx:    jmp @next

; Unison stack of side vx_s: push A (full: the oldest is dropped).
vx_spush:
        pha
        ldx vx_s
        lda vx_stn,x
        cmp #8
        bne @p
        lda #0
        jsr vx_srem
@p:     ldx vx_s
        lda vx_stn,x
        inc vx_stn,x
        jsr vx_six
        pla
        sta vx_stk,y
        rts
vx_six: sta vx_t0                   ; Y = side*8 + A
        txa
        asl
        asl
        asl
        ora vx_t0
        tay
        rts
vx_spop:
        ldx vx_s
        dec vx_stn,x
        lda vx_stn,x
        jsr vx_six
        lda vx_stk,y
        rts
; Remove every occurrence of vx_n.
vx_sdel:
        ldx vx_s
        lda vx_stn,x
        sta vx_t3
@l:     dec vx_t3
        bmi @r
        ldx vx_s
        lda vx_t3
        jsr vx_six
        lda vx_stk,y
        cmp vx_n
        bne @l
        lda vx_t3
        jsr vx_srem
        jmp @l
@r:     rts
; Remove entry A of side vx_s's stack.
vx_srem:
        sta vx_t0
        ldx vx_s
        txa
        asl
        asl
        asl
        sta vx_t2                   ; side*8
        ora vx_t0
        tay
@m:     iny
        tya
        sec
        sbc vx_t2
        cmp vx_stn,x
        bcs @d
        lda vx_stk,y
        sta vx_stk-1,y
        bne @m
        beq @m
@d:     dec vx_stn,x
        rts

; ---- voice data of new notes (stock $F9E8): sounding note, velocity tapers
vx_assign:
        jsr vx_arprun
        beq vx_assign_n
        jmp vx_arp
vx_assign_n:
        jsr vx_anynew
        bne @go
        rts
@go:    jsr vx_clipset
        jsr vx_mask
        ldy vx_top
@l:     sty vx_t2
        jsr vx_abs
        lda vx_new,x
        beq @n
        jsr vx_isdis
        bcs @n
        lda vx_nn,x
        sta vx_note,x
        lda vx_vel,x
        jsr vx_tvca
        sta vx_vca,x
        lda vx_vel,x
        jsr vx_tmod
        sta vx_mvel,x
        lda vx_vel,x
        jsr vx_tatt
        sta vx_avel,x
        jsr env_vel
@n:     ldy vx_t2
        dey
        bpl @l
        rts

; ---- unison voice data (stock $FA15): voice vx_b's note on every voice of the side (vx_top+1 voices)
vx_uasg:
        jsr vx_arprun
        beq @na
        jmp vx_uarp
@na:    ldx vx_b
        lda vx_new,x
        bne vx_ucopy
        rts
vx_ucopy:
        jsr vx_clipset
        ldx vx_b
        lda vx_vel,x
        jsr vx_tmod
        sta vx_t2
        ldx vx_b
        lda vx_vel,x
        jsr vx_tvca
        sta vx_t3
        ldx vx_b
        lda vx_vel,x
        jsr vx_tatt
        sta vx_t0
        ldx vx_b
        lda vx_nn,x
        sta vx_c
        lda vx_rst,x
        sta vx_k
        jsr vx_mask
        ldy vx_top
@l:     jsr vx_abs
        lda vx_t2
        sta vx_mvel,x
        lda vx_t3
        sta vx_vca,x
        lda vx_t0
        sta vx_avel,x
        jsr env_vel
        jsr vx_isdis
        bcs @dis
        lda vx_c
        sta vx_note,x
        lda vx_k
        sta vx_rst,x
        jmp @nx
@dis:   lda #0
        sta vx_note,x
@nx:    lda #$ff
        sta vx_new,x
        dey
        bpl @l
        rts

; ---- LAYER: voices 4-7 copy voices 0-3 (stock $FC27)
vx_lcopy:
        ldx #3
@l:     lda vx_note,x
        sta vx_note+4,x
        lda vx_mvel,x
        sta vx_mvel+4,x
        lda vx_vca,x
        sta vx_vca+4,x
        lda vx_avel,x
        sta vx_avel+4,x
        lda vx_new,x
        sta vx_new+4,x
        lda vx_rst,x
        sta vx_rst+4,x
        txa
        pha
        clc
        adc #4
        tax
        jsr env_vel
        pla
        tax
        dex
        bpl @l
        rts

; ---- side update (stock $EB58): gates, note-on CVs, envelope retrigger, keyboard gate / CV
vx_update:
        jsr vx_anynew               ; nothing to do: no new note, no refresh due
        ora vx_force
        bne @go
        lda vx_ref
        bmi @r
        jsr vx_pending
        beq @go
@r:     rts
@go:    jsr cv_lock
        ldx vx_s
        lda vx_kcvs,x
        sta vx_kcv
        lda #0
        sta vx_g
        sta vx_akey
        jsr vx_pending              ; parameter refresh only while no key event waits
        ora vx_busy
        sta vx_pend
        ldy vx_top
@v:     jsr vx_abs
        lda vx_key,x                ; some key down on the side (arpeggiator clock retrigger)
        bpl @nk
        lda #$ff
        sta vx_akey
@nk:    lda vx_note,x
        bmi @gon
        lda vx_gate,x
        beq @g2
        lda #$ff
        sta vx_rel,x
        lda #0
        sta vx_gate,x
        jsr env_gate
        jmp @g2
@gon:   lda #$20
        sta vx_g
        sta vx_gate,x
        jsr env_gate
@g2:    lda vx_new,x
        bne @proc
        lda vx_pend                 ; parameter refresh: one voice per pass, when no key event waits
        ora vx_busy
        bne @nx
        cpx vx_ref
        bne @nx
        dec vx_ref
@proc:  sty vx_y
        lda vx_gate,x
        bne @on
        lda vx_note,x               ; key up: the keyboard CV follows the highest gated key
        jsr vx_kidx
        cmp vx_kcv
        bne @fin
        jsr vx_maxg
        jmp @fin
@on:    ldy vx_s
        lda vx_sgate,y
        bne @son
        lda PERF+PF_UNISON
        and side_bit,y
        bne @uk
        jsr vx_maxg
        jmp @noc
@uk:    lda vx_note,x
        jsr vx_kidx
        sta vx_kcv
        jmp @noc
@son:   lda vx_note,x
        jsr vx_kidx
        cmp vx_kcvs,y
        bcc @noc
        sta vx_kcv
@noc:   jsr vx_noteon
@fin:   lda #0
        sta vx_new,x
        lda vx_rst,x
        beq @nr
        lda #0
        sta vx_rst,x
        jsr env_restart
@nr:    ldy vx_y
@nx:    dey
        bmi @sg
        jmp @v
@sg:
        ldx vx_s                    ; first key down with ARP RETRIGGER: the arpeggiator clock restarts
        lda PERF+PF_ARP_RETRIG
        beq @nrt
        lda vx_akeyp,x
        eor #$ff
        and vx_akey
        bpl @nrt
        jsr vx_clkretrig
        ldx vx_s
@nrt:   lda vx_akey
        sta vx_akeyp,x
        ; side gate: LFO retrigger / delay, keyboard gate slot
        ldx vx_s
        lda vx_g
        cmp vx_sgate,x
        beq @kc
        cmp #0
        beq @off
        txa
        bne @lk
        lda PERF+PF_ARP_SYNC        ; RIGHT: the LEFT arpeggiator clocked by a LEFT LFO restarts it (L-R sync)
        beq @lk
        lda PERF+PF_ARP_ON
        and #2
        beq @lk
        lda PERF+PF_ARP_PAUSE
        bne @lk
        ldx #1
        lda PERF+PF_ARP_CLK_L
        beq @lk0
        cmp #1
        beq @ls
        ldx #3
@ls:    jsr lfo_reset
@lk0:   ldx vx_s
@lk:    jsr lfo_key                 ; LFO1 of the side
        ldx vx_s
        inx
        inx
        jsr lfo_key                 ; LFO2
        ldx vx_s
        lda #$20
@off:   sta vx_sgate,x
        jsr vx_cvout
        bcs @kc
        lda vx_g
        beq @g0
        lda #$7f
@g0:    ldx #$50
        ldy cv_pb+$50
        jsr cv_write
@kc:    lda vx_kcv
        beq @done
        ldx vx_s
        cmp vx_kcvs,x
        beq @done
        sta vx_kcvs,x
        jsr lfo_rates               ; LFO keyboard tracking follows the keyboard CV
        ldx vx_s
        jsr vx_cvout
        bcs @done
        lda vx_kcv
        ldx #$55
        ldy #0
        jsr cv_write
@done:  lda #0
        sta vx_busy
        ldx vx_s
        bne @nf
        lda PERF+PF_KBMODE          ; the last side updated clears the forced pass
        bne @u
@nf:    lda #0
        sta vx_force
@u:     jmp cv_unlock

; A = OR of the side's new-note flags (Z = 1: none).
vx_anynew:
        lda vx_b
        clc
        adc vx_top
        tax
        lda #0
@l:     ora vx_new,x
        cpx vx_b
        beq @e
        dex
        jmp @l
@e:     cmp #0
        rts

; Highest key index among the side's gated voices -> vx_kcv (0 if none). X, Y preserved.
vx_maxg:
        txa
        pha
        tya
        pha
        lda #0
        sta vx_kcv
        ldy vx_top
@l:     jsr vx_abs
        lda vx_note,x
        bpl @n
        jsr vx_kidx
        cmp vx_kcv
        bcc @n
        sta vx_kcv
@n:     dey
        bpl @l
        pla
        tay
        pla
        tax
        rts

; Does side vx_s drive the CV/GATE output? C = 0 yes.
vx_cvout:
        lda PERF+PF_CVLEFT
        ldx vx_s
        bne @l
        cmp #0
        beq @y
        lda PERF+PF_KBMODE
        beq @y
@n:     sec
        rts
@l:     cmp #0
        beq @n
@y:     clc
        rts

; ---- note-on CVs of voice X (stock $ED97). Main loop, DAC locked. X preserved.
vx_noteon:
        stx vx_t0
        lda #$ff
        sta vx_busy
        lda vx_note,x
        and #$7f
        sta vx_t1                   ; note
        jsr vx_kidx
        sta vx_k
        lda #0
        rol
        sta vx_c
        ldy vx_s
        lda PERF+PF_OCT_R,y
        tay
        lda vx_k
        clc
        adc vx_oct12,y
        adc vx_c
        sta vx_t2                   ; key index + octave (+1)
        lda vx_t1
        sta vx_tgt,x
        ldy vx_s
        lda PERF+PF_KBMODE
        cmp #2
        bne @g
        ldy #0                      ; LAYER: glide of the RIGHT side
@g:     lda vx_goff,y
        bpl @vcf                    ; gliding: the glide routine moves the pitch
        lda vx_t1
        sta vx_cur,x
        lda #0
        sta vx_frac,x
        ; VCO2 pitch -> ch3
        clc
        lda vx_b2l,x
        adc vx_t1
        sta vx_t3
        lda vx_b2h,x
        adc #0
        jsr vx_pcl
        pha
        ldy vx_b2f,x
        txa
        asl
        asl
        asl
        ora #3
        tax
        pla
        jsr cv_write
        ldx vx_t0
        ldy #$0e                    ; VCO1 keyboard tracked (bit 7 = 1)?
        lda (vx_bp),y
        bpl @vcf
        clc
        lda vx_b1l,x
        adc vx_t1
        sta vx_t3
        lda vx_b1h,x
        adc #0
        jsr vx_pcl
        pha
        ldy vx_b1f,x
        txa
        asl
        asl
        asl
        ora #7
        tax
        pla
        jsr cv_write
        ldx vx_t0
@vcf:   ldy #$13                    ; VCF keyboard tracking (bit 7 = 0)
        lda (vx_bp),y
        bmi @pwm
        ldy #$1d                    ; half tracking (bit 7 = 0)
        lda (vx_bp),y
        php
        lda vx_t2
        clc
        adc #$d6                    ; - 42
        plp
        bmi @full
        cmp #$80
        ror
@full:  sta vx_t3
        ldy #$13
        lda (vx_bp),y
        and #$7f
        clc
        adc vx_t3
        bpl @fc
        bvs @fmax
        lda #0
        beq @fc
@fmax:  lda #$7f
@fc:    pha
        txa
        cmp #4
        bcc @fs
        adc #3                      ; (C = 1) voices 4-7 -> $48-$4B
@fs:    adc #$40
        tax
        pla
        ldy #0
        jsr cv_write
        ldx vx_t0
@pwm:   ldy vx_s                    ; PWM keyboard tracking: multiplier from the key index
        lda ap_pwm_kbd,y
        beq @p2
        lda ap_pwm_dep,y
        jsr vx_pwmk
        sta ap_pwm_mul,x
@p2:    lda ap_pwm_kbd+2,y
        beq @vel
        lda ap_pwm_dep+2,y
        jsr vx_pwmk
        sta ap_pwm_mul+8,x
@vel:   ldy #$24                    ; velocity slot: velocity or keyboard CV, optionally inverted
        lda #0
        sta vx_t3
        lda (vx_bp),y
        bmi @ni
        lda #$7f
        sta vx_t3
@ni:    dey
        lda (vx_bp),y
        bmi @vv
        lda vx_k
        lsr
        adc vx_k
        ldy vx_t3
        bne @inv
        adc #$18
        bne @vw
@vv:    lda vx_mvel,x
@inv:   eor vx_t3
@vw:    pha
        txa
        clc
        adc #$58
        tax
        pla
        ldy #0
        jsr cv_write
        ldx vx_t0
        ; envelope rates with velocity -> attack and keyboard decay/release tracking
        lda vx_s
        sta en_side
        ldy #$0c
        lda (vx_bp),y
        bmi @nk
        iny
        lda (vx_bp),y
        and #$80
        sta vx_t3
        lda vx_k
        lsr
        lsr
        bit vx_t3
        bmi @kf
        lsr
@kf:    sta vx_t3
        jmp @a
@nk:    lda #$ff
        sta vx_t3
@a:     ldy #$0a
        lda (vx_bp),y
        bmi @na
        iny
        lda (vx_bp),y
        and #$80
        sta vx_t2
        lda vx_avel,x
        lsr
        bit vx_t2
        bmi @go
        lsr
        jmp @go
@na:    lda #$ff
@go:    ldy vx_t3
        jsr env_note
        ldx vx_t0
        sta SH_HOLD
        rts

; Pitch PA: A = high byte, vx_t3 = semitone byte of base + note -> clamped 0-127.
vx_pcl:
        bmi @z
        bne @m
        lda vx_t3
        bpl @r
@m:     lda #$7f
@r:     rts
@z:     lda #0
        rts
vx_oct12:   .byte 0, 12, 24

; PWM keyboard-tracking multiplier: A = depth*16, vx_k = key index.
vx_pwmk:
        sta vx_t3
        lda vx_k
        and #$3f
        bit vx_t3
        bpl @b6
        asl
        asl
        rts
@b6:    bvc @r
        asl
@r:     rts

; ------------------------------------------------------------------ voice flags (disable / HOLD lock)
; A = sides to recompute (bit0 RIGHT, bit1 LEFT), Y = HOLD lock bits (keys down now stay locked).
; Then: circular positions restart at the highest free voice, and voices that are free again release
; the keys that went up meanwhile (stock $A3CB/$A3DA/$A465).
vx_flags:
        sta vx_t0
        sty vx_t3
        jsr vx_mask
        lda PERF+PF_KBMODE
        cmp #1
        beq @sp
        ldx #7                      ; WHOLE 8 / LAYER: everything cleared, side 0 recomputed
        lda #0
@c:     sta vx_dis,x
        dex
        bpl @c
        ldx #7
        lda PERF+PF_KBMODE
        beq @w
        ldx #3
@w:     lda #1
        jsr @one
        dex
        bpl @w
        lda PERF+PF_KBMODE
        cmp #2
        bne @tail
        ldx #3                      ; LAYER: voice pairs v / v+4 share their flags
@p:     lda vx_dis,x
        ora vx_dis+4,x
        sta vx_dis,x
        sta vx_dis+4,x
        dex
        bpl @p
        bmi @tail
@sp:    lsr vx_t0
        bcc @s1
        ldx #3
@r:     lda #1
        jsr @one
        dex
        bpl @r
@s1:    lsr vx_t0
        bcc @tail
        ldx #7
@l:     lda #2
        jsr @one
        dex
        cpx #3
        bne @l
        beq @tail
@one:   and vx_t3
        beq @nl
        lda vx_key,x
        and #$80
@nl:    sta vx_t2
        jsr vx_isdis
        lda #0
        ror
        ora vx_t2
        sta vx_dis,x
        rts
@tail:  lda #0                      ; circular positions
        sta vx_t0
        lda #4
        ldx PERF+PF_KBMODE
        bne @c4
        lda #8
@c4:    sta vx_cnt
        lda #0
        sta vx_b
        jsr @srch
        sta vx_e4
        lda PERF+PF_KBMODE
        beq @rs
        lda #4
        sta vx_b
        lda vx_e4
        jsr @srch
        sta vx_e4+1
@rs:    ldx #7                      ; release keys that went up while the voice was locked
@q:     lda vx_dis,x
        bmi @qn
        lda vx_key,x
        cmp vx_nn,x
        beq @qn
        sta vx_nn,x
        lda #$ff
        sta vx_new,x
@qn:    dex
        bpl @q
        rts
; Highest free voice below position A (wrapping), 8 tries -> A (unchanged if none).
@srch:  sta vx_t1
        tay
        lda #8
        sta vx_t2
@d:     dey
        bpl @t
        ldy vx_cnt
        bpl @d
@t:     dec vx_t2
        bmi @no
        jsr vx_abs
        lda vx_dis,x
        bmi @d
        tya
        rts
@no:    lda vx_t1
        rts

vx_shadow:
        lda PERF+PF_KBMODE
        sta vx_pmode
        lda PERF+PF_UNISON
        sta vx_puni
        lda PERF+PF_HOLD
        sta vx_phold
        lda PERF+PF_VOICEMASK
        sta vx_pmask
        rts

; Split latch $6304 (IC3 Q4): $FF in WHOLE 8.
vx_split_latch:
        lda #0
        ldx PERF+PF_KBMODE
        bne @w
        lda #$ff
@w:     sta LATCH_3+4
        rts

; ------------------------------------------------------------------ performance changes (main loop)
vx_apply_perf:
        lda PERF+PF_KBMODE
        cmp vx_pmode
        bne @mode
        lda PERF+PF_UNISON
        cmp vx_puni
        bne @mode
        lda PERF+PF_VOICEMASK
        cmp vx_pmask
        beq @h
        jsr vx_modereset            ; (stock SET page: like a mode change, held keys played again)
        jsr vx_reinject
        jmp vx_split_latch
@h:     lda PERF+PF_HOLD
        eor vx_phold
        beq @done
        sta vx_t0
        lda PERF+PF_HOLD
        sta vx_phold
        ldy PERF+PF_HOLD
        lda PERF+PF_KBMODE
        cmp #1
        beq @hs
        lda vx_t0                   ; WHOLE 8 / LAYER: only HOLD RIGHT acts
        and #1
        beq @done
@hs:    lda vx_t0
        jsr vx_flags
@done:  jmp vx_split_latch
@mode:  jsr vx_modereset
        jmp vx_split_latch

; Keyboard mode / unison change (stock $A46D + $F6EA + envelope reset): queues and stacks emptied, every gate
; closed, flags recomputed, envelopes idle; keys still down stay silent until played again.
vx_modereset:
        jsr cv_lock
        ldx #1
@q:     lda vx_qw,x
        sta vx_qr,x
        lda #0
        sta vx_stn,x
        dex
        bpl @q
        ldx #7
@v:     lda vx_key,x
        and #$7f
        sta vx_key,x
        lda vx_nn,x
        and #$7f
        sta vx_nn,x
        lda vx_note,x
        and #$7f
        sta vx_note,x
        lda #0
        sta vx_gate,x
        jsr env_gate
        dex
        bpl @v
        jsr vx_shadow
        lda #3
        ldy #0
        jsr vx_flags
        jsr env_reset
        jsr vx_cvclr
        lda #$ff
        sta vx_force
        ldx #60                     ; keyboard state resync (stock $B61A)
@k:     lda vk_down,x
        bmi @kd
        lda vk_st,x
        cmp #2
        bne @kn
        lda #$80
        sta vk_down,x
        txa
        ora #$80
        bne @kp
@kd:    lda vk_st,x
        cmp #2
        beq @kn
        lda #0
        sta vk_down,x
        txa
@kp:    stx vx_t0
        php
        sei
        jsr vk_push
        plp
        ldx vx_t0
@kn:    dex
        bpl @k
        jmp cv_unlock

; Every key held is played again (stock $A49A, no MIDI out).
vx_reinject:
        ldx #60
@k:     lda vk_down,x
        bpl @n
        stx vx_t3
        txa
        eor #$3f
        clc
        adc #$21
        sta vx_n
        jsr vx_route                ; X = side
        ldy vx_t3
        lda vk_cnt,y
        sec
        sbc #$c0
        cmp #$1f
        bcc @t
        lda #$1f
@t:     jsr vx_taper
        sta vx_v
        lda vx_n
        ora #$80
        sta vx_n
        jsr vx_qpush
        ldx vx_t3
@n:     dex
        bpl @k
        rts

; Side gate / keyboard CV cleared (stock $F6EA, after a program recall or a mode change).
vx_cvclr:
        lda #0
        sta vx_sgate                ; (the original clears the RIGHT side gate only)
        sta cv_pa+$50
        sta vx_kcvs
        sta vx_kcvs+1
        rts

; Program recall: envelopes idle, keyboard CV / gate cleared. Call after eng_apply_prog.
vx_recall:
        jsr env_reset
        jmp vx_cvclr

; ------------------------------------------------------------------ program parameters (X = side, en_buf)
; Pitch bases of the side's 4 voices (stock $AEB3), glide (stock $DE30), static VCO1 pitch (stock $DA64).
vx_apply:
        stx vx_s
        ldy #0                      ; octave: WHOLE 8 uses the RIGHT one for every voice
        lda PERF+PF_KBMODE
        beq @o
        ldy vx_s
@o:     lda PERF+PF_OCT_R,y
        tay
        lda vx_oct12,y
        sta vx_t1
        lda vx_s
        asl
        asl
        sta vx_t0                   ; first voice
        tax
        clc
        adc #4
        sta vx_t3
@v:     ldy #$0d                    ; VCO1: frequency $0D, detune $22 (x2), osc 2v+1
        lda (en_buf),y
        and #$7f
        sta vx_t2
        txa
        asl
        tay
        iny
        sty vx_y
        ldy #$22
        lda (en_buf),y
        asl
        ldy vx_y
        jsr vx_base
        sta vx_b1l,x
        lda vx_k
        sta vx_b1f,x
        lda vx_c
        sta vx_b1h,x
        ldy #$0e                    ; VCO2: frequency $0E, osc 2v
        lda (en_buf),y
        and #$7f
        sta vx_t2
        txa
        asl
        tay
        lda #0
        jsr vx_base
        sta vx_b2l,x
        lda vx_k
        sta vx_b2f,x
        lda vx_c
        sta vx_b2h,x
        inx
        cpx vx_t3
        bne @v
        ; glide
        ldx vx_s
        lda #$ff
        sta vx_goff,x
        ldy #$0a
        lda (en_buf),y
        and #$7f
        eor #$7f
        cmp #$78
        bcs @st
        adc #6
        asl
        tay
        lda tb_param_curve,y
        sta vx_grate,x
        lda #0
        sta vx_goff,x
@st:    ldy #$0e                    ; VCO1 not keyboard tracked (bit 7 = 0): fixed pitch (note 48)
        lda (en_buf),y
        bmi @r
        ldx vx_t0
@sv:    clc
        lda vx_b1l,x
        adc #$30
        sta vx_t3
        lda vx_b1h,x
        adc #0
        jsr vx_pcl
        pha
        txa
        asl
        asl
        asl
        ora #7
        tay
        pla
        sta cv_pa,y
        lda vx_b1f,x
        sta cv_pb,y
        inx
        txa
        and #3
        bne @sv
@r:     rts

; Pitch base: A = fraction in, vx_t2 = frequency (semitones), vx_t1 = octave offset, Y = oscillator.
; -> A = semitone byte, vx_k = fraction, vx_c = high byte (24-bit value - $10000 + $8900 + offsets).
vx_base:
        clc
        adc CAL_OFS_LO,y
        sta vx_k
        lda #$ff
        sta vx_c
        lda vx_t2
        adc CAL_OFS_HI,y
        bcc @a
        inc vx_c
        clc
@a:     adc vx_t1
        bcc @b
        inc vx_c
        clc
@b:     adc #$89
        bcc @r
        inc vx_c
@r:     rts

; After a program apply: every voice's note-on CVs are recomputed (one per main-loop pass) and the glide
; routine rewrites the pitches (fraction nudged).
vx_refresh:
        ldx #7
@l:     inc vx_frac,x
        dex
        bpl @l
        lda #7
        sta vx_ref
        rts

; ------------------------------------------------------------------ glide (control tick)
; X = 0: voices 0-3 (RIGHT parameters), X = 1: voices 4-7 (LEFT parameters; WHOLE 8: RIGHT; LAYER: RIGHT glide
; with the LEFT program's flags).
vx_glide:
        lda #$ff
        sta PIA2_PA
        cpx #0
        bne @l
        lda vx_goff
        bmi @r
        lda vx_grate
        sta vg_rate
        lda EDIT_R+$0e
        sta vg_trk
        lda EDIT_R+$1f
        ldx #3
        bne @go
@l:     ldy #1
        lda PERF+PF_KBMODE
        bne @nw
        dey
        lda EDIT_R+$0e
        sta vg_trk
        lda EDIT_R+$1f
        jmp @p
@nw:    cmp #2
        bne @nl
        dey
@nl:    lda EDIT_L+$0e
        sta vg_trk
        lda EDIT_L+$1f
@p:     ldx vx_goff,y
        bmi @r
        ldx vx_grate,y
        stx vg_rate
        ldx #7
@go:    and #$10                    ; glide (1) / glissando (0)
        beq @gm
        lda #$ff
@gm:    sta vg_gm
        txa
        sec
        sbc #4
        sta vg_t                    ; last voice - 4
@v:     jsr vg_voice
        dex
        cpx vg_t
        bne @v
        sta SH_HOLD
@r:     rts

vg_voice:
        lda vx_cur,x
        cmp vx_tgt,x
        bmi @up
        bne @dn
        lda vx_frac,x
        bne @dn2
        rts
@up:    lda vx_frac,x
        clc
        adc vg_rate
        sta vx_frac,x
        bcc @u1
        inc vx_cur,x
@u1:    lda vx_cur,x
        cmp vx_tgt,x
        bcs @snap
        sec
        bcs @out
@dn:    lda vx_frac,x
@dn2:   sec
        sbc vg_rate
        sta vx_frac,x
        bcs @d1
        dec vx_cur,x
@d1:    lda vx_cur,x
        cmp vx_tgt,x
        bcc @snap
        clc
        bcc @out
@snap:  lda #0
        sta vx_frac,x
        lda vx_tgt,x
        sta vx_cur,x
        clc
@out:   lda vg_gm                   ; glissando going up rounds to the next semitone
        bpl @k
        clc
@k:     php
        lda vg_trk
        bpl @v2                     ; VCO1 untracked: fixed
        clc
        lda vx_frac,x
        and vg_gm
        adc vx_b1f,x
        sta vg_pb
        lda vx_cur,x
        adc #0
        plp
        php
        adc vx_b1l,x
        pha
        lda #0
        adc vx_b1h,x
        bmi @z1
        bne @h1p
        pla
        bpl @w1
        bmi @h1
@h1p:   pla
@h1:    lda #$ff
        sta vg_pb
        lda #$7f
        bne @w1
@z1:    pla
        lda #0
@w1:    pha
        txa
        asl
        asl
        asl
        ora #7
        tay
        pla
        sta SH_HOLD
        sta PIA1_PA
        sta cv_pa,y
        lda vg_pb
        sta PIA1_PB
        sta SH_SLOT,y
        sta SH_SAMPLE
        sta cv_pb,y
@v2:    clc
        lda vx_frac,x
        and vg_gm
        adc vx_b2f,x
        sta vg_pb
        lda vx_cur,x
        adc #0
        plp
        php
        adc vx_b2l,x
        pha
        lda #0
        adc vx_b2h,x
        bmi @z2
        bne @h2p
        pla
        bpl @w2
        bmi @h2
@h2p:   pla
@h2:    lda #$ff
        sta vg_pb
        lda #$7f
        bne @w2
@z2:    pla
        lda #0
        sta vg_pb
@w2:    pha
        txa
        asl
        asl
        asl
        ora #3
        tay
        pla
        sta SH_HOLD
        sta PIA1_PA
        sta cv_pa,y
        lda vg_pb
        sta PIA1_PB
        sta SH_SLOT,y
        sta SH_SAMPLE
        sta cv_pb,y
        plp
        rts

; ------------------------------------------------------------------ arpeggiator (stock $FA7F-$FC1B)
; Notes come from the keys held on the side (vx_nn bit 7), played on the voice that holds the key; one step
; per rising edge of the side's arpeggiator clock (RIGHT: en_aphase; LEFT: en_aphase or the sign of the
; LEFT LFO1/LFO2 phase, PF_ARP_CLK_L). Modes (stock encoding): 0 down, 1 random, 2 up, 3 up/down.

; Z = 0 when the arpeggiator of side vx_s runs.
vx_arprun:
        lda PERF+PF_ARP_PAUSE
        bne @off
        ldx vx_s
        lda PERF+PF_ARP_ON
        and side_bit,x
        rts
@off:   lda #0
        rts

; Clock level of side vx_s -> A ($80 high / 0 low).
vx_aclk:
        lda vx_s
        beq @r
        lda PERF+PF_ARP_CLK_L
        beq @r
        ldx #1
        cmp #1
        beq @l
        ldx #3
@l:     lda lfo_phi,x
        and #$80
        rts
@r:     lda en_aphase
        and #$80
        rts

; C = 1 when the clock of side vx_s has an edge (A = new level, stored).
vx_aedge_t:
        jsr vx_aclk
        ldx vx_s
        cmp vx_aedge,x
        beq @n
        sta vx_aedge,x
        sec
        rts
@n:     clc
        rts

; All voices of the side: gate off (no new-note flag; the side update sees the gates close).
vx_agoff:
        ldy vx_top
@l:     jsr vx_abs
        lda vx_note,x
        and #$7f
        sta vx_note,x
        dey
        bpl @l
        lda #$ff
        sta vx_force
        rts

; Unison + arpeggiator: the unison note restarts on every rising clock edge.
vx_uarp:
        jsr vx_aedge_t
        bcs @e
        rts
@e:     jsr vx_agoff
        ldx vx_s
        lda vx_aedge,x
        bmi @on
        rts
@on:    jmp vx_ucopy

vx_arp:
        ldy vx_top                  ; no envelope retrigger requests while arpeggiating
@c:     jsr vx_abs
        lda #0
        sta vx_rst,x
        dey
        bpl @c
        jsr vx_aedge_t
        bcs @e
        rts
@e:     ldx vx_s
        lda PERF+PF_KBDGATE         ; keyboard gate: the held keys sound together, gated by the clock
        and side_bit,x
        beq @arp
        lda vx_aedge,x
        bmi @kg
        jmp vx_agoff
@kg:    ldy vx_top
@k:     jsr vx_abs
        lda vx_nn,x
        bpl @k1
        sta vx_new,x
@k1:    dey
        bpl @k
        jmp vx_assign_n
@arp:   jsr vx_agoff
        ldx vx_s
        lda vx_aedge,x
        bmi @step
        rts
@step:  jsr vx_clipset
        ldx vx_s
        lda PERF+PF_ARP_MODE_R,x
        and #3
        beq @down
        cmp #2
        beq @up
        cmp #1
        beq @rnd
        jmp vx_aud
@rnd:   jmp vx_arnd
@down:  lda #0
        beq @dir
@up:    lda #$7f
@dir:   jsr vx_aprev
vx_afind:                           ; next note in the direction, wrapping (with auto-octave) once
        jsr vx_ascan
        lda vx_af5
        cmp vx_abest
        bne vx_aplay
        eor #$7f
        sta vx_aprv
        jsr vx_aoct
        jsr vx_ascan
        lda vx_abest
        cmp vx_af5
        bne vx_aplay
        rts                         ; nothing held
vx_aud: ldx vx_s                    ; up/down: scan the current direction, turn at the end
        ldy vx_adir,x
        lda vx_udtab,y
        jsr vx_aprev
        jsr vx_ascan
        lda vx_abest
        cmp vx_af5
        bne vx_aplay
        lda vx_af5
        bne @turn
        jsr vx_aoct                 ; (turning at the bottom steps the auto-octave)
@turn:  ldx vx_s
        ldy vx_adir,x
        dey
        bpl @t
        ldy #1
@t:     tya
        sta vx_adir,x
        lda vx_udtab,y
        sta vx_af5
        sta vx_abest
        jmp vx_afind
vx_udtab:   .byte $00, $7f

; Direction A ($7F up / 0 down): the previous arpeggio voice gets a new-note flag (its gate is off),
; vx_aprv = its note.
vx_aprev:
        sta vx_af5
        sta vx_abest
        ldx vx_s
        ldy vx_alast,x
        jsr vx_abs
        lda vx_note,x
        sta vx_new,x
        and #$7f
        sta vx_aprv
        rts

; Play held note vx_abest on voice vx_ay (relative): gate on, velocity tapers.
vx_aplay:
        ldy vx_ay
        lda vx_abest
vx_aplay2:
        ora #$80
        pha
        ldx vx_s
        tya
        sta vx_alast,x
        jsr vx_abs
        pla
        sta vx_note,x
        sta vx_new,x
        lda vx_vel,x
        jsr vx_tvca
        sta vx_vca,x
        lda vx_vel,x
        jsr vx_tmod
        sta vx_mvel,x
        lda vx_vel,x
        jsr vx_tatt
        sta vx_avel,x
        jmp env_vel

; Closest held key beyond vx_aprv in the direction -> vx_abest (note), vx_ay (voice). Ties: first found.
vx_ascan:
        ldy vx_top
@l:     jsr vx_abs
        lda vx_nn,x
        bpl @n
        and #$7f
        cmp vx_aprv
        beq @n
        jsr vx_ainv
        bcc @n
        cmp vx_abest
        jsr vx_ainv
        bcs @n
        sta vx_abest
        sty vx_ay
@n:     dey
        bpl @l
        rts
; Going down: carry inverted (A preserved).
vx_ainv:
        pha
        lda vx_af5
        bne @r
        ror
        eor #$80
        asl
@r:     pla
        rts

; Random: the (r mod held)-th held key (r = 0-7), random auto-octave steps.
vx_arnd:
        php
        sei
        jsr lfo_random
        plp
        and #7
        sta vx_aprv
        lda #0
        sta vx_t3
@o:     ldy vx_top
@l:     jsr vx_abs
        lda vx_nn,x
        bpl @n
        inc vx_t3
        dec vx_aprv
        bmi @f
@n:     dey
        bpl @l
        lda vx_t3
        bne @o
        rts
@f:     sty vx_ay
        ldx vx_s
        ldy vx_alast,x
        jsr vx_abs
        lda #$ff
        sta vx_new,x
        lda vx_s
        pha
        jsr vx_aroct
        lda PERF+PF_KBMODE
        cmp #2
        bne @nl
        inc vx_s                    ; LAYER: the LEFT side's own random octave
        jsr vx_aroct
@nl:    pla
        sta vx_s
        ldy vx_ay
        jsr vx_abs
        lda vx_nn,x
        jmp vx_aplay2
vx_aroct:
        lda #$ff
        sta vx_af5
        php
        sei
        jsr lfo_random
        plp
        and #$0f
        cmp #2
        bcs @r
        cmp #1
        bcs @s
        lda #0
        sta vx_af5
@s:     jmp vx_aoct1
@r:     rts

; Auto-octave step (vx_af5: $7F up = +1 state, 0 down = -1 state), both sides in LAYER.
vx_aoct:
        lda vx_s
        pha
        jsr vx_aoct1
        lda PERF+PF_KBMODE
        cmp #2
        bne @r
        lda #1
        sta vx_s
        jsr vx_aoct1
        lda #0
        sta vx_s
@r:     pla
        sta vx_s
        rts
vx_aoct1:
        ldx vx_s
        lda PERF+PF_ARP_AUTOOCT
        and side_bit,x
        beq @r
        jsr vx_ocyc
        lda vx_af5
        bne @r
        jsr vx_ocyc                 ; down = two steps of the 3-state cycle
@r:     rts
; Octave of side vx_s: next of down / normal / up; pitch bases recomputed, voices refreshed.
vx_ocyc:
        ldx vx_s
        inc PERF+PF_OCT_R,x
        lda PERF+PF_OCT_R,x
        cmp #3
        bcc @k
        lda #0
        sta PERF+PF_OCT_R,x
@k:     lda vx_s
        pha
        jsr cv_lock
        ldx #0
        jsr ap_select
        ldx #0
        jsr vx_apply
        ldx #1
        jsr ap_select
        ldx #1
        jsr vx_apply
        jsr cv_unlock
        pla
        sta vx_s
        lda #7
        sta vx_ref
        rts

; ARP RETRIGGER: the internal clock restarts high (stock $EBC7), the edge detectors are cleared.
vx_clkretrig:
        php
        sei
        lda #2
        sta en_tdiv6
        lda en_trate
        sta en_tcount
        lda #$ff
        jsr clk_out
        plp
        lda #0
        sta vx_aedge
        lda PERF+PF_ARP_CLK_L
        bne @r
        lda #0
        sta vx_aedge+1
@r:     rts
