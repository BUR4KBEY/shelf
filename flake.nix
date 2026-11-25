{
  description = "shelf CLI: publish HTML pages and docs to your shelf";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs =
    { nixpkgs, ... }:
    let
      # The platforms the release builds for (cli/.goreleaser.yaml).
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "armv7l-linux"
        "x86_64-darwin"
        "aarch64-darwin"
      ];
    in
    {
      packages = nixpkgs.lib.genAttrs systems (system: rec {
        # The latest release's prebuilt binary; goreleaser rewrites nix/package.nix on each release.
        shelf = nixpkgs.legacyPackages.${system}.callPackage ./nix/package.nix { };
        default = shelf;
      });
    };
}
