# shelf in one container, no Cloudflare account: the Worker (src/) runs on Bun with its data in /data.
# Build from worker/: `docker build -t shelf .`. See the README, "Self-host with Docker".

# The dashboard, built into src/dashboard.html. Platform-independent output, so it builds on the host's own arch.
FROM --platform=$BUILDPLATFORM node:26-slim AS dashboard
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN npm install -g "$(node -p 'require("./package.json").packageManager')" && pnpm install --frozen-lockfile
COPY . .
# Settings → About shows the commit; the image has no .git, so CI passes it in.
ARG COMMIT
RUN WORKERS_CI_COMMIT_SHA=$COMMIT pnpm run build

# The server and everything it imports as one JS file.
FROM --platform=$BUILDPLATFORM oven/bun:1.4 AS bundle
WORKDIR /app
COPY --from=dashboard /app ./
RUN bun selfhost/build.ts

FROM oven/bun:1.4-slim
WORKDIR /app
COPY --from=bundle /app/selfhost/dist/server.js ./
RUN mkdir /data && chown bun:bun /data
USER bun
ENV NODE_ENV=production SHELF_DATA=/data PORT=8080
VOLUME /data
EXPOSE 8080
CMD ["bun", "server.js"]
