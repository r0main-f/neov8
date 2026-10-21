# Voyetra Eight Rev4 — hardware reference for firmware writers

Derived from the stock Rev4 ROM (V8600040–043; disassembly in `tools/disasm`, labels in `tools/disasm/ann/*.info`) and the schematics (`Voyetra 8 synths/Voyetra 8 Schematics.pdf`, page numbers = PDF pages).

Confidence tags used on every fact:
- **C** = confirmed by code (routine address cited)
- **S** = schematic (page cited)
- **R** = Rev4 Reference Guide / SysEx document
- **E** = measured by running the stock ROM in a scratch 6502 emulator (all-zero battery RAM, stubbed I/O) — re-check in Machine mode
- **I** = inferred

**Side convention in the stock code: index 0 = RIGHT, 1 = LEFT** for buttons, programs (`$50` = R program, `$51` = L), edit buffers (`$0800` = R, `$0840` = L) and MIDI channels. But **voices 0–3 are the LEFT card pair and voices 4–7 the RIGHT** (CV slot numbering). **C** (`$A782`, `$F18C`, CV writers in §4).

## 0. Corrections to earlier assumptions (plan §1)

| Item | Earlier assumption | What the ROM/schematic shows | Conf. |
|---|---|---|---|
| `$2803` / `$2804` | DEMUXEN on / off | **`$2803` = demux inhibited (HOLD, idle state); `$2804` = demux enabled (SAMPLE)**. Every DAC routine ends with `STA $2803`; boot charge loops do `$2804`, strobe, long delay, `$2803` (`$EA56–$EA7B`). | C |
| ACIA clock | 31.25 kHz, ÷1 | Control register base `$15` = **÷16**, 8N1 (`$CEAD`) → ACIA clock must be **500 kHz** (4 MHz ÷ 8 from the LS393). | C (code); **check the schematic before relying on it** |
| EN13 / EN14 | third-party diagram: EN13 = ADSR1, EN14 = ADSR2 | **EN13 (`$68–$6F`) = ADSR2 → VCAs (× velocity); EN14 (`$70–$77`) = ADSR1 → VCF (× Fc env depth)** | C `$8A00`/`$A61B`; S p19 |
| VCO channel order | V/oct, offset, PWM, CV for VCO2 then VCO1 | **ch0–3 = VCO2, ch4–7 = VCO1**; within each: scale trim, PWM, pulse width, pitch | C `$C043`, `$E102`, `$DD66`, `$ED97` |
| `$6D00` page cleared at boot | RAM? | **Mirror of the 6840 PTM** (LS139 decodes `$6C00–$6DFF`); harmless | S p21, C `$EA1C` |
| 8279 SHIFT | — | **A440 key = 8279 SHIFT input, active low** (FIFO bit6 = 1 when A440 is *not* held) | C (all A440 chords) |
| SysEx "panel button" 0–58, "0 = A440" | button 0 = A440 | SysEx cmd 11 byte goes straight to `$94`: **low 6 bits = internal button code, bit6 = "A440 up"**; the handwritten "0 = A440" means bit6 = 0 | C `$9E4E` |
| Memory protect | software-visible? | **Never read by the code.** Protect is hardware-only (CMOS R/W defeat). Reset spins at `$E457` writing `$AA` to `$4FFF` until it reads back. | C; S p31 (labels) |
| Program/step sizes | 45 / 30 B | **Stored as 40 / 24 B** (see `rev4-ram-map.md`) | C |

## 1. Memory and I/O map

| Address | Device | Registers / use by stock code | Conf. |
|---|---|---|---|
| `$0000–$1FFF` | 8 KB SRAM (volatile) | ZP + `$0200–$0BFF` cleared at reset; `$0B00`/`$0B80` MIDI rings; `$0C00–$1FF7` sequencer events (pointer-addressed, not cleared). Details: `rev4-ram-map.md` | C |
| `$2000` | 8279 data | read: FIFO / display RAM; write: display RAM | C |
| `$2001` | 8279 cmd/status | see §5 | C |
| `$2800` (W) | pot panel strobe 0 | VPK-5 shift clock | C |
| `$2801` (R) | strobe 1 | VPK-5 DSTR (frame start) | C/I |
| `$2802` (R) | strobe 2 | VPK-5 ASTR (frame end) | C/I |
| `$2803` (W) | strobe 3 | **S&H demux HOLD** (idle) | C |
| `$2804` (W) | strobe 4 | **S&H demux SAMPLE** | C |
| `$2805` (R, D7) | strobe 5 | VPK-5 data line A (first key contact / header bit) | C |
| `$2806` (R, D7) | strobe 6 | VPK-5 data line B (second contact / header bit) | C |
| `$2807` (R) | strobe 7 | VPK-5 ACKOFF | C/I |
| `$3000–$307F` (W) | S&H slot address | slot = enable×8 + channel; A0–A2 → 4051 channel, A3–A6 → 4515 enable; also steers DIGIMOD `$64xx` latch group (§4) | C/S p19 |
| `$3080–$3087` (W) | MIDI-controller CV bank | A7 = 1: 8 extra S&H channels, no DEMUXEN gating | C `$CF1A` |
| `$3800` | 68B50 control/status | CR: base `$15` (÷16, 8N1) \| `$80` RX IRQ (`$09EB`) \| `$20` TX IRQ while TX ring non-empty (`$09EA`); master reset `$03` at init (`$CEA3`) | C |
| `$3801` | 68B50 data | | C |
| `$4000–$5FFF` | 8 KB battery CMOS RAM | programs `$4000+40n`, steps `$5000+24n`, autotune `$5980–$59DF`, tapers `$5A20–$5A36`, footswitches `$5A46–$5A58`, MIDI `$5A60–$5A79`; **1614 B free** (largest `$5A7A–$5FFF`) | C |
| `$6100–$6107` | CD4724 IC1 (DAC card) | VCO waveform/sync/VCF-bypass latches, LEFT | C/S p21 |
| `$6200–$6207` | CD4724 IC2 | same, RIGHT | C |
| `$6300–$6307` | CD4724 IC3 | lin FM, autotune comparator select, split, LFO1 square, matrix control | C |
| `$6400–$6407` | DIGIMOD CD4724 IC22 / IC23 | IC22 = pot-mux / tune-mux address (after `STA $307F`); IC23 = PB enable, Fc pedal, mod offset… (after `STA $3000`) | C/S p19 |
| `$6500–$65FF` | ANA I CD22100 crosspoints | address = chip+crosspoint, D7 = on/off | C |
| `$6600–$6618`, `$6700–$6718` | DIGIMOD 74LS670 ×2 (R/L) | mod-source routing, word = A4:A3, data D4–D7 | C/S p19 |
| `$6800–$6803` | PIA#1 (6821) | PA0–6 out: DAC bits 13–7; **PA7 in: VCO-detect** (autotune); PB1–7 out: DAC bits 6–0; **PB0 in: pot comparator**; CA2/CB2 out; CA1 in (clock edge, polled) | C/S p21 |
| `$6A00–$6A03` | PIA#2 (6821) | PA out: DAC1022 multiplier (8 bit); PB0–5 in: footswitches; PB6 in: cassette; PB7 unused; CA1 in: ext clock (IRQ); CB2 out: cassette out / arp pulse | C/S p21 |
| `$6C00–$6C07` | 6840 PTM | `$6C00` CR1/CR3, `$6C01` CR2 (W)/status (R), `$6C02/3` T1, `$6C04/5` T2, `$6C06/7` T3 (MSB buffer at even address, write LSB to transfer) | C |
| `$6D00–$6DFF` | PTM mirror | | S/C |
| `$7000–$7FFF` | "EMULATOR" decode, no device | stock writes `$702E←$06`, `$702F←$80` (boot), `$7033←$98`, `$7032←$00` (MIDI init): dev-hardware hooks, safe to ignore | C/S p31 |
| `$8000–$FFFF` | 4 × 2764 | `$8000` 040, `$A000` 041, `$C000` 042, `$E000` 043 | C |

