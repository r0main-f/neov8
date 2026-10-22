; midi: zero page and RAM variables (docs/midi-implementation.md)
MIDI_SXMAX  = 144           ; SysEx buffer: ID + command + 128 nibbles (NeoV8 globals) + margin

        .zeropage
midi_rxrd:  .res 1          ; RX ring read index (main loop only)
midi_rxwr:  .res 1          ; RX ring write index (NMI only)
midi_txrd:  .res 1          ; TX ring read index (NMI only)
midi_txwr:  .res 1          ; TX ring write index (main loop only)
midi_rs:    .res 1          ; running status ($80-$EF), 0 = none
midi_dn:    .res 1          ; data bytes held for the current channel message (0/1)
midi_d0:    .res 1          ; first data byte
midi_d1:    .res 1          ; second data byte
midi_vec:   .res 2          ; per-side call vector (midi_eachv)

; ---- hot variables moved from BSS (ROM review: 1 byte saved per access)
midi_insx:  .res 1          ; inside a SysEx message
midi_sxlen: .res 1          ; bytes in midi_sxbuf (public, with midi_sxbuf)
midi_nrpn:  .res 2          ; selected NRPN: MSB (side), LSB (program byte); MSB $7F = none
midi_side:  .res 1

        .bss
; ---- public (read by UI / engine / tests)
midi_rxovr: .res 1          ; bytes dropped because the RX ring was full (wraps)
midi_hwovr: .res 1          ; ACIA overruns (bytes lost before the NMI read them, wraps)
midi_txdrop: .res 1         ; bytes dropped by midi_tx after its full-ring timeout (wraps)
midi_clock: .res 2          ; MIDI clock ($F8) count, 16-bit, counted in the NMI
midi_rtflags: .res 1        ; set by the NMI: bit0 start ($FA), bit1 continue ($FB), bit2 stop ($FC); consumer clears
midi_rtcnt: .res 3          ; counted by the NMI: start, continue, stop (wrap). Never cleared: each consumer keeps
                            ; its last-seen copy (any number of consumers, no lost event)
midi_kbd_off: .res 1        ; legacy SysEx cmd 3: 1 = "keyboard off" requested by a controller
midi_rxall: .res 1          ; set by the UI SYSEX RECEIVE page: accept data dumps without the controller flag
midi_sxstat: .res 1         ; last SysEx data message: 0 ok, 1 refused (memory protect), 2 malformed
midi_sxcount: .res 1        ; data blocks stored from SysEx (programs, steps, globals, tapers), wraps
midi_mon:   .res 3          ; last channel message received: status, data1, data2 (MIDI monitor)
midi_dmask: .res 1          ; background dump parts left: bit0 programs, bit1 steps, bit2 globals, bit3 taper block
midi_dnum:  .res 1          ; background dump: next program / step number
midi_tobuf: .res 1          ; non-zero: midi_tx stages into midi_dbuf (background dump message being built)
midi_dlen:  .res 1          ; staged dump message: length (0 = none), bytes already queued
midi_dpos:  .res 1
midi_dcnt:  .res 1          ; chunk countdown
; ---- private
midi_sxovf: .res 1          ; SysEx longer than MIDI_SXMAX: dropped at EOX
midi_dmsb:  .res 1          ; last data entry MSB
midi_mask:  .res 1          ; sides addressed by the current channel message (bit0 R, bit1 L)
midi_smask: .res 1          ; sides left for midi_eachv
midi_dir:   .res 1          ; nibble copy direction (+1 / -1)
midi_kind:  .res 1          ; 0 program, 1 step
midi_num:   .res 1
midi_txx:   .res 1
midi_txy:   .res 1

        .segment "BSS3"     ; not cleared at reset: buffers only (indices live in zero page)
midi_rxbuf: .res 256
midi_txbuf: .res 256
midi_sxbuf: .res MIDI_SXMAX ; last SysEx: [0] = ID (3, $7E, ...), [1] = command byte, ... (no F0 / F7)

        .bss

        .segment "BSS2"
midi_dbuf:  .res 140        ; background dump: the message being queued (largest: globals, 132 bytes)
