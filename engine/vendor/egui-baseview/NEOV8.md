# egui-baseview (NeoV8 copy)

A copy of egui-baseview at commit ec70c3fe6b2f070dcacbc22924431edbe24bd1c0 (MIT licence, `LICENSE`), the
version nih-plug's `nih_plug_egui` uses. One change, in `src/window.rs` (`on_frame`, `IdleCheck`): upstream runs
a full egui pass on every screen refresh (about 60 per second) even when it does not repaint. When the
application stores an `IdleCheck` in the egui context (temp data under `idle_check_id()`), a frame with no
input, no due or requested repaint and no change reported by the check skips the pass. The NeoV8 panel
(`crates/v8-plugin/src/editor.rs`) checks a hash of its displays, LEDs and parameters.