PIA control registers are shadowed in RAM: `$070C` = PIA1 CRA, `$070D` = PIA1 CRB, `$070E` = PIA2 CRA, `$070F` = PIA2 CRB and modified through `$A682`. **C**

### Boot I/O init table `$E989` (executed last → first by `$EA35`) — **C**
| # | Write | Meaning |
|---|---|---|
| 1–4 | `$6A03,$6A01,$6803,$6801 ← $00` | select DDRs |
| 5–8 | `$6A02←$00`, `$6A00←$FF`, `$6802←$FE`, `$6800←$7F` | PIA2 PB in / PA out; PIA1 PB0 in, PA7 in |
| 9–16 | `$6A03/$6803←$36`, `$6A01/$6801←$34` (+ shadows) | output registers selected; CA2/CB2 = manual outputs, low; CA1/CB1 IRQs disabled (PIA2 CA1 enabled later by `$A71E`) |
| 17–18 | `$3800←$03`, then `$3800←$10` | ACIA master reset (re-programmed later by `$CEA3`/`$99E6`) |
| 19–22 | `$6C01←$C3`, `$6C00←$00`, `$6C01←$C2`, `$6C00←$02` | CR2 = `$C3` (T2 continuous, IRQ, output), CR1 = `$00` (release preset), CR3 = `$02` (T3 internal clock, off) |
| 23–26 | `$6C02←$10`, `$6C05←$00`; `$6C02←$11`, `$6C07←$1C` | T2 latch `$1000`; T3 latch `$111C` (unused: A440 reloads `$08E0`) |
| 27–36 | RAM `$0777/$0778←$80`, `$0003/$0001←$06`, `$0610/$0611←$01`, `$0612–$0615←$00` | omni flags, misc |

## 2. Interrupts, timing, tick

### 2.1 Sources (**C** `$80B2`, **S** p31)
| Line | Source | Enabled condition | Handler effect |
|---|---|---|---|
| IRQ (wired-OR) | PTM T2 | always (CR2 bit6) | `INC $07F1` → control tick `$8127` |
| IRQ | PTM T1 | `$09BA` and CR1 bit6 | `INC $07F3` → arp/seq clock `$948F` |
| IRQ | PIA2 CA1 (SEQ CK IN) | `$09B6` | `INC $07F3` |
| IRQ | PIA1, PIA2 other, PTM T3 | must stay disabled (not polled) | — |
| NMI | 68B50 ACIA | RX always (`$80`), TX while ring non-empty (`$20`) | `$990B`, see §8.1 |

### 2.2 IRQ handler `$80B2` (**C**)
1. Push A/X/Y. Poll PIA2 CA1, PTM T1, PTM T2 as above (reading the data/counter register clears each flag).
2. If `$07F5` (main-loop "defer" lock) or `$07F0` (tick service already running) → RTI: nested/deferred interrupts **only count**.
3. Else `$07F0=$FF`, **CLI**, loop: while `$07F3`: `SEI; DEC; CLI; JSR $948F`; while `$07F1`: `SEI; DEC; CLI; JSR $8127`; repeat until both 0. `SEI`, `$07F0=0`, RTI.
- Ticks are never lost (8-bit counters, caught up back to back) and the tick work runs with interrupts enabled.
- Main-loop code that touches the DAC sets `$07F5=$FF`, does its writes, restores `$07F5` and calls `$B03E` (=`$B364`) which runs pending ticks by faking an IRQ. Short writes use `PHP/SEI`. **C**

### 2.3 Rates (E clock = φ2 = **2.000 MHz**, S p31: 4 MHz crystal ÷2)
| What | Value | Conf. |
|---|---|---|
| **Control tick** (T2 latch `$1000`) | 4097 cycles = **2.0485 ms = 488.2 Hz** | C + S |
| Envelopes (16 ADSRs), ADSR→PWM, LFO1/LFO2 L+R, glide | every 3 ticks = 6.15 ms = **162.7 Hz** | C |
| LFO→PWM per VCO | 6 ticks, 81 Hz | C |
| Static voice-channel refresh (8 voices × 8 ch + MIDI CV bank) | ≈27.7 ms | C |
| Static group refresh (`$40–$67`, `$7B`, `$7F`) | 18 ticks = 36.9 ms | C |
| VPK-5 frame | every tick (header buttons every 5th) | C |
| Pot conversion | 1 per ≥2 ticks from the main loop; full sweep ≈ 80+ ms | C |
| Arp/seq clock (T1) | 96 events per quarter note, 20–255 BPM via `$B66D` | C |

### 2.4 Control tick `$8127` structure and cost (**C** structure, **E** cycles)
| Step | Every | Cycles (E) |
|---|---|---|
| `$0637` pot-pacing countdown; read `$2807`, `$2801` (VPK-5 frame start); `$81 = 7` keyboard clocks to send | tick | — |
| `$F80C`→`$FC4F` VPK-5 header: 7 clocks + read 2 front buttons (`$3A/$3B`) | 5 ticks | 213 |
| `$B011`→`$B1D4`: skip refresh if key-assign busy (`$0612\|$0613`) | tick | 28 |
| `$801B` CV refresh slice (keyboard clocks interleaved), remaining clocks after | tick | 98–609 (avg 493) |
| `$B00B`→`$B053` VPK-5 61-key read (if `$0634` ≥ 0) | tick | included below |
| blink/tempo oscillator `$2A` → display RAM 9 bit2 + PIA2 CB2; `$0979` pulse end | tick | small |
| phase 0 (`$2B`): `$8A00` 16 envelopes + ADSR→PWM, `$F90D` volume gate, LFO→PWM VCO1/VCO2 alternating | 3 ticks | env 1310 idle / 2451 with 16 active |
| phase 1: `$FD64` LFO1 L+R, `$AE50` glide L | 3 ticks | 883 |
| phase 2: `$AE67` glide R, `$FD5B` LFO2 L+R | 3 ticks | 730 |

| Whole tick (E) | idle avg / max | 16 env active avg / max | + 16 ADSR→PWM | + 32 ADSR→PWM (unreachable) |
|---|---|---|---|---|
| phase 0 | 2225 / 2559 | 3064 / 3397 | 3371 / 3799 | 3690 / **4101** |
| phase 1 | 1728 / 1897 | | | |
| phase 2 | 1543 / 1705 | | | |

- Budget 4097 cycles/tick. IRQ share of CPU ≈ **49 % idle, ≈ 58 % loaded**; the main loop runs ≈300 passes/s idle. **E**
- Phase 0 can overrun the period under heavy envelope + PWM load; the catch-up design absorbs it as jitter. Phases 1/2 were measured with zeroed program data and may cost more with real patches. **E — check in Machine mode.**

### 2.5 6840 PTM usage

Clock and pins (**S** p31 + p21):
- E = φ2 = **2.000 MHz** (4 MHz crystal ÷2, LS393).
- G1 = "VCO DETECT" (LS74-divided comparator). /G2 and /G3 are grounded.
- O1 → buffer → "SEQ CLK OUT" jack. O3 → "AUDIO TO MIXER". O2 is not connected.

