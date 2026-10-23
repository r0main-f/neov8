//! The front panel, drawn after a real Rev4 Voyetra Eight module (photos of units in use): black panel with rack
//! ears, outlined sections, cream / red / blue / grey square buttons with their red LEDs, red 7-segment displays,
//! the arpeggiator speed, MASTER TUNE / VOLUME knobs and POWER rocker, and the light-grey PROGRAM PARAMETER
//! TRIMMERS section. Below it: bank loading, the analog performance controls, and an on-screen keyboard.
//!
//! Everything is laid out in panel units (1560 x 450, rack ears included) and scaled to the window. Knobs turn by
//! dragging up / down; double-click returns a trimmer to its centre. A440 latches as the shift key for the next
//! button, as holding it on the panel.

use crate::panel::{self, OCT_L, OCT_R, POTS_L, POTS_R, POT_ARP_SPEED};
use crate::{bank, Cmd, Shared, V8Params, STANDALONE};
use nih_plug::prelude::*;
use nih_plug_egui::egui::{self, Align2, Color32, FontId, Pos2, Rect, Sense, Stroke, StrokeKind, Vec2};
use nih_plug_egui::{create_egui_editor, idle_check_id, widgets, IdleCheck};
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

// panel geometry
const PW: f32 = 1560.0;
const PH: f32 = 450.0;
const EAR: f32 = 30.0;
// colours
const BLACK: Color32 = Color32::from_rgb(20, 20, 20);
const LINE: Color32 = Color32::from_rgb(185, 185, 185);
const TEXT: Color32 = Color32::from_rgb(232, 232, 232);
const CREAM: Color32 = Color32::from_rgb(231, 225, 207);
const RED: Color32 = Color32::from_rgb(200, 40, 52);
const BLUE: Color32 = Color32::from_rgb(70, 150, 200);
const GREY: Color32 = Color32::from_rgb(82, 82, 82);
const TRIM_BG: Color32 = Color32::from_rgb(206, 206, 198);
const TRIM_TEXT: Color32 = Color32::from_rgb(34, 34, 34);
const EAR_COL: Color32 = Color32::from_rgb(186, 186, 180);
const LED_ON: Color32 = Color32::from_rgb(255, 36, 36);
const LED_OFF: Color32 = Color32::from_rgb(70, 16, 16);
const SEG_OFF: Color32 = Color32::from_rgb(52, 10, 10);

// VPK-5 colours (video frames: warm light grey, natural wood cheeks, ivory keys)
const VPK_BODY: Color32 = Color32::from_rgb(196, 194, 184);
const VPK_TOP: Color32 = Color32::from_rgb(208, 206, 196);
const VPK_LIP: Color32 = Color32::from_rgb(180, 178, 168);
const VPK_EDGE: Color32 = Color32::from_rgb(150, 148, 138);
const WOOD: Color32 = Color32::from_rgb(196, 152, 98);
const WOOD_GRAIN: Color32 = Color32::from_rgb(160, 116, 70);
const IVORY: Color32 = Color32::from_rgb(242, 238, 224);

const LOW: u8 = 36; // on-screen keyboard (VPK-5 range the ROM scans: 36..96)
const HIGH: u8 = 96;

#[derive(Clone, Copy)]
enum Kind { Cream, Red, Blue, Grey }

#[derive(Clone, Copy, PartialEq)]
enum Scale { None, Bipolar, Ten }

struct UiState {
    a440: bool,
    pots: [f32; 16],
    note: Option<u8>,
    last_save: Instant,
    status: String,
    /// VPK-5 joystick position while dragged, and the front buttons held
    joy: (f32, f32),
    vpk_rev: bool,
    vpk_fwd: bool,
}

/// Panel units -> screen.
struct Pan { o: Pos2, s: f32 }
impl Pan {
    fn p(&self, x: f32, y: f32) -> Pos2 { Pos2::new(self.o.x + (EAR + x) * self.s, self.o.y + y * self.s) }
    fn r(&self, x: f32, y: f32, w: f32, h: f32) -> Rect { Rect::from_min_size(self.p(x, y), Vec2::new(w, h) * self.s) }
    fn c(&self, x: f32, y: f32, w: f32, h: f32) -> Rect { Rect::from_center_size(self.p(x, y), Vec2::new(w, h) * self.s) }
    fn f(&self, size: f32) -> FontId { FontId::proportional(size * self.s) }
    fn text(&self, p: &egui::Painter, x: f32, y: f32, s: &str, size: f32, col: Color32) {
        p.text(self.p(x, y), Align2::CENTER_CENTER, s, self.f(size), col);
    }
}

/// What the panel shows that can change without input: displays and LEDs, start-up state, the status line and the
/// host-automatable parameters.
fn fingerprint(shared: &Shared, params: &V8Params) -> u64 {
    let mut h = DefaultHasher::new();
    for d in &shared.display { d.load(Ordering::Relaxed).hash(&mut h); }
    shared.ready.load(Ordering::Relaxed).hash(&mut h);
    if let Ok(s) = shared.status.try_lock() { s.hash(&mut h); }
    for p in [
        &params.master, &params.master_tune, &params.joystick_x, &params.joystick_y, &params.pressure, &params.fc_pedal,
        &params.bend_up, &params.bend_down, &params.pressure_sens,
    ] {
        p.value().to_bits().hash(&mut h);
    }
    h.finish()
}

