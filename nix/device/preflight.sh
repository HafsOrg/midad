#!/bin/sh
# Device side of the installer's preflight (busybox sh). Prints facts; the host decides.
# MIDAD_* variables exist only so the script can be exercised against a temp tree.
H=${MIDAD_HOME:-/home/root}
OSREL=${MIDAD_OSREL:-/etc/os-release}
DTMODEL=${MIDAD_DTMODEL:-/proc/device-tree/model}

echo "MODEL=$(tr -d '\000' < "$DTMODEL" 2>/dev/null)"
echo "IMG=$(sed -n 's/^IMG_VERSION=//p' "$OSREL" 2>/dev/null | tr -d '"' | head -n 1)"
for f in \
  xovi/xovi.so \
  xovi/start \
  xovi/extensions.d/qt-resource-rebuilder.so \
  xovi/exthome/qt-resource-rebuilder/hashtab; do
  [ -e "$H/$f" ] || echo "MISSING $f"
done
exit 0
