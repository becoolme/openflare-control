import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
  it('stores by the bundle key digest and reads the same bytes back', async () => {
    const body = new TextEncoder().encode('stored-document-bytes')
    const digest = '1'.repeat(64) // bundle digest, deliberately not sha256(body)
    const key = bundleKeyFor(digest)
    await store.put(key, body)
    const object = await store.get(key)
    expect(object?.bytes).toBe(body.byteLength)
    expect(new Uint8Array(await new Response(object!.stream).arrayBuffer())).toEqual(body)
    expect(await store.has(key)).toBe(true)
  })

  it('rejects a key without a 64-hex digest segment', async () => {
    const body = new TextEncoder().encode('x')
    await expect(store.put('workers/v1/bundles/not-a-digest', body)).rejects.toThrow(/64-hex/)
  })

  it('returns null for missing objects and malformed names', async () => {
    expect(await store.get(bundleKeyFor('a'.repeat(64)))).toBeNull()
    expect(await store.get('../../etc/passwd')).toBeNull()
    expect(await store.get('workers/v1/bundles/not-a-digest')).toBeNull()
  })

  it('leaves only the digest file — no partial writes at the content address', async () => {
    const digest = '2'.repeat(64)
    await store.put(bundleKeyFor(digest), new TextEncoder().encode('v1'))
    await store.put(bundleKeyFor(digest), new TextEncoder().encode('v2'))
    // tmp+rename: the directory holds only finished, digest-named objects —
    // never a stranded .tmp — and a repeat put replaces it atomically.
    const files = readdirSync(dir)
    expect(files).toContain(digest)
    expect(files.every((f) => /^[0-9a-f]{64}$/.test(f))).toBe(true)
    const object = await store.get(bundleKeyFor(digest))
    expect(new Uint8Array(await new Response(object!.stream).arrayBuffer())).toEqual(
      new TextEncoder().encode('v2')
    )
  })
})
