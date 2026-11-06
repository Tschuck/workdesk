#!/usr/bin/env bash
# Renders assets/logo.svg into build/icon.icns (macOS app icon) and build/icon.png.
# Needs librsvg (`brew install librsvg`) plus macOS' own iconutil.
set -euo pipefail
cd "$(dirname "$0")/.."

command -v rsvg-convert >/dev/null || { echo "rsvg-convert not found: brew install librsvg" >&2; exit 1; }

svg=assets/logo.svg
iconset=$(mktemp -d)/WorkDesk.iconset
mkdir -p "$iconset" build

# every size is rendered from the vector, not scaled down from one bitmap
for size in 16 32 64 128 256 512 1024; do
  rsvg-convert -w "$size" -h "$size" "$svg" -o "$iconset/png-$size.png"
done
cp "$iconset/png-16.png"   "$iconset/icon_16x16.png"
cp "$iconset/png-32.png"   "$iconset/icon_16x16@2x.png"
cp "$iconset/png-32.png"   "$iconset/icon_32x32.png"
cp "$iconset/png-64.png"   "$iconset/icon_32x32@2x.png"
cp "$iconset/png-128.png"  "$iconset/icon_128x128.png"
cp "$iconset/png-256.png"  "$iconset/icon_128x128@2x.png"
cp "$iconset/png-256.png"  "$iconset/icon_256x256.png"
cp "$iconset/png-512.png"  "$iconset/icon_256x256@2x.png"
cp "$iconset/png-512.png"  "$iconset/icon_512x512.png"
cp "$iconset/png-1024.png" "$iconset/icon_512x512@2x.png"
rm "$iconset"/png-*.png

iconutil -c icns "$iconset" -o build/icon.icns
rsvg-convert -w 1024 -h 1024 "$svg" -o build/icon.png
echo "wrote build/icon.icns and build/icon.png"
