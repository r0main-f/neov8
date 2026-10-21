; MIDI: 68B50 driver (NMI rings), parser, channel routing, NRPN, SysEx (legacy Octave-Plateau + NeoV8).
; Behaviour and formats: docs/midi-implementation.md. New code; the documented stock behaviour is reproduced.
;
; Context rules: midi_nmi runs on NMI (ring work only). Everything else is main-loop only (not re-entrant,
; never call it from the IRQ tick). midi_tx may be called with I=1 (the NMI keeps draining the TX ring).

MIDI_OP_ID  = $03           ; Octave-Plateau manufacturer ID
.ifndef FW_VERSION_MAJ
FW_VERSION_MAJ = 0          ; TODO lead: move the firmware version to api.inc
FW_VERSION_MIN = 1
.endif

ACR_BASE    = $15           ; /16 (500 kHz -> 31250 baud), 8N1, RTS low, TX IRQ off, RX IRQ off
ACR_RUN     = ACR_BASE | $80            ; RX IRQ on
ACR_RUNTX   = ACR_BASE | $80 | $20      ; RX + TX IRQ (only while the TX ring is not empty)

; eng_ctrl indices (X). 0-7 = MIDI-controller CV bank $3080+i (stock mapping, docs/hardware.md 3.1)
MCV_MINUSX  = 0             ; joystick -X     <- CC2
MCV_PLUSX   = 1             ; joystick +X     <- CC1 mod wheel
MCV_FCPED   = 2             ; Fc pedal        <- CC4
MCV_PRESS   = 3             ; pressure        <- channel pressure
MCV_BEND_L  = 4             ; pitch bend LEFT  (A = MSB, Y = LSB)
MCV_BEND_R  = 6             ; pitch bend RIGHT (A = MSB, Y = LSB)
MCV_DAMP_R  = 8             ; damper CC64 RIGHT (virtual, not a CV: engine decides)
MCV_DAMP_L  = 9             ; damper CC64 LEFT

.assert EDIT_L - EDIT_R = $40 && <EDIT_R = 0, error, "midi_ptr assumes EDIT_R = $xx00, EDIT_L = +$40"
.assert <PROG_BASE = 0 && <STEP_BASE = 0, error, "midi_ptr assumes page-aligned program/step bases"

; ================================================================ init
midi_init:
        lda #$03
        sta ACIA_CTRL               ; master reset (no IRQ while in reset)
        lda #0
        sta midi_rxrd
        sta midi_rxwr
        sta midi_txrd
        sta midi_txwr
        sta midi_rs
        sta midi_dn
        sta midi_insx
        sta midi_dmask
        lda #$7f
        sta midi_nrpn               ; no NRPN selected
        lda #ACR_RUN
        sta ACIA_CTRL
        rts

; ================================================================ NMI: 68B50 RX/TX rings
; /NMI is edge triggered. Like the stock driver: interrupts off at entry (releases /IRQ), work, then
; rewrite the control register with the enables: a condition still pending raises /IRQ again, which
; is a fresh edge (a nested NMI handles it after all ring work is done here).
midi_nmi:
        pha
        txa
        pha
@loop:  lda #ACR_BASE
        sta ACIA_CTRL
        lda ACIA_CTRL               ; status
        tax
        and #$20                    ; OVRN: a byte was lost before we read the RDR
        beq @nov
        inc midi_hwovr
@nov:   txa
        lsr                         ; C = RDRF
        bcc @tx
        lda ACIA_DATA
        cmp #$f8
        bcs @rt                     ; real-time bytes never enter the ring
        ldx midi_rxwr
        sta midi_rxbuf,x
        inx
        cpx midi_rxrd
        beq @full                   ; ring full: count, never silent
        stx midi_rxwr
        bne @tx                     ; always (Z = 0)
@rt:    cmp #$f8
        bne @rt2
        inc midi_clock
        bne @tx
        inc midi_clock+1
        jmp @tx
