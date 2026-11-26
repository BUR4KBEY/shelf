# Security policy

## Reporting a vulnerability

Please report vulnerabilities privately: on GitHub, open the **Security** tab of this repository and click **Report a vulnerability**. Don't open a public issue, pull request or discussion for a security problem.

Include what you found, how to reproduce it, and what an attacker could do with it. Once a fix is released, the advisory is published, with credit to you if you want it.

## Supported versions

Only the latest release gets security fixes. Self-hosted instances get them by redeploying: on Cloudflare, deploy the latest `main`; on Docker, pull `ghcr.io/bur4kbey/shelf:latest`.

## Scope

In scope: the Worker and the self-hosted server (`worker/`), the dashboard, the CLI (`cli/`) and the agent skills (`skills/`). Examples:

- A key reaching docs outside its space, or skipping a doc's password.
- Getting into the dashboard without Cloudflare Access or the self-host password.
- A published doc reading cookies or storage, or making network requests, despite the sandbox.
- The CLI sending a key or a local file somewhere it shouldn't.

Out of scope:

- What a doc's owner chooses to publish. A doc's scripts can still load images from other sites and open links; this is documented in [docs/readers.md](docs/readers.md).
- Problems in Cloudflare, Docker or other services shelf runs on. Report those to their maintainers.
- Denial of service through volume, and missing hardening headers with no concrete attack.
