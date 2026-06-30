#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DIST_DIR="$ROOT_DIR/dist"
OUTPUT_ZIP="$DIST_DIR/proxy-switcher.zip"
STAGING_DIR="$DIST_DIR/staging"

rm -rf "$STAGING_DIR" "$OUTPUT_ZIP"
mkdir -p "$STAGING_DIR"

copy_path() {
  local path="$1"
  if [[ -e "$ROOT_DIR/$path" ]]; then
    mkdir -p "$STAGING_DIR/$(dirname "$path")"
    cp -R "$ROOT_DIR/$path" "$STAGING_DIR/$path"
  fi
}

for path in \
  manifest.json \
  background.js \
  shared.js \
  storage-manager.js \
  popup.html \
  popup.css \
  popup.js \
  icons \
  README.md \
  PRIVACY.md
do
  copy_path "$path"
done

(
  cd "$STAGING_DIR"
  zip -r "$OUTPUT_ZIP" . -x "*.DS_Store"
)

rm -rf "$STAGING_DIR"
echo "Built $OUTPUT_ZIP"
