; Voyetra Eight Rev4 hardware - docs/hardware.md (decoded from the stock ROM + schematics)

; ---- 8279 keyboard/display controller (switch panel)
KD_DATA     = $2000         ; FIFO / display RAM
KD_CMD      = $2001         ; command (W) / status (R): bits 0-2 FIFO count, bit 5 overrun

; ---- pot panel strobes (74LS138 on A0-A2), VPK-5 keyboard, S&H gate
VPK_CLK     = $2800         ; W: VPK-5 shift clock
VPK_DSTR    = $2801         ; R: frame start
VPK_ASTR    = $2802         ; R: frame end
SH_HOLD     = $2803         ; W: all 4051s inhibited (idle)
SH_SAMPLE   = $2804         ; W: addressed S&H tracks the DAC
VPK_A       = $2805         ; R: D7 = key first contact (1 = closed)
VPK_B       = $2806         ; R: D7 = key second contact (0 = closed)
VPK_ACKOFF  = $2807         ; R

SH_SLOT     = $3000         ; W: $3000+slot (slot = enable*8 + channel, 0-127)
SH_MIDICV   = $3080         ; W: $3080-$3087 MIDI-controller CV bank

ACIA_CTRL   = $3800         ; 68B50 MIDI, on NMI. W control / R status
ACIA_DATA   = $3801

BRAM        = $4000         ; battery CMOS RAM $4000-$5FFF
BRAM_SENT   = $4FFF         ; must read $AA (stock compatibility)

LATCH_L     = $6100         ; CD4724 waveform latches LEFT ($6100-$6107)
LATCH_R     = $6200         ; RIGHT
LATCH_3     = $6300         ; lin FM, tune select, split, LFO1 square, matrix
LATCH_MUX   = $6400         ; DIGIMOD IC22/IC23 ($6400-$6407): pot mux address after STA $307F

PIA1_PA     = $6800         ; DAC bits 13-7 (PA0-6), PA7 in = VCO detect
PIA1_CRA    = $6801
PIA1_PB     = $6802         ; DAC bits 6-0 (PB1-7), PB0 in = pot comparator (1 = DAC above pot)
PIA1_CRB    = $6803
PIA2_PA     = $6A00         ; DAC1022 multiplier
PIA2_CRA    = $6A01
PIA2_PB     = $6A02         ; PB0-5 footswitches, PB6 cassette in
PIA2_CRB    = $6A03

PTM_CR13    = $6C00         ; CR1 or CR3 (selected by CR2 bit 0)
PTM_CR2     = $6C01         ; W: CR2   R: status
PTM_T1      = $6C02
PTM_T2MSB   = $6C04         ; R: T2 counter MSB (clears the T2 flag after a status read)
PTM_T2LSB   = $6C05
PTM_T3MSB   = $6C06         ; MSB buffer for T3
PTM_T3LSB   = $6C07

CPU_HZ      = 2000000
TICK_CYCLES = $1000         ; PTM T2 latch: 4097 cycles = 2.0485 ms (488.2 Hz), same as Rev4