pub fn create(params: Arc<V8Params>, shared: Arc<Shared>) -> Option<Box<dyn Editor>> {
    let state = UiState { a440: false, pots: [64.0; 16], note: None, last_save: Instant::now(), status: String::new(), joy: (0.0, 0.0), vpk_rev: false, vpk_fwd: false };
    // The window runs an egui pass only on input, on a requested repaint or when the fingerprint of what it
    // shows changed (vendor/egui-baseview/NEOV8.md): an idle panel costs a hash per screen refresh.
    let shown = Arc::new(AtomicU64::new(0));
    let (check_shared, check_params, check_shown) = (shared.clone(), params.clone(), shown.clone());
    let check = IdleCheck(Arc::new(move || fingerprint(&check_shared, &check_params) != check_shown.load(Ordering::Relaxed)));
    create_egui_editor(params.editor_state.clone(), state, move |ctx, _| {
        ctx.data_mut(|d| d.insert_temp(idle_check_id(), check.clone()));
    }, move |ctx, setter, st| {
        let ram: [u8; 16] = std::array::from_fn(|i| shared.display[i].load(Ordering::Relaxed));
        let send = |c: Cmd| {
            if let Ok(mut tx) = shared.cmd.lock() { let _ = tx.push(c); }
        };
        if st.status.is_empty() {
            if let Ok(s) = shared.status.lock() { st.status = s.clone(); }
        }
        let fp = fingerprint(&shared, &params);
        if shown.swap(fp, Ordering::Relaxed) != fp {
            // a non-zero delay asks egui for one repaint (zero asks for two); this pass already shows the change
            ctx.request_repaint_after(Duration::from_nanos(1));
        }
        if STANDALONE.load(Ordering::Relaxed)
            && st.last_save.elapsed() > Duration::from_secs(5)
            && shared.bram_dirty.swap(false, Ordering::Relaxed)
        {
            if let Ok(b) = params.bram.lock() { if b.len() == 0x2000 { crate::save_bram_file(&b); } }
            st.last_save = Instant::now();
        }
        egui::CentralPanel::default().frame(egui::Frame::default().fill(Color32::from_rgb(12, 12, 12)).inner_margin(10.0)).show(ctx, |ui| {
            if !shared.ready.load(Ordering::Relaxed) {
                ui.colored_label(TEXT, "Starting (first start: loading the bank and tuning the oscillators)…");
                return;
            }
            let w = ui.available_width();
            let (rect, _) = ui.allocate_exact_size(Vec2::new(w, w * PH / PW), Sense::hover());
            let pan = Pan { o: rect.min, s: w / PW };
            draw_panel(ui, &pan, &ram, st, &send, &params, setter);
            ui.add_space(8.0);
            strip(ui, st, &send, &params, setter);
            ui.add_space(6.0);
            vpk5(ui, st, &send, &params, setter);
        });
    })
}