@rt2:   cmp #$fa
        bcc @tx                     ; $F9 undefined
        cmp #$fd
        bcs @tx                     ; $FD, $FE active sensing, $FF system reset: ignored (no reset!)
        sbc #$f9                    ; C = 0 here: A - $FA = 0 start, 1 continue, 2 stop
        tax
        lda midi_rtbit,x
        ora midi_rtflags
        sta midi_rtflags
        jmp @tx
@full:  inc midi_rxovr
@tx:    lda ACIA_CTRL
        and #$02                    ; TDRE
        beq @arm
        ldx midi_txrd
        cpx midi_txwr
        beq @arm
        lda midi_txbuf,x
        sta ACIA_DATA
        inx
        stx midi_txrd
@arm:   lda #ACR_RUN
        ldx midi_txrd
        cpx midi_txwr
        beq @w
        lda #ACR_RUNTX              ; TX IRQ only while the ring is not empty
@w:     sta ACIA_CTRL               ; re-arm
        lda ACIA_CTRL
        bmi @loop                   ; still asserted (no edge happened): serve it here
        pla
        tax
        pla
        rti

midi_rtbit: .byte $01, $02, $04

; ================================================================ TX
; midi_tx: queue A. Preserves X, Y (A is lost). If the ring is full it waits for the NMI to free a slot;
; after ~1.3 ms (4 byte times) without progress the byte is dropped and midi_txdrop counts it.
midi_tx:
        stx midi_txx
        sty midi_txy
        ldx midi_txwr
        inx
        ldy #0
@w:     cpx midi_txrd
        bne @put
        dey
        bne @w
        inc midi_txdrop
        jmp @out
@put:   dex
        sta midi_txbuf,x
        inx
        stx midi_txwr
        lda #ACR_RUNTX
        sta ACIA_CTRL               ; TX IRQ on (the NMI turns it off when the ring is empty)
@out:   ldx midi_txx
        ldy midi_txy
        rts

; A = byte -> two data bytes, low nibble first (legacy SysEx encoding). Preserves X, Y.
midi_txnb:
        pha
        and #$0f
        jsr midi_tx
        pla
        lsr
        lsr
        lsr
        lsr
        jmp midi_tx

; status nibble A ($90, $B0, $C0) | channel of side X -> TX. Preserves X, Y.
midi_chout:
        sta tmp
        lda NV_GLOBALS+G_MIDI_CH_R,x
        and #$0f
        ora tmp
        jmp midi_tx

; midi_note_out: X side, A note, Y velocity (0 = note off, sent as note on vel 0). Needs G_TX bit0.
midi_note_out:
        pha
        lda NV_GLOBALS+G_TX
        and #$01
        beq @no
        lda #$90
        jsr midi_chout
        pla
        jsr midi_tx
        tya
        jmp midi_tx
@no:    pla
        rts

; midi_pc_out: X side, A program number. Needs G_TX bit1.
midi_pc_out:
        pha
        lda NV_GLOBALS+G_TX
        and #$02
        beq @no
        lda #$c0
        jsr midi_chout
        pla
        jmp midi_tx
@no:    pla
        rts

; midi_cc_out: X side, A controller, Y value. Needs G_TX bit2.
midi_cc_out:
        pha
        lda NV_GLOBALS+G_TX
        and #$04
        beq @no
        lda #$b0
        jsr midi_chout
        pla
        jsr midi_tx
        tya
        jmp midi_tx
@no:    pla
        rts

; midi_nrpn_out: X side, A program byte number, Y raw byte value -> NRPN (MSB = side, LSB = byte),
; data entry MSB = value >> 7, LSB = value & $7F. Needs G_TX bit2. Sent on the side's channel.
midi_nrpn_out:
        sta midi_num
        sty midi_side
        lda #99
        txa
        tay                         ; NRPN MSB = side
        lda #99
        jsr midi_cc_out
        ldy midi_num
        lda #98
        jsr midi_cc_out
        lda midi_side
        asl                         ; C = bit7
        lda #0
        rol
        tay
        lda #6
        jsr midi_cc_out
        lda midi_side
        and #$7f
        tay
        lda #38
        jmp midi_cc_out

