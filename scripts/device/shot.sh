#!/bin/bash
# shot <name> <yoffset>  - capture, crop to exactly 1080x2160 (2:1), no alpha.
#   yoffset 216 = bottom-anchored just above the system gesture pill (tab-bar screens)
#   yoffset  96 = top-anchored just below the status bar (full-bleed reader screens)
# The status bar is exactly 96px here: screen 2400 - WebView 2304 (768 CSS x dpr 3).
ADB=${ADB:-~/Android/Sdk/platform-tools/adb}
OUT=${SHOT_DIR:-/tmp/shots}
mkdir -p "$OUT"
NAME="$1"; Y="${2:-216}"
$ADB shell cmd statusbar collapse >/dev/null 2>&1   # never photograph the shade
sleep 1
for i in 1 2 3 4 5; do
  $ADB exec-out screencap -p > "$OUT/raw-$NAME.png" 2>/dev/null
  SZ=$(stat -c%s "$OUT/raw-$NAME.png")
  [ "$SZ" -gt 12000 ] && break
  sleep 1.5
done
convert "$OUT/raw-$NAME.png" -crop "1080x2160+0+$Y" +repage \
        -background black -alpha remove -alpha off -type TrueColor \
        "$OUT/$NAME.png"
identify -format '%f  %wx%h  ratio 1:%[fx:h/w]  alpha=%A\n' "$OUT/$NAME.png"
# Prove no status bar / shade survived the crop: mean of the top 4 rows.
convert "$OUT/$NAME.png" -crop 1080x4+0+0 +repage -format 'top4 mean=%[fx:int(mean*255)] max=%[fx:int(maxima*255)]\n' info:
