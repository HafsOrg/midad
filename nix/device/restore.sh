#!/bin/sh
# Restart xochitl through xovi after an uninstall and confirm it is healthy without the
# shim (busybox sh). The host runs this detached and polls its log.
# Args: [timeout seconds]
T=${1:-40}
H=${MIDAD_HOME:-/home/root}
P=${MIDAD_PROC:-/proc}
MARK="DeviceReporter enabled"

systemctl reset-failed xochitl 2>/dev/null
start=$(date +%s)
echo "restore: xovi/start at $start"
"$H/xovi/start"

i=0
healthy=0
while [ $i -lt "$T" ]; do
  if journalctl -u xochitl --since "@$start" --no-pager 2>/dev/null | grep -q "$MARK"; then
    healthy=1
    break
  fi
  sleep 1
  i=$((i + 1))
done

if [ $healthy -ne 1 ]; then
  echo "restore: UNHEALTHY after ${T}s"
  exit 1
fi
echo "restore: healthy after ${i}s"

for pid in $(pidof xochitl); do
  if grep -q libayahfont.so "$P/$pid/maps" 2>/dev/null; then
    echo "restore: SHIM STILL MAPPED in xochitl pid $pid"
    exit 3
  fi
  echo "restore: xochitl pid $pid runs without libayahfont.so"
done
echo "restore: done"
exit 0