; legacy SysEx short message: A = command, X = data byte ($80-$FF = none): F0 03 cmd [data] F7
midi_sxshort:
        pha
        jsr midi_sxhdr
        pla
        jsr midi_tx
        txa
        bmi @e
        jsr midi_tx
@e:     lda #$f7
        jmp midi_tx

; midi_sx_event: same as midi_sxshort, only if SysEx is enabled (G_RX bit3, Rev4 "MX").
; UI use: A=0 X=step (new step called), A=8 X=$FF (new data available).
midi_sx_event:
        pha
        lda NV_GLOBALS+G_RX
        and #$08
        beq @no
        pla
        jmp midi_sxshort
@no:    pla
        rts

midi_sxhdr:
        lda #$f0
        jsr midi_tx
        lda #MIDI_OP_ID
        jmp midi_tx

; send midi_msgs from index X up to and including $F7
midi_txtab:
@l:     lda midi_msgs,x
        jsr midi_tx
        inx
        lda midi_msgs-1,x
        cmp #$f7
        bne @l
        rts

MSG_IDENT = 0
MSG_UID = 8
midi_msgs:
        .byte $f0, MIDI_OP_ID, $21, 'N', '8', FW_VERSION_MAJ, FW_VERSION_MIN, $f7
        .byte $f0, $7e, $7f, $06, $02, MIDI_OP_ID, 'N', '8', $00, $00, FW_VERSION_MAJ, FW_VERSION_MIN, $00, $00, $f7

; ================================================================ dumps
; midi_dump_all: A = parts (bit0 100 programs, bit1 100 steps, bit2 NeoV8 globals, bit3 taper/footswitch
; block). Starts a background dump: midi_poll sends one message whenever the TX ring has room, so the
; main loop never blocks. midi_dmask <> 0 while it runs.
midi_dump_all:
        and #$0f
        sta midi_dmask
        lda #0
        sta midi_dnum
        rts

midi_dump_step:
        lda midi_txrd
        clc
        sbc midi_txwr               ; free = rd - wr - 1
        cmp #140                    ; room for the largest message (globals: 132 bytes)
        bcc @r
        lda midi_dmask
        lsr
        bcs @prog
        lsr
        bcs @step
        lsr
        bcs @glob
        lsr
        bcs @blk
        lda #0
        sta midi_dmask
@r:     rts
@prog:  ldx #0
        beq @ps
@step:  ldx #1
@ps:    lda midi_dnum
        jsr midi_send_dump
        inc midi_dnum
        lda midi_dnum
        cmp #100
        bcc @r
        lda #0
        sta midi_dnum
        lda #$fe
        ldx midi_kind
        beq @clr
        lda #$fd
        bne @clr
@glob:  ldx #1
        jsr midi_blk_tx
        lda #$fb
        bne @clr
@blk:   ldx #0
        jsr midi_blk_tx
        lda #$f7
@clr:   and midi_dmask
        sta midi_dmask
        rts

; A = number, X = kind (0 program: 0-99, 126/127 = edit buffer R/L; 1 step: 0-99).
; Sends F0 03 01|02 00 nn <45|30 bytes as nibbles, low first> F7 (exactly like the stock ROM).
midi_send_dump:
        sta midi_num
        jsr midi_ptr
        bcs @r
        jsr midi_sxhdr
        ldx midi_kind
        inx
        txa
        jsr midi_tx                 ; command 1 / 2
        lda #0
        jsr midi_tx                 ; machine ID 0 = V8
        lda midi_num
        jsr midi_tx
        ldx midi_kind
        lda midi_size,x
        sta tmp
        lda #1
        sta midi_dir
        ldy #0
        jsr midi_txnib
        ldx midi_kind
        ldy midi_tailix,x
@t:     lda midi_tail,y
        beq @e
        jsr midi_txnb
        iny
        bne @t
@e:     lda #$f7
        jmp midi_tx
@r:     rts

; tmp bytes from (ptr),Y stepping midi_dir -> nibbles
midi_txnib:
@l:     lda (ptr),y
        jsr midi_txnb
        tya
        clc
        adc midi_dir
        tay
        dec tmp
        bne @l
        rts

