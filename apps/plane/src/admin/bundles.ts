import type { Hono } from 'hono'
import { VrtControlError, bundleKeyFor, verifyRuntimeBundle } from 'openflare-control'
import { type AdminDeps, digest, parse, readBody, sha256 } from './context.js'

export function registerBundles(app: Hono, deps: AdminDeps): void {
  app.put('/api/v1/cells/:cellId/bundles/:digest', async (c) => {
    const d = c.req.param('digest')
    parse(digest, d)
    const max = deps.maxBundleBytes ?? 128 * 1024 * 1024
    const bytes = new Uint8Array(await readBody(c, max))
    // Real cells consume the runtime's canonical stored document, whose
    // object key is sha256(canonical manifest) — NOT sha256(document bytes).
    // Keep the legacy raw-body rule as well for test fixtures/clients that
    // only exercise the control plane.
    const legacy = sha256(bytes) === d
    if (!legacy && !verifyRuntimeBundle(d, bytes)) {
      throw new VrtControlError(400, 'Digest does not match the runtime bundle or body')
    }
    await deps.store.registerBundleObject({
      digest: d,
      bytes: bytes.byteLength,
      createdById: 'plane-api',
    })
    await deps.bundleStore.put(bundleKeyFor(d), bytes)
    return c.json({ data: { digest: d, bytes: bytes.byteLength } }, 201)
  })

  app.get('/api/v1/cells/:cellId/bundles/:digest', async (c) => {
    const d = c.req.param('digest')
    parse(digest, d)
    const object = await deps.bundleStore.get(bundleKeyFor(d))
    if (!object) throw new VrtControlError(404, 'Bundle not found')
    const bytes = new Uint8Array(await new Response(object.stream).arrayBuffer())
    return c.body(bytes, 200, { 'Content-Type': 'application/octet-stream' })
  })
}
