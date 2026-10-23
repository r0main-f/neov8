//! Windows: embed the NeoV8 icon (tools/app/NeoV8.ico) in the executable and the plugin DLL.
fn main() {
    println!("cargo:rerun-if-changed=build.rs");
    #[cfg(windows)]
    {
        let icon = concat!(env!("CARGO_MANIFEST_DIR"), "/../../../tools/app/NeoV8.ico");
        println!("cargo:rerun-if-changed={icon}");
        if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
            let mut res = winresource::WindowsResource::new();
            res.set_icon(icon);
            res.set("ProductName", "NeoV8");
            res.set("FileDescription", "NeoV8 - a Voyetra Eight");
            res.compile().expect("Windows resources");
        }
    }
}
