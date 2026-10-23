#!/bin/sh
# Build NeoV8.app (the standalone instrument, with its icon) and install it in ~/Applications (macOS).
# npm run app:install
set -e
cd "$(dirname "$0")/../.."
. tools/app/rust-env.sh
npm run fw >/dev/null
cargo build --release --manifest-path engine/Cargo.toml -p v8-plugin --bin neov8
APP=$(sh tools/app/bundle-macos.sh engine/target/release/neov8 engine/target/bundled)
mkdir -p "$HOME/Applications"
rm -rf "$HOME/Applications/NeoV8.app"
cp -R "$APP" "$HOME/Applications/NeoV8.app"
echo "NeoV8.app installed in ~/Applications (open it from Finder, Spotlight or Launchpad)"
