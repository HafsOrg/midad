#!/bin/sh
# Guarded (re)start of xochitl via xovi. Run detached on the tablet:
#   setsid nohup /home/root/midad/guard.sh [timeout_s] > /tmp/midad-guard.log 2>&1 &
# If xochitl doesn't log its healthy-start marker in time, park every midad file
# and restart clean, killing the hung process before the watchdog's crash path can stall.
# MIDAD_HOME only exists so the script can be exercised against a temp tree.
T=${1:-40}
MARK="DeviceReporter enabled"
H=${MIDAD_HOME:-/home/root}
RB=$H/xovi/exthome/qt-resource-rebuilder
SVC=$H/xovi/services/xochitl.service
PARK=$H/midad-disabled

# xochitl.service reboots the tablet after repeated failed starts; clear the counter first.
start_xovi() {
  systemctl reset-failed xochitl 2>/dev/null
  "$H/xovi/start"
}

start=$(date +%s)
echo "guard: xovi/start at $start"
start_xovi

i=0
while [ $i -lt "$T" ]; do
  if journalctl -u xochitl --since "@$start" --no-pager 2>/dev/null | grep -q "$MARK"; then
    echo "guard: healthy after ${i}s"
    exit 0
  fi
  sleep 1
  i=$((i + 1))
done

echo "guard: UNHEALTHY after ${T}s, parking midad files and restarting clean"
mkdir -p "$PARK"
for f in "$RB"/midad* "$SVC"/midad*; do
  [ -e "$f" ] && mv "$f" "$PARK/"
done
p=$(pidof xochitl)
if [ -n "$p" ]; then
  # shellcheck disable=SC2086 # pidof may list several pids
  kill -9 $p
  sleep 3
fi
start_xovi
echo "guard: recovered"
exit 1
