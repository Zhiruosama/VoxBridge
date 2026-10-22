#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
app=".build/VoxBridgeAudioProbe.app"
mkdir -p "$app/Contents/MacOS"
cat > "$app/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>com.voxbridge.audio-probe</string>
<key>CFBundleName</key><string>VoxBridgeAudioProbe</string>
<key>CFBundleExecutable</key><string>AudioProbe</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>LSMinimumSystemVersion</key><string>14.2</string>
<key>NSAudioCaptureUsageDescription</key><string>Capture only the selected application's audio to verify VoxBridge routing. No audio is saved or uploaded.</string>
</dict></plist>
PLIST
arch="$(uname -m)"
xcrun swiftc -parse-as-library -swift-version 5 -target "$arch-apple-macosx14.2" \
  AudioProbe.swift -framework CoreAudio -framework AudioToolbox \
  -o "$app/Contents/MacOS/AudioProbe"
codesign --force --sign - "$app"
printf 'Built %s\n' "$app/Contents/MacOS/AudioProbe"
