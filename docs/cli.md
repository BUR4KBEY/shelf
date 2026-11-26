# CLI

Download a binary from [Releases](https://github.com/BUR4KBEY/shelf/releases), or install it with one of:

```sh
go install github.com/BUR4KBEY/shelf/cli/cmd/shelf@latest
nix profile install github:BUR4KBEY/shelf   # or try it: nix run github:BUR4KBEY/shelf -- version
yay -S shelf-cli-bin                         # Arch (AUR); shelf-bin is a different tool
```

Nix and the AUR install the release's prebuilt binary for Linux (x86_64, aarch64, armv7) and, with Nix, macOS (x86_64, aarch64). Only the latest stable release updates them; a pre-release or a patch to an older line doesn't. Each such release commits the new `nix/package.nix` to `main` through the `NIX_DEPLOY_KEY` secret, a write deploy key that `main`'s ruleset lets bypass PRs, so the flake installs nothing until the first release. It also publishes `shelf-cli-bin` to the AUR when the repo has an `AUR_KEY` secret: the private SSH key of the AUR account that owns the package.

```sh
shelf login                                  # server URL + API key, saved to ~/.config/shelf (0600)
shelf push plan.html                         # prints the link; pushing the same path again adds a version
shelf push ./report/ --project billing-poc   # a folder with an index.html, grouped with the rest of billing-poc
echo "$PW" | shelf push plan.md --slug q3-plan --password-stdin --expires 7d
shelf ls                                     # ★ favorites first, 🔒 locked; --project billing-poc for one project
shelf set q3-plan --fav --expires never
shelf get https://your-domain/view/q3-plan --password-stdin
shelf rm q3-plan
```

`SHELF_URL` and `SHELF_KEY` override the saved login; a `SHELF_URL` for another server needs its `SHELF_KEY` too, so the saved key is never sent elsewhere. `--json` on `push`, `ls` and `set` prints machine-readable output. `shelf get` saves under the doc's file name, but refuses a dotfile such as `.npmrc` unless you name it with `-o`.
