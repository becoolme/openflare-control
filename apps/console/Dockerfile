FROM node:22-bookworm-slim AS build
WORKDIR /src
RUN corepack enable
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/control/package.json packages/control/
COPY apps/plane/package.json apps/plane/
COPY apps/console/package.json apps/console/
RUN pnpm install --frozen-lockfile --prod=false --ignore-scripts
COPY packages/control packages/control
COPY apps/console apps/console
RUN pnpm --filter openflare-console build

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8788
COPY --from=build /src/apps/console/.output/public ./public
COPY apps/console/server ./server
USER node
EXPOSE 8788
CMD ["node", "server/main.mjs"]
