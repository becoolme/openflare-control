FROM node:22-bookworm-slim@sha256:be979e5523c76fa4d5ca4ebd3099078f220aa47ec39c48ad5b5df9314debd6eb AS build
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

FROM node:22-bookworm-slim@sha256:be979e5523c76fa4d5ca4ebd3099078f220aa47ec39c48ad5b5df9314debd6eb
WORKDIR /app
ENV NODE_ENV=production PORT=8788
COPY --from=build /src/apps/console/.output/public ./public
COPY apps/console/server ./server
USER node
EXPOSE 8788
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:8788/console-healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/main.mjs"]
