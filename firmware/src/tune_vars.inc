; tune: zero page and RAM variables (budget: 24 B of zero page). docs/autotune.md
        .zeropage
tn_osc:     .res 1          ; oscillator being tuned (0-15: 2v = VCO2, 2v+1 = VCO1 of voice v)
tn_k:       .res 1          ; loop counter 0-15 (osc = k EOR 1: voice 1 VCO1, voice 1 VCO2, voice 2 ...)
tn_iter:    .res 1          ; pass iterations left
tn_try:     .res 1          ; readings left before "unstable"
tn_mode:    .res 1          ; 0 = 1-period reading, 1 = 4-period reading
tn_half:    .res 1          ; $80 for VCO1 (stock measures VCO1 half a semitone up: detune centre), else 0
tn_sp:      .res 1          ; stack pointer at the start of an oscillator (error exit)
tn_cnt:     .res 2          ; reading (E cycles) / PW high-time count
tn_prev:    .res 2          ; previous reading / PW low-time count
tn_err:     .res 2          ; signed error of a pass
tn_ofs:     .res 2          ; pitch offset, lo = PB byte, hi = PA (stock $0720/$0730 format)
tn_trim:    .res 2          ; scale trim slot, lo = PB byte, hi = PA
tn_pw:      .res 2          ; pulse-width slot, lo = PB byte, hi = PA
tn_pit:     .res 2          ; pitch slot being measured, lo = PB byte, hi = PA
        .bss
tune_res:   .res 16         ; result per oscillator: 0 = ok, else error letter 'A' 'b' 'C' 'd' (for the UI report)
tn_first:   .res 1          ; first failing oscillator of the run ($FF = none)
tn_prot:    .res 1          ; battery write refused (memory protect)
tn_cra:     .res 1          ; PIA1 CRA / CRB saved during the run
tn_crb:     .res 1
