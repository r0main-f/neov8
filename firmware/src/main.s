; NeoV8 - a new operating system for the Octave-Plateau Voyetra Eight Rev4.
; SY6502A @ 2 MHz, 4x 2764 at $8000-$FFFF. See firmware/ARCHITECTURE.md.
        .setcpu "6502"
        .include "hw.inc"
        .include "api.inc"

; ------------------------------------------------------------------ shared zero page (core)
        .zeropage
tmp:        .res 1
tmp2:       .res 1
ptr:        .res 2
ptr2:       .res 2
ticks:      .res 2          ; control ticks since boot (488.2 Hz)
tickPend:   .res 1          ; ticks counted by the IRQ, not yet serviced
tickBusy:   .res 1          ; tick work running (IRQ re-entry guard)
dacLock:    .res 1          ; >0: main loop owns the DAC, ticks only counted
potIdx:     .res 1          ; pot scan position (stock pot index 0-14)
potTick:    .res 1
fsw_last:   .res 1          ; footswitches: last raw read, stable state, change work
fsw_stable: .res 1
fsw_state:  .res 1
fsw_changed: .res 1

panel_dirty: .res 1         ; display image changed since the last flush
cv_refIdx:  .res 1          ; next S&H slot to refresh

        .bss
potVal:     .res 15         ; last pot readings (7-bit, like the stock ROM)
panel_disp: .res 10         ; image of 8279 display RAM 0-9
cv_pa:      .res 128        ; per S&H slot: DAC bits 13-7 (PIA1 PA0-6)
cv_pb:      .res 128        ; DAC bits 6-0 in bits 7-1 (PIA1 PB1-7)
cv_mul:     .res 128        ; DAC1022 multiplier ($FF = full scale)

; ------------------------------------------------------------------ module variables (zero page first!)
; Benches replace a module by its logging stub: make DEFS="-D STUB_UI -D STUB_MIDI" (see ARCHITECTURE.md)
.ifdef STUB_ENG
        .include "stubs/eng_vars.inc"
.else
        .include "eng/vars.inc"
.endif
.ifdef STUB_TUNE
        .include "stubs/tune_vars.inc"
.else
        .include "tune_vars.inc"
.endif
.ifdef STUB_MIDI
        .include "stubs/midi_vars.inc"
.else
        .include "midi_vars.inc"
.endif
.ifdef STUB_UI
        .include "stubs/ui_vars.inc"
.else
        .include "ui/vars.inc"
.endif
        .include "stubs/log.inc"

        .code
        .include "font.asm"
        .include "panel.asm"
        .include "adc.asm"
        .include "cv.asm"
        .include "fsw.asm"
        .include "stubs/log.asm"
.ifdef STUB_ENG
        .include "stubs/eng.asm"
.else
        .include "eng/eng.asm"
.endif
.ifdef STUB_TUNE
        .include "stubs/tune.asm"
.else
        .include "tune.asm"
.endif
.ifdef STUB_MIDI
        .include "stubs/midi.asm"
.else
        .include "midi.asm"
.endif
.ifdef STUB_UI
        .include "stubs/ui.asm"
.else
        .include "ui/ui.asm"
.endif
        .include "../gen/rev4-tables.inc"

; ------------------------------------------------------------------ reset
reset:
        sei
        cld
        ldx #$ff
        txs
        lda #0                      ; clear work RAM $0000-$0FFF ($1000-$1FFF left alone)
        tax
@clr:   sta $00,x
        .repeat 15, I
        sta $0100*(I+1),x
        .endrepeat
        inx
        bne @clr
        sta SH_HOLD
        jsr pia_init
        jsr panel_init
        jsr bram_wait
        jsr cv_init
        jsr tune_restore
        jsr eng_init
        jsr midi_init
        jsr ui_init
        jsr pots_init
        jsr fsw_init
        jsr ptm_init
        cli

; ------------------------------------------------------------------ main loop
main:
        jsr panel_poll             ; C=1: A = button code, X = raw byte
        bcc @nokey
        jsr ui_key
@nokey: jsr midi_poll
        jsr pot_scan
        jsr fsw_poll
        jsr eng_service
        jsr ui_service
        jsr testport
        jmp main

; One pot conversion per control tick; report moves of 2+ steps (7-bit) to the UI.
pot_scan:
        lda ticks
        cmp potTick
        beq @done
        sta potTick
        ldx potIdx
        lda potMux,x
        jsr adc_read               ; 8-bit
        lsr                         ; 7-bit like the stock ROM
        ldx potIdx
        sta tmp
        sec
        sbc potVal,x
        bcs @pos
        eor #$ff
        adc #1
@pos:   cmp #2                      ; hysteresis (stock: 2)
        bcc @next
        lda tmp
        sta potVal,x
        jsr ui_pot                 ; X = pot index, A = value
@next:  inc potIdx
        lda potIdx
        cmp #15
        bcc @done
        lda #0
        sta potIdx
@done:  rts

pots_init:
        ldx #0
@l:     stx potIdx
        lda potMux,x
        jsr adc_read
        lsr
        ldx potIdx
        sta potVal,x
        inx
        cpx #15
        bcc @l
        lda #0
        sta potIdx
        rts

