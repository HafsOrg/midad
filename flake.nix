{
  description = "midad is a collection of extensions for the reMarkable Paper Pro that enables Islamic note-taking";

  inputs = {
    # The revision whose GCC 15.3 cross compiler built the .so that runs on the tablet.
    nixpkgs.url = "github:NixOS/nixpkgs/4975466d324710c576dc11ad614684e6bd8cad8e";
    # nixos-24.11: Qt 6.8.3, matching the tablet's Qt 6.8.2. Used for headers and rcc only, never linked.
    nixpkgs-qt.url = "github:NixOS/nixpkgs/50ab793786d9de88ee30ec4e4c24fb4236fc2674";
  };

  outputs = { self, nixpkgs, nixpkgs-qt }:
    let
      version = "0.1.0";
      systems = [ "x86_64-linux" "aarch64-linux" ];
      forAll = f: nixpkgs.lib.genAttrs systems f;

      mkPackages = system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
          lib = pkgs.lib;
          qtbase = nixpkgs-qt.legacyPackages.${system}.qt6.qtbase;
          cross = pkgs.pkgsCross.aarch64-multiplatform;
          cc = cross.stdenv.cc;

          # ---- pinned upstream sources (see README, "Sources") ----
          quranPng = pkgs.fetchurl {
            url = "https://github.com/quran-ws/quran-png/releases/download/artwork-v1.0.0/quran-svg-hafs-kfgqpc.tar.gz";
            sha256 = "2bff7bcc1d84b61ee9baf2c356ea554b0a1dd317d6a8145406b5cee998914d17";
          };
          qpcCommit = "8a4f39d563ea69c994416a1692827e38156c548d";
          qpcText = pkgs.fetchurl {
            url = "https://raw.githubusercontent.com/nuqayah/qpc-fonts/${qpcCommit}/text-mushafs/UthmanicHafs_V22/UthmanicHafs%20v22.json";
            sha256 = "b5f9c469702154ad8764150a874ee3353f014dd84e233d28d6db74e54226275a";
          };
          qpcFont = pkgs.fetchurl {
            url = "https://raw.githubusercontent.com/nuqayah/qpc-fonts/${qpcCommit}/text-mushafs/UthmanicHafs_V22/uthmanic_hafs_v22.ttf";
            sha256 = "a6e59510dcaf3ec99db49427321a035ed94af555ffc7d27e7f430b5fd5e179f8";
          };
          lkCorpus = pkgs.fetchFromGitHub {
            owner = "ShathaTm";
            repo = "LK-Hadith-Corpus";
            rev = "c45fa64aa40bf1d4a34b9b35359640a583b02881";
            hash = "sha256-3s20WM5jKOcw/RdUtwmqXbBpBY4VU5IzrIzug3C29LI=";
          };
          fawazCommit = "df57907be35291c91ad6a6691180e22ca9920784";
          fawazMuslim = pkgs.fetchurl {
            url = "https://raw.githubusercontent.com/fawazahmed0/hadith-api/${fawazCommit}/editions/ara-muslim.min.json";
            sha256 = "2cb296f3455ff8a3da9f6a0ca3de75da675788b2fb446ad316df297838e48217";
          };
          fawazLicense = pkgs.fetchurl {
            url = "https://raw.githubusercontent.com/fawazahmed0/hadith-api/${fawazCommit}/LICENSE";
            hash = "sha256-awOCsWJ58m/2kBQwBUGWejVqZm6wuRtCL2hi9rfa0X4=";
          };
          amiriOfl = pkgs.fetchurl {
            url = "https://raw.githubusercontent.com/aliftype/amiri/1.003/OFL.txt";
            hash = "sha256-ct5o5ZVPT90kcCKS71oy8APKlg7JMw3Ibl7vtd/7myI=";
          };
          notoOfl = pkgs.fetchurl {
            url = "https://raw.githubusercontent.com/notofonts/arabic/f1ba474be91d6a5d2cfcc4374bb03cc5f1011088/OFL.txt";
            hash = "sha256-p6WiXrGIvxzZaYIDDVPiPDNIXGmxBEpWIlQiaFfuE68=";
          };

          # ---- the data and the two search cores, built by the repo's own bun scripts ----
          data = pkgs.stdenvNoCC.mkDerivation {
            pname = "midad-data";
            inherit version;
            src = lib.fileset.toSource {
              root = ./.;
              fileset = lib.fileset.unions [
                ./src/search/core.js
                ./src/search/hadith-core.js
                ./src/search/build.ts
                ./src/device/build.ts
                ./src/hadith/load.ts
                ./src/hadith/build.ts
                ./device/qml/AyahBar.qml
                ./device/qml/layer.js
                ./device/fonts
                ./device/fonts.conf
                ./device/guard.sh
                ./nix/expected.md5
              ];
            };
            nativeBuildInputs = [ pkgs.bun ];
            dontFixup = true;
            buildPhase = ''
              runHook preBuild
              export HOME=$TMPDIR

              # The scripts read vendor/... and write dist/... relative to the repo; rebuild that layout.
              mkdir -p vendor/quran-png/.data vendor/qpc-hafs-v22 vendor/hadith/lk
              tar -xzf ${quranPng} -C vendor/quran-png/.data \
                quran-svg-hafs-kfgqpc/index/words.json quran-svg-hafs-kfgqpc/index/surahs.json
              cp ${qpcText} "vendor/qpc-hafs-v22/UthmanicHafs v22.json"
              cp -r ${lkCorpus}/Bukhari ${lkCorpus}/Muslim vendor/hadith/lk/
              cp ${fawazMuslim} vendor/hadith/ara-muslim.min.json
              chmod -R u+w vendor

              # The font in device/fonts must be the one the v22 text belongs to.
              cmp ${qpcFont} device/fonts/uthmanic_hafs_v22.ttf

              bun src/search/build.ts
              bun src/device/build.ts
              bun src/hadith/build.ts
              runHook postBuild
            '';
            installPhase = ''
              runHook preInstall
              built=dist/device/midad
              mkdir -p $out/midad/data $out/midad/qml
              cp $built/data/*.json $out/midad/data/
              cp $built/qml/search.js $built/qml/hadith-search.js $out/midad/qml/
              runHook postInstall
            '';
            doInstallCheck = true;
            installCheckPhase = ''
              # Byte-identity with what the tablet runs today.
              expected=$PWD/nix/expected.md5
              (cd $out && md5sum -c "$expected")
            '';
          };

          # ---- the shim ----
          ayahfont = pkgs.stdenvNoCC.mkDerivation {
            pname = "libayahfont";
            inherit version;
            src = lib.fileset.toSource {
              root = ./device/native;
              fileset = ./device/native;
            };
            nativeBuildInputs = [ cc pkgs.patchelf ];
            hardeningDisable = [ "all" ];
            # No self-RPATH from the wrapper, so the pre-patchelf link matches the hand build.
            NIX_NO_SELF_RPATH = "1";
            dontFixup = true;
            buildPhase = ''
              runHook preBuild
              Q=${qtbase}/include
              ${cc.targetPrefix}g++ -std=c++17 -O2 -fPIC -shared -fvisibility=hidden \
                -fno-exceptions -fno-rtti -fno-threadsafe-statics -nostdlib++ \
                -DQT_NO_VERSION_TAGGING -DQT_NO_DEBUG \
                -Wl,--version-script=exports.map \
                -I$Q -I$Q/QtCore -I$Q/QtGui -s -o libayahfont.so ayahfont.cpp
              cp libayahfont.so libayahfont.raw.so
              # The wrapper adds a RUNPATH into /nix/store; the tablet has none of it.
              patchelf --remove-rpath libayahfont.so
              runHook postBuild
            '';
            doCheck = true;
            checkPhase = ''
              runHook preCheck
              READELF=${cc.bintools.targetPrefix}readelf
              OBJDUMP=${cc.bintools.targetPrefix}objdump
              NM=${cc.bintools.targetPrefix}nm
              so=libayahfont.so
              fail() { echo "shim check FAILED: $*" >&2; exit 1; }

              echo "== ELF machine"
              $READELF -h $so | grep -E 'Machine|Class'
              $READELF -h $so | grep -q 'Machine:.*AArch64' || fail "not an AArch64 ELF"

              echo "== exported symbols"
              $NM -D --defined-only $so
              exported=$($NM -D --defined-only $so | awk '{print $3}' | sort | tr '\n' ' ')
              [ "$exported" = "_ZN11QTextCursor10insertTextERK7QString " ] \
                || fail "exports are: $exported"

              echo "== dynamic section"
              $READELF -d $so | grep -E 'NEEDED|RPATH|RUNPATH' || true
              for n in $($READELF -d $so | sed -n 's/.*(NEEDED).*\[\(.*\)\]/\1/p'); do
                case $n in libgcc_s.so.1|libc.so.6) ;; *) fail "unexpected NEEDED $n" ;; esac
              done
              if $READELF -d $so | grep -E 'RPATH|RUNPATH' | grep -q /nix/store; then
                fail "RPATH/RUNPATH into /nix/store"
              fi

              echo "== relocations against Qt symbols (must be none of GLOB_DAT/ABS64)"
              $READELF -rW $so | grep -E 'R_AARCH64_(GLOB_DAT|ABS64)' || echo "(no GLOB_DAT/ABS64 relocations at all)"
              if $READELF -rW $so | grep -E 'R_AARCH64_(GLOB_DAT|ABS64)' \
                  | grep -E '(_ZN?K?[0-9]+Q[A-Z]|qt_|[[:space:]]Q[A-Z])'; then
                fail "GLOB_DAT/ABS64 relocation against a Qt symbol"
              fi

              echo "== glibc symbol versions"
              $OBJDUMP -T $so | grep -oE 'GLIBC_[0-9.]+' | sort -uV
              maxv=$($OBJDUMP -T $so | grep -oE 'GLIBC_[0-9.]+' | sed 's/GLIBC_//' | sort -V | tail -n 1)
              if [ -n "$maxv" ]; then
                top=$(printf '%s\n2.39\n' "$maxv" | sort -V | tail -n 1)
                [ "$top" = "2.39" ] || fail "needs GLIBC_$maxv, tablet has 2.39"
              fi
              echo "shim checks passed"
              runHook postCheck
            '';
            installPhase = ''
              runHook preInstall
              install -Dm644 libayahfont.so $out/midad/lib/libayahfont.so
              install -Dm644 libayahfont.raw.so $out/share/libayahfont.raw.so
              runHook postInstall
            '';
          };

          # ---- the keyboard layout resource ----
          keyboard = pkgs.stdenvNoCC.mkDerivation {
            pname = "midad-kbd-rcc";
            inherit version;
            src = lib.fileset.toSource {
              root = ./device;
              fileset = lib.fileset.unions [ ./device/midad-kbd.qrc ./device/keyboard ];
            };
            dontFixup = true;
            buildPhase = ''
              runHook preBuild
              ${qtbase}/libexec/rcc --binary --no-compress --format-version 3 midad-kbd.qrc -o midad-kbd.rcc
              runHook postBuild
            '';
            installPhase = ''
              install -Dm644 midad-kbd.rcc $out/xovi/exthome/qt-resource-rebuilder/midad-kbd.rcc
            '';
          };

          # ---- the tree that lands under /home/root ----
          mkBundle = { dev ? false }:
            pkgs.runCommand "midad-bundle${lib.optionalString dev "-dev"}-${version}"
              {
                nativeBuildInputs = [ pkgs.coreutils pkgs.findutils ];
                qmd = if dev then ./dev/midad.qmd else ./device/qmd/midad.qmd;
                variant = if dev then "dev" else "shipped";
              } ''
              mkdir -p $out/midad/{qml,fonts,licenses} \
                       $out/xovi/exthome/qt-resource-rebuilder \
                       $out/xovi/services/xochitl.service
              cp -r ${data}/midad/. $out/midad/
              cp -r ${ayahfont}/midad/lib $out/midad/
              cp -r ${keyboard}/xovi/. $out/xovi/
              chmod -R u+w $out
              cp ${./device/qml/AyahBar.qml} $out/midad/qml/AyahBar.qml
              cp ${./device/qml/layer.js} $out/midad/qml/layer.js
              cp ${./device/fonts}/*.ttf $out/midad/fonts/
              cp ${./device/fonts.conf} $out/midad/fonts.conf
              cp ${./device/guard.sh} $out/midad/guard.sh
              cp $qmd $out/xovi/exthome/qt-resource-rebuilder/midad.qmd
              cp ${./device/midad.conf} $out/xovi/services/xochitl.service/midad.conf

              L=$out/midad/licenses
              cp ${./device/licenses/NOTICES.txt} $L/NOTICES.txt
              cp ${amiriOfl} $L/Amiri-OFL.txt
              cp ${notoOfl} $L/NotoNaskhArabic-OFL.txt
              cp ${fawazLicense} $L/hadith-api-LICENSE.txt
              tar -xzf ${quranPng} -C $TMPDIR quran-svg-hafs-kfgqpc/LICENSE quran-svg-hafs-kfgqpc/VERSION.json
              cp $TMPDIR/quran-svg-hafs-kfgqpc/LICENSE $L/quran-png-LICENSE.txt
              cp $TMPDIR/quran-svg-hafs-kfgqpc/VERSION.json $L/quran-png-VERSION.json

              # Modes as they should land on the tablet.
              find $out -type d -exec chmod 755 {} +
              find $out -type f -exec chmod 644 {} +
              chmod 755 $out/midad/guard.sh

              # Manifest: version, variant, then sha256sum lines relative to /home/root.
              # The installer compares it with the tablet to decide what changed.
              (
                echo "# midad ${version}"
                echo "# variant: $variant"
                cd $out
                LC_ALL=C find . -type f ! -path ./midad/manifest | LC_ALL=C sort | sed 's|^\./||' \
                  | while IFS= read -r f; do sha256sum "$f"; done
              ) > $TMPDIR/manifest
              install -m 644 $TMPDIR/manifest $out/midad/manifest
            '';
          bundle = mkBundle { };
          bundleDev = mkBundle { dev = true; };

          # ---- deterministic release tarball for the Vellum recipe ----
          release = pkgs.runCommand "midad-${version}-aarch64.tar.gz"
            { nativeBuildInputs = [ pkgs.gnutar pkgs.gzip ]; } ''
            cd ${bundle}
            tar --sort=name --mtime=@0 --owner=0 --group=0 --numeric-owner --mode='u=rwX,go=rX' \
                --format=gnu -cf - midad xovi | gzip -n -9 > $out
          '';

          # ---- host tools: installer, uninstaller, status ----
          tools = import ./nix/tools.nix { inherit pkgs bundle bundleDev version; };
        in
        {
          inherit data ayahfont keyboard bundle release;
          bundle-dev = bundleDev;
          default = bundle;
          inherit (tools) install uninstall status;
        };
    in
    {
      packages = forAll mkPackages;

      apps = forAll (system:
        let p = self.packages.${system}; in
        {
          install = { type = "app"; program = "${p.install}/bin/midad-install"; };
          uninstall = { type = "app"; program = "${p.uninstall}/bin/midad-uninstall"; };
          status = { type = "app"; program = "${p.status}/bin/midad-status"; };
        });

      # `nix flake check` lints the busybox sh that runs on the tablet.
      checks = forAll (system:
        let pkgs = nixpkgs.legacyPackages.${system}; in
        {
          device-scripts = pkgs.runCommand "midad-device-scripts-shellcheck"
            { nativeBuildInputs = [ pkgs.shellcheck ]; } ''
            shellcheck --shell=sh ${./nix/device}/*.sh ${./device/guard.sh}
            touch $out
          '';
        });

      devShells = forAll (system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
          qtbase = nixpkgs-qt.legacyPackages.${system}.qt6.qtbase;
          cc = pkgs.pkgsCross.aarch64-multiplatform.stdenv.cc;
        in
        {
          default = pkgs.mkShell {
            packages = [ pkgs.bun cc pkgs.openssh pkgs.patchelf ];
            shellHook = ''
              export QT_INCLUDE=${qtbase}/include
              export RCC=${qtbase}/libexec/rcc
            '';
          };
        });
    };
}
