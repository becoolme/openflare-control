/** Content-addressed asset store for the reference plane. Layout matches
 * openflare `vrt-provider` (`<root>/<segment(team)>/{manifests,objects}`), so
 * the cell can read the same directory/S3 mount. */
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export interface AssetStore {
  putManifest(teamId: string, digest: string, bytes: Uint8Array): Promise<void>
  hasManifest(teamId: string, digest: string): Promise<boolean>
  putObject(teamId: string, digest: string, bytes: Uint8Array): Promise<void>
  hasObject(teamId: string, digest: string): Promise<boolean>
  getManifest(teamId: string, digest: string): Promise<Uint8Array | null>
  getObject(teamId: string, digest: string): Promise<Uint8Array | null>
  statObject(teamId: string, digest: string): Promise<number | null>
  deleteManifest(teamId: string, digest: string): Promise<void>
  deleteObject(teamId: string, digest: string): Promise<void>
}

const segmentEncode = (value: string): string => {
  let out = ''
  for (const byte of Buffer.from(value, 'utf8')) {
    if (
      (byte >= 0x41 && byte <= 0x5a) ||
      (byte >= 0x61 && byte <= 0x7a) ||
      (byte >= 0x30 && byte <= 0x39) ||
      byte === 0x5f ||
      byte === 0x2d
    ) {
      out += String.fromCharCode(byte)
    } else {
      out += `%${byte.toString(16).toUpperCase().padStart(2, '0')}`
    }
  }
  return out
}

const hex = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
const assertDigest = (digest: string): void => {
  if (!/^[0-9a-f]{64}$/.test(digest)) throw new Error('asset digest must be 64 lowercase hex')
}

export class DirAssetStore implements AssetStore {
  constructor(private readonly root: string) {}

  private dir(teamId: string, kind: 'manifests' | 'objects'): string {
    return join(this.root, segmentEncode(teamId), kind)
  }

  private async write(path: string, bytes: Uint8Array): Promise<void> {
    await mkdir(join(path, '..'), { recursive: true, mode: 0o700 })
    const tmp = `${path}.${randomUUID()}.tmp`
    await writeFile(tmp, bytes, { mode: 0o600 })
    await rename(tmp, path)
  }

  async putManifest(teamId: string, digest: string, bytes: Uint8Array): Promise<void> {
    assertDigest(digest)
    if (hex(bytes) !== digest) throw new Error('manifest digest mismatch')
    await this.write(join(this.dir(teamId, 'manifests'), `${digest}.json`), bytes)
  }

  async hasManifest(teamId: string, digest: string): Promise<boolean> {
    assertDigest(digest)
    try {
      return (await stat(join(this.dir(teamId, 'manifests'), `${digest}.json`))).isFile()
    } catch {
      return false
    }
  }

  async putObject(teamId: string, digest: string, bytes: Uint8Array): Promise<void> {
    assertDigest(digest)
    if (hex(bytes) !== digest) throw new Error('object digest mismatch')
    await this.write(join(this.dir(teamId, 'objects'), digest), bytes)
  }

  async hasObject(teamId: string, digest: string): Promise<boolean> {
    assertDigest(digest)
    try {
      return (await stat(join(this.dir(teamId, 'objects'), digest))).isFile()
    } catch {
      return false
    }
  }

  async getManifest(teamId: string, digest: string): Promise<Uint8Array | null> {
    assertDigest(digest)
    try {
      return new Uint8Array(await readFile(join(this.dir(teamId, 'manifests'), `${digest}.json`)))
    } catch {
      return null
    }
  }

  async getObject(teamId: string, digest: string): Promise<Uint8Array | null> {
    assertDigest(digest)
    try {
      return new Uint8Array(await readFile(join(this.dir(teamId, 'objects'), digest)))
    } catch {
      return null
    }
  }

  async statObject(teamId: string, digest: string): Promise<number | null> {
    assertDigest(digest)
    try {
      const info = await stat(join(this.dir(teamId, 'objects'), digest))
      return info.isFile() ? info.size : null
    } catch {
      return null
    }
  }

  async deleteManifest(teamId: string, digest: string): Promise<void> {
    assertDigest(digest)
    try {
      await rm(join(this.dir(teamId, 'manifests'), `${digest}.json`), { force: true })
    } catch {
      // best effort
    }
  }

  async deleteObject(teamId: string, digest: string): Promise<void> {
    assertDigest(digest)
    try {
      await rm(join(this.dir(teamId, 'objects'), digest), { force: true })
    } catch {
      // best effort
    }
  }
}

/** Test-only in-memory store. */
export class MemoryAssetStore implements AssetStore {
  readonly manifests = new Map<string, Uint8Array>()
  readonly objects = new Map<string, Uint8Array>()
  private key(teamId: string, digest: string): string {
    return `${teamId}:${digest}`
  }
  async putManifest(teamId: string, digest: string, bytes: Uint8Array): Promise<void> {
    assertDigest(digest)
    if (hex(bytes) !== digest) throw new Error('manifest digest mismatch')
    this.manifests.set(this.key(teamId, digest), bytes)
  }
  async hasManifest(teamId: string, digest: string): Promise<boolean> {
    assertDigest(digest)
    return this.manifests.has(this.key(teamId, digest))
  }
  async putObject(teamId: string, digest: string, bytes: Uint8Array): Promise<void> {
    assertDigest(digest)
    if (hex(bytes) !== digest) throw new Error('object digest mismatch')
    this.objects.set(this.key(teamId, digest), bytes)
  }
  async hasObject(teamId: string, digest: string): Promise<boolean> {
    assertDigest(digest)
    return this.objects.has(this.key(teamId, digest))
  }
  async getManifest(teamId: string, digest: string): Promise<Uint8Array | null> {
    assertDigest(digest)
    return this.manifests.get(this.key(teamId, digest)) ?? null
  }
  async getObject(teamId: string, digest: string): Promise<Uint8Array | null> {
    assertDigest(digest)
    return this.objects.get(this.key(teamId, digest)) ?? null
  }
  async statObject(teamId: string, digest: string): Promise<number | null> {
    assertDigest(digest)
    const bytes = this.objects.get(this.key(teamId, digest))
    return bytes ? bytes.byteLength : null
  }
  async deleteManifest(teamId: string, digest: string): Promise<void> {
    assertDigest(digest)
    this.manifests.delete(this.key(teamId, digest))
  }
  async deleteObject(teamId: string, digest: string): Promise<void> {
    assertDigest(digest)
    this.objects.delete(this.key(teamId, digest))
  }
}
