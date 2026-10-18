usage() {
  cat <<USAGE
usage: nix run .#status -- [root@HOST] [--dev]

Read-only. Shows whether ayah-toolbar is installed, which files differ from this bundle,
and whether the font shim is loaded in the running xochitl.
  root@HOST  the tablet (default $DEFAULT_HOST)
  --dev      compare against the dev bundle
USAGE
}

parse_args "--dev" "$@"
select_bundle

require_reachable
chk=$(run_device check.sh) || die "could not query the tablet"

line() { printf '%s\n' "$chk" | sed -n "s/^$1 //p"; }
installed=$(line INSTALLED)
say "tablet:     $HOST"
say "bundle:     $(line BUNDLE)"
if [ "$installed" = none ]; then
  say "installed:  no"
else
  say "installed:  yes ($installed)"
fi

ok=$(printf '%s\n' "$chk" | grep -c '^OK ' || true)
diff=$(line DIFF)
miss=$(line MISSING)
stale=$(line STALE)
say "files:      $ok match the bundle"
[ -z "$diff" ] || printf '%s\n' "$diff" | sed 's/^/  differs: /'
[ -z "$miss" ] || printf '%s\n' "$miss" | sed 's/^/  missing: /'
[ -z "$stale" ] || printf '%s\n' "$stale" | sed 's/^/  not in this bundle: /'

parked=$(line PARKED)
if [ -n "$parked" ]; then
  say "parked:     the guard moved files to /home/root/ayah-disabled after a failed start:"
  printf '%s\n' "$parked" | sed 's/^/  /'
fi

xo=$(line XOCHITL)
case $xo in
  none) say "xochitl:    not running" ;;
  *shim=mapped*) say "xochitl:    $xo (libayahfont.so is loaded)" ;;
  *) say "xochitl:    $xo (libayahfont.so is not loaded)" ;;
esac

if [ -z "$diff$miss$stale" ] && [ "$installed" != none ]; then
  say "result:     up to date"
elif [ "$installed" = none ]; then
  say "result:     not installed"
else
  say "result:     differs from the bundle; 'nix run .#install' brings it up to date"
fi
