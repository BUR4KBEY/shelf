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
FROM --platform=$BUILDPLATFORM oven/bun:1.4.5@sha256:3aa040e5445efa09d75bb428a64ba50db13e2b3ac9b6b0c7f145615f62b2ee18 AS bundle
WORKDIR /app
COPY --from=dashboard /app ./
RUN bun selfhost/build.ts

FROM oven/bun:1.4.5-slim@sha256:b780593f3e10918cbdaec3d5a08d52224b9198069a65eb47812085c2ec007643
WORKDIR /app
COPY --from=bundle /app/selfhost/dist/server.js ./
RUN mkdir /data && chown bun:bun /data
USER bun
ENV NODE_ENV=production SHELF_DATA=/data PORT=8080
VOLUME /data
EXPOSE 8080
# `docker ps` shows healthy once the server answers. The slim image has no curl; bun's fetch does the same.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD ["bun", "-e", "fetch(`http://localhost:${process.env.PORT}/llms.txt`).then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["bun", "server.js"]
