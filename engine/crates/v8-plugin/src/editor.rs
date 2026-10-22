//! Front panel in egui: the three 2-digit displays and LEDs mirrored from the 8279 display RAM, the buttons
//! (A440 latches as the shift key for the next button), the 15 program-parameter trimmers, the analog controls,
//! and an on-screen keyboard (VPK-5). Battery RAM is written to its file every few seconds in the standalone app.

use crate::panel::{self, FIRST_ROW, GROUPS, OCT_L, OCT_R, POTS_L, POTS_R, POT_ARP_SPEED};
use crate::{Cmd, Shared, V8Params, STANDALONE};
use nih_plug::prelude::*;
use nih_plug_egui::egui::{self, Color32, Pos2, Rect, Sense, Stroke, Vec2};
use nih_plug_egui::{create_egui_editor, widgets};
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::{Duration, Instant};

const RED: Color32 = Color32::from_rgb(255, 40, 40);
const RED_DIM: Color32 = Color32::from_rgb(60, 12, 12);
const PANEL: Color32 = Color32::from_rgb(24, 22, 22);
const LOW: u8 = 36; // on-screen keyboard: C2 .. C6
const HIGH: u8 = 84;

struct UiState {
    a440: bool,
    pots: [f32; 16],
    note: Option<u8>,
    last_save: Instant,
}

pub fn create(params: Arc<V8Params>, shared: Arc<Shared>) -> Option<Box<dyn Editor>> {
    let state = UiState { a440: false, pots: [64.0; 16], note: None, last_save: Instant::now() };
    create_egui_editor(params.editor_state.clone(), state, |_, _| {}, move |ctx, setter, st| {
        ctx.request_repaint_after(Duration::from_millis(30));
        let ram: [u8; 16] = std::array::from_fn(|i| shared.display[i].load(Ordering::Relaxed));
        let send = |c: Cmd| {
            if let Ok(mut tx) = shared.cmd.lock() { let _ = tx.push(c); }
        };
        if STANDALONE.load(Ordering::Relaxed)
            && st.last_save.elapsed() > Duration::from_secs(5)
            && shared.bram_dirty.swap(false, Ordering::Relaxed)
        {
            if let Ok(b) = params.bram.lock() { if b.len() == 0x2000 { crate::save_bram_file(&b); } }
            st.last_save = Instant::now();
        }
        egui::CentralPanel::default().frame(egui::Frame::default().fill(PANEL).inner_margin(12.0)).show(ctx, |ui| {
            ui.style_mut().visuals.override_text_color = Some(Color32::from_gray(220));
            if !shared.ready.load(Ordering::Relaxed) {
                ui.label("Starting (first start: tuning the oscillators)…");
                return;
            }
            // displays
            ui.horizontal(|ui| {
                for (k, name) in ["LEFT", "RIGHT", "STEP"].iter().enumerate() {
                    ui.vertical(|ui| {
                        ui.label(*name);
                        ui.horizontal(|ui| {
                            digit(ui, panel::segments(&ram, 2 * k));
                            digit(ui, panel::segments(&ram, 2 * k + 1));
                        });
                    });
                    if k < 2 {
                        let oct = if k == 0 { OCT_L } else { OCT_R };
                        ui.vertical(|ui| {
                            ui.label("oct");
                            for (lbl, (i, b)) in ["up", "norm", "down"].iter().zip(oct) {
                                ui.horizontal(|ui| { led(ui, ram[i] & (1 << b) != 0); ui.small(*lbl); });
                            }
                        });
                    }
                    ui.add_space(18.0);
                }
                ui.add_space(24.0);
                ui.vertical(|ui| {
                    let a = egui::Button::new("A440 (shift)").fill(if st.a440 { RED } else { Color32::from_gray(60) });
                    if ui.add(a).clicked() { st.a440 = !st.a440; }
                    ui.small("latches for the next button");
                });
            });
            ui.add_space(8.0);
            // buttons, in two rows
            for row in [&GROUPS[..FIRST_ROW], &GROUPS[FIRST_ROW..]] {
                ui.horizontal(|ui| {
                    for (title, buttons) in row.iter() {
                        ui.group(|ui| {
                            ui.vertical(|ui| {
                                if !title.is_empty() { ui.small(*title); }
                                let cols = if *title == "PROGRAMMER" || buttons.len() > 4 { 3 } else { buttons.len() };
                                egui::Grid::new(title.to_string() + buttons[0].id).spacing([4.0, 4.0]).show(ui, |ui| {
                                    for (i, bt) in buttons.iter().enumerate() {
                                        let on = panel::led(&ram, bt.id);
                                        let w = egui::Button::new(bt.label)
                                            .min_size(Vec2::new(44.0, 22.0))
                                            .fill(if on { Color32::from_rgb(150, 30, 30) } else { Color32::from_gray(70) });
                                        if ui.add(w).clicked() {
                                            let code = if st.a440 { bt.code & !0x40 } else { bt.code };
                                            send(Cmd::Key(code));
                                            st.a440 = false;
                                        }
                                        if (i + 1) % cols == 0 { ui.end_row(); }
                                    }
                                });
                            });
                        });
                    }
                });
            }
            ui.add_space(8.0);
            // program parameter trimmers
            ui.group(|ui| {
                ui.small("PROGRAM PARAMETER TRIMMERS");
                for (row, pots) in [("LEFT", &POTS_L), ("RIGHT", &POTS_R)] {
                    ui.horizontal(|ui| {
                        ui.label(format!("{row:5}"));
                        for &(_, label, ch) in pots.iter() {
                            ui.vertical(|ui| {
                                ui.small(label);
                                let s = egui::Slider::new(&mut st.pots[ch], 0.0..=127.0).show_value(false);
                                if ui.add_sized([90.0, 18.0], s).changed() {
                                    send(Cmd::Pot(ch, st.pots[ch] as f64 * 1023.0 / 127.0));
                                }
                            });
                        }
                    });
                }
                ui.horizontal(|ui| {
                    ui.label("arpeggiator speed");
                    let s = egui::Slider::new(&mut st.pots[POT_ARP_SPEED], 0.0..=127.0).show_value(false);
                    if ui.add_sized([140.0, 18.0], s).changed() {
                        send(Cmd::Pot(POT_ARP_SPEED, st.pots[POT_ARP_SPEED] as f64 * 1023.0 / 127.0));
                    }
                });
            });
            ui.add_space(8.0);
            // analog controls (automatable parameters)
            ui.horizontal(|ui| {
                for (label, p) in [
                    ("master volume", &params.master),
                    ("joystick X", &params.joystick_x),
                    ("pressure", &params.pressure),
                    ("Fc pedal", &params.fc_pedal),
                ] {
                    ui.vertical(|ui| {
                        ui.small(label);
                        ui.add(widgets::ParamSlider::for_param(p, setter).with_width(120.0));
                    });
                }
            });
            ui.add_space(8.0);
            keyboard(ui, st, &send);
        });
    })
}