fn draw_panel(ui: &mut egui::Ui, pan: &Pan, ram: &[u8; 16], st: &mut UiState, send: &dyn Fn(Cmd), params: &V8Params, setter: &ParamSetter) {
    let p = ui.painter().clone();
    // rack ears and panel
    for x0 in [-EAR, 1500.0] {
        p.rect_filled(pan.r(x0, 0.0, EAR, PH), 3.0 * pan.s, EAR_COL);
        for y in [45.0, PH - 45.0] {
            p.circle_filled(pan.p(x0 + EAR / 2.0, y), 7.0 * pan.s, Color32::from_rgb(40, 40, 40));
            p.circle_filled(pan.p(x0 + EAR / 2.0, y), 4.0 * pan.s, Color32::from_rgb(110, 110, 105));
        }
    }
    p.rect_filled(pan.r(0.0, 0.0, 1500.0, PH), 2.0 * pan.s, BLACK);
    let outline = |x: f32, y: f32, w: f32, h: f32| {
        p.rect_stroke(pan.r(x, y, w, h), 6.0 * pan.s, Stroke::new(1.3 * pan.s, LINE), StrokeKind::Inside);
    };
    let led = |x: f32, y: f32, on: bool| { p.circle_filled(pan.p(x, y), 3.6 * pan.s, if on { LED_ON } else { LED_OFF }); };
    let lit = |id: &str| panel::led(ram, id);
    let code = |id: &str| panel::GROUPS.iter().flat_map(|g| g.1.iter()).find(|b| b.id == id).map(|b| b.code);

    // a panel button: sends its key when clicked (shifted when A440 is latched)
    let press = |ui: &mut egui::Ui, st: &mut UiState, id: &str, x: f32, y: f32, kind: Kind| {
        let r = pan.c(x, y, 34.0, 30.0);
        let resp = ui.interact(r, ui.id().with(id), Sense::click());
        let col = match kind { Kind::Cream => CREAM, Kind::Red => RED, Kind::Blue => BLUE, Kind::Grey => GREY };
        let col = if resp.is_pointer_button_down_on() { col.gamma_multiply(0.75) } else { col };
        p.rect_filled(r.translate(Vec2::splat(1.5 * pan.s)), 3.0 * pan.s, Color32::from_black_alpha(160));
        p.rect_filled(r, 3.0 * pan.s, col);
        p.rect_stroke(r, 3.0 * pan.s, Stroke::new(1.0 * pan.s, col.gamma_multiply(0.6)), StrokeKind::Inside);
        let hl = Rect::from_min_max(r.min + Vec2::splat(2.0 * pan.s), Pos2::new(r.max.x - 2.0 * pan.s, r.min.y + 6.0 * pan.s));
        p.rect_filled(hl, 2.0 * pan.s, Color32::from_white_alpha(28));
        if resp.clicked() {
            if let Some(c) = code(id) {
                send(Cmd::Key(if st.a440 { c & !0x40 } else { c }));
                st.a440 = false;
            }
        }
    };

    // ---- left column
    press(ui, st, "mute", 45.0, 55.0, Kind::Blue);
    led(68.0, 42.0, lit("mute"));
    pan.text(&p, 45.0, 85.0, "audio", 9.0, TEXT);
    pan.text(&p, 45.0, 96.0, "mute", 9.0, TEXT);
    knob(ui, pan, "phones", 52.0, 160.0, 17.0, &mut st.pots[15], Scale::Ten, false);
    pan.text(&p, 52.0, 200.0, "headphone", 8.5, TEXT);
    pan.text(&p, 52.0, 210.0, "monitor", 8.5, TEXT);
    p.circle_filled(pan.p(52.0, 250.0), 13.0 * pan.s, Color32::from_rgb(150, 150, 145));
    p.circle_filled(pan.p(52.0, 250.0), 6.0 * pan.s, Color32::from_rgb(10, 10, 10));
    p.rect_filled(pan.c(50.0, 355.0, 54.0, 62.0), 4.0 * pan.s, Color32::from_rgb(70, 70, 68));
    p.circle_filled(pan.p(50.0, 352.0), 17.0 * pan.s, Color32::from_rgb(25, 25, 25));
    for k in 0..5 {
        let a = std::f32::consts::PI * (0.15 + 0.175 * k as f32);
        p.circle_filled(pan.p(50.0 + 9.0 * a.cos(), 352.0 + 9.0 * a.sin()), 2.0 * pan.s, Color32::from_gray(150));
    }
    pan.text(&p, 50.0, 400.0, "keyboard input", 8.5, TEXT);

    // ---- keyboard mode, unison
    outline(98.0, 10.0, 78.0, 262.0);
    pan.text(&p, 137.0, 26.0, "KEYBOARD", 10.0, TEXT);
    pan.text(&p, 137.0, 38.0, "MODE", 10.0, TEXT);
    for (id, y, l1, l2) in [("kb_whole", 75.0, "whole", "8 voice"), ("kb_split", 150.0, "split", ""), ("kb_layer", 222.0, "layer", "")] {
        press(ui, st, id, 128.0, y, Kind::Cream);
        led(160.0, y, lit(id));
        pan.text(&p, 132.0, y + 24.0, l1, 10.5, TEXT);
        if !l2.is_empty() { pan.text(&p, 132.0, y + 35.0, l2, 10.5, TEXT); }
    }
    outline(98.0, 282.0, 78.0, 152.0);
    for (id, y, l) in [("uni_l", 315.0, "L"), ("uni_r", 395.0, "R")] {
        press(ui, st, id, 128.0, y, Kind::Cream);
        led(160.0, y - 14.0, lit(id));
        pan.text(&p, 160.0, y + 2.0, l, 10.0, TEXT);
    }
    pan.text(&p, 137.0, 355.0, "UNISON", 11.0, TEXT);

    // ---- displays
    outline(188.0, 10.0, 370.0, 182.0);
    for (k, x0, title) in [(0usize, 194.0, "LEFT"), (1, 344.0, "RIGHT")] {
        outline(x0, 16.0, 98.0, 170.0);
        pan.text(&p, x0 + 49.0, 26.0, title, 11.0, TEXT);
        let (call, oct, xc, xo) = if k == 0 { ("call_l", "oct_l", x0 + 25.0, x0 + 73.0) } else { ("call_r", "oct_r", x0 + 73.0, x0 + 25.0) };
        press(ui, st, call, xc, 54.0, Kind::Red);
        press(ui, st, oct, xo, 54.0, Kind::Cream);
        pan.text(&p, xc, 78.0, "call", 10.0, TEXT);
        pan.text(&p, xo, 78.0, "octave", 10.0, TEXT);
        digit(&p, pan.r(x0 + 11.0, 92.0, 36.0, 58.0), panel::segments(ram, 2 * k), pan.s);
        digit(&p, pan.r(x0 + 51.0, 92.0, 36.0, 58.0), panel::segments(ram, 2 * k + 1), pan.s);
        pan.text(&p, x0 + 49.0, 170.0, "PROGRAM NUMBER", 7.0, TEXT);
    }
    // octave LEDs: LEFT's on the left of the labels, RIGHT's on the right (between the two display boxes)
    for (i, ((ol, or), l)) in OCT_L.iter().zip(OCT_R.iter()).zip(["up", "normal", "down"]).enumerate() {
        let y = 102.0 + 20.0 * i as f32;
        led(299.0, y, ram[ol.0] & (1 << ol.1) != 0);
        led(337.0, y, ram[or.0] & (1 << or.1) != 0);
        pan.text(&p, 318.0, y, l, 6.5, TEXT);
    }
    outline(450.0, 16.0, 102.0, 170.0);
    pan.text(&p, 501.0, 26.0, "STEP", 11.0, TEXT);
    press(ui, st, "step_load", 475.0, 54.0, Kind::Red);
    press(ui, st, "step_enable", 527.0, 54.0, Kind::Cream);
    pan.text(&p, 475.0, 78.0, "load", 10.0, TEXT);
    pan.text(&p, 527.0, 78.0, "enable", 10.0, TEXT);
    digit(&p, pan.r(463.0, 92.0, 36.0, 58.0), panel::segments(ram, 4), pan.s);
    digit(&p, pan.r(503.0, 92.0, 36.0, 58.0), panel::segments(ram, 5), pan.s);
    pan.text(&p, 501.0, 170.0, "STEP NUMBER", 7.5, TEXT);

    // ---- programmer: remote / tape column and keypad
    outline(188.0, 200.0, 225.0, 234.0);
    press(ui, st, "edit", 218.0, 228.0, Kind::Grey);
    led(248.0, 234.0, lit("edit"));
    pan.text(&p, 248.0, 220.0, "edit", 8.0, TEXT);
    pan.text(&p, 222.0, 258.0, "REMOTE", 10.5, TEXT);
    press(ui, st, "store", 218.0, 290.0, Kind::Grey);
    led(248.0, 296.0, lit("store"));
    pan.text(&p, 248.0, 282.0, "store", 8.0, TEXT);
    press(ui, st, "tape_load", 218.0, 335.0, Kind::Blue);
    led(248.0, 341.0, lit("tape_load"));
    pan.text(&p, 248.0, 327.0, "load", 8.0, TEXT);
    pan.text(&p, 222.0, 360.0, "TAPE", 10.5, TEXT);
    press(ui, st, "tape_dump", 218.0, 392.0, Kind::Blue);
    led(248.0, 398.0, lit("tape_dump"));
    pan.text(&p, 248.0, 384.0, "dump", 8.0, TEXT);
    let keys = [["k1", "k2", "k3"], ["k4", "k5", "k6"], ["k7", "k8", "k9"], ["fwd", "k0", "rev"]];
    for (r, row) in keys.iter().enumerate() {
        for (c, id) in row.iter().enumerate() {
            let (x, y) = (300.0 + 45.0 * c as f32, 228.0 + 50.0 * r as f32);
            press(ui, st, id, x, y, Kind::Cream);
            match *id {
                "fwd" => pan.text(&p, x, y - 21.0, "FWD", 8.0, TEXT),
                "rev" => pan.text(&p, x, y - 21.0, "REV", 8.0, TEXT),
                k => pan.text(&p, x, y, &k[1..], 12.0, Color32::from_rgb(40, 40, 40)),
            }
        }
    }
    pan.text(&p, 330.0, 423.0, "PROGRAMMER", 12.0, TEXT);

    // ---- arpeggiator
    outline(566.0, 10.0, 366.0, 222.0);
    pan.text(&p, 682.0, 24.0, "mode", 11.0, TEXT);
    for (id, x, l) in [("arp_up", 600.0, "UP"), ("arp_down", 682.0, "DOWN"), ("arp_random", 764.0, "RANDOM")] {
        press(ui, st, id, x, 60.0, Kind::Cream);
        led(x + 24.0, 48.0, lit(id));
        pan.text(&p, x + 32.0, 64.0, l, 7.0, TEXT);
    }
    pan.text(&p, 682.0, 112.0, "ARPEGGIATOR", 13.0, TEXT);
    for (id, x, l, kind) in [("arp_left", 600.0, "LEFT", Kind::Blue), ("arp_pause", 682.0, "PAUSE", Kind::Cream), ("arp_right", 764.0, "RIGHT", Kind::Blue)] {
        press(ui, st, id, x, 152.0, kind);
        led(x + 24.0, 140.0, lit(id));
        pan.text(&p, x + 32.0, 172.0, l, 7.0, TEXT);
    }
    pan.text(&p, 682.0, 205.0, "assignment", 11.0, TEXT);
    pan.text(&p, 870.0, 50.0, "speed", 11.0, TEXT);
    if knob(ui, pan, "arp_speed", 870.0, 110.0, 22.0, &mut st.pots[POT_ARP_SPEED], Scale::None, true) {
        send(Cmd::Pot(POT_ARP_SPEED, st.pots[POT_ARP_SPEED] as f64 * 1023.0 / 127.0));
    }
    pan.text(&p, 848.0, 158.0, "SLOW", 7.0, TEXT);
    pan.text(&p, 894.0, 158.0, "FAST", 7.0, TEXT);
    led(870.0, 182.0, lit("tempo"));
    pan.text(&p, 870.0, 198.0, "tempo", 7.0, TEXT);

    // ---- logo, tune, volume, power
    outline(940.0, 10.0, 552.0, 222.0);
    pan.text(&p, 1135.0, 44.0, "VOYETRA EIGHT", 34.0, TEXT);
    pan.text(&p, 1135.0, 78.0, "polyphonic synthesizer module", 15.0, TEXT);
    p.rect_stroke(pan.r(1350.0, 22.0, 80.0, 60.0), 4.0 * pan.s, Stroke::new(2.0 * pan.s, TEXT), StrokeKind::Inside);
    pan.text(&p, 1390.0, 52.0, "OB", 30.0, TEXT);
    press(ui, st, "autotune", 985.0, 140.0, Kind::Cream);
    led(985.0, 117.0, lit("autotune"));
    pan.text(&p, 985.0, 170.0, "AUTO TUNE", 7.5, TEXT);
    // A440: the shift key, latched for the next button
    let ar = pan.c(1055.0, 140.0, 34.0, 30.0);
    let aresp = ui.interact(ar, ui.id().with("a440"), Sense::click());
    p.rect_filled(ar.translate(Vec2::splat(1.5 * pan.s)), 3.0 * pan.s, Color32::from_black_alpha(160));
    p.rect_filled(ar, 3.0 * pan.s, if st.a440 { BLUE.gamma_multiply(0.7) } else { BLUE });
    if st.a440 { p.rect_stroke(ar.expand(3.0 * pan.s), 4.0 * pan.s, Stroke::new(2.0 * pan.s, LED_ON), StrokeKind::Outside); }
    if aresp.clicked() { st.a440 = !st.a440; }
    led(1055.0, 117.0, lit("a440"));
    pan.text(&p, 1055.0, 170.0, "A 440", 7.5, TEXT);
    let mut tune = (params.master_tune.value() + 1.0) / 2.0 * 127.0;
    if knob(ui, pan, "master_tune", 1150.0, 140.0, 24.0, &mut tune, Scale::Bipolar, true) {
        setter.begin_set_parameter(&params.master_tune);
        setter.set_parameter(&params.master_tune, tune / 127.0 * 2.0 - 1.0);
        setter.end_set_parameter(&params.master_tune);
    }
    pan.text(&p, 1150.0, 192.0, "MASTER", 7.5, TEXT);
    pan.text(&p, 1150.0, 202.0, "TUNE", 7.5, TEXT);
    let mut vol = params.master.value() * 127.0;
    if knob(ui, pan, "master_volume", 1270.0, 140.0, 24.0, &mut vol, Scale::Ten, false) {
        setter.begin_set_parameter(&params.master);
        setter.set_parameter(&params.master, vol / 127.0);
        setter.end_set_parameter(&params.master);
    }
    pan.text(&p, 1270.0, 192.0, "MASTER", 7.5, TEXT);
    pan.text(&p, 1270.0, 202.0, "VOLUME", 7.5, TEXT);
    let pr = pan.c(1420.0, 140.0, 46.0, 58.0);
    let presp = ui.interact(pr, ui.id().with("power"), Sense::click());
    p.rect_filled(pr, 3.0 * pan.s, Color32::from_rgb(235, 235, 230));
    let rocker = pr.shrink(5.0 * pan.s);
    p.rect_filled(rocker, 2.0 * pan.s, if presp.is_pointer_button_down_on() { RED.gamma_multiply(0.6) } else { RED });
    p.rect_filled(Rect::from_min_max(rocker.min, Pos2::new(rocker.max.x, rocker.center().y)), 2.0 * pan.s, Color32::from_white_alpha(40));
    if presp.clicked() { send(Cmd::Power); }
    pan.text(&p, 1420.0, 192.0, "POWER", 7.5, TEXT);

    // ---- program parameter trimmers
    p.rect_filled(pan.r(422.0, 240.0, 1070.0, 196.0), 6.0 * pan.s, TRIM_BG);
    for (id, x, l1, l2) in [("reldef", 458.0, "RELEASE", "DEFEAT"), ("pbdef", 538.0, "PITCH BEND", "DEFEAT"), ("hold", 618.0, "HOLD", "")] {
        let (il, ir) = (format!("{id}_l"), format!("{id}_r"));
        press(ui, st, &il, x, 282.0, Kind::Grey);
        press(ui, st, &ir, x, 382.0, Kind::Grey);
        led(x, 257.0, lit(&il));
        led(x, 407.0, lit(&ir));
        pan.text(&p, x, 326.0, l1, 7.5, TRIM_TEXT);
        if !l2.is_empty() { pan.text(&p, x, 336.0, l2, 7.5, TRIM_TEXT); }
    }
    pan.text(&p, 675.0, 282.0, "LEFT", 11.0, TRIM_TEXT);
    pan.text(&p, 675.0, 382.0, "RIGHT", 11.0, TRIM_TEXT);
    const TRIM_LABELS: [&str; 7] = ["A", "R", "LFO RATE", "GLIDE", "Fc", "DETUNE", "VOLUME"];
    for (row, pots, y) in [(0, &POTS_L, 282.0), (1, &POTS_R, 382.0)] {
        for (i, &(_, label, ch)) in pots.iter().enumerate() {
            let x = 735.0 + 115.0 * i as f32;
            let scale = if label == "volume" { Scale::Ten } else { Scale::Bipolar };
            if knob(ui, pan, &format!("pot{ch}"), x, y, 20.0, &mut st.pots[ch], scale, true) {
                send(Cmd::Pot(ch, st.pots[ch] as f64 * 1023.0 / 127.0));
            }
            if row == 0 { pan.text(&p, x, 326.0, TRIM_LABELS[i], 9.0, TRIM_TEXT); }
        }
    }
    pan.text(&p, 1010.0, 428.0, "PROGRAM  PARAMETER  TRIMMERS", 12.5, TRIM_TEXT);
}

