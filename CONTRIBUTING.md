# Contributing

```sh
pnpm install
pnpm --filter openflare-control build
pnpm --filter openflare-control test        # pure unit tests, no database
pnpm --filter openflare-plane typecheck
DATABASE_URL=postgresql://.../openflare_plane_test pnpm --filter openflare-plane test
# without DATABASE_URL most of the plane suite silently skips (16+ files
# gate `describe` on it) — a green local run without it proves little.
pnpm lint && pnpm format:check
OPENFLARE_DIR=../openflare node scripts/vrt-k8s-check.mjs --template deploy/k8s/overlays/example
```

Requirements for a change:

- **Tests.** Pure logic gets a unit test under `packages/control/test/`. Store
  semantics get a case in `packages/control/src/storeConformance.ts` so both
  the Prisma and the Postgres implementations are held to the same contract.
  The reference plane's HTTP surface gets a route test in `apps/plane/src`.
- **Formatting and lint.** `pnpm lint` and `pnpm format:check` must pass.
- **Portable boundary.** `packages/control/src` may import only `node:*`,
  `zod` and same-directory modules. `boundary.test.ts` enforces it; Prisma and
  platform path aliases belong outside.
- **Sync with Vibeploy.** During the migration the same files exist at
  `server/src/vrt-control` in Vibeploy. Run
  `VIBEPLOY_DIR=../vibeploy node scripts/check-vibeploy-sync.mjs` and include
  the mirrored change in the Vibeploy commit.
- **Manifests.** Anything under `deploy/k8s` must render in template mode and
  must not contain real addresses, secrets or registry names:
  `pnpm run check:sanitized` fails on private host addresses, cell tokens,
  private keys or product-brand references.

Security issues: see [SECURITY.md](SECURITY.md); do not open a public issue.
