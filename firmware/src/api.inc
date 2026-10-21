; NeoV8 shared layout and module API. Every module reads this; only the lead changes it.
; See firmware/ARCHITECTURE.md for the rules (scopes, zero page, who owns what).

; ============================================================== fixed RAM (volatile, $0000-$1FFF)
; Linker areas (v8.cfg): BSS $0200-$07FF, BSS2 $0A00-$0DFF, BSS3 $1000-$1FFF (not cleared at reset).
; Fixed: $0800-$09FF (below), $0E00-$0FFF (call log of stubs, UI debug block, test port).
EDIT_R      = $0800         ; edit buffer RIGHT program (40 B)  - side index 0
EDIT_L      = $0840         ; edit buffer LEFT program (40 B)   - side index 1
PROG_SIZE   = 40            ; stored program size (SysEx sends 45: + $80,$80,$FF,$FF,$FF)
STEP_SIZE   = 24            ; stored step size (SysEx sends 30: + 6x $80)

; ---- performance state (the unpacked Step): written by UI / MIDI / step recall, read by the engine.
; Side bit convention: bit0 = RIGHT, bit1 = LEFT. Side index: 0 = RIGHT, 1 = LEFT (as the stock code).
PERF        = $0880
PF_PROG_R   = 0             ; program number RIGHT (0-99)
PF_PROG_L   = 1
PF_STEP     = 2             ; current step number
PF_KBMODE   = 3             ; 0 WHOLE 8, 1 SPLIT, 2 LAYER
PF_SPLIT    = 4             ; split point: first key of the RIGHT side, MIDI note (default 60)
PF_UNISON   = 5             ; bit0 R, bit1 L
PF_OCT_R    = 6             ; 0 down, 1 normal, 2 up
PF_OCT_L    = 7
PF_HOLD     = 8             ; bits
PF_RELDEF   = 9             ; release defeat bits
PF_PBDEF    = 10            ; pitch-bend defeat bits
PF_ARP_ON   = 11            ; bits
PF_ARP_MODE_R = 12          ; 0 down, 1 random, 2 up, 3 up/down (stock encoding)
PF_ARP_MODE_L = 13
PF_ARP_PAUSE = 14
PF_ARP_SPEED = 15           ; 0-127
PF_ARP_AUTOOCT = 16         ; bits (stock auto-octave)
PF_ASSIGN_R = 17            ; key assign 0 normal, 1 normal+same voice, 2 circular, 3 circular+same
PF_ASSIGN_L = 18
PF_VCAVEL   = 19            ; VCA velocity override bits (step byte 20 overrides program $1C bit 7)
PF_PRESSDEF = 20            ; pressure defeat bits
PF_LFOSYNC  = 21            ; bit0 LFO1 L-R sync, bit1 LFO2 L-R sync
PF_ARP_SYNC = 22            ; arp L-R sync
PF_ARP_RETRIG = 23
PF_ARP_CLK_L = 24           ; 0 arp clock, 1 LFO1, 2 LFO2
PF_KBDGATE  = 25            ; keyboard gate bits
PF_CVLEFT   = 26            ; CV/GATE out follows LEFT
PF_VOICEMASK = 27           ; bit v = voice v disabled
PF_TRIM_R   = 28            ; 7 signed offsets, stock order: Attack, Release, Fc, Glide, LFO1 rate, Detune, Volume
PF_TRIM_L   = 35
PF_ARP_OCT_R = 42           ; NeoV8 arp octave range 1-4
PF_ARP_OCT_L = 43
PF_SIZE     = 48

; ---- autotune calibration (RAM copies of the battery tables, stock format) - owner: tune
CAL         = $0900
CAL_OFS_HI  = CAL+$00       ; 16: pitch offset MSB per oscillator (osc 2v = VCO2 of voice v, 2v+1 = VCO1)
CAL_OFS_LO  = CAL+$10       ; 16: pitch offset LSB
CAL_TRIM_PA = CAL+$20       ; 16: scale trim (slot 4*osc) PA byte
CAL_TRIM_PB = CAL+$30       ; 16: scale trim PB byte
CAL_PW_HI   = CAL+$40       ; 16: pulse-width calibration
CAL_PW_LO   = CAL+$50       ; 16
CAL_FAILED  = CAL+$60       ; bit v = voice disabled by the last autotune (voice unavailable = PF_VOICEMASK | CAL_FAILED)
; CAL_PW_HI is a signed offset; pitch/PW formulas: docs/autotune.md §6. tune_res[16] (public, tune_vars.inc):
; 0 = ok or the error letter per oscillator (A dead, b offset, C unstable, d scale, E pulse) for the menu report.

; ---- test port: lets the test harness drive the engine before/without the UI (polled by the main loop)
TESTPORT    = $0FF0
TP_CMD      = TESTPORT+0    ; 0 idle. 1 recall program (X side, A num) 2 key on (A note, Y vel) 3 key off (A note)
                            ; 4 apply perf  5 PERF[X] = A  6 run autotune  7 side key on (X side, A note, Y vel)
TP_A        = TESTPORT+1
TP_X        = TESTPORT+2
TP_Y        = TESTPORT+3
TP_DONE     = TESTPORT+4    ; incremented when a command completes

; ---- UI debug block: lets the simulator/tests read the UI state (owner: ui; layout in ui/README or ui.asm)
UIDBG       = $0FC0         ; 32 bytes

; ============================================================== battery RAM ($4000-$5FFF), stock-compatible
PROG_BASE   = $4000         ; program n at PROG_BASE + 40*n
STEP_BASE   = $5000         ; step n at STEP_BASE + 24*n
BRAM_CAL    = $5980         ; autotune tables: +$00 ofs hi, +$10 ofs lo, +$20 trim PA, +$30 trim PB, +$40 PW hi, +$50 PW lo
BRAM_CLIP   = $5A20         ; velocity clip points (lower $5A20-23, upper $5A24-27)
BRAM_TAPER  = $5A28         ; user velocity taper, 15 B
BRAM_FSW    = $5A46         ; footswitch config 6 x 3 B, magic $A5 at $5A58
BRAM_FSW_MAGIC = $5A58
BRAM_PBSENS = $5A79         ; MIDI pitch-bend sensitivity (DAC1022 multiplier of the bend CVs), stock-compatible
; NeoV8 extension block: $5A7A-$5FFF is never touched by the stock ROM (docs/rev4-ram-map.md)
NV_MAGIC    = $5A7A         ; "N8"
NV_VERSION  = $5A7C
NV_GLOBALS  = $5A80         ; 64 B, layout below
NV_UNDO     = $5AC0         ; undo slot: +0 program number ($FF = empty), +1..40 previous content
NV_PROGEXT  = $5B00         ; 100 x 4 B per-program NeoV8 extension (reserved)
NV_STEPEXT  = $5C90         ; 100 x 1 B per-step NeoV8 extension (HOLD, ARP PAUSE, arp octave range: ui/README.md)
NV_END      = $5CF4

; NV_GLOBALS offsets (owner: ui; midi reads the MIDI ones)
G_MIDI_CH_R = 0             ; 0-15
G_MIDI_CH_L = 1
G_OMNI      = 2             ; bit0 R, bit1 L
G_RX        = 3             ; bit0 notes, bit1 program change, bit2 CC/NRPN params, bit3 SysEx, bit4 bend/mod/pressure
G_TX        = 4             ; bit0 notes, bit1 program change, bit2 panel CC/NRPN
G_PC_TARGET = 5             ; 0 programs, 1 steps
G_LOCAL     = 6             ; 1 local on
G_POTMODE   = 7             ; 0 pickup, 1 jump, 2 relative
G_TRIMMODE  = 8             ; 0 trim, 1 direct
G_DISPHOLD  = 9             ; x100 ms
G_POWERON   = 10            ; 0 last step, 1 step 00
G_ARPCLK    = 11            ; 0 internal, 1 external, 2 MIDI clock
G_STEAL     = 12            ; 0 oldest, 1 none
G_UNIDETUNE = 13            ; 0-15
G_PARAM_TX  = 14            ; 0 off, 1 CC, 2 NRPN
G_BEND_RANGE = 15           ; semitones
G_LAST_STEP = 16            ; for power-on
G_SIZE      = 64

