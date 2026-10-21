; eng/seq: polysequencer variables. Public ones (seq_*) are the UI contract (api.inc "polysequencer").
; Private ones (sq_*) mirror the stock Rev4 state ($0973-$097F, $08C5-$08D9, $09C6-$09E7, $063A, $48/$4C).

SEQ_SLOTS   = 1140          ; 3-byte event slots shared by both channels (stock: 1704, $0C00-$1FF7)

        .zeropage
sq_pp:      .res 2          ; play pointer (stock $48)
sq_rp:      .res 2          ; record pointer (stock $4C); group base in the quantize pass
sq_tp:      .res 2          ; event being read / written
sq_t2:      .res 2

; ---- hot variables moved from BSS (ROM review: 1 byte saved per access)
seq_len:    .res 4          ; events per channel (16-bit each, end marker not counted)
seq_run:    .res 1          ; nonzero: running (stock $09C9)
seq_free:   .res 2          ; events left while recording
sq_recch:   .res 1          ; record channel 0/1, 2 both (double), $FF none (stock $09C7)
sq_delta:   .res 2          ; clocks to the next play event (stock $09DA)
sq_time:    .res 2          ; clocks since the last recorded event (stock $09DC)
sq_t:       .res 1

        .bss
; ---- UI contract: switches (written by the UI; the engine changes them like the stock: song alternation,
; bounce swaps, REC off after a take, LOCK -> LOOP on STOP, PLAY off at the end of an overdub)
seq_play:   .res 1          ; bit0 PLAY 1, bit1 PLAY 2
seq_rec:    .res 1          ; bit0 REC 1, bit1 REC 2
seq_loop:   .res 1          ; nonzero: LOOP
seq_lock:   .res 1          ; nonzero: LOCK
seq_song:   .res 1          ; nonzero: SONG
seq_inst:   .res 1          ; nonzero: INSTANT RECORD
seq_metro:  .res 1          ; nonzero: metronome (the engine notices changes in seq_service)
seq_clk:    .res 1          ; 0 internal (PTM T1), 1 external (SEQ CK IN), 2 MIDI clock - change while stopped
seq_extrate: .res 1         ; 0 = 96, 1 = 48, 2 = 24 ppqn (external clock)
; (seq_tempo .. seq_reps: this order is the SysEx end-message layout, see seq_dump)
seq_tempo:  .res 1          ; BPM 20-251 (seq_tempo_set programs the timer)
seq_quant:  .res 1          ; 0 none .. 10 (stock table: 1 6 8 12 16 24 32 48 64 96 128 clocks)
seq_metbeat: .res 1         ; metronome beat 0 quarter, 1 eighth, 2 sixteenth
seq_reps:   .res 2          ; song repeats ch1, ch2 (1-99)
; ---- engine state for the UI
seq_mode:   .res 1          ; bit0 playing, bit1 recording, bit2 recording waits (metronome beat / first key),
                            ; bit3 song running
seq_status: .res 1          ; last seq_startstop: 0 ok, 1 nothing to play, 2 nothing selected / invalid
                            ; combination, 3 song needs both channels, 4 song refused while recording, 5 full
seq_cb2:    .res 1          ; bit7: the sequencer owns PIA2 CB2 (clock-out jack): running or metronome on
; ---- IRQ interface (main.s)
seq_cpend:  .res 1          ; clock events counted by the IRQ (stock $07F3)
seq_t1on:   .res 1          ; PTM T1 flag polled (stock $09BA)
seq_caon:   .res 1          ; PIA2 CA1 (SEQ CK IN) edges counted (stock $09B6, external clock only)
; ---- private
sq_srcon:   .res 1          ; external / MIDI clock source active (stock $09B6)
sq_t1run:   .res 1          ; T1 programmed for the sequencer (stock $08C7)
sq_cr1v:    .res 1          ; last CR1 value (re-armed after an autotune)
sq_t1msb:   .res 1          ; T1 latch MSB (stock $0977)
sq_clkon:   .res 1          ; clock steps processed (stock $0976)
sq_wait:    .res 1          ; start waits for the next metronome beat (stock $0975)
sq_metcnt:  .res 1          ; metronome countdown (stock $0978)
sq_pulse:   .res 1          ; metronome pulse ticks left (stock $0979)
sq_qcnt:    .res 1          ; quantize countdown (stock $0974)
sq_recon:   .res 1          ; recording (stock $09D6)
sq_playon:  .res 1          ; playing (stock $09D7)
sq_plch:    .res 1          ; play channel (stock $09C8)
sq_plch0:   .res 1          ; (stock $09CC)
sq_stev:    .res 1          ; PLAY+REC same channel + LOOP + LOCK (stock $09CD)
sq_user:    .res 1          ; started / stopped by START/STOP (stock $08C6)
sq_stopreq: .res 1          ; stop at the end of the loop (stock $063A)
sq_songcnt: .res 1          ; song repeats left (stock $08C8)
sq_songpass: .res 1         ; (stock $08C9)
sq_pstart:  .res 2          ; (stock $09CE)
sq_rstart:  .res 2          ; (stock $09D0)
sq_rclamp:  .res 2          ; last record slot (stock limit $09D4)
sq_step:    .res 4          ; play, record pointer step: 3 up, -3 down (channel 2 is stored downwards)
sq_end:     .res 4          ; end-marker slot of channel 1, 2
sq_rn:      .res 2          ; slots recorded in this take
sq_guard:   .res 1          ; track ends in this clock step (zero-length track guard)
sq_n:       .res 1
sq_mshad:   .res 1          ; seq_metro last seen
sq_mclast:  .res 1          ; midi_clock last seen
sq_rtl:     .res 3          ; midi_rtcnt last seen
sq_dblk:    .res 1          ; dump: next block, $FF idle
sq_dptr:    .res 2
sq_ec:      .res 1
sq_i:       .res 1
sq_u:       .res 1
sq_q:       .res 1
sq_gn:      .res 1          ; quantize pass (stock $09D8, $09D9, $09DF, $09DE, $09E4)
sq_gi:      .res 1
sq_gj:      .res 1
sq_ghi:     .res 1
sq_gkey:    .res 1
        .segment "BSS2"
seq_kd:     .res 64         ; key k down as played (keyboard or sequence; stock $0200)
        .segment "BSS3"
seq_ev:     .res SEQ_SLOTS*3 ; events: channel 1 / double upwards from seq_ev, channel 2 downwards from the top
        .bss
