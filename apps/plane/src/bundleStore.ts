/** Filesystem BundleStore for the reference plane (`PLANE_BUNDLE_DIR`). */
import { createHash } from 'node:crypto'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { BundleStore } from 'openflare-control'

export class DirBundleStore implements BundleStore {
  constructor(private readonly dir: string) {}

  async put(key: string, body: Uint8Array): Promise<{ key: string; sha256: string }> {
    const sha256 = createHash('sha256').update(body).digest('hex')
    if (!key.endsWith(sha256)) throw new Error('bundle key must embed the content digest')
    await mkdir(this.dir, { recursive: true })
    await writeFile(join(this.dir, sha256), body)
    return { key, sha256 }
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
