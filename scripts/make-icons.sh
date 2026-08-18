#!/usr/bin/env bash
#
# Regenerate every launcher asset from the SVG sources in assets/brand.
#
# The PNGs in assets/ are build output, not source. Edit the SVG and re-run
# this rather than editing a PNG, or the next person has a binary they cannot
# change.
#
# Needs rsvg-convert (librsvg) and ImageMagick, neither of which is an npm
# dependency - this runs by hand when the mark changes, not on every build.
#
set -euo pipefail
cd "$(dirname "$0")/.."

for tool in rsvg-convert magick; do
  command -v "$tool" >/dev/null || { echo "missing: $tool" >&2; exit 1; }
done

render() {  # render <svg> <size> <out>
  rsvg-convert -w "$2" -h "$2" "assets/brand/$1.svg" -o "$3"
}

# The App Store icon is the one asset that must not carry an alpha channel.
# An icon with alpha builds fine and is then rejected at upload with
# ITMS-90717, about twenty minutes after you thought you were finished.
render icon 1024 /tmp/prs-icon.png
magick /tmp/prs-icon.png -background '#EFE9DC' -alpha remove -alpha off -strip assets/icon.png
rm -f /tmp/prs-icon.png

render splash               1024 assets/splash-icon.png
render adaptive-foreground  1024 assets/android-icon-foreground.png
render adaptive-background  1024 assets/android-icon-background.png
render adaptive-monochrome  1024 assets/android-icon-monochrome.png
render splash                 48 assets/favicon.png

# Fail loudly rather than at the App Store Connect upload.
if magick identify -format '%A' assets/icon.png | grep -qi 'true\|blend'; then
  echo "assets/icon.png still has an alpha channel" >&2
  exit 1
fi

echo "icons regenerated"
magick identify assets/icon.png assets/splash-icon.png assets/favicon.png \
  assets/android-icon-foreground.png assets/android-icon-background.png \
  assets/android-icon-monochrome.png