; A = number, X = kind -> ptr, midi_kind. C = 1 if the number is not valid.
midi_ptr:
        stx midi_kind
        cpx #0
        bne @mem
        cmp #126
        bcc @mem
        cmp #128
        bcs @bad
        lsr                         ; C = 0: 126 RIGHT, 1: 127 LEFT
        lda #<EDIT_R
        bcc @e
        lda #<EDIT_L
@e:     sta ptr
        lda #>EDIT_R
        sta ptr+1
        clc
        rts
@mem:   cmp #100
        bcs @bad
        tay
        lda #0
        sta ptr
        lda midi_basehi,x
        sta ptr+1
@l:     dey
        bmi @ok
        clc
        lda ptr
        adc midi_size,x
        sta ptr
        bcc @l
        inc ptr+1
        bcs @l
@ok:    clc
        rts
@bad:   sec
        rts

midi_basehi: .byte >PROG_BASE, >STEP_BASE
midi_size:   .byte PROG_SIZE, STEP_SIZE
midi_tailix: .byte 0, 6
midi_tail:   .byte $80, $80, $ff, $ff, $ff, 0, $80, $80, $80, $80, $80, $80, 0

; ---- fixed blocks: 0 = taper/footswitch block $5A20-$5A58 (legacy cmd 22, sent last byte first),
;      1 = NeoV8 globals (cmd $23), 2 = user taper (legacy cmd 5)
midi_blk_lo:  .byte <BRAM_CLIP, <NV_GLOBALS, <BRAM_TAPER
midi_blk_hi:  .byte >BRAM_CLIP, >NV_GLOBALS, >BRAM_TAPER
midi_blk_y0:  .byte $38, 0, 0
midi_blk_dir: .byte $ff, 1, 1
midi_blk_n:   .byte 57, G_SIZE, 15
midi_blk_cmd: .byte $16, $23, $05

midi_blk_set:                       ; X = block -> ptr, Y, midi_dir, tmp
        lda midi_blk_lo,x
        sta ptr
        lda midi_blk_hi,x
        sta ptr+1
        lda midi_blk_dir,x
        sta midi_dir
        lda midi_blk_n,x
        sta tmp
        ldy midi_blk_y0,x
        rts

midi_blk_tx:                        ; X = block: F0 03 cmd <nibbles> F7
        jsr midi_sxhdr
        lda midi_blk_cmd,x
        jsr midi_tx
        jsr midi_blk_set
        jsr midi_txnib
        lda #$f7
        jmp midi_tx

; X = block: receive from midi_sxbuf+2 (needs 2n nibbles). Sets midi_sxstat / midi_sxcount. C = 1 if not stored.
midi_blk_rx:
        lda midi_blk_n,x
        asl
        adc #2
        cmp midi_sxlen
        beq @ok
        bcs midi_sxbad
@ok:    jsr midi_blk_set
        ldx #2
        jsr midi_unnib
        bcs midi_sxprot
midi_sxok:
        inc midi_sxcount
        lda #0
        sta midi_sxstat
        clc
        rts
midi_sxprot:
        lda #1
        .byte $2c                   ; BIT abs: skip the next 2-byte instruction
midi_sxbad:
        lda #2
        sta midi_sxstat
        sec
        rts

; Decode tmp bytes from nibble pairs at midi_sxbuf+X (low first) into (ptr),Y stepping midi_dir.
; Every write is read back: C = 1 if refused (battery RAM memory protect), nothing else written after.
midi_unnib:
@l:     lda midi_sxbuf+1,x
        asl
        asl
        asl
        asl
        sta tmp2
        lda midi_sxbuf,x
        and #$0f
        ora tmp2
        sta (ptr),y
        cmp (ptr),y
        bne @fail
        inx
        inx
        tya
        clc
        adc midi_dir
        tay
        dec tmp
        bne @l
        clc
        rts
@fail:  sec
        rts

; ================================================================ main loop: parser
; Drains the whole RX ring each call (the stock drained one message per pass: dense-MIDI hang),
; then advances a background dump.
midi_poll:
@loop:  ldx midi_rxrd
        cpx midi_rxwr
        beq @idle
        lda midi_rxbuf,x
        inx
        stx midi_rxrd
        jsr midi_byte
        jmp @loop