| Timer | Mode | Latch | Rate | Use | Evidence |
|---|---|---|---|---|---|
| T2 | CR2 = `$C3`: continuous, internal clock, IRQ on, output on (O2 n/c), 16-bit | `$1000` | (4096+1)/2 MHz = **2.0485 ms → 488.2 Hz** | **Control tick** (`$07F1` → `$8127`) | **C** `$E989`/`$C64E` |
| T1 | CR1 = `$42` (IRQ, no output) or `$C2` (IRQ + O1 → SEQ CLK OUT) when the internal clock runs and `$09D2` = 0; `$02` = stopped | `$0977`×256 + `$00` | 2e6/(N·256+1): N = `$F4` → 32.0 Hz … N = `$13` → 411 Hz | Arp/seq clock, **96 events per quarter note**. Tempo 20–255 BPM via `TEMPO_T1_TABLE` `$B66D` (index BPM−20, `$FF` = step down to the nearest representable tempo; `$B657`). Default `$097E` = 120 → N = `$29` (≈119 BPM). Arp step = 96/48/24 events (`$948C`). | **C** `$A712`, `$94CE`, `$A6EC`, `$A739`, `$9053` |
| T1 (autotune) | CR1 = `$92`: continuous, gate-initialised (G1), output on, no IRQ | `$FFFF` | — | Period measurement: the counter is read after gate edges (`$C407`–`$C43E`, EOR `$FF`) | **C** |
| T3 | CR3 = `$02` (off) / `$82` (output on, continuous) | `$08E0` when on (init value `$111C` is unused) | 2×2273/2 MHz → **439.95 Hz square on O3** | **A440 reference tone** to the mixer (`$F1B2`, toggled by `$65`) | **C**/**S** |
| T3 (autotune) | CR3 = `$22`: one-shot | `$FFFF` | 32.8 ms | Timeout: T3 flag → error "A" (`$C116`) | **C** |
| T2 (autotune / tape) | autotune: latch `$2000` (4.1 ms tick). Tape: CR2 = `$83`/`$82` (IRQ off), polled bit timing `$C950`, latches `$01A0`/`$03C0`, `$02B0` | | | | **C** `$C033`, `$C8DD`–`$C9BD` |

External clock:
- PIA2 CA1 (SEQ CK IN), enabled by `$09B6` (`$A71E`), increments the same `$07F3` counter as T1.
- `$08C5` = 0/1/2 → 1/3/4 events per input pulse (`$9494`).
- **C**


## 3. CV path

### 3.1 S&H slot map (`$3000+slot`, slot = enable×8 + channel)

Hardware:
- A3–A6 → 4174 latch → 4515 (enable 0–15).
- A0–A2 → 4051 channel.
- DEMUXEN drives the 4515 /EN.
- EN14 is split into L/R by latched A2 (4013 → EN14L / EN14R).

**S** p19.

Code side:
- Voices 0–3 are the LEFT side and voices 4–7 the RIGHT side. Side offsets in the code are +4 or +8×4. **C**
- "static" = the value is kept in `$0500+slot` (PIA1 PA) and `$0580+slot` (PIA1 PB) and re-sent by the refresh.
- mDAC = PIA2 PA = DAC1022 multiplier. When nothing else is said it is `$FF` (full scale).

| Slots | EN | ch | Function | Written by | DAC path |
|---|---|---|---|---|---|
| `8v+0` | v | 0 | VCO2 scale/tracking trim (autotune) | `$E102` at boot from `$59A0`/`$59B0`; autotune | 14-bit, static |
| `8v+1` | v | 1 | VCO2 PWM | `$8A00` (ADSR src, mDAC = `$0998+v`), `$FD23` (LFO src, mDAC = `$0998+v`); static `$0404` when source = none (`$DD66`) | 14-bit × mDAC |
| `8v+2` | v | 2 | VCO2 pulse width (byte `$26` + PW cal `$59C0`/`$59D0`; `$7F` = pulse off) | `$DD66` | static |
| `8v+3` | v | 3 | VCO2 pitch | `$ED97` note-on, glide `$AD30`, static | 14-bit |
| `8v+4` | v | 4 | VCO1 scale trim | `$E102` | static |
| `8v+5` | v | 5 | VCO1 PWM (depth `$0990+v`) | `$8A00`, `$FD23` | × mDAC |
| `8v+6` | v | 6 | VCO1 pulse width (byte `$0F` + cal) | `$DD66` | static |
| `8v+7` | v | 7 | VCO1 pitch (tracked: note-on; untracked: `$DA64`) | `$ED97`, `$DA64` | 14-bit |
| `$40`–`$43` / `$48`–`$4B` | 8 / 9 | 0–3 | VCF cutoff, voices 0–3 / 4–7 (byte `$13`, keyboard tracking) | `$EE5C` note-on; `$DA30` static when bit7 = 1 | 7-bit (PB = 0) |
| `$44` / `$4C` | 8 / 9 | 4 | VCO1 volume L / R (byte `$10`) | `$DA4A` | static |
| `$45` / `$4D` | 8 / 9 | 5 | VCO2 volume (byte `$11`) | `$DA4A` | static |
| `$46` / `$4E` | 8 / 9 | 6 | VCF Q (byte `$12`) | `$DA4A` | static |
| `$47` / `$4F` | 8 / 9 | 7 | Unknown. 0 V at boot (mDAC = 0, `$EA59`); `$FF` during autotune (`$C0A5`). Diagram says "INIT Q / VCF OFFS". | boot, autotune | **I** |
| `$50` | 10 | 0 | Keyboard gate CV (0 / `$7F`) | `$EC3D`; `$F6F0` clears it | **I** (diagram says NC) |
| `$51`, `$54` | 10 | 1, 4 | Never written apart from 0 (refreshed as 0) | — | **I** unused |
| `$52` / `$56` | 10 | 2 / 6 | Noise volume L / R (byte `$0C`) | `$DAAF` | static |
| `$53` / `$57` | 10 | 3 / 7 | Program volume L / R (byte `$21` via `$D900`). Divided by 4 when no voice is sounding. | `$DC37`, `$F90D` | static |
| `$55` | 10 | 5 | Keyboard CV, last note (`$78`) | `$EC68` | **I** |
| `$58`–`$5F` | 11 | 0–7 | Velocity per voice (or keyboard CV, per byte `$23` bit 7; invert per byte `$24`) | `$EEC1` note-on | 7-bit static |
| `$60`–`$63` / `$64`–`$67` | 12 | 0–3 / 4–7 | Mod depth banks A–D, L / R (bytes `$06`–`$09`) | `$DDF6` | 8-bit (PA = val>>1, PB bit 7 = LSB) |
| `$68`–`$6F` | 13 | v | ADSR2 → VCA. mDAC = `$07E0+v` (velocity) OR `$90+side` (`$FF` if VCA velocity is off, byte `$1C`). | `$8A00`, `$A61B` | 14-bit × mDAC |
| `$70`–`$77` | 14 | v | ADSR1 → VCF. mDAC = `$92+side` = byte `$14`×2. | `$8A00`, `$A61B` | 14-bit × mDAC |
| `$78` / `$7C` | 15 | 0 / 4 | LFO1 DC offset L / R (depends on waveform: `$1A`/`$20`) | `$FE25` | static |
| `$79` / `$7D` | 15 | 1 / 5 | LFO1 L / R. mDAC = `$0578` (delay fade-in). | `$FD77`/`$FE25` | × mDAC |
| `$7A` / `$7E` | 15 | 2 / 6 | LFO2 L / R (value + offset `$0E`/`$12`) | `$FE50` | 14-bit |
| `$7B` / `$7F` | 15 | 3 / 7 | VCO1 waveform-mix level compensation (sum of active waveforms; `$2E` + `$DEE1` steps + `$14`) | `$DEF3` | static |
| `$3080`–`$3087` | A7 = 1 bank | 0–7 | **MIDI-controller CVs** (Rev4 "received controllers as CVs"). DAC ← `$0740+i`/`$0748+i`. mDAC `$FF` (0–3) or `$0751` = `$5A79` (4–7). Strobed `STA $3000,Y` / `STA $3080,Y` with **no DEMUXEN**: the separate A7 bank samples until the next `$30xx` strobe. | `$CF1A` (`$9D7C` on CC receipt; `$CEFA` on refresh wrap) | **C** for code, **I** for physical destination |

The S&H address also selects DIGIMOD latches:
- A `STA $307F` before `$64xx` writes addresses DIGIMOD IC22.
- A `STA $3000` before them addresses IC23 (see §4).
- **C** convention, **I** mechanism: a latched address bit steers the CS3C strobe through 1/4053 IC24.


### 3.2 DAC write sequence and timing

DAC:
- PIA1 PA0–6 = DAC bits 13–7. PIA1 PB1–7 = DAC bits 6–0. PA7 and PB0 are inputs (DDR `$7F`/`$FE`, from `$E989`).
- The 14-bit value goes into the ICL7134. Its output is the reference of the DAC1022 multiplying DAC, which takes 8 bits from PIA2 PA. The mDAC output drives all S&H 4051s.
- **S** p21; **C** tables `$D000`–`$D7FF` never set PA7/PB0.

Canonical sequence (`$8034`, `$C5D1`):

```
STA $2803        ; hold: all 4051s inhibited
LDA lo / STA $6800 ; DAC high 7 bits (PA)
LDA hi / STA $6802 ; DAC low 7 bits (PB7..1)
[STA $6A00]      ; mDAC, only for scaled slots (else left at $FF)
STA $3000+slot   ; latch slot address (4174), 4051 channel/enable
NOP NOP          ; settle
STA $2804        ; open demux: S&H tracks DAC
...              ; ~20-23 cycles (VPK-5 clock strobe interleaved here)
STA $2803        ; close (next slot or idle)
```

| Measure | Cycles @2 MHz | Notes |
|---|---|---|
| Settle: last DAC/mDAC write → `$2804` | 9–13 (4.5–6.5 µs) | `$8043`–`$8048`. In the envelope path the DAC is written last and settles only about 4 cycles (`$8F63`→`$8F66`). |
| Sample window: `$2804` → next `$2803` | ≈20–23 (10–11.5 µs) in the refresh loop; ≈12–20 in `$8A00` | **C**, counted |
| Per slot in the refresh loop | ≈37 incl. loop/VPK clock | ≈4.7k cycles for all 128 slots |
| Autotune slot write (`$C4FC`) | settle ≈24 + sample ≈24 (JSR/RTS delays `$C53F`) | |
| Boot charge (`$EA56`) | thousands per slot (`JSR $EFE3` delays) | |

Mutual exclusion (**C**):
- The DAC/S&H path is shared between the IRQ (refresh, envelopes, LFOs) and main-loop writers (note-on, program apply).
- A main-loop writer does `LDA $07F5 / PHA / LDA #$FF / STA $07F5`, writes, restores `$07F5`, then `JMP $B03E` (= `$B364`, which runs any deferred ticks by faking an IRQ).
- While `$07F5` ≠ 0 the IRQ only counts ticks.
- Short single writes use `PHP/SEI` instead (`$CF0B`, `$F17B`).

PIA input/output pins:

| Pin | Use | Evidence |
|---|---|---|
| PIA1 PA7 (input) | VCO-detect: comparator on the VCO tune mux, divided by LS74. Polled by autotune. | **C** `$C0CC`/`$C0D5`/`$C57E`; **S** p21 |
| PIA1 PB0 (input) | Pot-ADC comparator (software SAR) | **C** `$CE6D`/`$CE88` |
| PIA1 CA1 | Edge flag polled in the tick (`$816C`) when `$07E8` ≠ 0: resyncs the blink/clock phase. Pin label illegible. | **I** |
| PIA1 CA2 / CB2 (output, via `$A682` X=0/1) | CB2 = clear of the LS74 VCO-detect divider (`$C0EA`). CA2 = set with the clock source (`$A6E2`). | **C** usage; **I** wiring |
| PIA2 PA (output) | DAC1022 multiplier | **C**/**S** |
| PIA2 PB0–5 (input) | Footswitch/jack inputs (`$EAEB`, `$F976`) | **S** p21 (§8) |
| PIA2 PB6 (input) | Cassette data in (`$C993`) | **C**/**S** "CASS DET" |
| PIA2 CA1 | External clock in ("SEQ CK IN" jack). IRQ path `$80B7` when `$09B6` is set. | **C**/**S** |
| PIA2 CB2 (output) | Jack-bay output through a 7407. Used for the cassette data out (`$C960`) and an arp-step pulse (`$94BC`, 3 ticks via `$0979`), and toggled by the blink oscillator (`$81B6`). | **C** usage, **S** label partly illegible |


