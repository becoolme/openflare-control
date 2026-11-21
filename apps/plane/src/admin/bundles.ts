import type { Hono } from 'hono'
import { VrtControlError, bundleKeyFor } from 'openflare-control'
import { type AdminDeps, digest, parse, sha256 } from './context.js'

export function registerBundles(app: Hono, deps: AdminDeps): void {
  app.put('/api/v1/cells/:cellId/bundles/:digest', async (c) => {
    const d = c.req.param('digest')
    parse(digest, d)
    const max = deps.maxBundleBytes ?? 128 * 1024 * 1024
    const declared = Number(c.req.header('content-length') ?? '0')
    if (Number.isFinite(declared) && declared > max) {
      throw new VrtControlError(413, 'Bundle too large')
    }
    const bytes = new Uint8Array(await c.req.arrayBuffer())
    if (bytes.byteLength > max) throw new VrtControlError(413, 'Bundle too large')
    if (sha256(bytes) !== d) throw new VrtControlError(400, 'Digest does not match body')
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
