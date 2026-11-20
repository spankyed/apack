#!/bin/bash
# Usage: ./build/resources/gen-icons.sh [source.png|source.svg]
# Generates icon.png, icon.icns, icon.ico in build/resources/
# Requires: sips, iconutil (macOS) and python3. rsvg-convert needed only for SVG input.

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

# Windows .ico holding every size Windows draws, each resized from the master: given a single 256x256 image Windows
# scales it down itself for the title bar, taskbar and file lists, and blurs it. sips writes one image per ICO, so
# python3 packs the container: an ICONDIR, one ICONDIRENTRY per image, then the images. Every entry is a PNG, which
# Windows Vista and later read at any size, and an entry's width and height bytes are 0 when the image is 256 wide.
ICO_SIZES=(16 24 32 48 64 128 256)
ICO_PNGS=()
for size in "${ICO_SIZES[@]}"; do
  sips -z "$size" "$size" "$WORK/icon-1024.png" --out "$WORK/ico-$size.png" >/dev/null
  ICO_PNGS+=("$WORK/ico-$size.png")
done
python3 - "$OUT_DIR/icon.ico" "${ICO_PNGS[@]}" <<'PY'
import struct
import sys

out, paths = sys.argv[1], sys.argv[2:]
images = []
for path in paths:
    with open(path, "rb") as f:
        data = f.read()
    # A PNG's first chunk is IHDR, whose width and height are the big-endian words at bytes 16 and 20.
    if data[:8] != b"\x89PNG\r\n\x1a\n" or data[12:16] != b"IHDR":
        sys.exit(f"{path} is not a PNG")
    width, height = struct.unpack(">II", data[16:24])
    if width != height or not 0 < width <= 256:
        sys.exit(f"{path} is {width}x{height}; an ICO image is square and at most 256 wide")
    images.append((width, data))

offset = 6 + 16 * len(images)
header = struct.pack("<HHH", 0, 1, len(images))
for width, data in images:
    # Planes 1 and 32 bits per pixel, which is what a PNG entry states whatever its own colour type.
    header += struct.pack("<BBBBHHII", width % 256, width % 256, 0, 0, 1, 32, len(data), offset)
    offset += len(data)
with open(out, "wb") as f:
    f.write(header + b"".join(data for _, data in images))
PY
echo "  icon.ico"

echo "Done — icons in $OUT_DIR/"
