#!/usr/bin/env bash
# Exercises midad-install / midad-uninstall / midad-status and their busybox-sh device scripts
# against a fake tablet: a temp directory standing in for /home/root, a stub systemctl,
# journalctl and pidof, and an "ssh" that runs the remote command locally. No real tablet.
#   test/install/run.sh                      (builds the tools with nix first)
#   MIDAD_TEST_BUSYBOX=1 test/install/run.sh  same, with the "tablet" side restricted to busybox
#                                            applets (the tablet's userland) instead of GNU tools
set -euo pipefail
cd "$(dirname "$0")/../.."

for t in install uninstall status; do
  eval "$(printf '%s' "$t" | tr a-z A-Z)=$(nix build ".#$t" --no-link --print-out-paths 2>/dev/null)/bin/midad-$t"
done
BUNDLE=$(nix build .#bundle --no-link --print-out-paths 2>/dev/null)

F=$(mktemp -d)
XP=
# guard.sh may already have killed the fake xochitl (pidof answers with $XP).
trap 'kill "$XP" 2>/dev/null || true; chmod -R u+w "$F"; rm -rf "$F"' EXIT
export F
H=$F/home/root
sleep 1000 & XP=$!
export XP
mkdir -p "$F/bin" "$F/tmp" "$F/proc/$XP" \
  "$H/xovi/extensions.d" "$H/xovi/exthome/qt-resource-rebuilder" "$H/xovi/services/xochitl.service" \
  "$H/ayah-backups" "$H/.local/share/remarkable/xochitl" "$H/.local/share/midad"
: > "$H/xovi/xovi.so"
: > "$H/xovi/extensions.d/qt-resource-rebuilder.so"
: > "$H/xovi/exthome/qt-resource-rebuilder/hashtab"
echo "precious" > "$H/ayah-backups/note.bak"
echo "precious" > "$H/.local/share/remarkable/xochitl/doc.metadata"
echo "precious" > "$H/.local/share/midad/layer.ini"
printf 'reMarkable Ferrari\0' > "$F/model"
printf 'IMG_VERSION="3.26.0.68"\n' > "$F/os-release"

cat > "$H/xovi/start" <<'S'
#!/bin/sh
# stands in for xovi/start: restart xochitl, hang it if the "break" flag is set and our QMD is in place
echo "start" >> "$F/start.log"
if [ -f "$F/break" ] && [ -e "$MIDAD_HOME/xovi/exthome/qt-resource-rebuilder/midad.qmd" ]; then rm -f "$F/healthy"; else touch "$F/healthy"; fi
if [ -f "$MIDAD_HOME/midad/lib/libayahfont.so" ] && [ -f "$MIDAD_HOME/xovi/services/xochitl.service/midad.conf" ]; then
  echo "7f00 r-xp 0 /home/root/midad/lib/libayahfont.so" > "$F/proc/$XP/maps"
else
  echo "7f00 r-xp 0 /usr/lib/libc.so.6" > "$F/proc/$XP/maps"
fi
S
chmod +x "$H/xovi/start"
printf '#!/bin/sh\necho "$@" >> "$F/systemctl.log"\n' > "$F/bin/systemctl"
printf '#!/bin/sh\n[ -f "$F/healthy" ] && echo "DeviceReporter enabled"\nexit 0\n' > "$F/bin/journalctl"
printf '#!/bin/sh\necho %s\n' "$XP" > "$F/bin/pidof"
if [ "${MIDAD_TEST_BUSYBOX:-0}" = 1 ]; then
  BB=$(nix build --inputs-from . nixpkgs#busybox --no-link --print-out-paths 2>/dev/null)
  mkdir -p "$F/bb"
  for a in $("$BB/bin/busybox" --list); do ln -s "$BB/bin/busybox" "$F/bb/$a"; done
  REMOTE_PATH=$F/bin:$F/bb
  echo "tablet side: busybox $("$BB/bin/busybox" 2>&1 | head -n 1)"
else
  REMOTE_PATH=$F/bin:$PATH
fi
cat > "$F/bin/fakessh" <<S
#!/bin/sh
while [ \$# -gt 0 ]; do case \$1 in -*) shift ;; *) break ;; esac; done
shift
PATH=$REMOTE_PATH exec sh -c "\$*"
S
chmod +x "$F"/bin/*

export MIDAD_SSH=$F/bin/fakessh MIDAD_HOME=$H MIDAD_TMP=$F/tmp MIDAD_PROC=$F/proc \
  MIDAD_DTMODEL=$F/model MIDAD_OSREL=$F/os-release MIDAD_POLL=1 MIDAD_GUARD_TIMEOUT=3

pass=0; failn=0
ok()   { pass=$((pass + 1)); echo "  ok   $*"; }
bad()  { failn=$((failn + 1)); echo "  FAIL $*"; }
check() { local d=$1; shift; if "$@"; then ok "$d"; else bad "$d"; fi; }
starts() { [ -f "$F/start.log" ] && wc -l < "$F/start.log" | tr -d ' ' || echo 0; }
out() { "$@" 2>&1 || true; }
has() { grep -q -- "$1" <<< "$2"; }

echo "== status before install"
o=$(out "$STATUS" root@fake)
check "reports not installed" has "not installed" "$o"

echo "== preflight refusals"
printf 'reMarkable 2\0' > "$F/model"
o=$(out "$INSTALL" root@fake); check "wrong model refused" has "not a Paper Pro" "$o"
printf 'reMarkable Ferrari\0' > "$F/model"
printf 'IMG_VERSION="3.25.1.10"\n' > "$F/os-release"
o=$(out "$INSTALL" root@fake); check "wrong OS refused" has "Use --force" "$o"
check "nothing installed after refusals" test ! -e "$H/midad"
printf 'IMG_VERSION="3.26.0.68"\n' > "$F/os-release"
mv "$H/xovi/exthome/qt-resource-rebuilder/hashtab" "$F/hashtab.away"
o=$(out "$INSTALL" root@fake); check "missing hashtab explained" has "rebuild_hashtable" "$o"
mv "$F/hashtab.away" "$H/xovi/exthome/qt-resource-rebuilder/hashtab"
o=$(MIDAD_SSH=/bin/false out "$INSTALL" root@fake); check "unreachable host explained" has "cannot reach" "$o"

echo "== install"
o=$(out "$INSTALL" root@fake); echo "$o" | sed 's/^/    | /' | tail -12
check "install reports done" has "done: xochitl restarted healthy" "$o"
check "one restart" test "$(starts)" = 1
check "reset-failed ran before the start" grep -q "reset-failed xochitl" "$F/systemctl.log"
check "tree matches the bundle (sha256)" bash -c "cd '$H' && grep -v '^#' '$BUNDLE/midad/manifest' | sha256sum -c --quiet -"
check "manifest installed" cmp -s "$BUNDLE/midad/manifest" "$H/midad/manifest"
check "guard.sh executable" test -x "$H/midad/guard.sh"
check "no staging dir left" test ! -e "$H/.midad-stage"
check "shipped qmd has no broker" bash -c "! grep -q XoviMessageBroker '$H/xovi/exthome/qt-resource-rebuilder/midad.qmd'"
o=$(out "$STATUS" root@fake)
check "status: up to date, shim mapped" bash -c "grep -q 'up to date' <<< '$o' && grep -q 'shim=mapped' <<< '$o'"

echo "== second run is a no-op"
o=$(out "$INSTALL" root@fake)
check "prints up to date" has "up to date" "$o"
check "no extra restart" test "$(starts)" = 1

echo "== drift is repaired"
echo "tampered" > "$H/midad/qml/AyahBar.qml"
o=$(out "$STATUS" root@fake); check "status sees the difference" has "differs: midad/qml/AyahBar.qml" "$o"
o=$(out "$INSTALL" root@fake)
check "only the changed file is swapped" bash -c "[ \"\$(grep -c '^  SWAP' <<< '$o')\" = 1 ]"
check "restart after change" test "$(starts)" = 2
check "file restored" cmp -s "$BUNDLE/midad/qml/AyahBar.qml" "$H/midad/qml/AyahBar.qml"

echo "== --dev swaps the one QMD"
o=$(out "$INSTALL" root@fake --dev)
check "dev qmd installed" grep -q XoviMessageBroker "$H/xovi/exthome/qt-resource-rebuilder/midad.qmd"
check "still exactly one qmd" test "$(ls "$H"/xovi/exthome/qt-resource-rebuilder/*.qmd | wc -l | tr -d ' ')" = 1
o=$(out "$INSTALL" root@fake)
check "back to the shipped qmd" bash -c "! grep -q XoviMessageBroker '$H/xovi/exthome/qt-resource-rebuilder/midad.qmd'"

echo "== a tampered upload is refused and nothing live changes"
mkdir -p "$H/.midad-stage/midad/qml"
echo bogus > "$H/.midad-stage/midad/qml/AyahBar.qml"
before=$(sha256sum "$H/midad/qml/AyahBar.qml")
o=$(MIDAD_MF=$F/mf; cp "$BUNDLE/midad/manifest" "$F/mf"; MIDAD_MF=$F/mf sh nix/device/apply.sh "$H/.midad-stage" 2>&1 || true)
check "apply.sh reports the mismatch" has "FAIL checksum mismatch" "$o"
check "live file untouched" test "$before" = "$(sha256sum "$H/midad/qml/AyahBar.qml")"
rm -rf "$H/.midad-stage"

echo "== guard rolls back a xochitl that does not start"
echo "tampered" > "$H/midad/qml/search.js"
touch "$F/break"
n=$(starts)
o=$(out "$INSTALL" root@fake); echo "$o" | sed 's/^/    | /' | tail -6
check "install reports the rollback" has "did not start healthy" "$o"
check "files parked" test -e "$H/midad-disabled/midad.qmd"
check "qmd no longer live" test ! -e "$H/xovi/exthome/qt-resource-rebuilder/midad.qmd"
check "restarted clean (two starts)" test "$(starts)" = $((n + 2))
rm -f "$F/break"
o=$(out "$STATUS" root@fake); check "status lists parked files" has "midad.qmd" "$o"
o=$(out "$INSTALL" root@fake); check "reinstall after rollback is healthy" has "done: xochitl restarted healthy" "$o"

echo "== uninstall"
n=$(starts)
o=$(out "$UNINSTALL" root@fake); echo "$o" | sed 's/^/    | /' | tail -10
check "uninstall reports done" has "libayahfont.so not loaded" "$o"
check "midad gone" test ! -e "$H/midad"
check "midad-disabled gone" test ! -e "$H/midad-disabled"
check "qmd, rcc and drop-in gone" bash -c "! ls '$H'/xovi/exthome/qt-resource-rebuilder/midad* '$H'/xovi/services/xochitl.service/midad* 2>/dev/null"
check "xovi files kept" test -e "$H/xovi/xovi.so" -a -e "$H/xovi/exthome/qt-resource-rebuilder/hashtab"
check "xochitl restarted once" test "$(starts)" = $((n + 1))
check "shim not in xochitl maps" bash -c "! grep -q libayahfont '$F/proc/$XP/maps'"
o=$(out "$UNINSTALL" root@fake)
echo "$o" | sed "s/^/    | /"
check "second uninstall is a no-op" has "was not installed" "$o"
check "no restart for the no-op" test "$(starts)" = $((n + 1))

echo "== untouched data"
check "ayah-backups untouched" test "$(cat "$H/ayah-backups/note.bak")" = precious
check "xochitl documents untouched" test "$(cat "$H/.local/share/remarkable/xochitl/doc.metadata")" = precious
check "midad layer untouched" test "$(cat "$H/.local/share/midad/layer.ini")" = precious
check "no script mentions ayah-backups" bash -c "! grep -rn 'ayah-backups' nix device flake.nix"

echo
echo "$pass passed, $failn failed"
[ "$failn" -eq 0 ]
