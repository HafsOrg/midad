usage() {
  cat <<USAGE
usage: nix run .#uninstall -- [root@HOST]

Removes midad from the tablet (the whole /home/root/midad, the QMD, the
keyboard rcc, the service drop-in and the guard's /home/root/midad-disabled), restarts
xochitl through xovi and checks that libayahfont.so is gone from it.
  root@HOST  the tablet (default $DEFAULT_HOST)
USAGE
}

parse_args "" "$@"
select_bundle

say "uninstalling midad from $HOST"
require_reachable

pre=$(run_device preflight.sh) || die "could not query the tablet"
model=$(printf '%s\n' "$pre" | sed -n 's/^MODEL=//p')
[ "$model" = "reMarkable Ferrari" ] \
  || die "this is not a Paper Pro (device-tree model: '${model:-unreadable}')"
if printf '%s\n' "$pre" | grep -q '^MISSING xovi/start$'; then
  die "$DEVHOME/xovi/start is missing, so xochitl cannot be restarted through xovi; nothing was removed"
fi

res=$(run_device remove.sh) || die "removal failed on the tablet"
printf '%s\n' "$res" | { grep '^REMOVED ' || true; } | sed 's/^/  /'
if printf '%s\n' "$res" | grep -q '^DONE 0$'; then
  say "midad was not installed; nothing removed, xochitl not restarted"
  exit 0
fi

say "restarting xochitl through xovi ..."
rsh "cat > $DEVTMP/midad-restore.sh" < "$DEVICE_DIR/restore.sh"
rsh "rm -f $DEVTMP/midad-restore.log; setsid nohup sh $DEVTMP/midad-restore.sh > $DEVTMP/midad-restore.log 2>&1 < /dev/null &"
if poll_log "$DEVTMP/midad-restore.log" 'restore: (done|UNHEALTHY|SHIM)' 60; then
  if rsh "grep -q 'restore: done' $DEVTMP/midad-restore.log"; then
    rsh "rm -f $DEVTMP/midad-restore.sh $DEVTMP/midad-restore.log $DEVTMP/midad-guard.log" || true
    say "done: midad removed, xochitl healthy, libayahfont.so not loaded"
    exit 0
  fi
  die "xochitl restarted but is not as expected (see above). Run $DEVHOME/xovi/start on the tablet, or reboot it for stock xochitl."
fi
die "no verdict within 60 s. Check $DEVTMP/midad-restore.log on the tablet; $DEVHOME/xovi/start or a reboot gets xochitl back."