fn led(ui: &mut egui::Ui, on: bool) {
    let (r, _) = ui.allocate_exact_size(Vec2::splat(9.0), Sense::hover());
    ui.painter().circle_filled(r.center(), 4.0, if on { RED } else { RED_DIM });
}

/// One 7-segment digit; `seg` bit 0..6 = a..g, bit 7 = decimal point.
fn digit(ui: &mut egui::Ui, seg: u8) {
    let (r, _) = ui.allocate_exact_size(Vec2::new(26.0, 42.0), Sense::hover());
    let p = ui.painter();
    p.rect_filled(r, 2.0, Color32::from_rgb(20, 4, 4));
    let (x0, y0, w, h, t) = (r.left() + 4.0, r.top() + 3.0, 16.0, 34.0, 3.0);
    let hseg = |y: f32| Rect::from_min_size(Pos2::new(x0 + t, y), Vec2::new(w - 2.0 * t, t));
    let vseg = |x: f32, y: f32| Rect::from_min_size(Pos2::new(x, y), Vec2::new(t, h / 2.0 - t));
    let segs = [
        hseg(y0),                              // a
        vseg(x0 + w - t, y0 + t),              // b
        vseg(x0 + w - t, y0 + h / 2.0 + t / 2.0), // c
        hseg(y0 + h - t),                      // d
        vseg(x0, y0 + h / 2.0 + t / 2.0),      // e
        vseg(x0, y0 + t),                      // f
        hseg(y0 + h / 2.0 - t / 2.0),          // g
    ];
    for (i, s) in segs.iter().enumerate() {
        p.rect_filled(*s, 1.0, if seg & (1 << i) != 0 { RED } else { RED_DIM });
    }
    p.circle_filled(Pos2::new(x0 + w + 3.0, y0 + h), 1.8, if seg & 0x80 != 0 { RED } else { RED_DIM });
}

/// On-screen keyboard C2..C6: press and drag to play (velocity 100).
fn keyboard(ui: &mut egui::Ui, st: &mut UiState, send: &dyn Fn(Cmd)) {
    let whites: Vec<u8> = (LOW..=HIGH).filter(|n| !is_black(*n)).collect();
    let ww = 22.0;
    let (r, resp) = ui.allocate_exact_size(Vec2::new(ww * whites.len() as f32, 90.0), Sense::click_and_drag());
    let p = ui.painter();
    let key_rect = |n: u8| -> Rect {
        let wi = whites.iter().position(|&w| w >= n).unwrap_or(0) as f32;
        if is_black(n) {
            Rect::from_min_size(Pos2::new(r.left() + wi * ww - 7.0, r.top()), Vec2::new(14.0, 55.0))
        } else {
            Rect::from_min_size(Pos2::new(r.left() + wi * ww, r.top()), Vec2::new(ww - 1.0, 90.0))
        }
    };
    for &n in &whites {
        let c = if st.note == Some(n) { Color32::from_rgb(220, 170, 170) } else { Color32::from_gray(235) };
        p.rect_filled(key_rect(n), 2.0, c);
    }
    for n in (LOW..=HIGH).filter(|n| is_black(*n)) {
        let c = if st.note == Some(n) { Color32::from_rgb(140, 40, 40) } else { Color32::from_gray(20) };
        p.rect_filled(key_rect(n), 2.0, c);
        p.rect_stroke(key_rect(n), 2.0, Stroke::new(1.0_f32, Color32::BLACK), egui::StrokeKind::Inside);
    }
    let hit = resp.interact_pointer_pos().and_then(|pos| {
        (LOW..=HIGH).filter(|n| is_black(*n)).find(|&n| key_rect(n).contains(pos))
            .or_else(|| whites.iter().copied().find(|&n| key_rect(n).contains(pos)))
    });
    let down = resp.is_pointer_button_down_on();
    let want = if down { hit } else { None };
    if want != st.note {
        if let Some(n) = st.note { send(Cmd::Note(n, false, 0)); }
        if let Some(n) = want { send(Cmd::Note(n, true, 100)); }
        st.note = want;
    }
}

fn is_black(n: u8) -> bool { matches!(n % 12, 1 | 3 | 6 | 8 | 10) }
