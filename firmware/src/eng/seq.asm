; Polysequencer: 2 channels of keyboard events, record / play / loop / lock (bounce), overdub, double channel,
; song mode, instant record, quantize, metronome, tempo on PTM T1 (96 clocks per quarter note), external clock
; (SEQ CK IN = PIA2 CA1, 96/48/24 ppqn), and NeoV8: MIDI clock (24 ppqn, start/stop/continue), SysEx dump.
; Behaviour of the stock Rev4 ($9000 page logic, clock step $948F, events $94EA-$97BD, $B37F-$B657, quantize
; pass $A0ED, timer $A6AF-$A781), new code. Contract: api.inc; data flow: eng/ENGINE.md "Polysequencer".
;
; Event (3 bytes, stock format): b0 = bit7 key down, bit6 = delta bit 12, bits 0-5 key index (VPK-5 k);
; b1 = delta bits 8-11 in the high nibble, velocity class (0-14) in the low one, $F = end of track;
; b2 = delta bits 0-7. Delta = clocks since the previous event. Velocity class = VPK-5 timer - $C0, 13-30 -> 13,
; 31+ -> 14 (played back as 32).
; Memory: SEQ_SLOTS slots. Channel 1 (and a double-channel take) from the bottom upwards, channel 2 from the top
; downwards: a channel can use what the other one leaves.
; Contexts: seq_clock / sq_step (IRQ, clock events), seq_tick / seq_tap (control tick), the rest main loop
; under cv_lock (the IRQ clock work waits meanwhile, as with the stock's $07F5).

SEQ_BASE    = seq_ev
SEQ_TOP     = seq_ev + SEQ_SLOTS*3
SEQ_LAST    = SEQ_TOP - 3               ; first slot of channel 2
SEQ_CAP     = SEQ_SLOTS - 2             ; events of one channel when the other is empty

; ================================================================ public routines (main loop)
seq_init:
        lda #$ff
        sta sq_dblk
        lda #1
        sta seq_reps
        sta seq_reps+1
        lda #3
        jsr sq_erase
        lda #<SEQ_CAP
        sta seq_free
        lda #>SEQ_CAP
        sta seq_free+1
        lda #120                    ; (stock: first page entry, tempo 120 -> T1 $29)
        sta seq_tempo

; A = BPM: T1 period from the stock table (a tempo it cannot make rounds down). seq_tempo is not changed.
seq_tempo_set:
        cmp #20
        bcs @t
        lda #20
@t:     sec
        sbc #20
        tay
@l:     lda tb_tempo_t1,y
        cmp #$ff
        bne @f
        dey
        bne @l
@f:     sta sq_t1msb
sq_latch:                           ; T1 latch <- MSB * 256 (restarts the period, as the stock)
        lda sq_t1msb
        sta PTM_T1
        lda #0
        sta PTM_T1+1
        rts

; START/STOP (stock $9060; the checks at start replace the stock's refusal of switch chords)
seq_startstop:
        jsr cv_lock
        lda #0
        sta seq_status
        lda seq_run
        bne @stop
        jsr sq_check
        bne @r
        lda #$ff
        .byte $2c
@stop:  lda #0
        sta sq_user
        jsr sq_go
@r:     jsr sq_mkmode
        jmp cv_unlock

; CLEAR: every switch off, stop
seq_clear:
        lda #0
        ldx #seq_clk-seq_play-1
@l:     sta seq_play,x
        dex
        bpl @l
        jsr cv_lock
        jsr sq_halt
        jmp sq_unl

; A = channels (bit0 ch1, bit1 ch2): stop, forget their data
seq_erase:
        pha
        jsr cv_lock
        jsr sq_halt
        pla
        jsr sq_erase
sq_unl: jsr sq_modes
        jsr sq_mkmode
        jmp cv_unlock
sq_erase:
        lsr
        pha
        bcc @c2
        ldx #0
        jsr sq_empty
@c2:    pla
        lsr
        bcc @r
        ldx #2
        bne sq_empty
@r:     rts
; X = 2 * channel: empty track (end marker of 128 clocks, as an empty take: stock $B611)
sq_empty:
        lda sq_chs,x
        sta sq_end,x
        sta sq_tp
        lda sq_chs+1,x
        sta sq_end+1,x
        sta sq_tp+1
        lda #0
        sta seq_len,x
        sta seq_len+1,x
        tay
        sta (sq_tp),y
        iny
        lda #$0f
        sta (sq_tp),y
        iny
        lda #$80
        sta (sq_tp),y
        rts
sq_chs:     .word SEQ_BASE, SEQ_LAST    ; first slot, step of channel 1, 2
sq_stp:     .word 3, $10000-3

; Autotune reprogrammed the PTM: T1 back if the sequencer / metronome uses it (main.s autotune)
seq_retune:
        lda sq_t1run
        beq @r
        lda sq_cr1v
        jsr sq_cr1
        jmp sq_latch
@r:     rts

; Main loop: metronome switch, MIDI start/stop/continue, background dump, mode for the UI.
seq_service:
        lda seq_metro
        cmp sq_mshad
        beq @m
        sta sq_mshad
        jsr cv_lock                 ; (stock EDIT on the page, $9135)
        lda #0
        sta sq_metcnt
        lda sq_clkon
        bne @mu
        lda seq_metro
        beq @off
        jsr sq_metsrc
        jmp @mu
@off:   jsr sq_clkstop
@mu:    jsr cv_unlock
@m:
.ifndef STUB_MIDI
        ldx #2                      ; MIDI real time (counted by the NMI): stop, continue, start
@rt:    lda midi_rtcnt,x
        cmp sq_rtl,x
        beq @rn
        sta sq_rtl,x
        lda seq_clk
        cmp #2
        bne @rn
        txa
        pha
        lda seq_run
        beq @st
        cpx #1
        beq @rx                     ; continue while running: nothing
        jsr cv_lock                 ; stop / start: the stock STOP (take kept, REC off...), then stop for good
        jsr sq_restart              ; (REC + PLAY, bounce, Stevenson would go on)
        jsr sq_halt
        jsr cv_unlock
        pla
        pha
        tax
@st:    cpx #2
        beq @rx
        jsr seq_startstop           ; start / continue: START (no song position: from the beginning)
@rx:    pla
        tax
@rn:    dex
        bpl @rt
        jsr sq_dstep
.endif
        lda seq_run
        ora seq_metro
        beq @cb
        lda #$80
@cb:    sta seq_cb2
; seq_mode for the UI
sq_mkmode:
        lda #0
        bit sq_recon
        bpl @nr
        lda seq_metro
        beq @nm
        lda sq_wait                 ; metronome: waits for the beat
        bne @w
        beq @r2
@nm:    lda seq_inst                ; not instant: waits for the first key (that time is dropped)
        ora sq_rn
        ora sq_rn+1
        bne @r2
        jsr sq_ovd
        bcs @r2
@w:     lda #6
        bne @nr
@r2:    lda #2
@nr:    bit sq_playon
        bpl @np
        ora #1
@np:    ldx seq_song
        beq @ns
        ldx seq_run
        beq @ns
        ora #8
@ns:    sta seq_mode
        rts

; Start checks -> Z = 0 refused (seq_status). The stock refused these chords as they were pressed ($B43E):
; LOCK combinations, song with REC on or both PLAY, REC 1+2 with one PLAY, one REC with both PLAY (the stock
; completed / dropped a switch there). NeoV8 adds: nothing to play, song needs both channels, memory full.
sq_check:
        jsr sq_modes
        ldx sq_recch
        ldy sq_plch
        stx sq_t
        txa
        and sq_plch
        bmi @sel                    ; nothing selected
        lda seq_lock
        beq @nl
        lda seq_song
        bne @sel
        cpx #2
        beq @sel
        lda seq_loop
        beq @k0
        cpy sq_t                    ; LOCK + LOOP: REC = PLAY channel
        bne @sel
        beq @data
@k0:    cpy sq_t                    ; LOCK: REC on the other channel
        beq @sel
        cpy #2
        bne @data
@sel:   lda #2
        bne @st
@nl:    cpx #2
        bne @n1
        cpy #2                      ; REC 1+2 with one PLAY
        bcc @sel
@n1:    cpy #2
        bne @n2
        cpx #2                      ; both PLAY with one REC
        bcc @sel
@n2:    lda seq_song
        beq @data
        lda #4
        cpx #$80
        bcc @st                     ; song while recording
        lda #3
        cpy #2
        beq @st
        lda seq_len                 ; song needs data on both channels
        ora seq_len+1
        beq @s3
        lda seq_len+2
        ora seq_len+3
        bne @data
@s3:    lda #3
        bne @st
@data:  txa
        bpl @free
        tya                         ; only playing: the channel must hold something
        and #1
        asl
        tax
        lda seq_len,x
        ora seq_len+1,x
        bne @ok
        lda #1
        bne @st
@free:  jsr sq_freecalc
        bmi @full
        ora seq_free
        bne @ok
@full:  lda #5
@st:    sta seq_status
        rts
@ok:    lda #0
        rts

; seq_free = room of the record channel - 1 (the last slot is shared with the end marker), minus the events of
; the played channel when they are merged in (overdub, bounce). -> A = high byte (N).
sq_freecalc:
        ldx sq_recch
        lda #<SEQ_CAP
        sta seq_free
        lda #>SEQ_CAP
        sta seq_free+1
        cpx #2
        beq @od
        txa
        eor #1                      ; the other channel's events
        jsr @sub
@od:    jsr sq_ovd
        bcc @r
        lda sq_plch0
@sub:   asl
        tax
        lda seq_free
        sec
        sbc seq_len,x
        sta seq_free
        lda seq_free+1
        sbc seq_len+1,x
        sta seq_free+1
@r:     lda seq_free+1
        rts

; ================================================================ modes, pointers (stock $B4B6)
sq_modes:
        lda #0
        sta sq_stev
        lda seq_play
        jsr @ch
        sta sq_plch
        sta sq_plch0
        lda seq_rec
        jsr @ch
        sta sq_recch
        lda seq_lock
        beq @n
        lda seq_loop
        beq @n
        lda sq_recch
        cmp sq_plch
        bne @n
        dec sq_stev
@n:     lda sq_plch0                ; play: channel 2 from its top slot downwards, else channel 1 upwards
        ldy #0
        jsr @set
        lda sq_recch                ; record: the same
        ldy #2
        jsr @set
        ldy sq_recch
        cpy #2
        bne @c
        lda #<(SEQ_TOP-6)           ; double: all but channel 2's end-marker slot
        ldx #>(SEQ_TOP-6)
        bne @s
@c:     txa                         ; last slot = next to the other channel's end marker
        eor #2
        tax
        lda sq_end,x
        clc
        adc sq_stp,x
        pha
        lda sq_end+1,x
        adc sq_stp+1,x
        tax
        pla
@s:     sta sq_rclamp
        stx sq_rclamp+1
        rts
@set:   ldx #0                      ; A = channel, Y = 0 play / 2 record -> X = 2 * (channel = 1)
        cmp #1
        bne @s1
        ldx #2
@s1:    lda sq_chs,x
        sta sq_pstart,y
        lda sq_chs+1,x
        sta sq_pstart+1,y
        lda sq_stp,x
        sta sq_step,y
        lda sq_stp+1,x
        sta sq_step+1,y
        rts
@ch:    and #3                      ; bits PLAY/REC 1, 2 -> channel 0, 1, 2 both, $FF none
        tax
        lda sq_chtab,x
        rts
sq_chtab:   .byte $ff, 0, 1, 2

; C = 1: recording the channel other than the one playing (overdub, bounce) (stock $97B0)
sq_ovd:
        lda sq_recch
        eor #1
        cmp sq_plch0
        beq @r                      ; (C = 1)
        clc
@r:     rts

; ================================================================ START / STOP state machine
; START/STOP with sq_user set (stock $9607)
sq_go:
        lda seq_run
        beq sq_stopnow
        jsr sq_ovd
        bcc @n
        lda seq_lock
        beq sq_stopnow
        lda #0                      ; continuous overdub: STOP turns LOCK into LOOP (stock, "ruins the take")
        sta seq_lock
        lda #1
        sta seq_loop
        rts
@n:     lda sq_plch
        bmi sq_stopnow
        lda sq_recch
        bpl sq_stopnow
        lda seq_loop
        beq sq_stopnow
        lda #$ff                    ; playing a loop: stop at its end
        sta sq_stopreq
        rts

; Stop now, or start (stock $963A)
sq_stopnow:
        lda #0
        sta sq_clkon
        sta sq_recon
        sta sq_playon
        lda seq_run
        beq @start
        jmp sq_stopped
@start: ldx #3
@p:     lda sq_pstart,x             ; (pstart, rstart -> pp, rp)
        sta sq_pp,x
        dex
        bpl @p
        lda sq_recch
        bmi @song
        jsr sq_freecalc
@song:  lda seq_song
        beq @sel
        ldx sq_plch
        beq @s0
        ldx #1
@s0:    ldy seq_reps,x
        dey
        sty sq_songcnt
        lda sq_user
        beq @sel
        lda #1
        sta sq_songpass
@sel:   lda sq_recch
        cmp sq_plch
        bne @df
        cmp #$ff
        bne @rec
        jmp sq_clkstop              ; nothing to do
@df:    lda sq_plch0
        bmi @rec
        lda #$ff
        sta sq_playon
        jsr sq_ldelta
        lda sq_recch
        bmi @clk
@rec:   lda #$ff
        sta sq_recon
        lda #0
        sta sq_time
        sta sq_time+1
        sta sq_rn
        sta sq_rn+1
        lda sq_user
        beq @clk
        jsr sq_qval                 ; started by hand: round to the nearest grid point
        lsr
        sta sq_qcnt
@clk:   php                         ; (stock $A6AF)
        sei
        lda #$ff
        sta sq_clkon
        sta seq_run
        lda sq_user
        sta sq_wait
        lda #$c2                    ; T1 IRQ + clock out
        ldx seq_metro
        beq sq_src
        ldx sq_wait
        beq sq_src
        lda #$42                    ; waiting for the beat: no clock out yet
; Clock source on (stock $A6D0). Called with the flags pushed and I = 1; A = CR1 for T1.
sq_src:
        ldx seq_clk
        bne @ext
        ldx sq_t1run
        bne @r                      ; already running: keep its phase
        dec sq_t1run
        jsr sq_cr1w
        lda #$ff
        sta seq_t1on
        lda #0
        sta sq_srcon
        sta seq_caon
        lda #$34
        sta PIA2_CRA                ; CA1 IRQ off
        jsr sq_latch
@r:     plp
        rts
@ext:   lda #0                      ; external / MIDI clock: T1 off
        sta sq_t1run
        sta seq_t1on
        sta seq_caon
        lda #$ff
        sta sq_srcon
        ldy #$34
        cpx #1
        bne @m
        sta seq_caon                ; SEQ CK IN: CA1 IRQ on
        ldy #$35
@m:     sty PIA2_CRA
        lda #$02
        jsr sq_cr1w
        plp
        rts

sq_metsrc:                          ; metronome on while stopped: T1 with IRQ, no clock out (stock $A6CB)
        php
        sei
        lda #$42
        jmp sq_src

; Clock source off (stock $A745): the metronome keeps T1 running.
sq_clkstop:
        lda seq_metro
        beq @full
        lda seq_clk
        bne @full
        lda #$42
        jmp sq_cr1
@full:  php
        sei
        lda #0
        sta sq_t1run
        sta sq_srcon
        sta seq_t1on
        sta seq_caon
        lda #$34
        sta PIA2_CRA
        lda #$02
        jsr sq_cr1w
        plp
        rts

; CR1 <- A (CR2 bit 0 selects CR1, then back to CR3 as ptm_init leaves it: eng_a440 relies on it)
sq_cr1: php
        sei
        jsr sq_cr1w
        plp
        rts
sq_cr1w:
        sta sq_cr1v
        ldx #$c3
        stx PTM_CR2
        sta PTM_CR13
        dex
        stx PTM_CR2
        rts

; Was running (stock $9717)
sq_stopped:
        lda #0
        sta seq_run
        lda sq_recch
        bpl @rec
        jsr sq_resync
        lda sq_stev
        beq @cs
        lda sq_plch0                ; Stevenson: the next take replaces the loop
        sta sq_recch
        jmp sq_go
@cs:    jmp sq_clkstop
@rec:   jsr sq_recend
        lda sq_plch0
        cmp sq_recch
        bne @oth
        sta sq_plch                 ; REC + PLAY on one channel: play the take
        lda #$ff
        sta sq_recch
        lda sq_stev
        bne @g
        lda #0
        sta seq_rec
@g:     jmp sq_go
@oth:   lda seq_lock
        bne @lk
        lda #$ff
        sta sq_recch
        lda #0
        sta seq_rec
        beq @cs
@lk:    lda sq_plch
        bmi @auto
        lda sq_stev
        beq @cs
        lda #$ff
        sta sq_recch
        bne @g
@auto:  ldx #2                      ; REC + LOCK: bounce to the other channel (stock $978D)
        lda #1
        ldy sq_recch
        beq @a0
        ldx #1
        lda #2
@a0:    stx seq_rec
        ora seq_play
        sta seq_play
        jsr sq_modes
        jmp sq_go

; Stop everything now (CLEAR, erase, MIDI stop, SysEx load, zero-length guard): a take is kept.
sq_halt:
        bit sq_recon
        bpl @n
        jsr sq_recend
@n:     lda #0
        sta sq_clkon
        sta seq_run
        sta sq_recon
        sta sq_playon
        sta sq_stopreq
        sta sq_wait
        jsr sq_clkstop
; Keys back to the keyboard: keys the sequence holds go up, keys held on the keyboard go down (stock $B61A).
; (Keys 61-63 read vk_st[61..63] = vk_cnt[0..2]: never 2, "not held".)
.assert vk_cnt = vk_st + 61, error, "sq_resync reads vk_st past key 60"
sq_resync:
        ldx #63
@l:     lda seq_kd,x
        bmi @dn
        lda vk_st,x                 ; not down as played: held on the keyboard?
        cmp #2
        bne @n
        lda #$80
        bne @p
@dn:    lda vk_st,x                 ; down as played: still held on the keyboard?
        cmp #2
        beq @n
        lda #0
@p:     sta seq_kd,x
        stx sq_i
        ora sq_i
        ldy vk_cnt,x
        sty sq_t
        ldx sq_t
        jsr vk_pushx
        ldx sq_i
@n:     dex
        bpl @l
        rts

; End of a take (stock $B5B4): end marker, length, cut of the time before the first event (record not instant),
; zero-length guard, quantize pass.
sq_recend:
        jsr sq_trp
        lda #0
        ldx #$0f
        jsr sq_wr
        lda sq_recch
        cmp #2
        bne @l1
        ldx #2                      ; double take: channel 2 is gone
        jsr sq_empty
        lda #0
@l1:    asl
        tax
        lda sq_rn
        sta seq_len,x
        lda sq_rn+1
        sta seq_len+1,x
        lda sq_rp
        sta sq_end,x
        lda sq_rp+1
        sta sq_end+1,x
        lda sq_rstart
        sta sq_rp
        sta sq_tp
        lda sq_rstart+1
        sta sq_rp+1
        sta sq_tp+1
        lda seq_inst
        ora seq_metro
        bne @z
        jsr sq_ovd
        bcs @z
        lda #0                      ; the time before the first event is dropped
        sta sq_time
        sta sq_time+1
        jsr sq_retime
@z:     jsr sq_trp                  ; zero deltas up to the end marker: give it 128 clocks
        jsr sq_tdelta
        bne sq_post
        jsr sq_isend
        bcs @e
        jsr sq_radv
        jmp @z
@e:     ldy #2
        lda #$80
        sta (sq_tp),y

; Quantize pass (stock $A0ED): in each group of simultaneous events, a key-up whose key went down earlier in the
; group moves to the group's end and gets one quantize step (the next group starts one step later). (After a
; group the stock can run past the end marker; NeoV8 stops there.)
sq_post:
        jsr sq_qval
        cmp #1
        beq @rr
        sta sq_q
        lda sq_rstart
        sta sq_pp
        lda sq_rstart+1
        sta sq_pp+1
@a24b:  jsr sq_tpp
        jsr sq_isend
        bcs @rr
        lda sq_pp                   ; rp = previous event
        sta sq_rp
        lda sq_pp+1
        sta sq_rp+1
        jsr @next
        bcs @rr
        jsr sq_tdelta
        bne @a24b
        lda #0                      ; a group starts at rp
        sta sq_gn
@a121:  inc sq_gn
        jsr @next
        jsr sq_tdelta
        bne @a148
        jsr sq_isend
        bcc @a121
@rr:    rts
@next:  ldx #sq_pp                  ; pp: next event of the take, tp = pp, C = end marker
        ldy #2
        jsr sq_adv
        jsr sq_tpp
        jmp sq_isend
@a148:  lda sq_gn
        sta sq_ghi
        lda #0
        sta sq_gi
@a153:  lda sq_gi
        jsr sq_evat
        bmi @a142
        and #$3f
        sta sq_gkey
        lda #0
        sta sq_gj
@a167:  lda sq_gj
        jsr sq_evat
        bpl @a135
        and #$3f
        cmp sq_gkey
        bne @a135
        lda sq_gj
        cmp sq_gi
        bcs @a142
        lda sq_gi
        cmp sq_ghi
        beq @a1ea
        jsr sq_evat                 ; event gi to the end of the group: swap it along
        ldx sq_gi
@rot:   cpx sq_gn
        beq @a1ea
        lda sq_tp
        clc
        adc sq_step+2
        sta sq_t2
        lda sq_tp+1
        adc sq_step+3
        sta sq_t2+1
        ldy #2
@sw:    lda (sq_tp),y
        pha
        lda (sq_t2),y
        sta (sq_tp),y
        pla
        sta (sq_t2),y
        dey
        bpl @sw
        lda sq_t2
        sta sq_tp
        lda sq_t2+1
        sta sq_tp+1
        inx
        bne @rot
@a1ea:  dec sq_ghi
        jmp @a1ed
@a135:  inc sq_gj
        lda sq_ghi
        cmp sq_gj
        bcs @a167
@a142:  inc sq_gi
@a1ed:  lda sq_ghi
        cmp sq_gi
        bcc @gx
        jmp @a153
@gx:    cmp sq_gn
        beq @j24
        adc #1                      ; (C = 0) first moved key-up: one step
        jsr sq_evat
        ldy #2
        lda sq_q
        sta (sq_tp),y
        jsr sq_tpp                  ; the next group's first event: one step less
        jsr sq_tdelta
        lda sq_delta
        sec
        sbc sq_q
        sta sq_time
        lda sq_delta+1
        sbc #0
        sta sq_time+1
        jsr sq_retime
@j24:   jmp @a24b

; tp = event A of the group at rp; A = its first byte (N), Y = 0
sq_evat:
        sta sq_ec
        lda sq_rp
        sta sq_tp
        lda sq_rp+1
        sta sq_tp+1
@l:     dec sq_ec
        bmi @r
        ldx #sq_tp
        ldy #2
        jsr sq_adv
        jmp @l
@r:     ldy #0
        lda (sq_tp),y
        rts

; ================================================================ event helpers
sq_tpp: lda sq_pp
        sta sq_tp
        lda sq_pp+1
        sta sq_tp+1
        rts
sq_trp: lda sq_rp
        sta sq_tp
        lda sq_rp+1
        sta sq_tp+1
        rts

; pointer at zero page X one slot on: Y = 0 play step, 2 record step
sq_adv: lda 0,x
        clc
        adc sq_step,y
        sta 0,x
        lda 1,x
        adc sq_step+1,y
        sta 1,x
        rts

; record pointer one slot on, unless it is the channel's last slot (it stays there: stock $B38D). C = 1 stayed.
sq_radv:
        lda sq_rp
        cmp sq_rclamp
        bne @a
        lda sq_rp+1
        cmp sq_rclamp+1
        beq @r                      ; (C = 1)
@a:     ldx #sq_rp
        ldy #2
        jsr sq_adv
        clc
@r:     rts

; sq_delta = delta of the event at tp; Z = 1 when zero (stock $B568)
sq_ldelta:
        jsr sq_tpp
sq_tdelta:
        ldy #0
        lda (sq_tp),y
        and #$40
        lsr
        lsr
        sta sq_delta+1
        iny
        lda (sq_tp),y
        lsr
        lsr
        lsr
        lsr
        ora sq_delta+1
        sta sq_delta+1
        iny
        lda (sq_tp),y
        sta sq_delta
        ora sq_delta+1
        rts

; C = 1 if the event at tp is the end marker (stock $B3B2)
sq_isend:
        ldy #0
        lda (sq_tp),y
        bmi @n
        iny
        lda (sq_tp),y
        and #$0f
        cmp #$0f
        beq @r                      ; (C = 1)
@n:     clc
@r:     rts

; the event at tp gets the delta sq_time (key, velocity kept)
sq_retime:
        ldy #1
        lda (sq_tp),y
        and #$0f
        tax
        dey
        lda (sq_tp),y
        and #$bf
; write the event at tp: A = b0 (key | $80 down), X = velocity nibble, delta = sq_time (stock $B594)
sq_wr:  stx sq_u
        pha
        lda sq_time+1
        asl
        asl
        and #$40
        sta sq_t
        pla
        ora sq_t
        ldy #0
        sta (sq_tp),y
        lda sq_time+1
        asl
        asl
        asl
        asl
        ora sq_u
        iny
        sta (sq_tp),y
        lda sq_time
        iny
        sta (sq_tp),y
        rts

; record A = key | $80 down, X = velocity timer at rp (tick / IRQ context, stock $B400)
sq_rec: pha
        txa
        sec
        sbc #$c0
        cmp #13
        bcc @c
        cmp #31
        lda #13
        bcc @c
        lda #14
@c:     tax
        pla
        bmi @k
        ldx #0
@k:     pha
        jsr sq_trp
        pla
        jsr sq_wr
        lda #0
        sta sq_time
        sta sq_time+1
        jsr sq_radv
        bcs @r
        inc sq_rn
        bne @r
        inc sq_rn+1
@r:     rts

; quantize step in clocks -> A
sq_qval:
        ldx seq_quant
        cpx #11
        bcc @q
        ldx #0
@q:     lda sq_qtab,x
        rts
sq_qtab:    .byte 1, 6, 8, 12, 16, 24, 32, 48, 64, 96, 128

; ================================================================ control tick
; Key event from the VPK-5 scan (voice.asm vk_push, tick context): A = k | $80 down, preserved. Stock $B0D4.
seq_tap:
        pha
        and #$7f
        tax
        pla
        pha
        and #$80
        sta seq_kd,x
        bit sq_recon
        bpl @r
        lda seq_free
        bne @f
        ora seq_free+1
        beq @z
        dec seq_free+1
@f:     dec seq_free
@z:     lda vk_cnt,x
        tax
        pla
        pha
        jsr sq_rec
@r:     pla
        rts

; Every control tick: metronome pulse end, MIDI clock -> clock events.
seq_tick:
        lda sq_pulse
        beq @p
        dec sq_pulse
        bne @p
        lda #$36                    ; PIA2 CB2 low
        sta PIA2_CRB
@p:     lda midi_clock
        tax
        sec
        sbc sq_mclast
        stx sq_mclast
        tax
        beq @r
        lda seq_clk
        cmp #2
        bne @r
        lda sq_srcon
        beq @r
        txa
        php
        sei
        clc
        adc seq_cpend
        sta seq_cpend
        plp
@r:     rts

; ================================================================ clock events (IRQ, stock $948F)
seq_clock:
        ldx #1
        lda sq_srcon
        beq @go
        ldx #4                      ; MIDI clock: 24 ppqn
        lda seq_clk
        cmp #2
        beq @go
        ldy seq_extrate             ; SEQ CK IN: 96 / 48 / 24 ppqn
        ldx sq_mul,y
@go:    stx sq_n
@l:     jsr sq_clk1
        dec sq_n
        bne @l
        rts
sq_mul:     .byte 1, 2, 4

; One clock (1/96 quarter note)
sq_clk1:
        lda #0
        sta sq_guard
        lda seq_metro
        beq @run
        dec sq_metcnt
        bpl @w
        ldx seq_metbeat
        lda sq_beat,x
        sta sq_metcnt
        lda #$3e                    ; metronome: PIA2 CB2 pulse, 3 ticks
        sta PIA2_CRB
        lda #3
        sta sq_pulse
        lda sq_wait
        beq @w
        lda #0                      ; the start was waiting for this beat: clock out on
        sta sq_wait
        lda #$02
        ldx seq_clk
        bne @c
        lda #$c2
@c:     jsr sq_cr1
@w:     lda sq_wait
        bne @r
@run:   lda sq_clkon
        beq @r
@loop:  bit sq_playon
        bpl @time
        lda sq_delta
        ora sq_delta+1
        bne @dec
        jsr sq_playev
        jmp @loop
@dec:   lda sq_delta
        bne @d
        dec sq_delta+1
@d:     dec sq_delta
@time:  dec sq_qcnt                 ; record time: one quantize step every step's clocks (stock $95BF)
        bpl @r
        jsr sq_qval
        tax
        dex
        stx sq_qcnt
        clc
        adc sq_time
        sta sq_time
        bcc @r
        inc sq_time+1
@r:     rts
sq_beat:    .byte 95, 47, 23

; Play the event at pp, its delta has elapsed (stock $9514, $B3C5)
sq_playev:
        jsr sq_tpp
        jsr sq_isend
        bcs sq_tend
        ldy #0
        lda (sq_tp),y
        and #$bf
        sta sq_t                    ; key | $80 down
        and #$3f
        tax
        lda sq_t
        and #$80
        sta seq_kd,x
        beq @up
        iny                         ; velocity class -> VPK-5 timer ($C0 + class, 14 -> 32)
        lda (sq_tp),y
        and #$0f
        cmp #14
        bne @v
        lda #$20
@v:     ora #$c0
        tax
@up:    stx sq_u
        lda sq_t
        jsr vk_pushx                ; into the keyboard's event FIFO (voice.asm)
        bit sq_recon
        bpl @n
        lda sq_t                    ; overdub / bounce: the played events go into the take too
        ldx sq_u
        jsr sq_rec
@n:     ldx #sq_pp
        ldy #0
        jsr sq_adv
        jmp sq_ldelta

sq_restart:
        lda #0
        sta sq_user
        jmp sq_stopnow
sq_stopbtn:
        lda #0
        sta sq_user
        jmp sq_go
sq_rewind:
        lda sq_guard                ; a track of zero length would loop forever in this clock step
        beq @ok
        jmp sq_halt
@ok:    inc sq_guard
        lda sq_pstart
        sta sq_pp
        lda sq_pstart+1
        sta sq_pp+1
        jmp sq_ldelta

; End of the played track (stock $9525)
sq_tend:
        jsr sq_resync
        lda sq_stopreq
        beq @n
        lda #0
        sta sq_stopreq
        beq sq_restart
@n:     lda seq_song
        beq @ns
        dec sq_songcnt
        bpl sq_rewind
        lda seq_loop
        bne @sw
        dec sq_songpass
        bmi sq_restart
@sw:    lda #0                      ; song: the other channel (PLAY 2 = PLAY 1, PLAY 1 = not PLAY 1)
        sta seq_run
        lda seq_play
        lsr
        lda #1
        bcc @s1
        asl
@s1:    sta seq_play
        jsr sq_modes
        jmp sq_restart
@ns:    lda seq_loop
        beq @nl
        jsr sq_ovd
        bcs sq_restart
        lda sq_recch
        bmi sq_rewind
        bpl sq_stopbtn
@rs:    jmp sq_restart
@nl:    lda seq_lock
        beq @nk
        jsr sq_ovd
        bcc @rs
        lda #0                      ; continuous overdub: swap the channels (bounce)
        sta seq_run
        lda seq_play
        eor #3
        sta seq_play
        lda seq_rec
        eor #3
        sta seq_rec
        jsr sq_recend
        jsr sq_modes
        jmp sq_stopbtn
@nk:    jsr sq_ovd
        bcc @rs
        lda #0                      ; overdub: the played channel ends, recording goes on
        sta sq_playon
        ldx sq_plch0                ; channel 0 -> clear bit0, 1 -> bit1
        inx
        txa
        eor #$ff
        and seq_play
        sta seq_play
        jmp sq_resync

; ================================================================ SysEx dump / load (NeoV8, docs/midi-implementation.md)
SQ_BLK  = 15                        ; slots per block message
SQ_NBLK = SEQ_SLOTS / SQ_BLK
.assert SQ_NBLK * SQ_BLK = SEQ_SLOTS, error, "SEQ_SLOTS must be a multiple of SQ_BLK"
.ifndef STUB_MIDI
; Background dump: F0 03 24 bb <15 slots = 90 nibbles> F7 for bb = 0..SQ_NBLK-1, then F0 03 25 F7 (end).
seq_dump:
        lda #0
        sta sq_dblk
        lda #<SEQ_BASE
        sta sq_dptr
        lda #>SEQ_BASE
        sta sq_dptr+1
        rts
sq_dstep:                           ; one message when the TX ring has room (seq_service)
        ldx sq_dblk
        bmi @r
        lda midi_txrd
        clc
        sbc midi_txwr               ; free = rd - wr - 1
        cmp #100
        bcc @r
        jsr midi_sxhdr
        lda #$25
        cpx #SQ_NBLK
        bcs @end
        lda #$24
        jsr midi_tx
        txa
        jsr midi_tx
        lda sq_dptr
        sta ptr
        lda sq_dptr+1
        sta ptr+1
        ldy #0
@l:     lda (ptr),y
        jsr midi_txnb
        iny
        cpy #SQ_BLK*3
        bne @l
        tya
        clc
        adc sq_dptr
        sta sq_dptr
        bcc @n
        inc sq_dptr+1
@n:     inc sq_dblk
        bne @f7
@end:   jsr midi_tx
        lda #$ff
        sta sq_dblk
@f7:    lda #$f7
        jmp midi_tx
@r:     rts

; Received NeoV8 command $24 / $25 (midi.asm; needs the controller flag or the SYSEX RECEIVE page). Stops the
; sequencer. $25 ends a load: the channels are found again from their end markers.
seq_sysex:
        jsr midi_ctlok
        bcc @r
        jsr cv_lock
        jsr sq_halt
        jsr cv_unlock
        lda midi_sxbuf+1
        lsr                         ; C = 1: $25
        bcs @end
        lda #1
        sta midi_dir
        ldy #0
        lda midi_sxlen
        cmp #3+SQ_BLK*6
        bne @bad
        ldx midi_sxbuf+2
        cpx #SQ_NBLK
        bcs @bad
        lda #<SEQ_BASE
        sta ptr
        lda #>SEQ_BASE
        sta ptr+1
@m:     dex
        bmi @go
        lda ptr
        clc
        adc #SQ_BLK*3
        sta ptr
        bcc @m
        inc ptr+1
        bcs @m
@go:    lda #SQ_BLK*3
        sta tmp
        ldx #3
        jsr midi_unnib
        jmp midi_sxok
@end:   jsr sq_scan
        jsr sq_modes
        jmp midi_sxok
@bad:   jmp midi_sxbad
@r:     rts

; Channels from their end markers (after a load); none within a channel's room: empty.
sq_scan:
        ldx #2
@c:     stx sq_i
        lda sq_chs,x
        sta sq_tp
        lda sq_chs+1,x
        sta sq_tp+1
        lda #0
        sta seq_len,x
        sta seq_len+1,x
@l:     jsr sq_isend
        bcs @f
        ldx sq_i
        lda sq_tp
        clc
        adc sq_stp,x
        sta sq_tp
        lda sq_tp+1
        adc sq_stp+1,x
        sta sq_tp+1
        inc seq_len,x
        bne @k
        inc seq_len+1,x
@k:     lda seq_len,x
        cmp #<SEQ_CAP
        lda seq_len+1,x
        sbc #>SEQ_CAP
        bcc @l
        jsr sq_empty                ; (X = 2 * channel)
        jmp @nx
@f:     ldx sq_i
        lda sq_tp
        sta sq_end,x
        lda sq_tp+1
        sta sq_end+1,x
@nx:    ldx sq_i
        dex
        dex
        bpl @c
        rts
.else
seq_dump:
        rts
.endif
