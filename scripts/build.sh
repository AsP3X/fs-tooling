#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST="$ROOT/dist"
EXT="$DIST/sth-extension"
rm -rf "$DIST"
mkdir -p "$EXT" "$ROOT/script" "$ROOT/extension"

python3 - "$ROOT" <<'PY'
from pathlib import Path
import sys, base64, gzip
root = Path(sys.argv[1])
plain = root / "script/freshservice-mod-dialog.js"
packed = root / "script/freshservice-mod-dialog.js.gz.b64"
if plain.exists() and plain.stat().st_size > 1000:
    src = plain.read_bytes()
elif packed.exists():
    src = gzip.decompress(base64.b64decode(packed.read_text().strip()))
    plain.write_bytes(src)
else:
    raise SystemExit("missing script/freshservice-mod-dialog.js")
text = src.decode()
if "// ==/UserScript==" in text:
    body = text.split("// ==/UserScript==", 1)[-1].lstrip("\n")
else:
    body = text
(root / "extension/content.js").write_text(body)
PY

cp "$ROOT/extension/manifest.json" "$EXT/"
cp "$ROOT/extension/content.js" "$EXT/"

python3 - "$EXT" <<'PY'
from pathlib import Path
import struct, zlib, sys
root = Path(sys.argv[1])

def png(size, rgb=(230, 81, 0)):
    r, g, b = rgb
    raw = b"".join(b"\x00" + bytes([r, g, b]) * size for _ in range(size))
    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")

for s in (16, 32, 48, 128):
    (root / f"icon{s}.png").write_bytes(png(s))
PY

cp "$ROOT/script/freshservice-mod-dialog.js" "$DIST/"
(cd "$DIST" && zip -qr sth-extension.zip sth-extension)
tar -czf "$DIST/sth-extension.tar.gz" -C "$DIST" sth-extension
echo "Built $DIST"
ls -la "$DIST"
