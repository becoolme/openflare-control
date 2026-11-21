# Implementing another store

`openflare-control` exports the store port and the cases any implementation must
satisfy. This is how the Vibeploy Prisma store and the reference Postgres store
stay interchangeable.

```ts
import { storeConformanceCases, type StoreConformanceHarness } from 'openflare-control'

const harness: StoreConformanceHarness = {
  store, // your VrtControlStore implementation
  clusterId: 'cell-1', // a real cell/cluster id in your backing store
  cellId: 'cell-1',
  teamId: 'team-a', // real teams (the Prisma store enforces FKs)
  otherTeamId: 'team-b',
  createdById: 'system',
  async seedWorker({ teamId, name }) {
    // insert a VRT worker in `clusterId` and return the row
  },
}

for (const testCase of storeConformanceCases) {
  it(testCase.name, () => testCase.run(harness))
}
```

Rules:

- Cases only call port methods; `seedWorker` is the only adapter hook, so a
  store backed by SQLite, Postgres or an in-memory map can run them.
- The suite is framework-free (plain `Error`s); wrap it in vitest, `node:test`
  or a CLI.
- Any new port method or semantic change lands with a case here. Coverage of
  the reference implementations lives in their own repositories; the suite is
  the cross-implementation contract.
- The reference plane runs the same cases **and** a route-level test that
  exercises auth, ACK digests, bundle allowlisting and secret isolation, so a
  store that passes conformance still has to be wired safely.
