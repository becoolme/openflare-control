FROM node:22-bookworm-slim@sha256:be979e5523c76fa4d5ca4ebd3099078f220aa47ec39c48ad5b5df9314debd6eb AS build
WORKDIR /src
RUN corepack enable
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/control/package.json packages/control/
# The package's `prepare` script builds itself for git/tarball consumers, so
# its tsconfigs and sources must exist in the dependency-install layer.
COPY packages/control/tsconfig.json packages/control/tsconfig.build.json packages/control/
COPY packages/control/src packages/control/src
COPY apps/plane/package.json apps/plane/
RUN pnpm install --frozen-lockfile --prod=false
COPY packages/control packages/control
COPY apps/plane apps/plane
RUN pnpm --filter openflare-control build && pnpm --filter openflare-plane build
# Prod-only deploy tree: shipping the workspace install would drag every
# devDependency (tsc, vitest, tsx…) into the runtime image.
RUN pnpm --filter openflare-plane deploy --prod /deploy

FROM node:22-bookworm-slim@sha256:be979e5523c76fa4d5ca4ebd3099078f220aa47ec39c48ad5b5df9314debd6eb
WORKDIR /app
ENV NODE_ENV=production
# `pnpm deploy` materializes prod deps plus the workspace `openflare-control`
# package as plain files — no .pnpm store or cross-package symlinks needed.
COPY --from=build /deploy/package.json ./package.json
COPY --from=build /deploy/node_modules ./node_modules
# dist is gitignored so `pnpm deploy` will not copy it — take it from the
# build stage (schema.sql is already inside via the package build script).
COPY --from=build /src/apps/plane/dist ./dist
# The default bundle volume is initialized from this directory; root-owned
# `/data` would make every bundle PUT fail with EACCES for the `node` user.
RUN mkdir -p /data/bundles && chown -R node:node /data
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s \
  CMD node -e "fetch('http://127.0.0.1:8787/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]
