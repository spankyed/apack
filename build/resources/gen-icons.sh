#!/bin/bash
# Usage: ./build/resources/gen-icons.sh [source.png|source.svg]
# Generates icon.png, icon.icns, icon.ico in build/resources/
# Requires: sips, iconutil (macOS). rsvg-convert needed only for SVG input.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEFAULT_SOURCE="$SCRIPT_DIR/../../resources/modern logo/app-icon.png"
SOURCE="${1:-$DEFAULT_SOURCE}"
OUT_DIR="$SCRIPT_DIR"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "Generating icons from: $SOURCE"

# Get 1024x1024 master PNG from source
if [[ "$SOURCE" == *.svg ]]; then
  rsvg-convert -w 1024 -h 1024 "$SOURCE" > "$WORK/icon-1024.png"
else
  sips -z 1024 1024 "$SOURCE" --out "$WORK/icon-1024.png" >/dev/null
fi

# macOS .icns
ICONSET="$WORK/icon.iconset"
mkdir -p "$ICONSET"
for size in 16 32 128 256 512; do
  sips -z $size $size "$WORK/icon-1024.png" --out "$ICONSET/icon_${size}x${size}.png" >/dev/null
  double=$((size * 2))
  sips -z $double $double "$WORK/icon-1024.png" --out "$ICONSET/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$OUT_DIR/icon.icns"
echo "  icon.icns"

# General PNG (512x512)
sips -z 512 512 "$WORK/icon-1024.png" --out "$OUT_DIR/icon.png" >/dev/null
echo "  icon.png"

# Windows .ico (256x256): sips writes the format it is told, not the one the file name says, so `-s format ico`; without
# it the file is a PNG, which electron-builder refuses as no ICO
sips -z 256 256 "$WORK/icon-1024.png" -s format ico --out "$OUT_DIR/icon.ico" >/dev/null
echo "  icon.ico"

echo "Done — icons in $OUT_DIR/"