## 4. `$6000`–`$7FFF` latches, crosspoints, routing

Decode (**S** p21):
- The CPU-card LS139 splits CS3 into `$6000` "CS DAC" and `$7000` "EMULATOR" (A12).
- On the DAC card, an LS139 on A11/A9/A10 gives: `$6800` PIA1, `$6A00` PIA2, `$6C00` PTM (mirrored in `$6D00`), `$6E00` unused.
- With A11 = 0, an LS138 on A8–A10 gives: `$61`, `$62`, `$63` (DAC-card 4724s, IC1/2/3), `$64` (DIGIMOD 4724s), `$65` (ANA I CD22100 matrix), `$66`/`$67` (DIGIMOD LS670), `$60` unused.
- For all 4724s: data = D7, latch bit = A0–A2.

| Address | Device / bit | Meaning | Written by | Conf. |
|---|---|---|---|---|
| `$6100`–`$6107` | IC1 4724 → VCOs LEFT, Q0–Q7 | = program bytes `$14`–`$1B` bit 7: Q0 VCO1 sub-oct, Q1 VCO1 triangle, Q2 VCO1 saw, Q3 sync, Q4 VCO2 sub-oct, Q5 VCO2 triangle, Q6 VCO2 saw, Q7 VCF bypass ("BYP (VCF)"). Active low per the SysEx doc. | `$DEF3` (program), `$C2C7` (all `$FF`), `$C17F` (autotune: Q2/Q6 = 0) | **C** + **S** (glyphs for tri/saw ambiguous; the code order is authoritative) |
| `$6200`–`$6207` | IC2 4724 → VCOs RIGHT | same, right side | same | **C** |
| `$6300` / `$6301` | IC3 Q0/Q1 | Linear FM L / R (byte `$22` bit 7) | `$DF48`; `$C080` (autotune `$FF`) | **C**/**S** "LIN FM L,R" |
| `$6302` / `$6303` | IC3 Q2/Q3 | /VCO2 SEL, /VCO1 SEL → autotune comparator mux (IC19). Odd osc → VCO1. | `$C04A`/`$C04F` | **C**/**S** |
| `$6304` | IC3 Q4 | Split mode flag ("SPLIT"), from `$5C` | `$A47C` | **C**/**S** |
| `$6305` / `$6306` | IC3 Q5/Q6 | LFO1 square L / R (sign of the LFO1 phase increment) → ANA I mod source "LFO1 SQUARE" | `$FE78` | **C** write, **I** meaning |
| `$6307` | IC3 Q7 → ANA I | Crosspoint-matrix control: 0 while clearing/reprogramming `$65xx`, `$FF` after | `$E9FF` (0), `$EB25` (`$FF`), `$C6D7`/`$C715`, `$DAD7`/`$DAF7` | **C** usage, **I** meaning |
| `$6400`–`$6407` after `STA $307F` | DIGIMOD IC22 4724 Q0–Q6 = DA0–DA6 | Pot-mux address (pot channel from `$C009[$35]`). DA0–2 also go through a 4053 to VMA0–2 = VCO tune-mux voice select (autotune `$C05C`: voice = osc>>1). | `$C719`, `$E685`, `$C05E` | **C**/**S** p19 |
| `$6400` / `$6401` after `STA $3000` | DIGIMOD IC23 Q0/Q1 | Pitch-bend enable L / R (PB DEFEAT L/R buttons; `$63`/`$64` toggles) | `$F19F`/`$F192`, `$F4DF`/`$F4E6`, `$F64C` | **C**/**S** "PBL/PBR enable" |
| `$6404` | IC23 Q4 "AUDIO MUTE" | No individual write found | — | **I** unused by stock code? |
| `$6405` | IC23 Q5 "Fc PED enable" (to ANA II) | From `$081E`/`$085E` bit (`$DB04`) | `$DB09`, `$C6D4`, `$DAD4` | **C** write, **S** label |
| `$6406` | IC23 Q6 "mod offset" (to ANA II) | 0 at boot (`$EB20`), `$FF` in autotune (`$C0A2`) | | **C**/**S** |
| `$6407` | IC23 Q7 "ctrl add (to pot panel)" | ← `$0762` (MIDI-related setting) | `$9F85`, `$EA2E` | **C** write, **I** meaning |
| `$6500`–`$65FF` | ANA I CD22100 crosspoints | Address byte = chip + crosspoint; D7 = close/open. Init `$C6CF` closes a default set (`$6500+4i`, `$6521+4i`, …, `$65F1+4i`). Programmed per mod bank by `$DB22` (controllers VEL/+X/−X/PRESS and invert). | `$C6DC`–`$C70F`, `$DADC`, `$DBC2`–`$DBDD` | **C** writes, **I** exact matrix |
| `$6600`–`$6618` / `$6700`–`$6718` | DIGIMOD 74LS670 ×2 (R / L) | Word = A4:A3 (bank). D4–D6 = mod source select (bytes `$00`–`$03` bits 6–4, inverted). D7 = extra flag (bank word 0 ← byte `$04` bit 4). | `$DBE1` | **C** writes, **S** p19 (A3/A4, D4–D7), **I** bit meaning |
| `$6800`–`$6803`, `$6A00`–`$6A03` | PIAs | see §1 and §3.2. CRs are shadowed at `$070C`–`$070F`. | `$E989`, `$A682` | **C** |
| `$6C00`–`$6C07` | PTM | see §2.5 | | **C** |
| `$6D00`–`$6DFF` | PTM mirror | cleared at boot (`$EA1C`) | | **S**/**C** |
| `$702E`/`$702F` (← `$06`, `$80`) and `$7033`/`$7032` (← `$98`, `$00`) | "EMULATOR" decode, no device on production boards | Boot (`$EA80`) and MIDI init (`$CEA5`). Probably development-hardware hooks; harmless to omit. | | **S** p31 decode, **I** purpose |


## 5. Switch panel: Intel 8279 (`$2000` data, `$2001` cmd/status)

| Item | Value | Conf. |
|---|---|---|
| Init (reset $EAC8) | `$C1` clear all → ~1.3 ms delay → `$34` prescaler ÷20 (100 kHz from 2 MHz) → `$0A` 16-char display, left entry, **encoded scan, N-key rollover** → `$40` read FIFO | C |
| Scan decoding on panel | keys: SL0–2 via U1 74LS138 (8 scan rows), 6 return lines RL0–5 used; display strobes via U5 7445 → only display positions 0–9 exist | S (p.11 "ICs used": LS138, 8279-5, 7445) / I |
| FIFO poll | `kbd_fifo_poll` $F70A, called first in main loop ($EB40 → $F053). If status bit5 (overrun) → cmd `$C2` (clear FIFO status). If status&7 = 0 → return. Else read 1 byte → `$94`. | C |
| FIFO byte | bit7 CNTL (unused), **bit6 SHIFT = A440 key, active low (1 = A440 up)**, bits5-3 SL, bits2-0 RL | C (chords: A440+CALL = init patch $F1F3, A440+MUTE = taper page $F1D7, consistent with Ref Guide) |
| Translate | `X = RL*8 + SL` → `KEYTAB` $A0BD (48 B) → button code 0..58 ($FF = empty) | C |
| Dispatch | `key_dispatch` $F73E: if a page flag is set jump to that page's key handler (`$0702`→$A800 edit, `$4F`→$825B alternate, `$1A`<0→$B800 taper, `$09C6`→$9000 sequencer, `$075A`→$85C5 Set, `$0750`→$B830 MIDI); else `$0606`=code, `$0601`=code&7, `$A2`=(code&$38)>>1, `JMP ($00A2)` into `BTN_GROUP_JT` $F000 (16× JMP+NOP; page $F0 set in `$A3` at boot) | C |
| Key release | **Not reported** (N-key rollover only queues closures). No key-up events, no software debounce (8279 does 10 ms debounce). Holding = only via A440/SHIFT level and the "previous key" variable `$0602` (used for UP+DOWN chord). | C/I |
| SysEx "panel button" (cmd 11, $9E4E) | data byte → `$94` verbatim, code = byte&$3F → `$F056`=JMP $F73E. **So SysEx button # = internal code; bit6 of the byte is the A440-up flag** (send $40+code for a plain press, code alone = "A440 held" chord). Handwritten "0 = A440" in the SysEx PDF = "bit6 zero means A440". | C |

### 5.1 Button code table (code = SysEx button number)

| Code | RL | SL | FIFO byte (A440 up / held) | Button | Conf. | Handler / notes |
|---|---|---|---|---|---|---|
| $00 (0) | 5 | 2 | $55 / $15 | UNISON L | C | $F618: toggle `$56`; only when SPLIT on |
| $01 (1) | 5 | 6 | $75 / $35 | UNISON R | C | toggle `$57` (voice assign $E826 → unison routine $F806) |
| $02 (2) | 5 | 4 | $65 / $25 | SPLIT | C | `$58`; $F6D8 grabs held key as split point; exclusive with 3/6 |
| $03 (3) | 5 | 0 | $45 / $05 | LAYER | C | `$59` |
| $04 (4) | 1 | 4 | $61 / $21 | HOLD L | I | toggle `$5A`; only in SPLIT; re-runs assignment ($A027/$A02A) |
| $05 (5) | 1 | 0 | $41 / $01 | HOLD R | I | toggle `$5B` |
| $06 (6) | 5 | 3 | $5D / $1D | WHOLE 8 | C | `$5C` (8-voice assign, $A409) |
| $08–$11 (8–17) | see below | | | digits 0–9 | C | $F272: digit = code−8; 2-digit entry (`$0604` toggle, `$0607` tens, `$0605` result, `$0458,X`=$FF pending) |
| $12 (18) | 0 | 6 | $70 / $30 | REV | C | `$0605`−1, wraps to 99 |
| $13 (19) | 4 | 2 | $54 / $14 | FWD | C | `$0605`+1, ≥100 → 0 |
| $14 (20) | 5 | 7 | $7D / $3D | no Rev4 legend (glide defeat R?) | I | toggles `$7E`; `$7E,X`≠0 skips glide calc ($DE3D); cleared on CALL |
| $15 (21) | 4 | 7 | $7C / $3C | no Rev4 legend (glide defeat L?) | I | toggles `$7F` |
| $18 (24) | 3 | 7 | $7B / $3B | OCT R | C | $F7BC→$FBFE: `$15`=(`$15`+1) mod 3; A440: toggle octave-jump `$1E` |
| $19 (25) | 3 | 5 | $6B / $2B | OCT L | C | same with `$16` / `$1F` |
| $1A (26) | 4 | 4 | $64 / $24 | TAPE LOAD | C | JSR $C803→$C88D (reads tape, ends in JMP $E80E reset) |
| $1B (27) | 4 | 6 | $74 / $34 | TAPE DUMP | I | JSR $C800→$CAC0 |
| $1C (28) | 4 | 5 | $6C / $2C | STORE | C | $F7A4→$A00F: copy 40 B edit buffer → battery RAM; A440: nothing |
| $1D (29) | 4 | 3 | $5C / $1C | EDIT | C | JMP $A800 (edit pages) |
| $1E (30) | 2 | 2 | $52 / $12 | AUTO TUNE | C | $F793: JMP $C003; **A440+AUTO TUNE = code $2A** |
| $20 (32) | 3 | 1 | $4B / $0B | CALL R | C | `$0608`=0; A440: load null program $F068 into $0800 |
| $21 (33) | 3 | 3 | $5B / $1B | CALL L | C | `$0608`=1; A440: null program into $0840 |
| $22 (34) | 3 | 2 | $53 / $13 | STEP ENABLE (recall step) | C | `$0608`=2 → $F362; A440: Alternate page ($8009) |
| $23 (35) | 3 | 4 | $63 / $23 | STEP LOAD (save panel to step) | C | `$0608`=3 → $F387 packs panel; A440: JSR $8000 ($8588) |
| $28 (40) | 1 | 6 | $71 / $31 | PB DEFEAT R | C | toggle `$63` → latch `$6400` (after STA $3000); in WHOLE also writes `$6401` |
| $29 (41) | 1 | 2 | $51 / $11 | PB DEFEAT L | C | toggle `$64` → `$6401`; ignored in WHOLE |
| $2A (42) | 2 | 6 | $72 / $32 | A440 tone toggle | C (function) / I (physical key) | $F1B2: `$65` toggle; on: PTM CR3=$82, T3 latch=$08E0 → 2e6/(2·2273)=**439.9 Hz** on T3 out; off: CR3=$02 |
| $2B (43) | 5 | 5 | $6D / $2D | AUDIO MUTE | C | toggle `$5D`, JSR $E01E; A440: velocity-taper page ($B800) |
| $30 (48) | 1 | 7 | $79 / $39 | REL DEFEAT R | C | toggle `$5E` (used by release, $E619); A440: toggle prog byte $1C bit7 (VCA velocity) R |
| $31 (49) | 1 | 1 | $49 / $09 | REL DEFEAT L | C | `$5F`; A440: VCA velocity L |
| $32 (50) | 2 | 0 | $42 / $02 | ARP RIGHT | C | `$60`; arp-run `$17`=`$60`&¬`$62`; A440: polysequencer ($9000) |
| $33 (51) | 2 | 1 | $4A / $0A | ARP LEFT | C | `$61` → `$18` |
| $34 (52) | 2 | 3 | $5A / $1A | ARP PAUSE | C | `$62`; if seq active (`$09D3`) → $9000 |
| $38 (56) | 2 | 5 | $6A / $2A | ARP DOWN | C | mode 0 (`$0603`), LED `$66`; A440: MIDI page (`$0750`, $B830) |
| $39 (57) | 2 | 4 | $62 / $22 | ARP RANDOM | C | mode 1, LED `$67`; A440: Set page (`$075A`, $85C5) |
| $3A (58) | 2 | 7 | $7A / $3A | ARP UP | C | mode 2, LED `$68`; UP then DOWN (or DOWN then UP) = mode 3 (LEDs `$66`+`$68`) |

Digit positions: 0=RL4/SL0, 1=RL0/SL3, 2=RL0/SL1, 3=RL1/SL3, 4=RL0/SL5, 5=RL0/SL7, 6=RL1/SL5, 7=RL0/SL2, 8=RL0/SL0, 9=RL0/SL4.
**A440** itself: wired to the 8279 **SHIFT** input (C: polarity proven by chords). 44 codes exist for 41 matrix buttons + A440: codes $14, $15 have no Rev4 legend (I); whether the A440 key also closes matrix position RL2/SL6 (code $2A, tone toggle) is **unconfirmed — check on hardware**. Rev3 KEYTAB/LEDTAB/font are byte-identical (same panel).
Unused codes: 7, $16, $17, $1F, $24–$27, $2C–$2F, $35–$37 (not in KEYTAB).
Edit pages use a second map `EDIT_KEYTAB` $AB80 (code → edit-switch index; e.g. $1C→$60 STORE, $1D→$61 EXIT, $12/$13→$21/$20, digits→$30–$39).

### 5.2 Display RAM (8279, 16 locations, only 0–9 used)

| Disp RAM | Normal page content ($A2CA) | Conf. |
|---|---|---|
| 0 | LED byte A | C |
| 1, 2 | LEFT window: 1 = tens, 2 = units (`$51` = L program #) | C |
| 3 | LED byte B (octave LEDs) | C |
| 4, 5 | RIGHT window: **4 = units, 5 = tens** (reversed wiring) (`$50` = R program #) | C (code) / I (wiring) |
| 6 | LED byte C | C |
| 7, 8 | STEP window: 7 = tens, 8 = units (`$52` = step #) | C |
| 9 | LED byte D (arp, A440, AUTO TUNE, tempo blink) | C |
| 10–15 | not written on normal page (no strobe via 7445) | I |

- Write method: cmd `$90` (write from address 0, auto-increment), 10 data bytes; whole display rewritten on every key/pot event (`$A01E`→$A2CA). IRQ-safety: `$07F5`=$FF during the rewrite (blocks the IRQ blink write). **No RAM shadow of display RAM**: digits come from `$50–$52`, DP from `$53–$55` bit7 (marks the focused CALL/STEP window, set at $F23E), pending entry from `$0458–$045B`, LEDs from zero-page flags `$56–$74`.
- Edit pages: $AB09 writes digits from `$04F4–$04FF` and LEDs from `$04C0` via `EDIT_LEDTAB` $ABBB (same bit positions as below — independently confirms the button↔LED pairing).
- IRQ blink ($81C3, in control tick, Normal page only): read RAM 9 (`$69`), clear bit2, OR `$74`&4, write back (`$99`), restore `$40`. Phase `$2A` toggles every (`$2C`+1)×6 ticks, or on PIA1 CA1 pulses when `$07E8` (ext clock) set.
- Other writers: $842E (sequencer), $870F (Set page), $C68E (autotune progress: count in STEP window + AUTO TUNE LED), $92A3–$9450 (MIDI/seq), $C23A/$C290/$CADC–$CE34 (tape), $BA24–$BA73 (taper), $ECCE.

### 5.3 7-segment font `SEGFONT` $A080 (C)
Segment bits: **7=a, 6=c, 5=f, 4=b, 3=e, 2=d, 1=g, 0=dp**.

| Char | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | A | b | C | d | E | F | – | blank |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Byte | $FC | $50 | $9E | $D6 | $72 | $E6 | $EE | $D0 | $FE | $F2 | $FA | $6E | $AC | $5E | $AE | $AA | $02 | $00 |

Derived (not in table): L=$2C, r=$0A, n=$4A (used at $CADF), P=$BA, U=$7C, o=$4E, H=$7A, t=$2E, y=$76, S=$E6.

### 5.4 LED map (`LEDTAB` $A09D: flag per bit, MSB first; flag ≠0 → LED on) (C)

| Disp RAM | b7 | b6 | b5 | b4 | b3 | b2 | b1 | b0 |
|---|---|---|---|---|---|---|---|---|
| 0 | `$5D` AUDIO MUTE | `$6C` ? | `$58` SPLIT | `$59` LAYER | `$56` UNISON L | `$57` UNISON R | `$5C` WHOLE 8 | `$6D` ? |
| 3 | `$73` OCT L state2 | `$6A` ? | `$71` OCT L state1 | `$72` OCT R state2 | `$6E` OCT R state0 | `$6F` OCT L state0 | `$70` OCT R state1 | `$6B` ? |
| 6 | `$61` ARP LEFT | `$63` PB DEF R | `$00` (unused) | `$5A` HOLD L | `$5F` REL DEF L | `$5E` REL DEF R | `$5B` HOLD R | `$64` PB DEF L |
| 9 | `$68` ARP UP | `$62` PAUSE | `$67` RANDOM | `$66` DOWN | `$69` AUTO TUNE | `$74` tempo/arp-speed blink | `$65` A440 (tone on) | `$60` ARP RIGHT |

- Octave LEDs: flag `$6E + 2·state + side` ($A292). State offsets 0/12/24 semitones (`$EB55`, `$AEB0`) → state 0 = DOWN, 1 = NORMAL, 2 = UP (I). Seq page reuses the 3 left-octave LEDs (b7/b5/b2 of RAM 3) for `$089F`.
- `$6A`,`$6B`,`$6C`,`$6D`: never set on Normal page (only cleared at $A379); remaining physical LEDs are EDIT, STORE, TAPE LOAD, TAPE DUMP (S: layout p.11) → likely these four (I, check on hardware). Seq page drives RAM0 b6/b0 (`$0799`/`$0798`) and RAM3 b6 (`$07E8` ext clock), b0 (`$08C3`).
- AUTO TUNE LED = RAM9 b3 (C: $C6B4 writes $08 during autotune; `$69` cleared at end $C688).


## 6. Pot ADC and pot map

| Item | Value | Conf. |
|---|---|---|
| Converter | `adc_sar8` $CE4E: software SAR. PIA1 PB=0, PIA2 PA=$FF (DAC1022 full scale); 7 trials on **PIA1 PA6..PA0** (DAC MSBs), comparator read on **PIA1 PB0** (1 → bit too high, subtract), then 8th bit on **PIA1 PB7**; ~19-cycle settle per trial. Result `$0707` (8 bit). ≈150 µs/conversion. | C |
| Mux select | `pot_mux_select` $E685: `STA $307F` (selects latch group via S&H address), then 8× `STA $6400+X` / ASL (X=7..0) → addressable latch Q7..Q0 = mux address (bit order depends on which data line feeds the CD4724 — check DIGIMOD p.19). Channel for the *next* pot is selected right after each conversion → ≥1 tick settling. | C / I |
| Scan routine | `pot_scan` $E1AB (main loop via $E00C). Runs only when `$0637`=0 (set to 2, decremented each control tick) and `$0612|$0613`=0. Round-robin `$35` = 14..0; every 4th conversion re-reads the last-moved pot (`$08EC`, `$08E9/$08EA`). Full sweep ≈ 20 conversions × ≥2 ticks ≈ 80+ ms. | C |
| Resolution / hysteresis | result LSR → **7-bit (0–127)** stored `$0710,X`. Change accepted if \|new−old\| ≥ `$03C6` = **2** (8 while a value is being displayed/edited, $E470). First pass (`$03C5`≥0) just fills. | C |
| Boot | `pot_init_all` $E692 reads all 16 channels (index 15 = mux 2 → `$071F`, read only at boot) with ~3 ms settle each. | C |
| Normal-page use | $E2DC: relative trims `$0780,X` clamped ±$40 ($E377), written into program buffer byte (+$40 for L) | C |

| Pot index | Mux ch. (`$E0CB`) | Knob | Program byte (`$E0DB`/`$E0E1`/`$E0E5`) |
|---|---|---|---|
| 0 / 1 | 1 / 9 | Fc R / L | $13 VCF Fc |
| 2 / 3 | 5 / 10 | GLIDE R / L | $0A glide time |
| 4 / 5 | 7 / 13 | LFO RATE R / L | $0B LFO1 rate |
| 6 / 7 | 4 / 12 | A R / L | $19 ADSR1 attack + $15 ADSR2 attack |
| 8 / 9 | 6 / 15 | R R / L | $1B ADSR1 release + $17 ADSR2 release |
| 10 / 11 | 3 / 8 | DETUNE R / L | $22 VCO1 detune |
| 12 / 13 | 0 / 11 | VOLUME R / L | $21 program volume |
| 14 | 14 | ARP SPEED | `$08FF` = `$078E`+$40 (step byte 5) |
| 15 | 2 | spare 16th channel (boot read only) | — |
All C (code); knob names follow Ref Guide normal page (R).


## 7. VPK-5 keyboard (CPU side)

| Item | Value | Conf. |
|---|---|---|
| Strobes | `$2807` read = ACKOFF, `$2801` read = DSTR (frame start/latch), `$2800` write = shift clock, `$2805` read D7 = data line A, `$2806` read D7 = data line B, `$2802` read = ASTR (end of frame) | C (sequence) / I (meaning) |
| Frame (every control tick, $8127) | ACKOFF, DSTR → 8 header clocks (interleaved with CV refresh writes at $801B/$8089, or via $FC4F) → `vpk_scan` $B053: 61 keys X=60..0: read `$2805` D7, clock → ASTR | C |
| Header bits | every 5th tick ($34 counter) `vpk_hdr_bits` $FC4F: clk, clk, read `$2805` D7 → `$3A`, clk, read `$2806` D7 → `$3B`, 3 clks. Two VPK-5 buttons, active low, debounced (2 equal reads), auto-repeat via `$08E6` ($3F then $0F); `vpk_buttons` $FCAC injects codes **$12 REV / $13 FWD**. If both read high at first check → `$0762`=0 + MIDI re-init ($981B, $C82A) — probably "keyboard absent". | C / I |
| Key state | `$02C0,X` state: 0 idle → (A=1) state 1, counter `$0240,X`=$C0 → each tick while A=1: if B (`$2806` D7)=1 → counter++ (sat. $FF); if B=0 → **note on**, velocity raw `$0280,X`=counter, `$0200,X` bit7 set, state 2 → when A=0 → **note off**, state 0, `$0200,X` bit7 clear. A released before B → back to 0. | C |
| Note number | `(X EOR $3F) + $21` → X=60 → 36 (C2) … X=0 → 96 (C7); 61 keys | C |
| Velocity | raw = ticks between contact A and B, from $C0 (≈2 ms/tick at 488 Hz tick); mapped through tapers elsewhere | C / I (2.05 ms tick) |
| Events | `vpk_key_event` $B116; if `$09D6` (MIDI out on) also JSR $B3F9 | C |
| Gating | scan skipped when `$0634` negative | C |
| Analog | joystick/pressure not digitized (no reads) | C (absence) |


## 8. Other inputs and outputs

| Input | Use | Conf. |
|---|---|---|
| PIA2 PB0–PB5 | 6 footswitches. `footsw_poll` $F976 (main loop): 2-read debounce (`$07FA`), change mask vs `$07F9`. Config 3 B/switch at **$5A46–$5A57**: byte0 bit7 = act on both edges, byte1/2 = panel button codes injected with `$94`=$40 (A440 up); code $1E (AUTO TUNE) and ≥$80 ignored. Defaults ($E814): FS0 REL DEF R+L (both edges), FS1 PAUSE, FS2 HOLD L+R (both edges), FS3 UNISON L+R (both edges), FS4 REV, FS5 FWD. Magic `$5A58`=$A5; FS4/FS5 entries are re-copied from ROM at every boot ($EB0D). | C |
| PIA2 PB6 | tape input (zero-cross timed with PTM T2, $C993) | C |
| PIA2 PB7 | not used by code | C (absence) |
| PIA2 CB2 | tape output (CRB bit3 via shadow `$070F`, $C960) | C |
| PIA2 CA1 | ext arp/seq clock IRQ (handler $80B7 when `$09B6`) | C |
| PIA1 CA1 | clock pulse flag polled in tick ($816C) when `$07E8` → LED blink | C |
| Memory protect | not read by code. `$E457` spins writing $AA to `$4FFF` until it reads back (called at reset $EA02) — battery-RAM write-enable/power-good wait | C / I |


### 8.1 MIDI (68B50 on NMI) — **C**
| Item | Value |
|---|---|
| Init `$CEA3` | `$7033←$98`, `$7032←0` (dev hooks); soft CR `$09F0 = $15` (÷16, 8N1, RTS low, no IRQs); `$09EB = $80` (RX IRQ enable); ring pointers = 1; `$3800 ← $03` master reset; CR written by `$99E6` = `$09F0 \| $09EA \| $09EB` |
| NMI `$990B` | write `$09F0` (IRQs off), read status; RDRF → `$996F`: byte → RX ring `$0B00` (count `$09F2`, wr `$09F6`), **dropped if count ≥ $7F**; `$F8–$FE` ignored; **`$FF` → `JMP $E80E` (full reset)**. Else TDRE and `$09EA` → `$9948`: TX ring `$0B80` → `$3801`, clear `$09EA` when empty. Rewrite CR with enables (re-arms the edge), loop while status bit7. |
| TX `$999F` | queue into ring `$0B80` (wr `$09F7`, count `$09F3`), **spins while full**; sets `$09EA = $20` |
| Parser `$99FA` | main loop only; running status; SysEx dispatcher `$9B56` (25 commands, word table `$9B6F`) |
| Risk | RX is drained once per main-loop pass; a slow pass (display rewrite, program apply) with dense input overflows the 127-byte ring → bytes lost (I: the "dense MIDI hang" lead) |

## 9. Autotune (`$C003` → `$C124`, from the AUTO TUNE button `$F79E` and from `$9E08`)

- Runs entirely with **SEI**. The control tick, envelopes and pot scan stop; the NMI (MIDI) still runs. Return address saved at `$047D`/`$047E`; SP reset at the end (`$C164`). **C**
- Setup (`$C018`): PTM as in §2.5. The 8279 display is cleared. Crosspoints and IC23 are cleared (`$C6CF`). All slots are written once (`$C5D1`).
- Loop: oscillator `$047A` = 15 … 0. Voice = osc>>1. **Odd osc = VCO1 (ch4–7), even = VCO2 (ch0–3).**
  - Select: `$6302`/`$6303` (VCO1/2 comparator) and DIGIMOD IC22 DA0–2 (voice tune mux) via `$C043`.
  - Waveform latches: all off except Q2/Q6 (`$C17F`).
  - Display: osc number in digits 7–8 (`$C68E`).
- Per oscillator: three passes, all writing the 4 slots of that osc through `$C4FC`.
  1. **Offset** (`$C1E1`/`$C2D5`): the pitch slot is driven at `$2E + $0720[osc]`. The period is measured with PTM T1 gated by VCO-detect (`$C3FA`: repeated readings until two agree within `$0475`; more than 48 retries → error "C"). The 16-bit offset `$0720`/`$0730` is adjusted, up to 32 iterations (no convergence → error "b").
  2. **Scale** (`$C348`): the period is measured at two pitches (`$16`+ofs, `$2E`+ofs). The ch0/ch4 trim (`$0460`) is adjusted until the octave span is right. The iteration count runs out → error "d".
  3. **Pulse-width symmetry** (`$C55E`): PA7 high and low times are counted in software. The ch2/ch6 PW value is adjusted.
- Errors (`$C27B`/`$C28D`):
  - Error letter = 7-seg glyph `$A080[$0A..$0D]` ("A".."d") in display RAM 4.
  - The failing voice is OR-ed into bitmask `$F3`.
  - The run moves on to the next oscillator (it does not abort).
- Results are saved to battery RAM by `$C606`/`$C62D` (all **C**):

| Address | Size | Content |
|---|---|---|
| `$5980`–`$598F` | 16 | pitch offset MSB per osc (→ `$0720`) |
| `$5990`–`$599F` | 16 | pitch offset LSB (→ `$0730`) |
| `$59A0`–`$59AF` | 16 | scale trim, PA byte (→ slot 4·osc, i.e. ch0/ch4) |
| `$59B0`–`$59BF` | 16 | scale trim, PB byte |
| `$59C0`–`$59CF` | 16 | PW cal MSB = slot ch2 − `$40`, clamped to `$F8`… (added to the program PW in `$DD66`) |
| `$59D0`–`$59DF` | 16 | PW cal LSB |

  Osc index: 2v = VCO2 of voice v, 2v+1 = VCO1. At boot, `$E102` reloads the first four tables. No checksum or valid flag was found.
- End (`$C14F`): save, then:
  - PTM restore (`$C64E`);
  - `$F05C`, `$981E`, `$A01E` (UI/MIDI re-init);
  - CLI, then RTS through the saved return address.


## 10. Engine tables in ROM (**C**)

| Address | Size | Content | Used by |
|---|---|---|---|
| `$D000`–`$D7FF` | 4×(256 PA + 256 PB) | Envelope level → 14-bit DAC curve, 1024 points, monotonic 0…16380, convex (≈x^1.6 low, ≈x^2.4 high). Pages D0/D1, D2/D3, D4/D5, D6/D7 = fraction bits 00/01/10/11 of `$0380`. | env handlers `$8E35`…`$8F9B`, `$E4E1` |
| `$D800`–`$D8FF` | 256 | Inverse curve (concave 0…255), index level×2 | env state entry `$8DF7` |
| `$D900`–`$D9FF` | 256 | Convex 0…255 parameter curve, index param×2 | glide `$DE51`, program volume `$DC42`/`$F949`, blink rate `$DC29` |
| `$8800`–`$887F` / `$8880`–`$88FF` | 128 + 128 | ADSR rate (16-bit hi/lo) per 7-bit time parameter | `$EEEF`, `$E579`, `$A508` |
| `$B66D`–`$B758` | 236 | Tempo → T1 MSB (`$FF` holes) | `$B657` |
| `$948C` | 3 | Arp step dividers 96/48/24 | `$94B2` |
| `$800F` / `$8015` | 6 + 6 | Refresh groups | `$801B` |
| `$DEE1` | 3 | Waveform level-compensation steps (9, `$15`, `$17`) | `$DF2E` |
| `$E989`–`$E9F4` | 36×3 | Boot I/O init (value, lo, hi), executed last to first | `$EA35` |
| `$C009` | 15 | Pot-mux channel order  | `$C678` |
| `$CFB6`–`$CFFF` | 74 | zero fill (free) | — |


## 11. Open questions (check on hardware or at higher schematic resolution)

| # | Question | Why it matters |
|---|---|---|
| 1 | ACIA clock: 500 kHz (÷16, as the code implies) or 31.25 kHz? | MIDI driver CR value |
| 2 | Does the A440 key also close matrix RL2/SL6 (code `$2A`, tone toggle), or only SHIFT? | A440 as pure shift vs. a key |
| 3 | Which LEDs are flags `$6A–$6D` (display RAM 0 b6/b0, 3 b6/b0)? Likely EDIT, STORE, TAPE LOAD, TAPE DUMP. | NeoV8 LED map |
| 4 | Physical keys behind codes `$14`/`$15` (RL5/SL7, RL4/SL7), toggling `$7E/$7F` (glide skip). | 2 extra buttons? |
| 5 | Codes `$04`/`$05` = HOLD L/R (inferred from symmetry and toggle logic). | button map |
| 6 | CD4724 data-line bit order for the DIGIMOD pot-mux latch. | pot mux addressing (copying the stock sequence `$E685` avoids the question) |
| 7 | Slots `$47/$4F`, `$50`, `$55` exact destinations; `$51/$54` unused? | CV map completeness |
| 8 | `$6404` "AUDIO MUTE" latch is never written; how does AUDIO MUTE act (code `$2B` → `$E01E`)? | mute implementation |
| 9 | ANA I crosspoint matrix exact chip/crosspoint mapping (`$65xx`). | mod-bank engine parity — copy stock `$DB22` tables meanwhile |