@idle:  lda midi_dmask
        beq @r
        jmp midi_dump_step
@r:     rts

midi_byte:
        cmp #$80
        bcc midi_data
        pha
        lda midi_insx
        beq @nosx
        jsr midi_sx_end             ; any status byte ends a SysEx (implied EOX)
@nosx:  pla
        cmp #$f0
        bcc @chan
        ldx #0
        stx midi_rs                 ; system common cancels running status ($F1-$F3 data then ignored)
        cmp #$f0
        bne @sys
        stx midi_sxlen
        stx midi_sxovf
        inx
        stx midi_insx
        rts
@sys:   cmp #$f6                    ; tune request -> autotune (stock), needs MX
        bne @r
        lda NV_GLOBALS+G_RX
        and #$08
        beq @r
        jmp tune_run
@chan:  sta midi_rs
        lda #0
        sta midi_dn
@r:     rts

midi_data:
        ldx midi_insx
        beq @ch
        ldx midi_sxlen
        cpx #MIDI_SXMAX
        bcs @ovf
        sta midi_sxbuf,x
        inc midi_sxlen
        rts
@ovf:   stx midi_sxovf
        rts
@ch:    ldx midi_rs
        beq @r
        ldx midi_dn
        bne @d1
        sta midi_d0
        lda midi_rs
        and #$e0
        cmp #$c0                    ; $Cx / $Dx: one data byte
        bne @more
        lda #0
        sta midi_d1
        beq midi_chmsg
@more:  inc midi_dn
@r:     rts
@d1:    sta midi_d1
        lda #0
        sta midi_dn
        ; fall through

; ---- complete channel message in midi_rs / midi_d0 / midi_d1
midi_chmsg:
        lda midi_rs
        sta midi_mon
        lda midi_d0
        sta midi_mon+1
        lda midi_d1
        sta midi_mon+2
        lda midi_rs
        and #$0f
        tay                         ; channel
        ldx #0
        cmp NV_GLOBALS+G_MIDI_CH_R
        beq @isr
        lda NV_GLOBALS+G_OMNI
        lsr
        bcc @notr
@isr:   inx
@notr:  tya
        cmp NV_GLOBALS+G_MIDI_CH_L
        beq @isl
        lda NV_GLOBALS+G_OMNI
        and #$02
        beq @notl
@isl:   inx
        inx
@notl:  stx midi_mask
        txa
        beq midi_rts
        lda midi_rs
        lsr
        lsr
        lsr
        lsr
        tax
        lda midi_chhi-8,x
        pha
        lda midi_chlo-8,x
        pha
midi_rts:
        rts

midi_chlo:  .lobytes midi_noteoff-1, midi_noteon-1, midi_rts-1, midi_cc-1, midi_pc-1, midi_press-1, midi_bend-1
midi_chhi:  .hibytes midi_noteoff-1, midi_noteon-1, midi_rts-1, midi_cc-1, midi_pc-1, midi_press-1, midi_bend-1

; controller sides: outside SPLIT the RIGHT channel drives both sides (like the keyboard)
midi_wsides:
        lda midi_mask
        ldx PERF+PF_KBMODE
        cpx #1
        beq @r
        lsr
        lda midi_mask
        bcc @r
        lda #3
@r:     rts

; note sides: as midi_wsides, and WHOLE 8 has no LEFT side
midi_nsides:
        jsr midi_wsides
        ldx PERF+PF_KBMODE
        bne @r
        and #1
@r:     rts

; call the routine at A (lo) / Y (hi) for each side in midi_smask: X = side, A = midi_d0, Y = midi_d1
midi_eachv:
        sta midi_vec
        sty midi_vec+1
        ldx #0
@l:     lsr midi_smask
        bcc @n
        stx midi_side
        lda midi_d0
        ldy midi_d1
        jsr @call
        ldx midi_side
@n:     inx
        cpx #2
        bcc @l
        rts
@call:  jmp (midi_vec)

