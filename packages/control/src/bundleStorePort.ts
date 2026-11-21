/**
 * BundleStore port — content-addressed object storage for VRT version
 * bundles and asset objects.
 *
 * Portable: implementations live on the consumer side (S3 on the
 * vibeploy side, filesystem/S3 on the OSS plane side). The key is derived
 * from the content digest, so `put` is naturally idempotent; the host
 * re-verifies content before use and fails closed at the edge.
 */

/** Object key prefix for VRT bundles — the full key is
 * `bundleKeyFor(digest)`; only this route family may read by key. */
export const VRT_BUNDLE_KEY_PREFIX = 'workers/v1/bundles/'

/** Bundle object key for a manifest digest (strict 64-hex caller). */
export function bundleKeyFor(digest: string): string {
  return `${VRT_BUNDLE_KEY_PREFIX}${digest}`
}

/** Streamed bundle object returned by `BundleStore.get`. */
export interface BundleStoreObject {
  /** Byte stream of the stored document (caller enforces the size cap). */
  readonly stream: ReadableStream<Uint8Array>
  /** Declared length when the backend reports one (pre-check signal). */
  readonly bytes: number | null
}

export interface BundleListPage {
  objects: { key: string; lastModified: Date | null; bytes: number }[]
  /** Last object key in this page — feed back as the next `startAfter`. */
  nextStartAfter: string | null
  reachedEnd: boolean
}

export interface BundleStore {
  /** Store `body` under `key`. Returns the object's sha256 (which MUST equal
   * the digest embedded in `key` — callers pass content-derived keys). */
  put(key: string, body: Uint8Array): Promise<{ key: string; sha256: string }>
  /** T15/B2: read the object under `key`, streamed. `null` = absent.
   * Authorized callers only (the cell bundle route) — see
   * bundleReadGuard.test.ts for the access invariant. */
  get(key: string): Promise<BundleStoreObject | null>
  /** T22/G6: cheap existence probe (S3 HEAD / in-memory map). Optional —
   * a backend without it returns `undefined` and callers must put. */
  has?(key: string): Promise<boolean>
  /** T22/G5: remove an object (asset GC). Optional — backends without
   * delete keep orphan bytes (registry row removal is still logged).
   * `opts.signal` is honored end-to-end (GC1-r2: the GC's abort reaches
   * the SDK request itself — a timed-out delete must stop in flight,
   * not land late). Callers await the promise to a REAL settle, never
   * race past it while holding the registry row lock. */
  delete?(key: string, opts?: { signal?: AbortSignal }): Promise<void>
  /** GC1: one bounded page of objects under `prefix` for legacy-orphan
   * adoption — never a full-bucket scan contract. `cursor` is opaque
   * (backend-defined); `limit` bounds the page. Optional: a backend
   * without it makes the GC skip adoption (`adoptionSupported: false`)
   * and GC still works from the registry alone.
   *
   * `startAfter` is a plain object key (StartAfter semantics,
   * lexicographic) — persistable across runs unlike an opaque
   * continuation token. `reachedEnd` = no more keys under the prefix. */
  list?(prefix: string, startAfter: string | null, limit: number): Promise<BundleListPage>
}