/// A black knob with a pointer and a dot scale (−135..+135 degrees for 0..127). Returns true when changed.
#[allow(clippy::too_many_arguments)]
fn knob(ui: &mut egui::Ui, pan: &Pan, id: &str, x: f32, y: f32, r: f32, v: &mut f32, scale: Scale, center_reset: bool) -> bool {
    let p = ui.painter().clone();
    let c = pan.p(x, y);
    let on_trim = y > 240.0 && x > 422.0;
    let mark = if on_trim { TRIM_TEXT } else { TEXT };
    for k in 0..=10 {
        let a = (-225.0f32 + 27.0 * k as f32).to_radians();
        let rr = (r + 7.0) * pan.s;
        p.circle_filled(c + Vec2::new(a.cos(), a.sin()) * rr, 1.3 * pan.s, mark);
        if scale == Scale::Ten && k % 2 == 0 {
            let rt = (r + 15.0) * pan.s;
            p.text(c + Vec2::new(a.cos(), a.sin()) * rt, Align2::CENTER_CENTER, format!("{k}"), pan.f(6.5), mark);
        }
    }
    if scale == Scale::Bipolar {
        p.text(c + Vec2::new(0.0, -(r + 15.0) * pan.s), Align2::CENTER_CENTER, "0", pan.f(7.0), mark);
        p.text(c + Vec2::new(-(r + 12.0) * pan.s, (r + 8.0) * pan.s), Align2::CENTER_CENTER, "−", pan.f(8.0), mark);
        p.text(c + Vec2::new((r + 12.0) * pan.s, (r + 8.0) * pan.s), Align2::CENTER_CENTER, "+", pan.f(8.0), mark);
    }
    let rect = Rect::from_center_size(c, Vec2::splat(2.0 * r * pan.s));
    let resp = ui.interact(rect, ui.id().with(id), Sense::click_and_drag());
    let old = *v;
    if resp.dragged() {
        *v = (*v - resp.drag_delta().y * 0.6 / pan.s.max(0.3)).clamp(0.0, 127.0);
    }
    if center_reset && resp.double_clicked() { *v = 64.0; }
    p.circle_filled(c + Vec2::splat(1.5 * pan.s), r * pan.s, Color32::from_black_alpha(120));
    p.circle_filled(c, r * pan.s, Color32::from_rgb(18, 18, 18));
    p.circle_stroke(c, r * pan.s, Stroke::new(1.5 * pan.s, Color32::from_rgb(70, 70, 70)));
    p.circle_filled(c, r * 0.72 * pan.s, Color32::from_rgb(34, 34, 34));
    let a = (-225.0 + 270.0 * *v / 127.0).to_radians();
    let dir = Vec2::new(a.cos(), a.sin());
    p.line_segment([c + dir * r * 0.25 * pan.s, c + dir * r * 0.95 * pan.s], Stroke::new(2.4 * pan.s, Color32::WHITE));
    *v != old
}

