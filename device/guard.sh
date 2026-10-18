#!/bin/sh
# Guarded (re)start of xochitl via xovi. Run detached on the tablet:
#   setsid nohup /home/root/ayah-toolbar/guard.sh [timeout_s] > /tmp/ayah-guard.log 2>&1 &
# If xochitl doesn't log its healthy-start marker in time, park every ayah-toolbar file
# and restart clean, killing the hung process before the watchdog's crash path can stall.
T=${1:-40}
MARK="DeviceReporter enabled"
RB=/home/root/xovi/exthome/qt-resource-rebuilder
SVC=/home/root/xovi/services/xochitl.service
PARK=/home/root/ayah-disabled

start=$(date +%s)
echo "guard: xovi/start at $start"
/home/root/xovi/start

i=0
while [ $i -lt "$T" ]; do
  if journalctl -u xochitl --since "@$start" --no-pager 2>/dev/null | grep -q "$MARK"; then
    echo "guard: healthy after ${i}s"
    exit 0
  fi
  sleep 1
  i=$((i + 1))
done

echo "guard: UNHEALTHY after ${T}s, parking ayah files and restarting clean"
mkdir -p "$PARK"
for f in "$RB"/ayah* "$SVC"/ayah*; do
  [ -e "$f" ] && mv "$f" "$PARK/"
done
pkill -9 xochitl
/home/root/xovi/start
echo "guard: recovered"
exit 1
