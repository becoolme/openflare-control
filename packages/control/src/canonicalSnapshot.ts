/**
 * Canonical JSON v2 — byte-identical to the snapshot-protocol crate's
 * `StrictValue::canonical`. Portable: both the vibeploy control plane and
 * the OSS plane sign the same bytes.
 *
 * Strings use JSON escaping after rejecting unpaired UTF-16 surrogates;
 * object keys sort by UTF-16 code units; numbers are safe integers only
 * and -0 encodes as 0.
 */
const hasUnpairedSurrogate = (value: string): boolean => {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true
      index += 1
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true
    }
  }
  return false
}

const compareUtf16 = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0

const canonicalV2Inner = (value: unknown, depth: number): string => {
  if (depth > 128) throw new Error('Unsupported canonical JSON value')
  if (value === null) return 'null'
  if (typeof value === 'string') {
    if (hasUnpairedSurrogate(value)) throw new Error('Unsupported canonical JSON value')
    return JSON.stringify(value)
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new Error('Unsupported canonical JSON value')
    return Object.is(value, -0) ? '0' : value.toString(10)
  }
  if (typeof value !== 'object' || value === null) {
    throw new Error('Unsupported canonical JSON value')
  }

  if (Array.isArray(value)) {
    if (
      Object.getPrototypeOf(value) !== Array.prototype ||
      Object.getOwnPropertySymbols(value).length
    )
      throw new Error('Unsupported canonical JSON value')
    const ownKeys = Reflect.ownKeys(value)
    if (ownKeys.length !== value.length + 1 || ownKeys.at(-1) !== 'length')
      throw new Error('Unsupported canonical JSON value')
    const values: string[] = []
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
      if (!descriptor || !descriptor.enumerable || !('value' in descriptor))
        throw new Error('Unsupported canonical JSON value')
      values.push(canonicalV2Inner(descriptor.value, depth + 1))
    }
    return `[${values.join(',')}]`
  }

  const prototype = Object.getPrototypeOf(value)
  if (
    (prototype !== Object.prototype && prototype !== null) ||
    Object.getOwnPropertySymbols(value).length
  )
    throw new Error('Unsupported canonical JSON value')
  const ownKeys = Reflect.ownKeys(value)
  if (!ownKeys.every((key) => typeof key === 'string'))
    throw new Error('Unsupported canonical JSON value')
  const entries = (ownKeys as string[]).map((key) => {
    if (key === '__proto__' || hasUnpairedSurrogate(key))
      throw new Error('Unsupported canonical JSON value')
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor))
      throw new Error('Unsupported canonical JSON value')
    return [key, descriptor.value] as const
  })
  entries.sort(([left], [right]) => compareUtf16(left, right))
  return `{${entries
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalV2Inner(item, depth + 1)}`)
    .join(',')}}`
}

/** Canonical JSON v2. Strings use JSON.stringify's JSON escaping after rejecting unpaired UTF-16 surrogates; object keys sort by UTF-16 code units. Numbers are safe integers only and -0 encodes as 0. */
export function canonicalControlPlaneSnapshotV2(value: unknown): string {
  return canonicalV2Inner(value, 0)
}
