//! Sound banks into battery RAM: SysEx dumps (`.syx`, the Rev4 / NeoV8 format of docs/midi-implementation.md §5),
//! cassette recordings (`.wav`, the Rev4 tape format: the reader of the stock ROM, $C972-$CA65), and raw battery
//! RAM images (`.bin`, 8 KB).
//!
//! Battery RAM layout (docs/rev4-ram-map.md): programs 40 bytes each at $4000 (offset 0), steps 24 bytes each at
//! $5000 (offset $1000), the taper / footswitch block $5A20-$5A58, NeoV8 globals at $5A80 (64 bytes).

/// What a file contained, ready to be written into a battery RAM image.
#[derive(Default)]
pub struct Bank {
    pub programs: Vec<(usize, [u8; 40])>,
    pub steps: Vec<(usize, [u8; 24])>,
    /// $5A20-$5A58
    pub tail: Option<[u8; 57]>,
    /// NeoV8 globals ($5A80, 64 bytes)
    pub globals: Option<[u8; 64]>,
    /// a whole battery RAM image
    pub image: Option<Vec<u8>>,
}

impl Bank {
    pub fn summary(&self) -> String {
        if self.image.is_some() { return "battery RAM image".into(); }
        let mut s = format!("{} programs, {} steps", self.programs.len(), self.steps.len());
        if self.tail.is_some() { s += ", tapers/footswitches"; }
        if self.globals.is_some() { s += ", NeoV8 settings"; }
        s
    }

    pub fn is_empty(&self) -> bool {
        self.image.is_none() && self.programs.is_empty() && self.steps.is_empty() && self.tail.is_none() && self.globals.is_none()
    }

    /// Write into a battery RAM image (8 KB). The autotune data and everything not in the bank are kept.
    pub fn apply(&self, bram: &mut [u8]) {
        if let Some(img) = &self.image {
            // keep this instrument's tuning ($5980-$59DF): it belongs to its oscillators
            let tune: Vec<u8> = bram[0x1980..0x19e0].to_vec();
            bram.copy_from_slice(&img[..0x2000]);
            bram[0x1980..0x19e0].copy_from_slice(&tune);
            return;
        }
        for (n, p) in &self.programs { bram[40 * n..40 * n + 40].copy_from_slice(p); }
        for (n, s) in &self.steps { bram[0x1000 + 24 * n..0x1000 + 24 * n + 24].copy_from_slice(s); }
        if let Some(t) = &self.tail { bram[0x1a20..0x1a59].copy_from_slice(t); }
        if let Some(g) = &self.globals { bram[0x1a80..0x1ac0].copy_from_slice(g); }
        bram[0x0fff] = 0xaa; // battery check bytes
        bram[0x1a58] = 0xa5;
    }
}

/// Load a bank file, by content: SysEx (starts with F0), WAV (RIFF), or an 8 KB battery image.
pub fn load(path: &std::path::Path) -> Result<Bank, String> {
    let data = std::fs::read(path).map_err(|e| format!("{}: {e}", path.display()))?;
    let bank = if data.first() == Some(&0xf0) {
        parse_syx(&data)
    } else if data.starts_with(b"RIFF") {
        let (x, sr) = read_wav(&data)?;
        decode_tape(&x, sr)?
    } else if data.len() == 0x2000 {
        Bank { image: Some(data), ..Default::default() }
    } else {
        return Err(format!("{}: not a SysEx dump, a WAV tape recording or an 8 KB battery image", path.display()));
    };
    if bank.is_empty() { return Err(format!("{}: no Voyetra programs or steps found", path.display())); }
    Ok(bank)
}

// ------------------------------------------------------------------ SysEx

/// `n` bytes from nibbles, low nibble first.
fn nibbles(d: &[u8], n: usize) -> Option<Vec<u8>> {
    if d.len() < 2 * n { return None; }
    Some((0..n).map(|i| (d[2 * i] & 0x0f) | ((d[2 * i + 1] & 0x0f) << 4)).collect())
}

/// Every `F0 03 ...` message: programs (cmd 1), steps (cmd 2), the taper/footswitch block (cmd 22), NeoV8 globals
/// (cmd $23). The controller flag (bit 6 of the command) is ignored.
pub fn parse_syx(data: &[u8]) -> Bank {
    let mut bank = Bank::default();
    let mut i = 0;
    while i < data.len() {
        if data[i] != 0xf0 { i += 1; continue; }
        let end = data[i + 1..].iter().position(|&b| b & 0x80 != 0).map_or(data.len(), |p| i + 1 + p);
        let m = &data[i + 1..end];
        i = end;
        if m.len() < 2 || m[0] != 0x03 { continue; }
        let body = &m[2..];
        match m[1] & 0x3f {
            1 if body.len() >= 2 => {
                if let (Some(b), n @ 0..=99) = (nibbles(&body[2..], 40), body[1] as usize) {
                    bank.programs.push((n, b.try_into().unwrap()));
                }
            }
            2 if body.len() >= 2 => {
                if let (Some(b), n @ 0..=99) = (nibbles(&body[2..], 24), body[1] as usize) {
                    bank.steps.push((n, b.try_into().unwrap()));
                }
            }
            0x16 => {
                // the first byte received goes to $5A58 (stock order)
                if let Some(b) = nibbles(body, 57) {
                    let mut t = [0u8; 57];
                    for (k, v) in b.iter().enumerate() { t[56 - k] = *v; }
                    bank.tail = Some(t);
                }
            }
            0x23 => {
                if let Some(b) = nibbles(body, 64) { bank.globals = Some(b.try_into().unwrap()); }
            }
            _ => {}
        }
    }
    bank
}

