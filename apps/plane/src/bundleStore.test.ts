import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { bundleKeyFor } from 'openflare-control'
import { DirBundleStore } from './bundleStore.js'

let dir: string
let store: DirBundleStore

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'vrt-bundles-'))
  store = new DirBundleStore(dir)
})
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('filesystem bundle store', () => {
  it('stores by content digest and reads the same bytes back', async () => {
    const body = new TextEncoder().encode('bundle-bytes')
    const digest = createHash('sha256').update(body).digest('hex')
    const key = bundleKeyFor(digest)
    await store.put(key, body)
    const object = await store.get(key)
    expect(object?.bytes).toBe(body.byteLength)
    expect(new Uint8Array(await new Response(object!.stream).arrayBuffer())).toEqual(body)
    expect(await store.has(key)).toBe(true)
  })

  it('rejects a key that does not embed the content digest', async () => {
    const body = new TextEncoder().encode('x')
    await expect(store.put(bundleKeyFor('0'.repeat(64)), body)).rejects.toThrow(/content digest/)
  })

  it('returns null for missing objects and malformed names', async () => {
    expect(await store.get(bundleKeyFor('a'.repeat(64)))).toBeNull()
    expect(await store.get('../../etc/passwd')).toBeNull()
    expect(await store.get('workers/v1/bundles/not-a-digest')).toBeNull()
  })
})
