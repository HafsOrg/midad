#!/bin/sh
# Compares the tablet with a bundle manifest (busybox sh, read-only). The host sends the
# manifest in $AYAH_MF ahead of this script. Prints one line per fact:
#   BUNDLE <version> <variant>        what the manifest describes
#   INSTALLED <version> <variant>     what the tablet's own manifest says, or "none"
#   OK|DIFF|MISSING <path>            every manifest file, relative to /home/root
#   STALE <path>                      listed by the installed manifest, absent from the new one
#   MANIFEST same|differs|missing
#   PARKED <name>                     files the guard moved to ayah-disabled
#   XOCHITL none | pid=<n> shim=mapped|absent
# shellcheck disable=SC2154
H=${AYAH_HOME:-/home/root}
P=${AYAH_PROC:-/proc}
T=${AYAH_TMP:-/tmp}/ayah-check.$$
mkdir -p "$T"
trap 'rm -rf "$T" "$AYAH_MF"' EXIT

inst=$H/ayah-toolbar/manifest
grep -v '^#' "$AYAH_MF" > "$T/new"
echo "BUNDLE $(sed -n 's/^# ayah-toolbar //p' "$AYAH_MF" | head -n 1) $(sed -n 's/^# variant: //p' "$AYAH_MF" | head -n 1)"

if [ -f "$inst" ]; then
  echo "INSTALLED $(sed -n 's/^# ayah-toolbar //p' "$inst" | head -n 1) $(sed -n 's/^# variant: //p' "$inst" | head -n 1)"
  if cmp -s "$AYAH_MF" "$inst"; then echo "MANIFEST same"; else echo "MANIFEST differs"; fi
else
  echo "INSTALLED none"
  echo "MANIFEST missing"
fi

while read -r want path; do
  [ -n "$path" ] || continue
  if [ -f "$H/$path" ]; then
    have=$(sha256sum "$H/$path" | cut -d' ' -f1)
    if [ "$have" = "$want" ]; then echo "OK $path"; else echo "DIFF $path"; fi
  else
    echo "MISSING $path"
  fi
done < "$T/new"

if [ -f "$inst" ]; then
  grep -v '^#' "$inst" > "$T/old"
  awk 'NR==FNR { keep[$2] = 1; next } !($2 in keep) { print "STALE " $2 }' "$T/new" "$T/old"
fi

if [ -d "$H/ayah-disabled" ]; then
  for f in "$H"/ayah-disabled/*; do
    [ -e "$f" ] && echo "PARKED $(basename "$f")"
  done
fi

pids=$(pidof xochitl 2>/dev/null)
if [ -z "$pids" ]; then
  echo "XOCHITL none"
else
  for pid in $pids; do
    if grep -q libayahfont.so "$P/$pid/maps" 2>/dev/null; then
      echo "XOCHITL pid=$pid shim=mapped"
    else
      echo "XOCHITL pid=$pid shim=absent"
    fi
  done
fi
exit 0
