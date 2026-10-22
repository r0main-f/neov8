//! The front panel as the ROM sees it: 8279 key codes, the display RAM layout (digits, LEDs) and the pot
//! multiplexer channels. Ported from the browser simulator (sim/src/machine/panelmap.ts, backend.ts).

/// A panel button: id, label, 8279 FIFO byte with the A440 (shift) key up (bit 6 = 1).
pub struct Button {
    pub id: &'static str,
    pub label: &'static str,
    pub code: u8,
}

const fn b(id: &'static str, label: &'static str, code: u8) -> Button { Button { id, label, code } }

/// Groups of buttons in panel order (left to right). A440 is the shift key: a button pressed with it held sends
/// `code & !0x40`.
pub const GROUPS: &[(&str, &[Button])] = &[
    ("KEYBOARD MODE", &[b("kb_whole", "whole 8", 93), b("kb_split", "split", 101), b("kb_layer", "layer", 69)]),
    ("UNISON", &[b("uni_l", "L", 85), b("uni_r", "R", 117)]),
    ("LEFT", &[b("call_l", "call", 91), b("oct_l", "octave", 107)]),
    ("RIGHT", &[b("oct_r", "octave", 123), b("call_r", "call", 75)]),
    ("STEP", &[b("step_load", "load", 99), b("step_enable", "enable", 83)]),
    ("", &[b("edit", "EDIT", 92), b("store", "STORE", 108), b("autotune", "AUTO TUNE", 82), b("mute", "AUDIO MUTE", 109)]),
    ("TAPE", &[b("tape_load", "load", 100), b("tape_dump", "dump", 116)]),
    // second row
    (
        "PROGRAMMER",
        &[
            b("k1", "1", 88), b("k2", "2", 72), b("k3", "3", 89), b("k4", "4", 104), b("k5", "5", 120),
            b("k6", "6", 105), b("k7", "7", 80), b("k8", "8", 64), b("k9", "9", 96), b("fwd", "FWD", 84),
            b("k0", "0", 68), b("rev", "REV", 112),
        ],
    ),
    (
        "ARPEGGIATOR",
        &[
            b("arp_up", "up", 122), b("arp_down", "down", 106), b("arp_random", "random", 98),
            b("arp_left", "left", 74), b("arp_pause", "pause", 90), b("arp_right", "right", 66),
        ],
    ),
    (
        "PERFORMANCE",
        &[
            b("reldef_l", "rel. def. L", 73), b("pbdef_l", "bend def. L", 81), b("hold_l", "hold L", 97),
            b("reldef_r", "rel. def. R", 121), b("pbdef_r", "bend def. R", 113), b("hold_r", "hold R", 65),
        ],
    ),
];
/// The first `FIRST_ROW` groups go on the top row.
pub const FIRST_ROW: usize = 7;

/// Button LEDs: (display RAM index, bit) (panelmap.ts DISPLAY_MAP.leds).
pub const LEDS: &[(&str, usize, u8)] = &[
    ("mute", 0, 7), ("kb_split", 0, 5), ("kb_layer", 0, 4), ("uni_l", 0, 3), ("uni_r", 0, 2), ("kb_whole", 0, 1),
    ("arp_left", 6, 7), ("pbdef_r", 6, 6), ("hold_l", 6, 4), ("reldef_l", 6, 3), ("reldef_r", 6, 2), ("hold_r", 6, 1),
    ("pbdef_l", 6, 0), ("arp_up", 9, 7), ("arp_pause", 9, 6), ("arp_random", 9, 5), ("arp_down", 9, 4),
    ("autotune", 9, 3), ("a440", 9, 1), ("arp_right", 9, 0),
];

/// Octave LEDs [up, normal, down] per side.
pub const OCT_L: [(usize, u8); 3] = [(3, 7), (3, 5), (3, 2)];
pub const OCT_R: [(usize, u8); 3] = [(3, 4), (3, 1), (3, 3)];

/// Display RAM index of LEFT tens, LEFT units, RIGHT tens, RIGHT units, STEP tens, STEP units.
pub const DIGITS: [usize; 6] = [1, 2, 5, 4, 7, 8];
/// Source bit in a display RAM byte for segments a, b, c, d, e, f, g, dp.
pub const SEG_BITS: [u8; 8] = [7, 4, 6, 2, 3, 5, 1, 0];

/// Segments a..g, dp (bit 0 = a) of display digit `i` (0..5).
pub fn segments(ram: &[u8; 16], i: usize) -> u8 {
    let byte = ram[DIGITS[i]];
    SEG_BITS.iter().enumerate().fold(0, |s, (dst, &src)| if byte & (1 << src) != 0 { s | 1 << dst } else { s })
}

pub fn led(ram: &[u8; 16], id: &str) -> bool {
    LEDS.iter().find(|l| l.0 == id).is_some_and(|&(_, i, bit)| ram[i] & (1 << bit) != 0)
}

/// The program parameter trimmers: (id, label, pot multiplexer channel), LEFT row then RIGHT row, then ARP speed.
pub const POTS_L: [(&str, &str, usize); 7] = [
    ("l_a", "A", 12), ("l_r", "R", 15), ("l_lfo", "LFO rate", 13), ("l_glide", "glide", 10), ("l_fc", "Fc", 9),
    ("l_detune", "detune", 8), ("l_vol", "volume", 11),
];
pub const POTS_R: [(&str, &str, usize); 7] = [
    ("r_a", "A", 4), ("r_r", "R", 6), ("r_lfo", "LFO rate", 7), ("r_glide", "glide", 5), ("r_fc", "Fc", 1),
    ("r_detune", "detune", 3), ("r_vol", "volume", 0),
];
pub const POT_ARP_SPEED: usize = 14;
