# Monster Battle 9001: the game server and the game page in one container image.
#
#   podman build -f Containerfile -t monster-battle-9001:local .
#   docker build -f Containerfile -t monster-battle-9001:local .
#
# Most people never run this by hand: host/start.cmd (Windows) or host/start.sh (Linux, WSL)
# builds it through compose.yaml. docs/HOSTING.md is the guide.
#
# Three stages:
#   build    installs every package with "npm ci" and builds the server bundle and the client;
#   deps     installs only the packages the server bundle loads at run time;
#   runtime  Node 22 on Alpine Linux with the bundle, the built client and those packages,
#            running as the unprivileged "node" user. Nothing is downloaded at run time.

ARG NODE_VERSION=22.23

# ---------------------------------------------------------------------------------------------
FROM docker.io/library/node:${NODE_VERSION}-bookworm-slim AS build
WORKDIR /src
ENV npm_config_update_notifier=false
# Package files first, so the slow install step is reused until a dependency changes.
COPY package.json package-lock.json .npmrc ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build --workspace @mb/server \
 && npm run build --workspace @mb/client \
 && test -f server/dist/index.js \
 && test -f client/dist/index.html

# ---------------------------------------------------------------------------------------------
FROM docker.io/library/node:${NODE_VERSION}-alpine AS deps
WORKDIR /app
ENV npm_config_update_notifier=false
COPY package.json package-lock.json .npmrc ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
# Only the server's own run-time packages (the bundle already contains the shared code).
# The workspace links and the type definitions are of no use at run time.
RUN npm ci --omit=dev --workspace @mb/server --no-audit --no-fund \
 && rm -rf node_modules/@mb node_modules/@types \
 && npm cache clean --force

# ---------------------------------------------------------------------------------------------
FROM docker.io/library/node:${NODE_VERSION}-alpine AS runtime
ENV NODE_ENV=production \
    PORT=2567 \
    npm_config_update_notifier=false
WORKDIR /app
# The layout mirrors the repository, because the server looks for the page at
# ../../client/dist next to its own bundle.
COPY --from=deps --chown=root:root /app/node_modules ./node_modules
COPY --from=build --chown=root:root /src/server/dist ./server/dist
COPY --from=build --chown=root:root /src/client/dist ./client/dist
# server/package.json says the bundle is an ES module.
COPY --chown=root:root server/package.json ./server/package.json
# Files belong to root and are read-only for the "node" user that runs the server.
USER node
EXPOSE 2567
# The game answers on /healthz. Node's own fetch is used, so the image needs no extra tools.
# (Podman keeps this only when building with "--format docker"; compose.yaml repeats it.)
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||2567)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
# Node runs directly (not through npm) so a stop request reaches the server, which closes
# every room and exits at once.
STOPSIGNAL SIGTERM
CMD ["node", "--enable-source-maps", "server/dist/index.js"]
