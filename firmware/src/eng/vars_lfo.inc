; eng/lfo: zero page and RAM variables (owned by the lfo module)
; LFO index L = lfo#*2 + side (0 LFO1 R, 1 LFO1 L, 2 LFO2 R, 3 LFO2 L). Output slot index Y = side*4 + lfo#
; (slots $79+Y: $79/$7A RIGHT, $7D/$7E LEFT; LFO1 offset slots $78+Y).
        .zeropage
lfo_hi:     .res 1          ; waveform value: PA byte
lfo_lo:     .res 1          ; PB byte
lfo_off:    .res 1          ; DC offset of the waveform
lfo_src:    .res 1          ; LFO whose direction drives the LFO1 square latch
lfo_rnd:    .res 1          ; 8-bit LFSR (S&H)
lfo_alt:    .res 1          ; LFO->PWM alternation VCO1 / VCO2
lfo_t0:     .res 1
lfo_t1:     .res 1
lfo_ptr:    .res 2

        .segment "BSS2"
lfo_ihi:    .res 4          ; phase increment (signed 16 bit)
lfo_ilo:    .res 4
lfo_phi:    .res 4          ; phase (signed 16 bit, bounces between the extremes)
lfo_plo:    .res 4
lfo_flag:   .res 4          ; $FF: the phase bounced in this step (new S&H sample, square edge)
lfo_wave:   .res 4          ; 0 sine, 1 triangle, 2 saw, 3 sample & hold
lfo_sh:     .res 4          ; S&H value
lfo_retrig: .res 4          ; $FF: key retrigger
lfo_dhi:    .res 2          ; LFO1 delay fade rate per side ($FF = no delay)
lfo_dlo:    .res 2
lfo_fhi:    .res 2          ; fade attenuation (16 bit, $FF = silent)
lfo_flo:    .res 2
lfo_fon:    .res 2          ; fade started for the current gate
lfo_fade:   .res 2          ; current LFO1 multiplier per side
        .bss
