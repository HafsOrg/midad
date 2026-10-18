usage() {
  cat <<USAGE
usage: nix run .#install -- [root@HOST] [--dev] [--force]

Installs midad $VERSION onto a reMarkable Paper Pro that runs xovi.
  root@HOST  the tablet (default $DEFAULT_HOST)
  --dev      install the dev QMD (message-broker hooks) instead of the shipped one
  --force    go ahead on an OS version other than 3.26.x
USAGE
}

parse_args "--dev --force" "$@"
select_bundle

say "midad $VERSION -> $HOST"
require_reachable

# ---- preflight ----
pre=$(run_device preflight.sh) || die "preflight failed on the tablet"
model=$(printf '%s\n' "$pre" | sed -n 's/^MODEL=//p')
img=$(printf '%s\n' "$pre" | sed -n 's/^IMG=//p')
[ "$model" = "reMarkable Ferrari" ] \
  || die "this is not a Paper Pro (device-tree model: '${model:-unreadable}'; expected 'reMarkable Ferrari')"
case $img in
  3.26.*) ;;
  *)
    if [ "$FORCE" -eq 1 ]; then
      warn "OS version is '${img:-unknown}', tested on 3.26.0.68; continuing because of --force"
    else
      die "OS version is '${img:-unknown}'; this build is for 3.26.x. Use --force to try anyway."
    fi
    ;;
esac
missing=$(printf '%s\n' "$pre" | sed -n 's/^MISSING //p')
if [ -n "$missing" ]; then
  printf '%s\n' "$missing" | sed 's|^|error: missing on the tablet: /home/root/|' >&2
  case $missing in
    *hashtab*)
      say "The qt-resource-rebuilder hashtab is missing. On the tablet run: /home/root/xovi/rebuild_hashtable" >&2 ;;
  esac
  case $missing in
    *xovi.so*|*xovi/start*|*qt-resource-rebuilder.so*)
      say "xovi and qt-resource-rebuilder are required (for example from Vellum or reManager)." >&2 ;;
  esac
  exit 1
fi
say "preflight ok: $model, OS $img, xovi and qt-resource-rebuilder present"

# ---- what differs ----
chk=$(run_device check.sh) || die "could not compare with the tablet"
changed=$(printf '%s\n' "$chk" | sed -n 's/^\(DIFF\|MISSING\) //p')
stale=$(printf '%s\n' "$chk" | sed -n 's/^STALE //p')
manifest_state=$(printf '%s\n' "$chk" | sed -n 's/^MANIFEST //p')

if [ -z "$changed" ] && [ -z "$stale" ]; then
  if [ "$manifest_state" != "same" ]; then
    # same files, new manifest text (for example a version bump): record it, no restart
    changed=midad/manifest
    say "files match; updating the manifest only"
  else
    say "up to date ($(printf '%s\n' "$chk" | sed -n 's/^INSTALLED //p')); nothing to do, xochitl not restarted"
    exit 0
  fi
fi

count=$(printf '%s\n' "$changed" | grep -c . || true)
say "to install: $count file(s)$([ -n "$stale" ] && printf ', %s to remove' "$(printf '%s\n' "$stale" | grep -c .)")"

# ---- upload once, verify, swap ----
list=$(mktemp)
trap 'rm -f "$list"' EXIT
{ printf '%s\n' "$changed"; echo midad/manifest; } | grep . | sort -u > "$list"
say "uploading to $STAGE ..."
rsh "rm -rf '$STAGE'"
tar -C "$BUNDLE" --format=ustar --owner=0 --group=0 --numeric-owner -cf - -T "$list" \
  | { 
      # shellcheck disable=SC2086
      $MIDAD_SSH -C "$HOST" "mkdir -p '$STAGE' && tar -xf - -C '$STAGE'"
    } || die "upload failed"

res=$(run_device apply.sh "$STAGE") || { printf '%s\n' "$res" >&2; die "install failed on the tablet; live files were not touched unless listed above"; }
printf '%s\n' "$res" | grep -E '^(VERIFIED|SWAP|REMOVE) ' | sed 's/^/  /'
printf '%s\n' "$res" | grep -q '^APPLIED ' || die "installer on the tablet did not finish"

# ---- restart through the guard ----
if [ -z "$(printf '%s\n' "$changed" | grep -v '^midad/manifest$' || true)" ] && [ -z "$stale" ]; then
  say "manifest updated; xochitl not restarted"
  exit 0
fi
say "restarting xochitl through guard.sh (rolls the addon back on its own if xochitl does not come up) ..."
rsh "rm -f $DEVTMP/midad-guard.log; setsid nohup sh $DEVHOME/midad/guard.sh $GUARD_TIMEOUT > $DEVTMP/midad-guard.log 2>&1 < /dev/null &"
if poll_log "$DEVTMP/midad-guard.log" 'guard: (healthy|recovered)' 60; then
  if rsh "grep -q 'guard: healthy' $DEVTMP/midad-guard.log"; then
    say "done: xochitl restarted healthy with midad $VERSION"
    exit 0
  fi
  die "xochitl did not start healthy; the guard parked the addon in /home/root/midad-disabled and restarted stock. See $DEVTMP/midad-guard.log on the tablet."
fi
die "no verdict from the guard within 60 s. Check $DEVTMP/midad-guard.log on the tablet; to get back to stock xochitl run $DEVHOME/xovi/start (a reboot also does)."