// ------------------------------------------------------------------ WAV

/// Mono samples (channels averaged) and the sample rate of a PCM (16/24/32-bit) or float WAV file.
pub fn read_wav(d: &[u8]) -> Result<(Vec<f32>, f64), String> {
    let u16le = |p: usize| u16::from_le_bytes([d[p], d[p + 1]]) as usize;
    let u32le = |p: usize| u32::from_le_bytes([d[p], d[p + 1], d[p + 2], d[p + 3]]) as usize;
    if d.len() < 12 || &d[8..12] != b"WAVE" { return Err("not a WAV file".into()); }
    let (mut fmt, mut ch, mut sr, mut bits) = (0, 0, 0, 0);
    let mut p = 12;
    while p + 8 <= d.len() {
        let (id, len) = (&d[p..p + 4], u32le(p + 4));
        let body = p + 8;
        if id == b"fmt " && body + 16 <= d.len() {
            fmt = u16le(body);
            ch = u16le(body + 2);
            sr = u32le(body + 4);
            bits = u16le(body + 14);
            if fmt == 0xfffe && body + 26 <= d.len() { fmt = u16le(body + 24); } // WAVE_FORMAT_EXTENSIBLE
        } else if id == b"data" {
            if ch == 0 { return Err("WAV: data before fmt".into()); }
            let end = (body + len).min(d.len());
            let bps = bits / 8;
            let frames = (end - body) / (bps * ch);
            let sample = |q: usize| -> f32 {
                match (fmt, bits) {
                    (1, 16) => i16::from_le_bytes([d[q], d[q + 1]]) as f32 / 32768.0,
                    (1, 24) => (i32::from_le_bytes([0, d[q], d[q + 1], d[q + 2]]) >> 8) as f32 / 8_388_608.0,
                    (1, 32) => i32::from_le_bytes([d[q], d[q + 1], d[q + 2], d[q + 3]]) as f32 / 2_147_483_648.0,
                    (3, 32) => f32::from_le_bytes([d[q], d[q + 1], d[q + 2], d[q + 3]]),
                    (1, 8) => (d[q] as f32 - 128.0) / 128.0,
                    _ => 0.0,
                }
            };
            if !matches!((fmt, bits), (1, 8) | (1, 16) | (1, 24) | (1, 32) | (3, 32)) {
                return Err(format!("WAV: unsupported format {fmt}/{bits} bit"));
            }
            let x = (0..frames)
                .map(|f| (0..ch).map(|c| sample(body + (f * ch + c) * bps)).sum::<f32>() / ch as f32)
                .collect();
            return Ok((x, sr as f64));
        }
        p = body + len + (len & 1);
    }
    Err("WAV: no data".into())
}

// ------------------------------------------------------------------ cassette

/// Edge-to-edge intervals (µs) of a tape recording: DC removed with a 5 ms moving average, zero crossings
/// interpolated linearly.
fn intervals(x: &[f32], sr: f64) -> Vec<f64> {
    let k = ((sr * 0.005) as usize).max(1);
    let mut pre = vec![0f64; x.len() + 1];
    for (i, v) in x.iter().enumerate() { pre[i + 1] = pre[i] + *v as f64; }
    let y: Vec<f64> = (0..x.len())
        .map(|i| {
            let (a, b) = (i.saturating_sub(k / 2), (i + k - k / 2).min(x.len()));
            x[i] as f64 - (pre[b] - pre[a]) / (b - a) as f64
        })
        .collect();
    let mut t = Vec::new();
    for i in 0..y.len().saturating_sub(1) {
        if (y[i] < 0.0) != (y[i + 1] < 0.0) {
            t.push((i as f64 + y[i] / (y[i] - y[i + 1])) / sr * 1e6);
        }
    }
    t.windows(2).map(|w| w[1] - w[0]).collect()
}

/// The ROM's tape reader ($C972-$C9E6): a bit is 4 intervals, the first short; the 4th is short for a 1.
struct Reader { short: Vec<bool>, i: usize }

