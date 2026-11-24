import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DirAssetStore, MemoryAssetStore } from './assetStore.js'

const sha = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('DirAssetStore', () => {
  it('round-trips content-addressed manifests and objects', async () => {
    const root = await mkdtemp(join(tmpdir(), 'plane-assets-'))
    tempDirs.push(root)
    const store = new DirAssetStore(root)
    const object = new TextEncoder().encode('hello')
    const objectDigest = sha(object)
    await store.putObject('team/one', objectDigest, object)
    expect(await store.hasObject('team/one', objectDigest)).toBe(true)
    expect(await store.statObject('team/one', objectDigest)).toBe(object.byteLength)
    expect(Buffer.from((await store.getObject('team/one', objectDigest))!)).toEqual(
      Buffer.from(object)
    )

    const manifest = new TextEncoder().encode('{"schemaVersion":1,"files":[]}')
    const manifestDigest = sha(manifest)
    await store.putManifest('team/one', manifestDigest, manifest)
    expect(await store.hasManifest('team/one', manifestDigest)).toBe(true)
    expect(Buffer.from((await store.getManifest('team/one', manifestDigest))!)).toEqual(
      Buffer.from(manifest)
    )
    await store.deleteManifest('team/one', manifestDigest)
    expect(await store.hasManifest('team/one', manifestDigest)).toBe(false)
    expect(await store.getManifest('team/one', manifestDigest)).toBeNull()
    expect(await store.getObject('team/one', 'f'.repeat(64))).toBeNull()
    expect(await store.statObject('team/one', 'f'.repeat(64))).toBeNull()
  })

  it('rejects digest mismatches', async () => {
    const store = new DirAssetStore('/tmp/plane-assets-unused')
    await expect(store.putObject('t', 'a'.repeat(64), new Uint8Array([1]))).rejects.toThrow(
      /digest mismatch/
    )
    await expect(store.putManifest('t', 'a'.repeat(64), new Uint8Array([1]))).rejects.toThrow(
      /digest mismatch/
    )
  })
})

describe('MemoryAssetStore', () => {
  it('mirrors the store contract', async () => {
    const store = new MemoryAssetStore()
    const bytes = new Uint8Array([1, 2, 3])
    const digest = sha(bytes)
    await store.putObject('t', digest, bytes)
    await store.putManifest('t', digest, bytes)
    expect(await store.hasObject('t', digest)).toBe(true)
    expect(await store.hasManifest('t', digest)).toBe(true)
    expect(await store.statObject('t', digest)).toBe(3)
    expect(await store.getObject('t', digest)).toEqual(bytes)
    await store.deleteManifest('t', digest)
    expect(await store.hasManifest('t', digest)).toBe(false)
  })
})