/// One red 7-segment digit; `seg` bit 0..6 = a..g, bit 7 = decimal point.
fn digit(p: &egui::Painter, r: Rect, seg: u8, s: f32) {
    p.rect_filled(r, 2.0 * s, Color32::from_rgb(28, 4, 4));
    let (x0, y0) = (r.left() + 6.0 * s, r.top() + 5.0 * s);
    let (w, h, t) = (r.width() - 14.0 * s, r.height() - 10.0 * s, 4.0 * s);
    let hseg = |y: f32| Rect::from_min_size(Pos2::new(x0 + t, y), Vec2::new(w - 2.0 * t, t));
    let vseg = |x: f32, y: f32| Rect::from_min_size(Pos2::new(x, y), Vec2::new(t, h / 2.0 - t));
    let segs = [
        hseg(y0),
        vseg(x0 + w - t, y0 + t),
        vseg(x0 + w - t, y0 + h / 2.0 + t / 2.0),
        hseg(y0 + h - t),
        vseg(x0, y0 + h / 2.0 + t / 2.0),
        vseg(x0, y0 + t),
        hseg(y0 + h / 2.0 - t / 2.0),
    ];
    for (i, sg) in segs.iter().enumerate() {
        p.rect_filled(*sg, 1.0 * s, if seg & (1 << i) != 0 { LED_ON } else { SEG_OFF });
    }
    p.circle_filled(Pos2::new(x0 + w + 4.0 * s, y0 + h), 2.2 * s, if seg & 0x80 != 0 { LED_ON } else { SEG_OFF });
}

