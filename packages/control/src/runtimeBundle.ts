/**
 * Runtime bundle format (openflare `vrt-config::VersionBundle`).
 *
 * A deployable artifact is NOT the raw worker JS: it is the canonical
 * "stored document" whose object key is the bundle digest =
 * `sha256(canonical manifest)`. The cell fetches the stored document and
 * re-verifies the inner `digest` field. The control plane must upload and
 * reference that digest (not `sha256(stored document)`), so this module
 * mirrors the runtime's build/verify rules for API callers and the bundle
 * upload guard.
 *
 * Canonical JSON: no whitespace, object keys in UTF-16 code-unit order —
 * the same rules as `vrt-config/src/canonical.rs`.
 */
import { createHash } from 'node:crypto'

export type RuntimeModuleType = 'esModule' | 'commonJs' | 'text' | 'json' | 'data' | 'wasm'

export interface RuntimeModule {
  type: RuntimeModuleType
  name: string
  /** Text content for `esModule` / `commonJs` / `text` / `json`. */
  text?: string
  /** Canonical base64 for `data` / `wasm`. */
  dataBase64?: string
}

export interface RuntimeBundleInput {
  mainModule: string
  modules: readonly RuntimeModule[]
  compatibilityDate: string
  compatibilityFlags?: readonly string[]
}

export interface RuntimeBundle {
  /** `sha256(canonical manifest)`, lowercase hex. */
  digest: string
  /** Canonical stored document uploaded under `bundles/<digest>`. */
  bytes: Uint8Array
}

const TEXT_TYPES = new Set<RuntimeModuleType>(['esModule', 'commonJs', 'text', 'json'])
const BINARY_TYPES = new Set<RuntimeModuleType>(['data', 'wasm'])

/** Canonical JSON bytes (UTF-16 key order, no whitespace). */
export function canonicalJson(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('non-finite number')
    return JSON.stringify(value)
  }
  if (typeof value === 'string') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>
    const keys = Object.keys(obj).sort()
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`
  }
  throw new Error('unsupported canonical JSON value')
}

const sha256 = (bytes: Uint8Array | string): string =>
  createHash('sha256').update(bytes).digest('hex')

function moduleContent(module: RuntimeModule): Buffer {
  if (!module || typeof module !== 'object') throw new Error('module must be an object')
  if (!TEXT_TYPES.has(module.type) && !BINARY_TYPES.has(module.type)) {
    throw new Error(`unsupported module type: ${String(module.type)}`)
  }
  if (typeof module.name !== 'string' || !module.name) throw new Error('module name is required')
  if (TEXT_TYPES.has(module.type)) {
    if (typeof module.text !== 'string') throw new Error(`module ${module.name}: text required`)
    if (module.type === 'json') {
      const parsed: unknown = JSON.parse(module.text)
      return Buffer.from(canonicalJson(parsed), 'utf8')
    }
    return Buffer.from(module.text, 'utf8')
  }
  if (typeof module.dataBase64 !== 'string' || !module.dataBase64) {
    throw new Error(`module ${module.name}: dataBase64 required`)
  }
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(module.dataBase64)) {
    throw new Error(`module ${module.name}: invalid base64`)
  }
  return Buffer.from(module.dataBase64, 'base64')
}

/** Build the runtime stored document + manifest digest from source modules. */
export function buildRuntimeBundle(input: RuntimeBundleInput): RuntimeBundle {
  if (!input || typeof input !== 'object') throw new Error('bundle input must be an object')
  if (typeof input.mainModule !== 'string' || !input.mainModule) {
    throw new Error('mainModule is required')
  }
  if (!Array.isArray(input.modules) || input.modules.length === 0) {
    throw new Error('modules must be a non-empty array')
  }
  const compatibilityDate = input.compatibilityDate
  if (typeof compatibilityDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(compatibilityDate)) {
    throw new Error('compatibilityDate must be YYYY-MM-DD')
  }
  const compatibilityFlags = [...(input.compatibilityFlags ?? [])]
  if (compatibilityFlags.some((f) => typeof f !== 'string' || !f)) {
    throw new Error('compatibilityFlags must be strings')
  }
  const modules = [...input.modules].sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0
  )
  const seen = new Set<string>()
  const manifestModules = modules.map((m) => {
    if (seen.has(m.name)) throw new Error(`duplicate module name: ${m.name}`)
    seen.add(m.name)
    return { digest: sha256(moduleContent(m)), name: m.name, type: m.type }
  })
  const manifest = {
    compatibilityDate,
    compatibilityFlags,
    mainModule: input.mainModule,
    modules: manifestModules,
    schemaVersion: 1,
  }
  const digest = sha256(canonicalJson(manifest))
  const stored = {
    compatibilityDate,
    compatibilityFlags,
    digest,
    mainModule: input.mainModule,
    modules: modules.map((m) => {
      if (TEXT_TYPES.has(m.type)) {
        // JSON modules are stored canonically, matching the runtime.
        const text =
          m.type === 'json' ? canonicalJson(JSON.parse(m.text as string)) : (m.text as string)
        return { name: m.name, text, type: m.type }
      }
      return { dataBase64: m.dataBase64, name: m.name, type: m.type }
    }),
    schemaVersion: 1,
  }
  return { digest, bytes: Buffer.from(canonicalJson(stored), 'utf8') }
}

/**
 * Re-derive a stored document and check it is the bundle named by `digest`.
 * Returns false for malformed input (callers map that to a 400).
 */
export function verifyRuntimeBundle(digest: string, bytes: Uint8Array): boolean {
  if (!/^[0-9a-f]{64}$/.test(digest)) return false
  let stored: unknown
  try {
    stored = JSON.parse(Buffer.from(bytes).toString('utf8'))
  } catch {
    return false
  }
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return false
  const doc = stored as Record<string, unknown>
  if (doc.schemaVersion !== 1 || doc.digest !== digest) return false
  if (typeof doc.mainModule !== 'string' || !doc.mainModule) return false
  if (typeof doc.compatibilityDate !== 'string') return false
  if (!Array.isArray(doc.modules) || doc.modules.length === 0) return false
  try {
    const built = buildRuntimeBundle({
      mainModule: doc.mainModule,
      modules: doc.modules as RuntimeModule[],
      compatibilityDate: doc.compatibilityDate,
      compatibilityFlags: (doc.compatibilityFlags as string[] | undefined) ?? [],
    })
    return built.digest === digest
  } catch {
    return false
  }
}
