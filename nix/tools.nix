{ pkgs, bundle, bundleDev, version }:
let
  lib = pkgs.lib;
  deviceDir = ./device;
  subst = builtins.replaceStrings
    [ "@DEVICE@" "@BUNDLE@" "@BUNDLE_DEV@" "@VERSION@" ]
    [ "${deviceDir}" "${bundle}" "${bundleDev}" version ];
  common = subst (builtins.readFile ./lib.sh);
  mk = name: script: pkgs.writeShellApplication {
    name = "midad-${name}";
    excludeShellChecks = [ "SC2034" "SC2329" ]; # helpers and variables shared by all three tools
    runtimeInputs = [ pkgs.openssh pkgs.gnutar pkgs.coreutils pkgs.gnugrep pkgs.gnused pkgs.findutils ];
    text = common + "\n" + builtins.readFile script + "\n";
  };
in
{
  install = mk "install" ./install.sh;
  uninstall = mk "uninstall" ./uninstall.sh;
  status = mk "status" ./status.sh;
}
