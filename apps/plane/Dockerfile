FROM node:22-bookworm-slim AS build
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

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
# pnpm keeps dependencies in the workspace package's node_modules (symlinks
# into the root .pnpm store), so all three must be copied together.
COPY --from=build /src/node_modules ./node_modules
COPY --from=build /src/packages/control/package.json ./packages/control/package.json
COPY --from=build /src/packages/control/node_modules ./packages/control/node_modules
COPY --from=build /src/packages/control/dist ./packages/control/dist
COPY --from=build /src/apps/plane/package.json ./apps/plane/package.json
COPY --from=build /src/apps/plane/node_modules ./apps/plane/node_modules
COPY --from=build /src/apps/plane/dist ./apps/plane/dist
COPY --from=build /src/apps/plane/src/schema.sql ./apps/plane/dist/schema.sql
# The default bundle volume is initialized from this directory; root-owned
# `/data` would make every bundle PUT fail with EACCES for the `node` user.
RUN mkdir -p /data/bundles && chown -R node:node /data
WORKDIR /app/apps/plane
USER node
EXPOSE 8787
CMD ["node", "dist/main.js"]