midi_noteon:
        lda midi_d1
        beq midi_noteoff            ; velocity 0 = note off
        lda NV_GLOBALS+G_RX
        and #$01
        beq @r
        jsr midi_nsides
        cmp #3
        bne @go
        ldx PERF+PF_KBMODE
        dex
        bne @go                     ; LAYER: both sides
        lda midi_d0                 ; SPLIT, same channel for both sides: the split point decides
        cmp PERF+PF_SPLIT
        lda #1
        bcs @go
        lda #2
@go:    sta midi_smask
        lda #<eng_side_on
        ldy #>eng_side_on
        jmp midi_eachv
@r:     rts

midi_noteoff:                       ; to every side the channel addresses (no stuck notes after a split move)
        lda NV_GLOBALS+G_RX
        and #$01
        beq @r
        jsr midi_nsides
        sta midi_smask
        lda #<eng_side_off
        ldy #>eng_side_off
        jmp midi_eachv
@r:     rts

midi_pc:
        lda NV_GLOBALS+G_RX
        and #$02
        beq @r
        lda midi_d0
        cmp #100
        bcs @r
        ldx NV_GLOBALS+G_PC_TARGET
        beq @prog
        jmp ui_recall_step
@prog:  lda midi_mask
        sta midi_smask
        lda #<ui_recall_prog
        ldy #>ui_recall_prog
        jmp midi_eachv
@r:     rts

midi_press:
        lda NV_GLOBALS+G_RX
        and #$10
        beq @r
        ldx #MCV_PRESS
        lda midi_d0
        ldy #0
        jmp eng_ctrl
@r:     rts

midi_bend:
        lda NV_GLOBALS+G_RX
        and #$10
        beq @r
        jsr midi_wsides
        sta midi_smask
        lda #<midi_bend1
        ldy #>midi_bend1
        jmp midi_eachv
@r:     rts

midi_bend1:                         ; X = side: A = MSB, Y = LSB
        lda midi_bendcv,x
        tax
        lda midi_d1
        ldy midi_d0
        jmp eng_ctrl

midi_damp1:                         ; X = side: A = CC64 value
        lda midi_dampcv,x
        tax
        lda midi_d1
        ldy #0
        jmp eng_ctrl

midi_bendcv: .byte MCV_BEND_R, MCV_BEND_L
midi_dampcv: .byte MCV_DAMP_R, MCV_DAMP_L
midi_cvcc:   .byte 2, 1, 4          ; CC for MCV 0 (-X), 1 (+X), 2 (Fc pedal)
midi_nrpncc: .byte 99, 98, 101, 100, 6, 38

midi_cc:
        lda midi_d0
        cmp #120
        bcs @mode
        ldx #5
@n:     cmp midi_nrpncc,x
        beq midi_nrpn_cc
        dex
        bpl @n
        ldx NV_GLOBALS+G_RX
        cpx #$10                    ; (bit test below)
        lda NV_GLOBALS+G_RX
        and #$10
        beq @r
        lda midi_d0
        cmp #64
        beq @damp
        ldx #2
@c:     cmp midi_cvcc,x
        beq @cv
        dex
        bpl @c