impl Reader {
    fn interval(&mut self) -> Option<bool> {
        let v = *self.short.get(self.i)?;
        self.i += 1;
        Some(v)
    }
    fn bit(&mut self) -> Option<u8> {
        while !self.interval()? {}
        self.interval()?;
        self.interval()?;
        Some(self.interval()? as u8)
    }
    fn byte(&mut self) -> Option<u8> {
        let mut r = 0u8;
        for _ in 0..8 { r = (r >> 1) | (self.bit()? << 7); }
        Some(r)
    }
    /// $C9B6: a run of $16 bytes, then $A3
    fn sync(&mut self) -> Option<()> {
        loop {
            let mut r = 0u8;
            while r != 0x16 { r = (r >> 1) | (self.bit()? << 7); }
            let mut run = true;
            for _ in 0..5 { if self.byte()? != 0x16 { run = false; break; } }
            if !run { continue; }
            loop {
                match self.byte()? {
                    0xa3 => return Some(()),
                    0x16 => {}
                    _ => break,
                }
            }
        }
    }
    /// a checksummed block: optional lead bytes, `n` data bytes, 16-bit sum low/high
    fn block(&mut self, lead: usize, n: usize) -> Option<(Vec<u8>, bool)> {
        self.sync()?;
        for _ in 0..lead { self.byte()?; }
        let d: Vec<u8> = (0..n).map(|_| self.byte()).collect::<Option<_>>()?;
        let (lo, hi) = (self.byte()? as u16, self.byte()? as u16);
        let sum = d.iter().fold(0u16, |s, &b| s.wrapping_add(b as u16));
        Some((d, sum == (hi << 8 | lo)))
    }
}

/// Decode a Rev4 cassette dump (format tag $45): 100 program+step blocks, then the taper/footswitch block.
pub fn decode_tape(x: &[f32], sr: f64) -> Result<Bank, String> {
    let short = intervals(x, sr).iter().map(|&d| d < 345.0).collect();
    let mut r = Reader { short, i: 0 };
    r.sync().ok_or("tape: no data found (not a Voyetra cassette dump?)")?;
    let hdr: Vec<u8> = (0..10).map(|_| r.byte()).collect::<Option<_>>().ok_or("tape: header cut short")?;
    if hdr[9] != 0x45 {
        return Err(format!("tape: format ${:02X} (only the Rev4 format $45 is supported)", hdr[9]));
    }
    let mut bank = Bank::default();
    let mut bad = 0;
    for n in 0..100 {
        let Some((d, ok)) = r.block(6, 64) else { break };
        if !ok { bad += 1; continue; }
        let mut buf = [0u8; 64];
        for (k, v) in d.iter().enumerate() { buf[0x3f - k] = *v; }
        bank.programs.push((n, buf[0x18..0x40].try_into().unwrap()));
        bank.steps.push((n, buf[0..0x18].try_into().unwrap()));
    }
    if bank.programs.is_empty() { return Err("tape: no program block decoded".into()); }
    if bank.programs.len() + bad == 100 {
        if let Some((d, true)) = r.block(0, 57) {
            let mut t = [0u8; 57];
            for (k, v) in d.iter().enumerate() { t[0x38 - k] = *v; }
            bank.tail = Some(t);
        }
    }
    if bad > 0 { eprintln!("NeoV8: tape: {bad} blocks with a bad checksum skipped"); }
    Ok(bank)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn syx_program_and_step_dumps() {
        let prog: [u8; 40] = std::array::from_fn(|i| (i * 7 + 3) as u8);
        let step: [u8; 24] = std::array::from_fn(|i| (i * 11 + 1) as u8);
        let nib = |b: &[u8]| b.iter().flat_map(|v| [v & 0x0f, v >> 4]).collect::<Vec<u8>>();
        let mut syx = vec![0xf0, 0x03, 0x01, 0x00, 42];
        syx.extend(nib(&prog));
        syx.extend(nib(&[0x80, 0x80, 0xff, 0xff, 0xff]));
        syx.push(0xf7);
        syx.extend([0xf0, 0x03, 0x42, 0x00, 7]);
        syx.extend(nib(&step));
        syx.extend(nib(&[0x80; 6]));
        syx.push(0xf7);
        let b = parse_syx(&syx);
        assert_eq!(b.programs, vec![(42, prog)]);
        assert_eq!(b.steps, vec![(7, step)]);
        let mut bram = vec![0u8; 0x2000];
        b.apply(&mut bram);
        assert_eq!(&bram[40 * 42..40 * 43], &prog);
        assert_eq!(&bram[0x1000 + 24 * 7..0x1000 + 24 * 8], &step);
    }

    /// The user's factory tape, when it is in the repository folder (not distributed).
    #[test]
    fn factory_tape_decodes_when_present() {
        let p = concat!(env!("CARGO_MANIFEST_DIR"), "/../../../Voyetra 8 synths/voyetra-8_v8factorytapeB2.wav");
        let Ok(bank) = load(std::path::Path::new(p)) else { return };
        assert_eq!(bank.programs.len(), 100);
        assert_eq!(bank.steps.len(), 100);
        assert_eq!(bank.tail.map(|t| t[56]), Some(0xa5));
    }
}