/// Bank loading and the analog performance controls.
fn strip(ui: &mut egui::Ui, st: &mut UiState, send: &dyn Fn(Cmd), params: &V8Params, setter: &ParamSetter) {
    ui.horizontal(|ui| {
        ui.style_mut().visuals.override_text_color = Some(TEXT);
        if ui.button("LOAD BANK…").on_hover_text("SysEx dump (.syx), cassette recording (.wav) or battery image (.bin)").clicked() {
            if let Some(path) = rfd::FileDialog::new().add_filter("Voyetra banks", &["syx", "wav", "bin"]).pick_file() {
                st.status = match bank::load(&path) {
                    Ok(b) => {
                        let mut img = params.bram.lock().map(|b| b.clone()).unwrap_or_default();
                        if img.len() != 0x2000 { img = crate::default_bram(); }
                        b.apply(&mut img);
                        if let Ok(mut pb) = params.bram.lock() { *pb = img.clone(); }
                        let boxed: Box<[u8; 0x2000]> = img.into_boxed_slice().try_into().unwrap();
                        send(Cmd::LoadBram(boxed));
                        format!("{}: {} loaded", path.file_name().map(|f| f.to_string_lossy()).unwrap_or_default(), b.summary())
                    }
                    Err(e) => e,
                };
            }
        }
        ui.label(&st.status);
    });
    ui.horizontal(|ui| {
        ui.style_mut().visuals.override_text_color = Some(TEXT);
        for (label, p) in [("key pressure", &params.pressure), ("Fc pedal", &params.fc_pedal)] {
            ui.label(label);
            ui.add(widgets::ParamSlider::for_param(p, setter).with_width(150.0));
            ui.add_space(12.0);
        }
    });
}

