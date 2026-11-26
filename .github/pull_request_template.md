## What and why

<!-- The problem this solves, in a sentence or two. Link the issue if there is one: Fixes #123 -->

## Evidence

<!--
Required. Show the change working, from your own run:
- UI or anything a person sees: screenshots, before and after. A short video or GIF for anything that moves or takes several steps.
- CLI, API, MCP or self-host: the commands you ran and their output.
- Bug fix: the failure before, and the same steps passing after.
Drag files into this box to upload them.
-->

## Checklist

- [ ] `devenv test` passes (and `bun test selfhost` if `worker/selfhost/` changed)
- [ ] Commits follow [Conventional Commits](https://www.conventionalcommits.org/)
- [ ] `docs/` is updated if the change is visible to people using shelf
- [ ] A schema change is a new migration file, and backup and import handle it
