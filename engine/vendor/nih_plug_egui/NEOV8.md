# nih_plug_egui (NeoV8 copy)

A copy of `nih_plug_egui` from nih-plug at commit de421011f41a6d10fc8c7a6084e4f4dee0143683 (ISC licence,
`LICENSE`). Changes:

* `src/editor.rs`: upstream requests a repaint on every frame (about 60 per second, whether or not anything
  changed). This copy repaints continuously only for the first second after the window opens (some hosts open it
  unmapped); after that egui repaints on input and the editor's `update` closure requests a repaint when its
  content has changed.
* It uses the NeoV8 copy of egui-baseview (`../egui-baseview`, which can skip idle frames entirely) and
  re-exports its `IdleCheck` / `idle_check_id`.

Together they took the standalone app with its window open and silent from about 16 % to about 8.5 % of one core
(Apple Silicon; about 2 % is the instrument itself, most of the rest is one repaint per blink of the tempo LED).
