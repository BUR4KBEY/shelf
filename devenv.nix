{ pkgs, ... }:

{
  env.DEVSHELL_NAME = "shelf";

  languages.javascript.enable = true;
  languages.javascript.package = pkgs.nodejs_22;
}
