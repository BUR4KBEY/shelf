# shelf in one container, no Cloudflare account: the Worker (src/) runs on Bun with its data in /data.
# Build from worker/: `docker build -t shelf .`. See the README, "Self-host with Docker".

# The dashboard, built into src/dashboard.html. Platform-independent output, so it builds on the host's own arch.
FROM --platform=$BUILDPLATFORM node:26-slim@sha256:abe7e5a82b61a8ef67b315b85497c9e65173387ccf2f4a029248184b8e020be5 AS dashboard
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# pnpm only if its tarball matches packageManager's sha512: npm install alone ignores that hash.
# shortcut: its native binary (@pnpm/exe.<platform>) is pinned by version only, checked against the registry's own hash.
RUN pm=$(node -p 'require("./package.json").packageManager') && tgz=$(npm pack --silent "${pm%%+*}") \
  && echo "${pm#*+sha512.}  $tgz" | sha512sum -c - && npm install -g "./$tgz" && rm "$tgz" \
  && pnpm install --frozen-lockfile
COPY . .
# Settings → About shows the commit; the image has no .git, so CI passes it in.
ARG COMMIT
RUN WORKERS_CI_COMMIT_SHA=$COMMIT pnpm run build

# The server and everything it imports as one JS file.
FROM --platform=$BUILDPLATFORM oven/bun:1.4.4@sha256:1d22548f177f4ff38e0c15baa3c2c46c6c2060ba2d1bc573bb4720b407548f1d AS bundle
WORKDIR /app
COPY --from=dashboard /app ./
RUN bun selfhost/build.ts

FROM oven/bun:1.4.4-slim@sha256:1846adf22496bd711036aae8be147e57bdebbaea2e5264e3e0b5af1db187d9a4
WORKDIR /app
COPY --from=bundle /app/selfhost/dist/server.js ./
RUN mkdir /data && chown bun:bun /data
USER bun
ENV NODE_ENV=production SHELF_DATA=/data PORT=8080
VOLUME /data
EXPOSE 8080
CMD ["bun", "server.js"]
