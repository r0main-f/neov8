#!/bin/sh
# Build NeoV8.app (the standalone instrument, with its icon) and install it in ~/Applications (macOS).
# npm run app:install
set -e
cd "$(dirname "$0")/../.."
. tools/app/rust-env.sh
npm run fw >/dev/null
cargo build --release --manifest-path engine/Cargo.toml -p v8-plugin --bin neov8
VERSION=$(node -p "require('./package.json').version")
APP=engine/target/bundled/NeoV8.app
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp engine/target/release/neov8 "$APP/Contents/MacOS/neov8"
cp tools/app/NeoV8.icns "$APP/Contents/Resources/NeoV8.icns"
cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleName</key><string>NeoV8</string>
    <key>CFBundleDisplayName</key><string>NeoV8</string>
    <key>CFBundleIdentifier</key><string>io.github.r0main-f.neov8.app</string>
    <key>CFBundleExecutable</key><string>neov8</string>
    <key>CFBundleIconFile</key><string>NeoV8</string>
    <key>CFBundlePackageType</key><string>APPL</string>
    <key>CFBundleShortVersionString</key><string>$VERSION</string>
    <key>CFBundleVersion</key><string>$VERSION</string>
    <key>LSMinimumSystemVersion</key><string>11.0</string>
    <key>LSApplicationCategoryType</key><string>public.app-category.music</string>
    <key>NSHighResolutionCapable</key><true/>
    <key>NSMicrophoneUsageDescription</key><string>NeoV8 opens the audio device; it does not record.</string>
</dict>
</plist>
PLIST
codesign --force --deep -s - "$APP" 2>/dev/null
mkdir -p "$HOME/Applications"
rm -rf "$HOME/Applications/NeoV8.app"
cp -R "$APP" "$HOME/Applications/NeoV8.app"
echo "NeoV8.app installed in ~/Applications (open it from Finder, Spotlight or Launchpad)"