@r:     rts                         ; TODO: CC map of program parameters (lead's parameter table)
@cv:    lda midi_d1
        ldy #0
        jmp eng_ctrl
@damp:  jsr midi_wsides
        sta midi_smask
        lda #<midi_damp1
        ldy #>midi_damp1
        jmp midi_eachv
@mode:  cmp #121
        beq @reset
        cmp #122                    ; local control: not handled (TODO, UI/engine own Local)
        beq @r
        jmp eng_all_off             ; 120 all sound off, 123 all notes off, 124-127 (omni/mono/poly)
@reset: lda NV_GLOBALS+G_RX         ; 121 reset all controllers
        and #$10
        beq @r
        lda #0
        sta midi_d0
        lda #$40
        sta midi_d1
        jsr midi_bend               ; bend centre
        lda #0
        sta midi_d1
        jsr @damp                   ; damper up
        lda #3
        sta midi_side
@z:     ldx midi_side               ; CV 0-3 = 0
        lda #0
        tay
        jsr eng_ctrl
        dec midi_side
        bpl @z
        rts

; NRPN: MSB 0 = RIGHT edit buffer, 1 = LEFT; LSB = program byte 0-39; data entry = raw byte
; (MSB*128 + LSB, clipped to 255). CC6 applies with LSB 0, CC38 applies with the full value. X = table index.
midi_nrpn_cc:
        lda NV_GLOBALS+G_RX
        and #$04
        beq @r
        lda midi_d1
        cpx #1
        bcs @x1
        sta midi_nrpn               ; 99 NRPN MSB
        rts
@x1:    bne @x2
        sta midi_nrpn+1             ; 98 NRPN LSB
        rts
@x2:    cpx #4
        bcs @data
        lda #$7f                    ; 101/100: an RPN is selected, NRPN off
        sta midi_nrpn
@r:     rts
@data:  bne @val                    ; X = 5: CC38, A = LSB
        sta midi_dmsb               ; X = 4: CC6
        lda #0
@val:   ldy midi_dmsb
        beq @set
        dey
        bne @max
        ora #$80
        bne @set
@max:   lda #$ff
@set:   ldx midi_nrpn
        cpx #2
        bcs @r
        ldy midi_nrpn+1
        cpy #PROG_SIZE
        bcs @r
        jsr midi_editsta
        jmp eng_apply_prog          ; X = side

midi_editsta:                       ; A -> edit buffer of side X, byte Y
        cpx #0
        bne @l
        sta EDIT_R,y
        rts
@l:     sta EDIT_L,y
        rts

; ================================================================ SysEx
; midi_sxbuf = bytes between F0 and F7: [0] ID, [1] command byte (bit6 = controller flag), data...
midi_sx_end:
        lda #0
        sta midi_insx
        lda midi_sxovf
        bne @r
        lda midi_sxlen
        cmp #2
        bcc @r
        lda midi_sxbuf
        cmp #$7e
        beq midi_sx_univ
        cmp #MIDI_OP_ID
        bne @r
        lda NV_GLOBALS+G_RX         ; Rev4 "MX": every ID-3 message needs it
        and #$08
        beq @r
        lda midi_sxbuf+1
        and #$3f
        cmp #13
        bcc @tab
        cmp #$16
        beq @c22
        cmp #$20
        beq @ident
        cmp #$22
        beq @dump
        cmp #$23
        bne @ui
        jsr midi_ctlok              ; NeoV8 globals
        bcc @r
        ldx #1
        jsr midi_blk_rx
        bcs @r
@ui:    jmp ui_sysex_in             ; cmd 9, unknown and NeoV8 UI-level messages
@c22:   jsr midi_ctlok
        bcc @r
        ldx #0
        jmp midi_blk_rx
@ident: ldx #MSG_IDENT
        jmp midi_txtab
@dump:  lda #$0f
        ldx midi_sxlen
        cpx #3
        bcc @all
        lda midi_sxbuf+2
@all:   jmp midi_dump_all
@tab:   tax
        lda midi_sxneed,x
        bpl @nf
        jsr midi_ctlok              ; data commands need the controller flag (or the receive page)
        bcc @r
        lda midi_sxneed,x
@nf:    and #$7f
        beq @r                      ; 4, 8, 12: nothing to do on receive
        cmp midi_sxlen
        beq @go
        bcs @bad
@go:    lda midi_sxhi,x
        pha
        lda midi_sxlo,x
        pha
@r:     rts
@bad:   jmp midi_sxbad

midi_sx_univ:                       ; F0 7E <dev> 06 01 F7 -> identity reply
        lda midi_sxlen
        cmp #4
        bcc @r
        lda midi_sxbuf+2
        cmp #$06
        bne @r
        lda midi_sxbuf+3
        cmp #$01
        bne @r
        ldx #MSG_UID
        jmp midi_txtab
@r:     rts

; C = 1 if data may be stored: controller flag set, or the UI receive page is open. Preserves X.
midi_ctlok:
        bit midi_sxbuf+1
        bvs @ok
        lda midi_rxall
        bne @ok
        clc
        rts
@ok:    sec
        rts

; minimum length (ID + cmd + data) per legacy command 0-12; bit7 = needs the controller flag
midi_sxneed: .byte 3, $80|84, $80|52, $80|3, 0, $80|32, 3, 3, 0, 2, $80|7, $80|4, 0
midi_sxlo:  .lobytes midi_sx_step-1, midi_sx_data-1, midi_sx_data-1, midi_sx_kbd-1, midi_rts-1, midi_sx_taper-1
            .lobytes midi_sx_reqp-1, midi_sx_reqs-1, midi_rts-1, ui_sysex_in-1, midi_sx_param-1, midi_sx_key-1, midi_rts-1
midi_sxhi:  .hibytes midi_sx_step-1, midi_sx_data-1, midi_sx_data-1, midi_sx_kbd-1, midi_rts-1, midi_sx_taper-1
            .hibytes midi_sx_reqp-1, midi_sx_reqs-1, midi_rts-1, ui_sysex_in-1, midi_sx_param-1, midi_sx_key-1, midi_rts-1

midi_sx_step:                       ; 0 new step: F0 03 00 ss F7
        lda midi_sxbuf+2
        cmp #100
        bcs @r
        jmp ui_recall_step
@r:     rts

midi_sx_kbd:                        ; 3 keyboard on/off: F0 03 43 dd F7
        lda midi_sxbuf+2
        and #1
        sta midi_kbd_off
        rts

midi_sx_taper:                      ; 5 user taper: F0 03 45 <30 nibbles> F7
        ldx #2
        jmp midi_blk_rx

midi_sx_reqp:                       ; 6 request program: F0 03 06 nn F7
        ldx #0
        .byte $2c
midi_sx_reqs:                       ; 7 request step: F0 03 07 ss F7
        ldx #1
        lda midi_sxbuf+2
        jmp midi_send_dump

; 1 program / 2 step data: F0 03 41|42 00 nn <90|60 nibbles> F7 -> memory, or edit buffer (126/127)
midi_sx_data:
        lda midi_sxbuf+2
        bne @bad                    ; machine ID must be 0
        lda midi_sxbuf+1
        and #$03
        tax
        dex                         ; kind 0 program, 1 step
        lda midi_sxbuf+3
        jsr midi_ptr
        bcs @bad
        ldx midi_kind
        lda midi_size,x
        sta tmp
        lda #1
        sta midi_dir
        ldx #4
        ldy #0
        jsr midi_unnib
        bcs @prot                   ; memory protect: no ack (the controller times out)
        jsr midi_sx_apply
        jsr midi_sxok
        ldx midi_sxbuf+3
        lda #12
        jmp midi_sxshort            ; load acknowledge: F0 03 0C nn F7
@bad:   jmp midi_sxbad
@prot:  jmp midi_sxprot

; if ptr is an edit buffer: eng_apply_prog for its side (number 126/127 in midi_sxbuf+3)
midi_sx_apply:
        lda ptr+1
        cmp #>EDIT_R
        bne @r
        lda midi_sxbuf+3
        and #1
        tax
        jmp eng_apply_prog
@r:     rts

; 10 parameter byte: F0 03 4A 00 nn bb lo hi F7
midi_sx_param:
        lda midi_sxbuf+2
        bne @bad
        lda midi_sxbuf+4
        cmp #PROG_SIZE
        bcs @bad
        lda midi_sxbuf+3
        ldx #0
        jsr midi_ptr
        bcs @bad
        lda #1
        sta tmp
        sta midi_dir
        ldx #5
        ldy midi_sxbuf+4
        jsr midi_unnib
        bcs @prot
        lda #0
        sta midi_sxstat
        jmp midi_sx_apply
@bad:   jmp midi_sxbad
@prot:  jmp midi_sxprot

; 11 panel button: F0 03 4B 00 bb F7 -> ui_key A = bb & $3F, X = bb (bit6 = 1: A440 up, as the 8279 byte)
midi_sx_key:
        lda midi_sxbuf+2
        bne @r
        ldx midi_sxbuf+3
        txa
        and #$3f
        jmp ui_key
@r:     rts
