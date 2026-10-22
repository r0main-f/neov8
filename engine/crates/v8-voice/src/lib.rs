//! Model of the Voyetra Eight analog voice path (docs/audio-model.md): CEM3340 oscillators, the VCO card's
//! waveform mix, SSM2024 level VCAs, SSM2044 filter, the mixer card's voice VCAs and panning. Driven only by
//! the analog state the CPU writes (S&H slots and control latches), so it works with any ROM.

pub mod calib;
pub mod engine;
pub mod filter;
pub mod modmatrix;
pub mod osc;

pub use engine::{AnalogState, Engine, BLOCK};
