#!/bin/sh
# Builds the Chrome Web Store upload: dist/sticky-notes-sync-<version>.zip
# The manifest "key" (stable dev ID) is removed; the store assigns its own ID.
set -e
cd "$(dirname "$0")/.."

if grep -q "YOUR_CLIENT_ID" src/config.js; then
  echo "Set GOOGLE_CLIENT_ID in src/config.js first" >&2
  exit 1
fi

VERSION=$(node -p "require('./manifest.json').version")
OUT="dist/sticky-notes-sync-$VERSION.zip"
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT

cp -R src assets _locales LICENSE "$STAGE/"
node -e "
  const m = require('./manifest.json');
  delete m.key;
  require('fs').writeFileSync('$STAGE/manifest.json', JSON.stringify(m, null, 2) + '\n');
"
find "$STAGE" -name '.DS_Store' -delete

mkdir -p dist
rm -f "$OUT"
(cd "$STAGE" && zip -qr - .) > "$OUT"
echo "$OUT"
