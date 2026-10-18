usage() {
  cat <<USAGE
usage: nix run .#uninstall -- [root@HOST]

Removes ayah-toolbar from the tablet (the whole /home/root/ayah-toolbar, the QMD, the
keyboard rcc, the service drop-in and the guard's /home/root/ayah-disabled), restarts
xochitl through xovi and checks that libayahfont.so is gone from it.
  root@HOST  the tablet (default $DEFAULT_HOST)
USAGE
}

parse_args "" "$@"
select_bundle

say "uninstalling ayah-toolbar from $HOST"
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
  say "ayah-toolbar was not installed; nothing removed, xochitl not restarted"
  exit 0
fi

say "restarting xochitl through xovi ..."
rsh "cat > $DEVTMP/ayah-restore.sh" < "$DEVICE_DIR/restore.sh"
rsh "rm -f $DEVTMP/ayah-restore.log; setsid nohup sh $DEVTMP/ayah-restore.sh > $DEVTMP/ayah-restore.log 2>&1 < /dev/null &"
if poll_log "$DEVTMP/ayah-restore.log" 'restore: (done|UNHEALTHY|SHIM)' 60; then
  if rsh "grep -q 'restore: done' $DEVTMP/ayah-restore.log"; then
    rsh "rm -f $DEVTMP/ayah-restore.sh $DEVTMP/ayah-restore.log $DEVTMP/ayah-guard.log" || true
    say "done: ayah-toolbar removed, xochitl healthy, libayahfont.so not loaded"
    exit 0
  fi
  die "xochitl restarted but is not as expected (see above). Run $DEVHOME/xovi/start on the tablet, or reboot it for stock xochitl."
fi
die "no verdict within 60 s. Check $DEVTMP/ayah-restore.log on the tablet; $DEVHOME/xovi/start or a reboot gets xochitl back."
