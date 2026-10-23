#!/bin/sh
# Wrap a built `neov8` binary into NeoV8.app (Info.plist, icon, ad-hoc signature).
# usage: tools/app/bundle-macos.sh <neov8 binary> <output dir>   ->  <output dir>/NeoV8.app
set -e
BIN=$1
OUT=$2
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
VERSION=$(node -p "require('$ROOT/package.json').version")
APP="$OUT/NeoV8.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$BIN" "$APP/Contents/MacOS/neov8"
cp "$ROOT/tools/app/NeoV8.icns" "$APP/Contents/Resources/NeoV8.icns"
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
echo "$APP"