; ============================================================== module API (global labels with module prefix)
; core:  panel_*, adc_read, cv_*            (main.s, panel.asm, adc.asm, cv.asm)
FW_VERSION_MAJ = 0
FW_VERSION_MIN = 1
; eng:   eng_init  eng_tick (IRQ, every 2.05 ms)  eng_service (main loop)
;        eng_apply_prog (X = side whose edit buffer changed: fast per-side path; X >= 2 = both, full)   eng_apply_perf   eng_key_on (A note, Y vel)  eng_key_off (A note)
;        eng_side_on (X side, A note, Y vel)  eng_side_off (X side, A note)  eng_all_off
;        eng_a440 (A = 1 on / 0 off: 440 Hz reference tone on PTM T3)  eng_mute (A = 1 mute / 0 unmute)
;        eng_lowest_held (-> A = lowest key held, MIDI note, or $FF; for "hold a key + SPLIT")
;        eng_recalled (call after the eng_apply_prog of a program RECALL: envelopes idle, kbd CV/gate cleared)
;        eng_ctrl (X = 0 -X, 1 +X, 2 Fc pedal, 3 pressure, 4 bend L, 6 bend R: A = value/MSB, Y = bend LSB;
;                  X = 8/9 damper R/L: A >= 64 = release defeat on)  eng_compare (X side, A = 1 hear stored / 0 edit buffer)
; ui:    ui_init  ui_key (A = button code, X = raw 8279 byte: bit6 = 1 when A440 is up)
;        ui_pot (X = pot index 0-14, A = 0-127)  ui_service (main loop)  ui_recall_prog (X side, A num)
;        ui_recall_step (A num)  ui_sysex_in (complete legacy/NeoV8 SysEx in midi_sxbuf)
; midi:  midi_init  midi_nmi  midi_poll (main loop)  midi_tx (A byte, X/Y kept)  midi_note_out (X side, A note, Y vel; Y=0 off)
;        midi_pc_out (X side, A num)  midi_cc_out (X side, A cc, Y val)  midi_nrpn_out (X side, A byte, Y raw value)
;        midi_sx_event (A cmd, X data or $FF)  midi_dump_all (A parts: bit0 programs, 1 steps, 2 globals, 3 taper/fsw block)
;        vars: midi_clock (16-bit, 24 ppqn ticks)  midi_rtflags (bit0 start, 1 continue, 2 stop; consumer clears)
;        midi_kbd_off (SysEx cmd 3)  midi_rxall (set by the UI's SYSEX RECEIVE page: accept data without the
;        controller flag)  midi_sxstat (0 ok, 1 protected, 2 malformed)  midi_sxcount  midi_mon (3 B)  midi_sxbuf/len
;        midi_rxovr midi_hwovr midi_txdrop (error counters). Details: docs/midi-implementation.md.
;        NV_GLOBALS must be initialised (defaults + NV_MAGIC) by ui_init: MIDI reads the globals directly.
; tune:  tune_restore (boot: battery tables -> CAL + trim CVs)  tune_run (blocking, SEI inside)
; core:  autotune = THE way to start an autotune (UI AUTO TUNE, MIDI tune request, test port): tune_run, then
;        midi_flush (stale MIDI input dropped, parser reset) and eng_all_off. Never call tune_run directly.
; midi:  midi_flush (drop unparsed input, reset running status / SysEx / NRPN state)
