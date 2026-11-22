Wire fixtures copied from OpenFlare's `fixtures/vrt-wire/` (MIT, © 2026
becoolme). The Rust cell-controller and this TypeScript plane validate the
same JSON, so these files are the cross-language contract for `desired/ack`
and the periodic `cell-report`.

**The runtime owns this contract.** Do not edit these files locally. CI checks
out the exact OpenFlare commit in [`OPENFLARE_CONTRACT_REV`](../../../../OPENFLARE_CONTRACT_REV)
and runs:

```sh
OPENFLARE_DIR=openflare pnpm run check:openflare-contract
```

To bump the dependency, check out the intended OpenFlare revision and pull it:

```sh
OPENFLARE_DIR=../openflare pnpm run sync:openflare-contract
```

That updates both the fixtures and the pin. The comparison is JSON-value based,
so Prettier formatting here does not fight the upstream layout.
