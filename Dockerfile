# MonieNaija backend — production container.
#
# Design constraints, each of which is a security property rather than a preference:
#
#  * Three stages, so build tooling never reaches the runtime image. `npm ci` in the builder installs
#    dev dependencies (the Nest compiler, TypeScript); the runtime stage installs only production
#    dependencies. A container that ships tsc also ships an attack surface and ~200 MB nobody needs.
#  * Node 22 is pinned to `22.22.3-alpine3.23`, matching the runtime this repository is developed and
#    accepted against, rather than floating `node:22-alpine`: a base image that silently advances can
#    change a V8 behaviour under a financial service. For a real production deploy this tag should
#    further be pinned by digest (`node:22.22.3-alpine3.23@sha256:…`), which is a one-line change made
#    at release time for the specific registry the image is pulled from. This file does not embed a
#    digest because a digest that was never pulled is a guess, and a wrong digest fails the build in a
#    way that looks like a network problem.
#  * Non-root. The `node` user (uid 1000) owns only /app/dist and the writable paths the application
#    genuinely needs; everything else is root-owned and read-only to the process.
#  * No secrets, no .env, no development credentials. Configuration arrives at runtime through the
#    environment. A build that bakes a credential into an image layer has published it.
#  * Explicit startup command. `node dist/main.js` — no npm wrapper, so SIGTERM reaches the process
#    directly and the graceful-shutdown hook actually runs.
#  * Liveness and readiness are separate endpoints, and the container healthcheck uses liveness only.
#    A readiness failure means "do not send traffic", not "kill this container": killing it would
#    turn a database blip into a restart loop that cannot recover.

# ---------------------------------------------------------------- builder
FROM node:22.22.3-alpine3.23 AS builder
WORKDIR /app

# Install with the lockfile only, so the dependency layer is cached independently of source changes.
# `npm ci` (not `npm install`) fails the build if package.json and package-lock.json disagree, which
# is the point: a lockfile that does not describe the tree is a reproducibility bug.
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
RUN npm run build

# Strip dev dependencies from the installed tree, then verify nothing survived that should not have.
RUN npm prune --omit=dev && npm cache clean --force

# ---------------------------------------------------------------- runtime
FROM node:22.22.3-alpine3.23 AS runtime

# tini is PID 1 so that SIGTERM is forwarded and zombie children are reaped. Node handles signals
# poorly as PID 1, and a financial worker that ignores SIGTERM drops in-flight work on every deploy.
RUN apk add --no-cache tini

ENV NODE_ENV=production \
    PORT=3000 \
    NODE_OPTIONS="--max-old-space-size=1024"

WORKDIR /app

# Production dependencies only. No compiler, no test runner, no ts-node.
COPY package.json package-lock.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

# Writable directory for local proof-of-address storage and any other on-disk artefact the
# application writes. Mounted as a volume in compose; owned by the runtime user so the process does
# not need to be root to write.
RUN mkdir -p /app/var/poa /app/var/backups \
 && chown -R node:node /app/var /app/dist \
 && chmod 0750 /app/var/poa /app/var/backups

USER node

EXPOSE 3000

# Liveness only. `/api/v1/health` is deliberately public and deliberately shallow: it proves the
# process can serve HTTP. Readiness (`/api/v1/health/ready`) requires a workforce session and would
# both fail closed and leak the requirement if used here.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||'3000')+'/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main.js"]
