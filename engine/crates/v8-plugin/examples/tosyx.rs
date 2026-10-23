//! Convert a bank (cassette .wav, .syx or 8 KB battery image .bin) to Rev4 SysEx:
//! `cargo run --release -p v8-plugin --example tosyx <in> <out.syx>`
fn main() {
    let a: Vec<String> = std::env::args().collect();
    let (Some(src), Some(dst)) = (a.get(1), a.get(2)) else {
        eprintln!("usage: tosyx <bank.wav|.syx|.bin> <out.syx>");
        std::process::exit(2);
    };
    let bank = v8_plugin::bank::load(std::path::Path::new(src)).unwrap_or_else(|e| {
        eprintln!("{e}");
        std::process::exit(1)
    });
    std::fs::write(dst, bank.to_syx()).expect("write");
    println!("{dst}: {}", bank.summary());
}