; stock pot index -> pot-mux channel: Fc R/L, GLIDE R/L, LFO R/L, A R/L, R R/L, DETUNE R/L, VOL R/L, ARP SPEED
potMux:     .byte 1, 9, 5, 10, 7, 13, 4, 12, 6, 15, 3, 8, 0, 11, 14

; ------------------------------------------------------------------ test port (see api.inc)
testport:
        lda TP_CMD
        bne @go
        rts
@go:    cmp #1
        bne @c2
        ldx TP_X
        lda TP_A
        jsr eng_load_prog          ; battery program -> edit buffer, then apply
        jmp @done
@c2:    cmp #2
        bne @c3
        lda TP_A
        ldy TP_Y
        jsr eng_key_on
        jmp @done
@c3:    cmp #3
        bne @c4
        lda TP_A
        jsr eng_key_off
        jmp @done
@c4:    cmp #4
        bne @c5
        jsr eng_apply_perf
        jmp @done
@c5:    cmp #5
        bne @c6
        ldx TP_X
        lda TP_A
        sta PERF,x
        jmp @done
@c6:    cmp #6
        bne @c7
        jsr autotune
        jmp @done
@c7:    cmp #7
        bne @done
        ldx TP_X
        lda TP_A
        ldy TP_Y
        jsr eng_side_on
@done:  lda #0
        sta TP_CMD
        inc TP_DONE
        rts

; ------------------------------------------------------------------ autotune entry point
; The one way to run the autotune (AUTO TUNE button, MIDI tune request, test port). The tuner runs with
; interrupts off for many seconds while MIDI keeps arriving: afterwards that input is stale, so it is flushed,
; all notes are released, and overflow counted during the tune is not reported as an error.
autotune:
        lda midi_rxovr
        pha
        jsr tune_run
        jsr midi_flush
        pla
        sta midi_rxovr
        lda #0
        sta en_a440                 ; the tuner reprogrammed the PTM: the reference tone is off
        jmp eng_all_off

; ------------------------------------------------------------------ chip init (same order as the stock ROM)
pia_init:
        lda #0
        sta PIA2_CRB
        sta PIA2_CRA
        sta PIA1_CRB
        sta PIA1_CRA                ; select DDRs
        sta PIA2_PB                 ; PIA2 PB all inputs (footswitches, cassette)
        lda #$ff
        sta PIA2_PA                 ; PIA2 PA outputs (DAC1022 multiplier)
        lda #$fe
        sta PIA1_PB                 ; PIA1 PB1-7 out (DAC low), PB0 in (comparator)
        lda #$7f
        sta PIA1_PA                 ; PIA1 PA0-6 out (DAC high), PA7 in (VCO detect)
        lda #$36
        sta PIA2_CRB
        sta PIA1_CRB
        lda #$34
        sta PIA2_CRA
        sta PIA1_CRA                ; output registers, CA2/CB2 low, CA1/CB1 IRQs off
        lda #$ff
        sta PIA2_PA
        rts

ptm_init:
        lda #$c3
        sta PTM_CR2                 ; T2: continuous, internal clock, IRQ on, output; next $6C00 write = CR1
        lda #$00
        sta PTM_CR13                ; CR1: release the preset
        lda #$c2
        sta PTM_CR2                 ; next $6C00 write = CR3
        lda #$02
        sta PTM_CR13                ; CR3: T3 internal clock, off
        lda #>TICK_CYCLES
        sta PTM_T2MSB
        lda #<TICK_CYCLES
        sta PTM_T2LSB               ; T2 latch = $1000 -> 488.2 Hz control tick
        rts

; The stock ROM spins until $4FFF reads back $AA (CMOS RAM power-up). Keep the sentinel, with a timeout.
bram_wait:
        ldy #0
@l:     lda #$aa
        sta BRAM_SENT
        cmp BRAM_SENT
        beq @ok
        dey
        bne @l
@ok:    rts

; ------------------------------------------------------------------ interrupts
; IRQ: wired-OR of PIA1, PIA2, PTM. Only PTM T2 (control tick) is enabled for now.
irq:
        pha
        txa
        pha
        tya
        pha
        lda PTM_CR2                 ; status
        and #$02
        beq @out
        lda PTM_T2MSB               ; status read + counter read clears the flag
        inc ticks
        bne @t
        inc ticks+1
@t:     inc tickPend
        lda dacLock
        ora tickBusy
        bne @out                    ; main loop owns the DAC, or tick work already running: just count
        jsr run_ticks
@out:   pla
        tay
        pla
        tax
        pla
        rti

; Service pending ticks with interrupts enabled (a new tick only increments tickPend). Called with I=1.
run_ticks:
        lda #1
        sta tickBusy
        lda tmp                     ; preserve the shared temporaries the tick may use
        pha
        lda tmp2
        pha
        lda ptr
        pha
        lda ptr+1
        pha
@loop:  lda tickPend
        beq @end
        dec tickPend
        cli
        jsr eng_tick
        sei
        jmp @loop
@end:   pla
        sta ptr+1
        pla
        sta ptr
        pla
        sta tmp2
        pla
        sta tmp
        lda #0
        sta tickBusy
        rts

nmi:    jmp midi_nmi

        .segment "VECTORS"
        .word nmi, reset, irq