/// The VPK-5 keyboard, after the unit in the Doctor Mix video (QrGLSp1WzzY): warm light-grey body with wooden end
/// cheeks, 61 keys C2..C7 in a black key well, and on the left the chrome joystick between the ← (REV) and → (FWD)
/// buttons, with the three front trimmers below (UM p.61-62: PITCH BEND RANGE UP / DOWN, PRESSURE SENSITIVITY).
/// Geometry in white-key widths `u`.
fn vpk5(ui: &mut egui::Ui, st: &mut UiState, send: &dyn Fn(Cmd), params: &V8Params, setter: &ParamSetter) {
    const W: f32 = 44.0; // cheek, left panel, 36 white keys, right block, cheek
    const H: f32 = 7.4;
    const KX: f32 = 5.0; // first white key
    const KT: f32 = 1.3; // top of the key well
    const KB: f32 = 6.0; // bottom of the white keys
    let avail = ui.available_size();
    let u = (avail.x / W).min(avail.y.max(60.0) / H);
    let (full, _) = ui.allocate_exact_size(Vec2::new(avail.x, u * H), Sense::hover());
    let o = Pos2::new(full.center().x - u * W / 2.0, full.top());
    let pt = |x: f32, y: f32| Pos2::new(o.x + x * u, o.y + y * u);
    let rc = |x: f32, y: f32, w: f32, h: f32| Rect::from_min_size(pt(x, y), Vec2::new(w, h) * u);
    let p = ui.painter().clone();

    // body: top rear surface, front lip, wooden cheeks
    p.rect_filled(rc(0.3, 0.0, W - 0.6, H), 0.15 * u, VPK_BODY);
    p.rect_filled(rc(0.3, 0.0, W - 0.6, KT), 0.15 * u, VPK_TOP);
    p.line_segment([pt(0.5, KT), pt(W - 0.5, KT)], Stroke::new(0.04 * u, VPK_EDGE));
    p.rect_filled(rc(0.3, KB + 0.3, W - 0.6, H - KB - 0.3), 0.1 * u, VPK_LIP);
    p.line_segment([pt(0.5, KB + 0.3), pt(W - 0.5, KB + 0.3)], Stroke::new(0.04 * u, VPK_EDGE));
    for x0 in [0.0, W - 0.6] {
        let r = rc(x0, -0.1, 0.6, H + 0.2);
        p.rect_filled(r, 0.18 * u, WOOD);
        for k in 1..4 {
            let x = r.left() + r.width() * k as f32 / 4.0;
            p.line_segment([Pos2::new(x, r.top() + 0.2 * u), Pos2::new(x + 0.03 * u, r.bottom() - 0.2 * u)], Stroke::new(0.03 * u, WOOD_GRAIN));
        }
        p.rect_stroke(r, 0.18 * u, Stroke::new(0.04 * u, WOOD_GRAIN), StrokeKind::Inside);
    }

    // ← (REV) and → (FWD): held buttons with auto-repeat in the ROM
    for (fwd, x) in [(false, 1.4), (true, 4.0)] {
        let r = Rect::from_center_size(pt(x, 1.95), Vec2::splat(0.55 * u));
        let resp = ui.interact(r, ui.id().with(("vpk_btn", fwd)), Sense::click_and_drag());
        let down = resp.is_pointer_button_down_on();
        let held = if fwd { &mut st.vpk_fwd } else { &mut st.vpk_rev };
        if down != *held {
            *held = down;
            send(Cmd::VpkButton(fwd, down));
        }
        p.rect_filled(r.translate(Vec2::splat(0.04 * u)), 0.06 * u, Color32::from_black_alpha(90));
        p.rect_filled(r, 0.06 * u, if down { CREAM.gamma_multiply(0.75) } else { CREAM });
        p.rect_stroke(r, 0.06 * u, Stroke::new(0.03 * u, Color32::from_rgb(150, 145, 130)), StrokeKind::Inside);
        // the arrow, drawn (the default font has no arrow glyphs)
        let dir = if fwd { 1.0 } else { -1.0 };
        let ink = Color32::from_rgb(60, 55, 45);
        let (cc, a) = (r.center(), 0.15 * u);
        p.line_segment([cc - Vec2::new(dir * a, 0.0), cc + Vec2::new(dir * a * 0.4, 0.0)], Stroke::new(0.05 * u, ink));
        p.add(egui::Shape::convex_polygon(
            vec![cc + Vec2::new(dir * a, 0.0), cc + Vec2::new(dir * a * 0.2, -0.09 * u), cc + Vec2::new(dir * a * 0.2, 0.09 * u)],
            ink,
            Stroke::NONE,
        ));
        let _ = resp.on_hover_text(if fwd { "FWD (→): next program or step" } else { "REV (←): previous program or step" });
    }

    // joystick: X = −X / +X mod controllers, Y = pitch bend (away = up); springs back to the centre
    let c = pt(2.7, 4.15);
    let area = Rect::from_center_size(c + Vec2::new(0.0, -0.6 * u), Vec2::new(3.0, 3.4) * u);
    let resp = ui.interact(area, ui.id().with("vpk_joystick"), Sense::click_and_drag());
    if resp.drag_started() {
        setter.begin_set_parameter(&params.joystick_x);
        setter.begin_set_parameter(&params.joystick_y);
        st.joy = (0.0, 0.0);
    }
    if resp.dragged() {
        let d = resp.drag_delta() / (1.1 * u);
        let (mut x, mut y) = (st.joy.0 + d.x, st.joy.1 - d.y);
        let len = (x * x + y * y).sqrt();
        if len > 1.0 { x /= len; y /= len; }
        st.joy = (x, y);
        setter.set_parameter(&params.joystick_x, x);
        setter.set_parameter(&params.joystick_y, y);
    }
    if resp.drag_stopped() {
        st.joy = (0.0, 0.0);
        setter.set_parameter(&params.joystick_x, 0.0);
        setter.set_parameter(&params.joystick_y, 0.0);
        setter.end_set_parameter(&params.joystick_x);
        setter.end_set_parameter(&params.joystick_y);
    }
    let (jx, jy) = (params.joystick_x.value(), params.joystick_y.value());
    // chrome cone (seen from the front, a little above)
    let cone = |rx: f32, ry: f32, col: Color32| {
        let pts: Vec<Pos2> = (0..40).map(|k| {
            let a = k as f32 / 40.0 * std::f32::consts::TAU;
            c + Vec2::new(a.cos() * rx, a.sin() * ry) * u
        }).collect();
        p.add(egui::Shape::convex_polygon(pts, col, Stroke::NONE));
    };
    cone(1.36, 0.56, Color32::from_rgb(110, 110, 112));
    cone(1.3, 0.51, Color32::from_rgb(236, 236, 238));
    cone(1.02, 0.39, Color32::from_rgb(150, 152, 156));
    cone(0.72, 0.27, Color32::from_rgb(214, 216, 220));
    cone(0.38, 0.14, Color32::from_rgb(90, 92, 96));
    p.add(egui::Shape::convex_polygon(
        vec![c + Vec2::new(-1.1, -0.15) * u, c + Vec2::new(-0.4, -0.4) * u, c + Vec2::new(-0.26, -0.13) * u, c + Vec2::new(-0.9, 0.07) * u],
        Color32::from_white_alpha(120),
        Stroke::NONE,
    ));
    let top = c + Vec2::new(jx * 0.85, -1.6 - jy * 0.45) * u;
    p.line_segment([c, top], Stroke::new(0.2 * u, Color32::from_rgb(40, 40, 42)));
    let knob_r = Rect::from_center_size(top + Vec2::new(0.0, 0.25 * u), Vec2::new(0.42, 0.8) * u);
    p.rect_filled(knob_r, 0.19 * u, Color32::from_rgb(22, 22, 24));
    p.rect_filled(Rect::from_min_size(knob_r.min + Vec2::new(0.08, 0.08) * u, Vec2::new(0.09, 0.6) * u), 0.04 * u, Color32::from_white_alpha(40));
    let _ = resp.on_hover_text("joystick: left / right = −X / +X modulation, up / down = pitch bend");

    // front trimmers: PITCH BEND RANGE UP, DOWN, PRESSURE SENSITIVITY
    for (k, (x, y, prm, tip)) in [
        (1.55, 6.75, &params.bend_up, "pitch bend range up"),
        (3.75, 6.75, &params.bend_down, "pitch bend range down"),
        (2.65, 7.05, &params.pressure_sens, "pressure sensitivity"),
    ].into_iter().enumerate() {
        let c = pt(x, y);
        let r = 0.26 * u;
        let resp = ui.interact(Rect::from_center_size(c, Vec2::splat(2.4 * r)), ui.id().with(("vpk_trim", k)), Sense::click_and_drag());
        if resp.drag_started() { setter.begin_set_parameter(prm); }
        if resp.dragged() {
            let v = (prm.unmodulated_normalized_value() - resp.drag_delta().y / (6.0 * u)).clamp(0.0, 1.0);
            setter.set_parameter_normalized(prm, v);
        }
        if resp.drag_stopped() { setter.end_set_parameter(prm); }
        if resp.double_clicked() {
            setter.begin_set_parameter(prm);
            setter.set_parameter(prm, prm.default_plain_value());
            setter.end_set_parameter(prm);
        }
        p.circle_filled(c + Vec2::splat(0.05 * u), r, Color32::from_black_alpha(100));
        p.circle_filled(c, r, Color32::from_rgb(20, 20, 20));
        for t in 0..16 {
            let a = t as f32 / 16.0 * std::f32::consts::TAU;
            let d = Vec2::new(a.cos(), a.sin());
            p.line_segment([c + d * r * 0.78, c + d * r], Stroke::new(0.025 * u, Color32::from_rgb(70, 70, 70)));
        }
        p.circle_filled(c, r * 0.62, Color32::from_rgb(200, 200, 195));
        let a = (-225.0 + 270.0 * prm.unmodulated_normalized_value()).to_radians();
        p.line_segment([c, c + Vec2::new(a.cos(), a.sin()) * r * 0.6], Stroke::new(0.05 * u, Color32::from_rgb(30, 30, 30)));
        let _ = resp.on_hover_text(format!("{tip}: {}", prm));
    }

    // keys: 61, C2..C7; velocity from where the key is pressed (further down = harder)
    let whites: Vec<u8> = (LOW..=HIGH).filter(|n| !is_black(*n)).collect();
    p.rect_filled(rc(KX - 0.12, KT - 0.05, whites.len() as f32 + 0.24, KB - KT + 0.35), 0.05 * u, Color32::from_rgb(14, 14, 14));
    let key_rect = |n: u8| -> Rect {
        let wi = whites.iter().position(|&x| x >= n).unwrap_or(0) as f32;
        if is_black(n) { rc(KX + wi - 0.29, KT, 0.58, 2.9) } else { rc(KX + wi + 0.02, KT, 0.96, KB - KT) }
    };
    let kb = rc(KX, KT, whites.len() as f32, KB - KT);
    let resp = ui.interact(kb, ui.id().with("vpk_keys"), Sense::click_and_drag());
    for &n in &whites {
        let r = key_rect(n);
        let down = st.note == Some(n);
        p.rect_filled(r, 0.06 * u, if down { Color32::from_rgb(214, 208, 192) } else { IVORY });
        let front = Rect::from_min_max(Pos2::new(r.left(), r.bottom() - 0.22 * u), r.max);
        p.rect_filled(front, 0.06 * u, if down { Color32::from_rgb(190, 184, 168) } else { Color32::from_rgb(222, 216, 200) });
    }
    for n in (LOW..=HIGH).filter(|n| is_black(*n)) {
        let r = key_rect(n);
        let down = st.note == Some(n);
        p.rect_filled(r.translate(Vec2::new(0.04, 0.06) * u), 0.05 * u, Color32::from_black_alpha(110));
        p.rect_filled(r, 0.05 * u, if down { Color32::from_rgb(52, 52, 54) } else { Color32::from_rgb(18, 18, 19) });
        let cap = Rect::from_min_max(r.min + Vec2::new(0.07, 0.05) * u, Pos2::new(r.max.x - 0.07 * u, r.bottom() - 0.35 * u));
        p.rect_filled(cap, 0.04 * u, if down { Color32::from_rgb(64, 64, 66) } else { Color32::from_rgb(40, 40, 42) });
    }
    let hit = resp.interact_pointer_pos().and_then(|pos| {
        (LOW..=HIGH).filter(|n| is_black(*n)).find(|&n| key_rect(n).contains(pos))
            .or_else(|| whites.iter().copied().find(|&n| key_rect(n).contains(pos)))
            .map(|n| {
                let r = key_rect(n);
                let depth = ((pos.y - r.top()) / r.height()).clamp(0.0, 1.0);
                (n, (30.0 + 97.0 * depth).round() as u8)
            })
    });
    let want = if resp.is_pointer_button_down_on() { hit } else { None };
    if want.map(|w| w.0) != st.note {
        if let Some(n) = st.note { send(Cmd::Note(n, false, 64)); }
        if let Some((n, vel)) = want { send(Cmd::Note(n, true, vel)); }
        st.note = want.map(|w| w.0);
    }
}

fn is_black(n: u8) -> bool { matches!(n % 12, 1 | 3 | 6 | 8 | 10) }
