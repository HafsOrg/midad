# Shared by midad-install, midad-uninstall and midad-status (concatenated ahead of each).
# MIDAD_SSH, MIDAD_POLL, MIDAD_STAGE, MIDAD_HOME and MIDAD_TMP exist so the tools can be exercised against a local
# fake of the tablet; leave them unset on real use.
DEFAULT_HOST=root@10.11.99.1
MIDAD_SSH=${MIDAD_SSH:-"ssh -o BatchMode=yes -o ConnectTimeout=8"}
MIDAD_POLL=${MIDAD_POLL:-3}
DEVHOME=${MIDAD_HOME:-/home/root}
DEVTMP=${MIDAD_TMP:-/tmp}
GUARD_TIMEOUT=${MIDAD_GUARD_TIMEOUT:-}
STAGE=${MIDAD_STAGE:-$DEVHOME/.midad-stage}
DEVICE_DIR=@DEVICE@
VERSION=@VERSION@

HOST=$DEFAULT_HOST
FORCE=0
DEV=0

say() { printf '%s\n' "$*"; }
warn() { printf 'warning: %s\n' "$*" >&2; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

# rsh <remote command...>: run a command on the tablet.
rsh() {
  # shellcheck disable=SC2086
  $MIDAD_SSH "$HOST" "$@"
}

# parse_args <allowed flags, space separated> "$@"
parse_args() {
  local allowed=$1
  shift
  local a
  for a in "$@"; do
    case $a in
      -h|--help) usage; exit 0 ;;
      --force) case " $allowed " in *" --force "*) FORCE=1 ;; *) die "unknown option $a" ;; esac ;;
      --dev) case " $allowed " in *" --dev "*) DEV=1 ;; *) die "unknown option $a" ;; esac ;;
      -*) die "unknown option $a (try --help)" ;;
      *) HOST=$a ;;
    esac
  done
}

# run_device <script> [args...]: run one of the busybox sh scripts on the tablet. The bundle
# manifest travels ahead of the script and lands in $MIDAD_MF on the tablet.
run_device() {
  local script=$1
  shift
  {
    # shellcheck disable=SC2016
    printf 'MIDAD_MF=${MIDAD_TMP:-/tmp}/midad-manifest.$$\n'
    printf "cat > \"\$MIDAD_MF\" <<'__MIDAD_MANIFEST__'\n"
    cat "$MANIFEST"
    printf '__MIDAD_MANIFEST__\n'
    cat "$DEVICE_DIR/$script"
  } | rsh "sh -s -- $*"
}

require_reachable() {
  rsh true 2>/dev/null \
    || die "cannot reach $HOST over ssh (BatchMode, so it needs a key). Check the USB cable or Wi-Fi address, and that 'ssh $HOST' works without a password prompt."
}

# poll_log <log path on tablet> <egrep pattern that ends the wait> <max seconds>
# Prints new lines as they appear; returns 0 when the pattern shows, 1 on timeout.
poll_log() {
  local log=$1 pattern=$2 max=$3 waited=0 seen=0 out n
  while [ "$waited" -le "$max" ]; do
    out=$(rsh "cat '$log' 2>/dev/null" || true)
    n=$(printf '%s\n' "$out" | grep -c . || true)
    if [ "$n" -gt "$seen" ]; then
      printf '%s\n' "$out" | tail -n +"$((seen + 1))" | sed 's/^/  tablet: /'
      seen=$n
    fi
    if printf '%s\n' "$out" | grep -Eq "$pattern"; then
      return 0
    fi
    sleep "$MIDAD_POLL"
    waited=$((waited + MIDAD_POLL))
  done
  return 1
}

# the mounted bundle, chosen by --dev
select_bundle() {
  if [ "$DEV" -eq 1 ]; then BUNDLE=@BUNDLE_DEV@; else BUNDLE=@BUNDLE@; fi
  MANIFEST=$BUNDLE/midad/manifest
}
