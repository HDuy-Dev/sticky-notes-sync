#!/bin/sh
# Renders the Chrome Web Store images and extension icons with headless Chrome.
#   store/src/<name>.html -> store/<name>.png
#   assets/icons/icon.svg -> assets/icons/icon-{16,32,48,128}.png
# Usage: scripts/render-store-images.sh [name ...]   (default: all)
set -e
cd "$(dirname "$0")/.."

CHROME=${CHROME:-"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"}

shot() { # <html file> <png out> <width> <height>
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --allow-file-access-from-files \
    --force-device-scale-factor=1 --virtual-time-budget=4000 \
    --window-size="$3,$4" --screenshot="$2" "file://$PWD/$1" 2>/dev/null
  echo "$2"
}

size() {
  case "$1" in
    promo-small) echo "440 280" ;;
    promo-marquee) echo "1400 560" ;;
    *) echo "1280 800" ;;
  esac
}

if [ $# -eq 0 ]; then
  set -- $(cd store/src && ls *.html | grep -v popup-demo | sed 's/\.html$//') icons
fi

for name in "$@"; do
  if [ "$name" = icons ]; then
    TMP=$(mktemp -d)
    for px in 16 32 48 128; do
      # 16px drops the sync badge; 128px keeps 16px of transparent padding per side (store spec).
      src=icon.svg; art=$px; pad=0
      [ "$px" = 16 ] && src=icon-small.svg
      [ "$px" = 128 ] && art=96 && pad=16
      printf '<style>html,body{margin:0;background:transparent}</style><img src="file://%s/assets/icons/%s" width="%s" height="%s" style="display:block;margin:%spx">' "$PWD" "$src" "$art" "$art" "$pad" > "$TMP/icon.html"
      "$CHROME" --headless=new --disable-gpu --hide-scrollbars --allow-file-access-from-files \
        --force-device-scale-factor=1 --default-background-color=00000000 \
        --window-size="$px,$px" --screenshot="assets/icons/icon-$px.png" "file://$TMP/icon.html" 2>/dev/null
      echo "assets/icons/icon-$px.png"
    done
    rm -rf "$TMP"
    continue
  fi
  wh=$(size "$name")
  shot "store/src/$name.html" "store/$name.png" "${wh% *}" "${wh#* }"
done
