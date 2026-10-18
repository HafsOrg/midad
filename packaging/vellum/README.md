# Vellum recipe

`ayah-toolbar/VELBUILD` packages the addon for [Vellum](https://github.com/vellum-dev/vellum), the package manager for reMarkable tablets. reManager installs from the Vellum index, so this recipe is the reManager route.

It is a draft. Before it can go anywhere, a person has to fill in the placeholders at the top of the file (maintainer, the GitHub account that will host releases, the licence) and publish a release.

## Rules to follow

Vellum's README says pull requests and issues must be opened by a person, and that a description written by an LLM gets the PR closed. Commits must be authored and co-authored by people: no `Co-Authored-By:` trailer that names an assistant, agent or bot. Commits in this repository carry such a trailer; do not copy them into a Vellum PR. Write the PR text yourself.

## Build the release tarball

```sh
nix build .#release          # result -> ayah-toolbar-0.1.0-aarch64.tar.gz, deterministic
sha512sum result             # goes into sha512sums in the VELBUILD
```

Upload that file to a GitHub release tagged `v0.1.0`; the VELBUILD's `source` points there. Update the checksum whenever anything under `device/` or `src/` changes.

## Lint and build locally

Use a checkout of the Vellum package repository, docker or podman, and Vellum's `vbuild`:

```sh
cp -r packaging/vellum/ayah-toolbar <vellum-checkout>/packages/
cd <vellum-checkout>
./scripts/lint-packages.sh ayah-toolbar --apkbuild-lint
./scripts/build-package.sh ayah-toolbar aarch64        # needs the release URL to be downloadable
```

`build-package.sh` creates a throwaway signing key at `keys/vellum-dev.rsa(.pub)` and writes the package to `dist/aarch64/`. To test on a tablet, copy `vellum-dev.rsa.pub` to `/home/root/.vellum/etc/apk/keys/` and run `vellum add ayah-toolbar-0.1.0-r0.apk`. Then restart xochitl as the install message says. `vellum del ayah-toolbar` removes it again.

To build before a release exists, put the tarball where abuild looks for distfiles (it skips the download when the file is there and its sha512 matches):

```sh
docker run --rm -e CARCH=aarch64 -v "$PWD/pkg:/work" -v "$PWD/distfiles:/var/cache/distfiles" -v "$PWD/out:/out" \
  -w /work ghcr.io/eeems/vbuild-builder:main sh -c \
  'abuild-keygen -a -n -q; cp /root/.abuild/*.pub /etc/apk/keys/; abuild -F -d -r -P /out'
```

`pkg/` holds an APKBUILD made from the VELBUILD (lifecycle functions turned into `.post-install` and friends, `options="!check !fhs !strip !tracedeps"`, which is what `vbuild` generates). Its `apkbuild-lint` needs `SKIP_AL6=1` because `upstream_author` and `category` are VELBUILD-only variables.

## What the package does

It installs the release tree under `/home/root` and copies the licence texts to `/home/root/.vellum/licenses/ayah-toolbar/`. `postinstall` tells you to run `/home/root/xovi/start` (or `guard.sh` for an automatic rollback). `predeinstall` runs `systemctl reset-failed xochitl`, because xochitl's service reboots the tablet after repeated failed starts. It depends on `xovi`, `qt-resource-rebuilder` and `remarkable-os` 3.26.x, and excludes the devices this was not tested on (`rm1`, `rm2`, `rmppm`, `rmppure`).

The tree also contains the `manifest` that `nix run .#status` reads, so status reports a Vellum install as up to date.
