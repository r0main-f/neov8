; Arpeggiator clock: tempo oscillator, external clock, MIDI clock sync, clock-out jack, tempo LED.
; Internal / external modes reproduce the stock control-tick oscillator ($8164-$81DF, rate from $DC22):
; every 6 ticks a counter reloaded with the tempo value (ARP SPEED through the parameter curve) toggles the
; phase; an external clock edge (PIA1 CA1) forces it high for the same time. NeoV8 adds MIDI clock sync.
; Output: en_aphase (bit 7 = clock level) for the arpeggiator note logic; PIA2 CB2 = clock-out jack;
; tempo LED = display byte 9 bit 2 (the LED under the SPEED knob; the UI must keep that bit).
; Ext/MIDI selection: NV_GLOBALS+G_ARPCLK (0 internal, 1 external, 2 MIDI clock).

; Tempo value from PF_ARP_SPEED (stock $DC22). Called by eng_apply_perf and when the speed changes.
clk_rate:
        lda PERF+PF_ARP_SPEED
        asl
        eor #$ff
        tax
        lda tb_param_curve,x
        clc
        adc #1
        bcc @n
        lda #$ff
@n:     lsr
        sta en_trate
        rts

clk_init:
        lda #5
        sta en_tdiv6
        lda #0
        sta en_aphase
        sta en_tcount
        sta en_mcacc
        jmp clk_rate

; Control tick.
clk_tick:
        lda NV_GLOBALS+G_ARPCLK
        cmp #1
        beq @ext
        cmp #2
        beq @midi
        dec en_tdiv6                ; internal: every 6 ticks ...
        bpl @r
        lda #5
        sta en_tdiv6
        dec en_tcount               ; ... count down the tempo value, then toggle
        bpl @r
        lda en_trate
        sta en_tcount
        lda en_aphase
        eor #$ff
        jmp clk_out
@ext:   lda PIA1_CRA                ; CA1 edge flag
        bpl @fall
        lda PIA1_PA                 ; reading the port clears the flag
        lda en_trate
        sta en_extcnt
        lda #$ff
        jmp clk_out
@fall:  lda en_extcnt               ; pulse length = tempo value x 6 ticks
        beq @r
        dec en_tdiv6
        bpl @r
        lda #5
        sta en_tdiv6
        dec en_extcnt
        bne @r
        lda #0
        jmp clk_out
@midi:  jmp clk_midi
@r:     rts

; MIDI clock (24 per quarter). ARP SPEED picks the step: 1/4, 1/8, 1/8T, 1/16, 1/16T, 1/32, 1/32T, 1/64.
; Start ($FA) restarts the step; the clock is high for the first half of each step.
clk_midi:
        lda midi_rtflags
        and #$01                    ; start
        beq @run
        lda midi_rtflags
        and #$fe
        sta midi_rtflags
        lda #0
        sta en_mcacc
        lda midi_clock
        sta en_mclast
        lda #$ff                    ; first step starts now
        jmp clk_out
@run:   lda midi_clock              ; clocks since last tick (low byte is enough at 488 Hz)
        sec
        sbc en_mclast
        beq @r
        clc
        adc en_mcacc
        sta en_mcacc
        lda midi_clock
        sta en_mclast
        lda PERF+PF_ARP_SPEED
        lsr
        lsr
        lsr
        lsr
        tax
        lda en_mcacc
        cmp clk_div,x
        bcc @half
        sbc clk_div,x               ; a new step
        sta en_mcacc
        lda #$ff
        jmp clk_out
@half:  lda en_mcacc
        cmp clk_half,x
        bcc @r                      ; first half of the step: stays high
        lda en_aphase               ; second half: low
        beq @r
        lda #0
        jmp clk_out
@r:     rts
clk_div:    .byte 24, 12, 8, 6, 4, 3, 2, 1
clk_half:   .byte 12, 6, 4, 3, 2, 2, 1, 1

; New phase in A: arpeggiator clock, clock-out jack (PIA2 CB2 = bit 3), tempo LED (byte 9 bit 2).
clk_out:
        sta en_aphase
        bit seq_cb2                 ; the sequencer owns the jack while it runs / its metronome is on
        bmi @j
        and #$08
        ora #$36                    ; CRB: CB2 manual output, level = bit 3; output register selected
        sta PIA2_CRB
@j:     lda panel_disp+9
        and #$fb
        bit en_aphase
        bpl @l
        ora #$04
@l:     sta panel_disp+9
        lda #1
        sta panel_dirty
        rts
