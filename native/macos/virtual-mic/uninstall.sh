#!/bin/bash
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo 'Run with administrator authorization.' >&2; exit 1; }
base=/Library/Audio/Plug-Ins/HAL/VoxBridge.driver
[[ ! -L "$base" && -d "$base" ]] || { echo 'VoxBridge driver not found, or unsafe target.' >&2; exit 1; }
identity=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$base/Contents/Info.plist")
[[ "$identity" == com.voxbridge.audio.driver ]] || { echo 'Refusing a different driver.' >&2; exit 1; }
backup="/Library/Application Support/VoxBridge/DriverBackups/uninstalled-$(date +%Y%m%d-%H%M%S).driver"
mkdir -p "$(dirname "$backup")"
mv "$base" "$backup"
/usr/bin/killall -TERM coreaudiod || true
printf 'Driver disabled and preserved at %s\n' "$backup"
