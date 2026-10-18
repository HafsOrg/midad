#!/bin/sh
# Verify the staged files against the manifest, then swap each into place (busybox sh).
# Every swap is a rename inside /home/root, so a live file is never half-written; xochitl
# once loaded a half-written .so and the tablet rebooted. The manifest goes last, so an
# interrupted run is picked up again by the next one.
# Args: <stage dir>. The host sends the new manifest in $AYAH_MF ahead of this script.
# shellcheck disable=SC2154
H=${AYAH_HOME:-/home/root}
STAGE=$1
T=${AYAH_TMP:-/tmp}/ayah-apply.$$
mkdir -p "$T"
trap 'rm -rf "$T" "$AYAH_MF"' EXIT

case $STAGE in
  "$H"/.ayah-stage*) ;;
  *) echo "FAIL refusing to use $STAGE as staging dir"; exit 2 ;;
esac
cd "$STAGE" || { echo "FAIL no staging dir $STAGE"; exit 1; }

grep -v '^#' "$AYAH_MF" > "$T/sums"
find . -type f ! -path ./ayah-toolbar/manifest | sed 's|^\./||' | sort > "$T/files"

# 1. verify what arrived
while read -r f; do
  want=$(awk -v p="$f" '$2 == p { print $1 }' "$T/sums")
  have=$(sha256sum "$f" | cut -d' ' -f1)
  if [ -z "$want" ] || [ "$want" != "$have" ]; then
    echo "FAIL checksum mismatch for $f"
    rm -rf "$STAGE"
    exit 1
  fi
done < "$T/files"
if [ -f ayah-toolbar/manifest ] && ! cmp -s ayah-toolbar/manifest "$AYAH_MF"; then
  echo "FAIL staged manifest differs from the one sent"
  rm -rf "$STAGE"
  exit 1
fi
echo "VERIFIED $(wc -l < "$T/files" | tr -d ' ') files"

# 2. same-filesystem rename over each destination
n=0
while read -r f; do
  case $f in
    ayah-toolbar/guard.sh) chmod 755 "$f" ;;
    *) chmod 644 "$f" ;;
  esac
  mkdir -p "$H/$(dirname "$f")"
  mv -f "$f" "$H/$f" || { echo "FAIL could not move $f"; exit 1; }
  echo "SWAP $f"
  n=$((n + 1))
done < "$T/files"

# 3. files the previous version shipped and this one does not
inst=$H/ayah-toolbar/manifest
if [ -f "$inst" ]; then
  grep -v '^#' "$inst" | awk '{ print $2 }' | while read -r f; do
    if ! awk -v p="$f" '$2 == p { found = 1 } END { exit !found }' "$T/sums"; then
      rm -f "$H/$f" && echo "REMOVE $f"
    fi
  done
fi

# 4. the manifest
if [ -f ayah-toolbar/manifest ]; then
  chmod 644 ayah-toolbar/manifest
  mv -f ayah-toolbar/manifest "$inst"
fi

cd "$H" && rm -rf "$STAGE"
echo "APPLIED $n"
exit 0
