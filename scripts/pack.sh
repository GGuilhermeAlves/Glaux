#!/usr/bin/env bash
# Builds store-ready zips from extension/:
#   dist/glaux-<version>-chrome.zip   → Chrome Web Store / Edge Add-ons / Opera
#   dist/glaux-<version>-firefox.zip  → addons.mozilla.org (AMO)
# extension/manifest.json is universal (works unpacked in both browsers);
# each zip gets a clean manifest without the other browser's keys.
set -euo pipefail
cd "$(dirname "$0")/.."
VERSION=$(python3 -c "import json;print(json.load(open('extension/manifest.json'))['version'])")
mkdir -p dist
for TARGET in chrome firefox; do
  TMP=$(mktemp -d)
  cp -R extension/. "$TMP/"
  python3 - "$TMP/manifest.json" "$TARGET" <<'PY'
import json, sys
path, target = sys.argv[1], sys.argv[2]
m = json.load(open(path))
if target == "chrome":
    m.pop("browser_specific_settings", None)
    m["background"] = {"service_worker": m["background"]["service_worker"]}
else:
    m.pop("minimum_chrome_version", None)
    m["background"] = {"scripts": m["background"]["scripts"]}
json.dump(m, open(path, "w"), ensure_ascii=False, indent=2)
PY
  OUT="dist/glaux-${VERSION}-${TARGET}.zip"
  rm -f "$OUT"
  (cd "$TMP" && zip -qr "$OLDPWD/$OUT" . -x '.*' '*/.*')
  rm -r "$TMP"
  echo "→ $OUT"
done
