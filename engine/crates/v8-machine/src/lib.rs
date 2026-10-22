//! Voyetra Eight Rev4 CPU-card emulator: a behaviour-identical port of the TypeScript machine in
//! `sim/src/machine/` (checked by differential tests, `sim/test/engine-diff.test.ts`), plus a cycle-stamped log
//! of analog writes for the sound engine.

pub mod chips;
pub mod cpu;
pub mod machine;
pub mod vco;

pub use machine::{AnalogEvent, Ctl, Machine, CPU_HZ, POT_MUX_CHANNEL};
pub use vco::{OscParams, VcoBank, VcoOptions};
