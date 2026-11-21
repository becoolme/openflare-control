Wire fixtures copied from OpenFlare's `fixtures/vrt-wire/` (MIT, © 2026
becoolme). The Rust cell-controller and this TypeScript plane validate the
same JSON, so these files are the cross-language contract for `desired/ack`.

**The runtime owns this contract.** Do not edit these files locally. CI checks
out `becoolme/openflare` and runs:

```sh
OPENFLARE_DIR=openflare pnpm run check:openflare-contract
```

To pull a runtime contract change:

```sh
OPENFLARE_DIR=../openflare pnpm run sync:openflare-contract
```

The comparison is JSON-value based, so Prettier formatting here does not fight
the upstream layout.
