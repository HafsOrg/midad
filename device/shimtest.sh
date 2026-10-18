#!/bin/sh
# One-off xochitl launch for testing the ayahfont shim, always restoring the normal service.
#   shimtest.sh control   xovi only (checks the manual launch itself)
#   shimtest.sh shim      xovi + libayahfont.so, Amiri fallback config
# Prints "HEALTHY", "DIED" or "TIMEOUT", then restarts xochitl.service.
MODE=${1:-control}
FONTS=${2:-auto}
LOG=/tmp/xochitl-shimtest-$MODE-${2:-auto}.log
PRE=/home/root/xovi/xovi.so
FC=/home/root/ayah-toolbar/fonts.conf
if [ "$MODE" = shim ]; then
  PRE="$PRE /home/root/ayah-toolbar/lib/libayahfont.so"
  FC=/home/root/ayah-toolbar/fonts-shim-test.conf
fi
if [ "$FONTS" = normal ]; then FC=/home/root/ayah-toolbar/fonts.conf; elif [ "$FONTS" = shimfonts ]; then FC=/home/root/ayah-toolbar/fonts-shim-test.conf
fi

# Stop the test copy gently and wait for it to be gone before starting the service:
# a force-kill followed by a quick start made the service core-dump, and xochitl.service
# reboots the tablet when it fails.
restore() {
  pkill -TERM -x xochitl 2>/dev/null
  j=0
  while pidof xochitl > /dev/null && [ $j -lt 20 ]; do
    sleep 1
    j=$((j + 1))
  done
  pidof xochitl > /dev/null && pkill -9 -x xochitl && sleep 3
  systemctl start xochitl
}
trap restore EXIT

systemctl stop xochitl
sleep 1
setsid env QML_DISABLE_DISK_CACHE=1 QML_XHR_ALLOW_FILE_WRITE=1 QML_XHR_ALLOW_FILE_READ=1 \
  FONTCONFIG_FILE="$FC" LD_PRELOAD="$PRE" /usr/bin/xochitl > "$LOG" 2>&1 < /dev/null &

i=0
while [ $i -lt 30 ]; do
  sleep 1
  i=$((i + 1))
  if grep -q "DeviceReporter enabled" "$LOG"; then
    p=$(pidof xochitl)
    echo "HEALTHY after ${i}s, shim mapped: $(grep -c libayahfont /proc/$p/maps 2>/dev/null)"
    exit 0
  fi
  if ! pidof xochitl > /dev/null; then
    echo "DIED after ${i}s:"
    tail -n 5 "$LOG"
    exit 1
  fi
done
echo "TIMEOUT"
tail -n 5 "$LOG"
exit 1
