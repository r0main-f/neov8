# Voyetra Eight program parameters (45-byte program)

GENERATED from `spec/params.yaml` by `npm run gen`. Do not edit by hand.

Source: Voyetra-8 Program Format sheet (SysEx doc p.5-7). Single-bit flags are active low.
Bytes $28-$2C are undocumented (decoded in Phase 0). Confidence: doc = from the sheet, scan = sheet cut off, tbd = to verify.
MIDI: the CC of each parameter, on the side's channel (docs/midi-implementation.md §4). 8-bit depths are 14-bit pairs
(MSB, LSB). NRPN = the on/off switches, sent and received as the raw program byte.

| Byte | Bits | Id | Name | Mn | Type | MIDI | Conf |
|---|---|---|---|---|---|---|---|
| $00 | 7 | `modA_inv` | Bank A source invert | `In` | flag (active low) | NRPN | doc |
| $00 | 6-4 | `modA_src` | Bank A source | `So` | enum modSource | 16 | doc |
| $00 | 3 | `modA_c_vel` | Bank A ctrl velocity | `Uc` | flag (active low) | NRPN | doc |
| $00 | 2 | `modA_c_px` | Bank A ctrl +X | `+H` | flag (active low) | NRPN | doc |
| $00 | 1 | `modA_c_nx` | Bank A ctrl -X | `-H` | flag (active low) | NRPN | doc |
| $00 | 0 | `modA_c_press` | Bank A ctrl pressure | `Pr` | flag (active low) | NRPN | doc |
| $01 | 7 | `modB_inv` | Bank B source invert | `In` | flag (active low) | NRPN | doc |
| $01 | 6-4 | `modB_src` | Bank B source | `So` | enum modSource | 17 | doc |
| $01 | 3 | `modB_c_vel` | Bank B ctrl velocity | `Uc` | flag (active low) | NRPN | doc |
| $01 | 2 | `modB_c_px` | Bank B ctrl +X | `+H` | flag (active low) | NRPN | doc |
| $01 | 1 | `modB_c_nx` | Bank B ctrl -X | `-H` | flag (active low) | NRPN | doc |
| $01 | 0 | `modB_c_press` | Bank B ctrl pressure | `Pr` | flag (active low) | NRPN | doc |
| $02 | 7 | `modC_inv` | Bank C source invert | `In` | flag (active low) | NRPN | doc |
| $02 | 6-4 | `modC_src` | Bank C source | `So` | enum modSource | 18 | doc |
| $02 | 3 | `modC_c_vel` | Bank C ctrl velocity | `Uc` | flag (active low) | NRPN | doc |
| $02 | 2 | `modC_c_px` | Bank C ctrl +X | `+H` | flag (active low) | NRPN | doc |
| $02 | 1 | `modC_c_nx` | Bank C ctrl -X | `-H` | flag (active low) | NRPN | doc |
| $02 | 0 | `modC_c_press` | Bank C ctrl pressure | `Pr` | flag (active low) | NRPN | doc |
| $03 | 7 | `modD_inv` | Bank D source invert | `In` | flag (active low) | NRPN | doc |
| $03 | 6-4 | `modD_src` | Bank D source | `So` | enum modSource | 19 | doc |
| $03 | 3 | `modD_c_vel` | Bank D ctrl velocity | `Uc` | flag (active low) | NRPN | doc |
| $03 | 2 | `modD_c_px` | Bank D ctrl +X | `+H` | flag (active low) | NRPN | doc |
| $03 | 1 | `modD_c_nx` | Bank D ctrl -X | `-H` | flag (active low) | NRPN | doc |
| $03 | 0 | `modD_c_press` | Bank D ctrl pressure | `Pr` | flag (active low) | NRPN | doc |
| $04 | 7 | `modA_d_q` | Bank A dest VCF Q | `oq` | flag (active low) | NRPN | doc |
| $04 | 6 | `modA_d_fc` | Bank A dest VCF Fc | `oF` | flag (active low) | NRPN | doc |
| $04 | 5 | `modA_d_vco2` | Bank A dest VCO2 | `o2` | flag (active low) | NRPN | doc |
| $04 | 4 | `modA_d_vco1` | Bank A dest VCO1 | `o1` | flag (active low) | NRPN | doc |
| $04 | 3 | `modB_d_q` | Bank B dest VCF Q | `oq` | flag (active low) | NRPN | doc |
| $04 | 2 | `modB_d_fc` | Bank B dest VCF Fc | `oF` | flag (active low) | NRPN | doc |
| $04 | 1 | `modB_d_vco2` | Bank B dest VCO2 | `o2` | flag (active low) | NRPN | doc |
| $04 | 0 | `modB_d_vco1` | Bank B dest VCO1 | `o1` | flag (active low) | NRPN | doc |
| $05 | 7 | `modC_d_q` | Bank C dest VCF Q | `oq` | flag (active low) | NRPN | doc |
| $05 | 6 | `modC_d_fc` | Bank C dest VCF Fc | `oF` | flag (active low) | NRPN | doc |
| $05 | 5 | `modC_d_vco2` | Bank C dest VCO2 | `o2` | flag (active low) | NRPN | doc |
| $05 | 4 | `modC_d_vco1` | Bank C dest VCO1 | `o1` | flag (active low) | NRPN | doc |
| $05 | 3 | `modD_d_q` | Bank D dest VCF Q | `oq` | flag (active low) | NRPN | doc |
| $05 | 2 | `modD_d_fc` | Bank D dest VCF Fc | `oF` | flag (active low) | NRPN | doc |
| $05 | 1 | `modD_d_vco2` | Bank D dest VCO2 | `o2` | flag (active low) | NRPN | doc |
| $05 | 0 | `modD_d_vco1` | Bank D dest VCO1 | `o1` | flag (active low) | NRPN | doc |
| $06 | 7-0 | `modA_depth` | Bank A depth | `dP` | 0-255 | 12 + 44 | doc |
| $07 | 7-0 | `modB_depth` | Bank B depth | `dP` | 0-255 | 13 + 45 | doc |
| $08 | 7-0 | `modC_depth` | Bank C depth | `dP` | 0-255 | 14 + 46 | doc |
| $09 | 7-0 | `modD_depth` | Bank D depth | `dP` | 0-255 | 15 + 47 | doc |
| $0A | 7 | `vel_attack` | Velocity -> attack | `UA` | flag (active low) | NRPN | doc |
| $0A | 6-0 | `glide_time` | Glide time | `GL` | 0-127 | 5 | doc |
| $0B | 7 | `vel_attack_half` | Velocity attack 1/2 | `AH` | flag (active low) | NRPN | doc |
| $0B | 6-0 | `lfo1_rate` | LFO1 rate | `L1` | 0-127 | 76 | doc |
| $0C | 7 | `reldec_kbd_trk` | Rel/Dec kbd tracking | `dK` | flag (active low) | NRPN | doc |
| $0C | 6-0 | `noise_vol` | Noise volume | `no` | 0-127 | 31 | doc |
| $0D | 7 | `reldec_half_trk` | Rel/Dec 1/2 tracking | `dH` | flag (active low) | NRPN | doc |
| $0D | 6-0 | `vco1_freq` | VCO1 frequency | `F1` | 0-127 | 20 | doc |
| $0E | 7 | `vco1_kbd_trk` | VCO1 kbd tracking | `1K` | flag (active low) | NRPN | doc |
| $0E | 6-0 | `vco2_freq` | VCO2 frequency | `F2` | 0-127 | 21 | doc |
| $0F | 6-0 | `vco1_init_pw` | VCO1 initial PW | `P1` | 0-127 | 23 | doc |
| $10 | 6-0 | `vco1_vol` | VCO1 volume | `U1` | 0-127 | 29 | doc |
| $11 | 7 | `vco1_pulse` | VCO1 pulse | `1P` | flag (active low) | NRPN | doc |
| $11 | 6-0 | `vco2_vol` | VCO2 volume | `U2` | 0-127 | 30 | doc |
| $12 | 7 | `vco2_pulse` | VCO2 pulse | `2P` | flag (active low) | NRPN | doc |
| $12 | 6-0 | `vcf_q` | VCF Q (resonance) | `q` | 0-127 | 71 | doc |
| $13 | 7 | `vcf_kbd_trk` | VCF kbd tracking | `FK` | flag (active low) | NRPN | doc |
| $13 | 6-0 | `vcf_fc` | VCF cutoff | `Fc` | 0-127 | 74 | doc |
| $14 | 7 | `vco1_sub` | VCO1 sub octave | `1o` | flag (active low) | NRPN | doc |
| $14 | 6-0 | `adsr1_depth` | VCF ADSR1 depth | `Ed` | 0-127 | 102 | doc |
| $15 | 7 | `vco1_tri` | VCO1 triangle | `1t` | flag (active low) | NRPN | doc |
| $15 | 6-0 | `adsr2_attack` | ADSR2 attack | `A2` | 0-127 | 73 | doc |
| $16 | 7 | `vco1_saw` | VCO1 sawtooth | `1A` | flag (active low) | NRPN | doc |
| $16 | 6-0 | `adsr2_decay` | ADSR2 decay | `d2` | 0-127 | 75 | doc |
| $17 | 7 | `vco_sync` | VCO sync | `SY` | flag (active low) | NRPN | doc |
| $17 | 6-0 | `adsr2_release` | ADSR2 release | `r2` | 0-127 | 72 | doc |
| $18 | 7 | `vco2_sub` | VCO2 sub octave | `2o` | flag (active low) | NRPN | doc |
| $18 | 6-0 | `adsr2_sustain` | ADSR2 sustain | `S2` | 0-127 | 79 | doc |
| $19 | 7 | `vco2_tri` | VCO2 triangle | `2t` | flag (active low) | NRPN | doc |
| $19 | 6-0 | `adsr1_attack` | ADSR1 attack | `A1` | 0-127 | 103 | doc |
| $1A | 7 | `vco2_saw` | VCO2 sawtooth | `2A` | flag (active low) | NRPN | doc |
| $1A | 6-0 | `adsr1_decay` | ADSR1 decay | `d1` | 0-127 | 104 | doc |
| $1B | 7 | `vco1_bypass` | VCO1 bypass VCF | `bY` | flag (active low) | NRPN | doc |
| $1B | 6-0 | `adsr1_release` | ADSR1 release | `r1` | 0-127 | 106 | doc |
| $1C | 7 | `vca_vel` | VCA velocity | `UU` | flag (active low) | NRPN | doc |
| $1C | 6-0 | `adsr1_sustain` | ADSR1 sustain | `S1` | 0-127 | 105 | doc |
| $1D | 7 | `vcf_half_trk` | VCF 1/2 kbd tracking | `FH` | flag (active low) | NRPN | doc |
| $1D | 6-5 | `lfo1_wave` | LFO1 waveform | `1u` | enum lfoWave | 109 | doc |
| $1D | 3-0 | `lfo1_delay` | LFO1 delay | `dL` | 0-15 | 78 | doc |
| $1E | 7 | `modA_replace` | Bank A replace velocity by ADSR1 | `rP` | flag (active low) | NRPN | doc |
| $1E | 6 | `modB_replace` | Bank B replace velocity by ADSR1 | `rP` | flag (active low) | NRPN | doc |
| $1E | 5 | `modC_replace` | Bank C replace velocity by Noise | `rP` | flag (active low) | NRPN | doc |
| $1E | 4 | `modD_replace` | Bank D replace velocity by Pedal | `rP` | flag (active low) | NRPN | doc |
| $1E | 3-2 | `lfo2_wave` | LFO2 waveform | `2u` | enum lfoWave | 111 | doc |
| $1F | 7 | `vel_taper_fact` | Velocity taper user/factory | `UF` | bit | NRPN | doc |
| $1F | 6 | `lfo1_kb_trig` | LFO1 key retrigger | `t1` | flag (active low) | NRPN | doc |
| $1F | 5 | `lfo2_kb_trig` | LFO2 key retrigger | `t2` | flag (active low) | NRPN | doc |
| $1F | 4 | `glide_mode` | Glide (1) / Gliss (0) | `GS` | bit | NRPN | doc |
| $1F | 3-2 | `adsr2_mode` | ADSR2 mode | `n2` | enum adsrMode | 108 | doc |
| $1F | 1-0 | `adsr1_mode` | ADSR1 mode | `n1` | enum adsrMode | 107 | doc |
| $20 | 7 | `pwm1_kbd_trk` | PWM1 kbd tracking | `1c` | flag (active low) | NRPN | doc |
| $20 | 6 | `release_modify` | Release cutoff (1) / gets decay (0) | `rd` | bit | NRPN | doc |
| $20 | 4-3 | `vco2_pwm_src` | VCO2 PWM source | `2S` | enum pwmSource | 28 | doc |
| $20 | 1-0 | `vco1_pwm_src` | VCO1 PWM source | `1S` | enum pwmSource | 27 | doc |
| $21 | 7 | `pwm2_kbd_trk` | PWM2 kbd tracking | `2c` | flag (active low) | NRPN | doc |
| $21 | 6-0 | `prog_vol` | Program volume | `PU` | 0-127 | 9 | doc |
| $22 | 7 | `linear_fm` | Linear FM (VCO2->VCO1) | `FN` | flag (active low) | NRPN | doc |
| $22 | 6-0 | `vco1_detune` | VCO1 detune | `dE` | 0-127 | 22 | doc |
| $23 | 7 | `mod_kbd_cv` | Mod banks use kbd CV (not velocity) | `KC` | bit | NRPN | doc |
| $23 | 6-0 | `lfo2_rate` | LFO2 rate | `L2` | 0-127 | 110 | doc |
| $24 | 7 | `mod_vel_inv` | Mod banks velocity invert | `UI` | flag (active low) | NRPN | doc |
| $24 | 6 | `lfo1_kbd_trk` | LFO1 kbd tracking | `1F` | flag (active low) | NRPN | doc |
| $24 | 5 | `lfo2_kbd_trk` | LFO2 kbd tracking | `2F` | flag (active low) | NRPN | doc |
| $24 | 4 | `lfo1_half_trk` | LFO1 1/2 tracking | `1H` | flag (active low) | NRPN | doc |
| $24 | 3 | `lfo2_half_trk` | LFO2 1/2 tracking | `2H` | flag (active low) | NRPN | doc |
| $25 | 7-4 | `vco1_pwm_depth` | VCO1 PWM depth | `1d` | 0-15 | 25 | doc |
| $25 | 3-0 | `vco2_pwm_depth` | VCO2 PWM depth | `2d` | 0-15 | 26 | doc |
| $26 | 6-0 | `vco2_init_pw` | VCO2 initial PW | `P2` | 0-127 | 24 | doc |
| $27 | 4 | `clip_mod` | Clip mod bank | `Cn` | flag (active low) | NRPN | scan |
| $27 | 3 | `clip_vca` | Clip VCA | `CU` | flag (active low) | NRPN | scan |
| $27 | 1-0 | `taper_select` | Velocity taper select | `tS` | enum taperSelect | 112 | scan |

## Edit pages

| Page | Title | Buttons | Pots | Keypad |
|---|---|---|---|---|
| P1 | Page 1 - VCO | 18 | 14 | PWM SOURCE 0 LFO1 1 LFO2 2 ADSR1 3 ADSR2 |
| P2 | Page 2 - VCF / ADSR / LFO | 19 | 14 | LFO WAVE 0 SINE 1 TRI 2 SAW 3 S&H |
| A | Mod bank A | 16 | 15 | SOURCE 0 DC 1 LFO1 2 LFO2 3 LFO1sq 4 VCO1 5 VCO2 6 ADSR1 7 ADSR2 |
| B | Mod bank B | 16 | 15 | SOURCE 0 DC 1 LFO1 2 LFO2 3 LFO1sq 4 VCO1 5 VCO2 6 ADSR1 7 ADSR2 |
| C | Mod bank C | 16 | 15 | SOURCE 0 DC 1 LFO1 2 LFO2 3 LFO1sq 4 VCO1 5 VCO2 6 ADSR1 7 ADSR2 |
| D | Mod bank D | 16 | 15 | SOURCE 0 DC 1 LFO1 2 LFO2 3 LFO1sq 4 VCO1 5 VCO2 6 ADSR1 7 ADSR2 |
