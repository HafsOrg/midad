#!/bin/sh
# Remove everything the installer put on the tablet (busybox sh). Nothing else is touched:
# not xovi, not other extensions, not documents, not the principal's own backup dir.
H=${AYAH_HOME:-/home/root}
RB=$H/xovi/exthome/qt-resource-rebuilder
SVC=$H/xovi/services/xochitl.service

[ -n "$H" ] || exit 2
n=0
for p in \
  "$H/ayah-toolbar" \
  "$H/ayah-disabled" \
  "$H/.ayah-stage" \
  "$RB/ayahBar.qmd" \
  "$RB/ayah-kbd.rcc" \
  "$SVC/ayah-toolbar.conf"; do
  if [ -e "$p" ]; then
    rm -rf "$p"
    echo "REMOVED ${p#"$H"/}"
    n=$((n + 1))
  fi
done
echo "DONE $n"
exit 0
