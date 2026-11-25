{
  pkgs,
  lib,
  config,
  ...
}:
let
  isTesting = config.devenv.isTesting;
  workerPort = config.processes.worker.ports.http.value;
in
{
  env.DEVSHELL_NAME = "shelf";

  # Versions match CI (.github/workflows/ci.yml) and cli/go.mod.
  languages.javascript = {
    enable = true;
    package = pkgs.nodejs_26;
    directory = "worker";
    pnpm = {
      enable = true;
      install.enable = true;
    };
    lsp.enable = true;
  };
  languages.go = {
    enable = true;
    package = pkgs.go_1_27;
    lsp.enable = true;
  };
  languages.nix = {
    enable = true;
    lsp.enable = true;
  };

  packages = [ pkgs.nixfmt ];

  git-hooks.hooks = {
    gofmt.enable = true;
    # cli/ is its own module, so vet runs there rather than per staged file.
    go-vet = {
      enable = true;
      name = "go vet";
      entry = "sh -c 'cd cli && go vet ./...'";
      files = "^cli/.*\\.go$";
      pass_filenames = false;
      language = "system";
    };
    worker-typecheck = {
      enable = true;
      name = "worker typecheck";
      entry = "sh -c 'cd worker && pnpm run typecheck && pnpm run typecheck:dashboard && pnpm run typecheck:preview'";
      files = "^worker/.*\\.(ts|tsx|mts|cts|json|jsonc)$";
      pass_filenames = false;
      language = "system";
    };
    nix-format = {
      enable = true;
      name = "nixfmt";
      entry = "${pkgs.nixfmt}/bin/nixfmt";
      files = "\\.nix$";
      language = "system";
    };
  };

  # `devenv up`: local Worker with the dashboard signed in as you@localhost.
  # Each worktree gets its own free port, starting at 8787.
  processes = lib.optionalAttrs (!isTesting) {
    worker = {
      exec = ''cd "$DEVENV_ROOT/worker" && pnpm run dev --ip 127.0.0.1 --port ${toString workerPort}'';
      ports.http.allocate = 8787;
      ready.http.get = {
        port = workerPort;
        path = "/";
      };
    };
  };

  # The same checks CI runs; `devenv test` runs them all.
  tasks = {
    "shelf:check-worker".exec = ''
      set -euo pipefail
      cd "$DEVENV_ROOT/worker"
      pnpm run typecheck
      pnpm run typecheck:dashboard
      pnpm run typecheck:preview
      pnpm test
      pnpm run build:preview
    '';
    "shelf:check-cli".exec = ''
      set -euo pipefail
      cd "$DEVENV_ROOT/cli"
      test -z "$(gofmt -l .)"
      go vet ./...
      go test ./...
    '';
  };

  enterTest = ''
    set -euo pipefail
    node --version | grep -q '^v26\.'
    go version | grep -q ' go1\.27\.'
    ${config.tasks."shelf:check-worker".command}
    ${config.tasks."shelf:check-cli".command}
  '';
}
