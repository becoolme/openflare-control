/** Filesystem BundleStore for the reference plane (`PLANE_BUNDLE_DIR`). */
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { BundleStore } from 'openflare-control'

export class DirBundleStore implements BundleStore {
  constructor(private readonly dir: string) {}

  async put(key: string, body: Uint8Array): Promise<{ key: string; sha256: string }> {
    // The key segment is the BUNDLE digest (sha256 of the canonical runtime
    // manifest for real artifacts), not necessarily sha256(body): the stored
    // document carries the manifest digest inside it. The route verifies the
    // body; this store only owns the content-addressed file.
    const digest = key.split('/').pop() ?? ''
    if (!/^[0-9a-f]{64}$/.test(digest)) throw new Error('bundle key must end in a 64-hex digest')
    await mkdir(this.dir, { recursive: true })
    await writeFile(join(this.dir, digest), body)
    return { key, sha256: digest }
  }

  async get(key: string) {
    const name = key.split('/').pop() ?? ''
    if (!/^[0-9a-f]{64}$/.test(name)) return null
    try {
      const body = await readFile(join(this.dir, name))
      return {
        stream: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(body)
            controller.close()
          },
        }),
        bytes: body.byteLength,
      }
    } catch {
      return null
    }
  }

  async has(key: string): Promise<boolean> {
    const name = key.split('/').pop() ?? ''
    if (!/^[0-9a-f]{64}$/.test(name)) return false
    try {
      return (await stat(join(this.dir, name))).isFile()
    } catch {
      return false
    }
  }
}
