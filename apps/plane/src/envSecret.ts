import { readFileSync } from 'node:fs'

/**
 * M9: resolve a secret from `<NAME>_FILE` when set (Docker Compose secrets /
 * systemd credentials), else from `<NAME>`. The file form keeps the value out
 * of `docker inspect` and `/proc/1/environ`. An empty/unreadable file fails
 * closed instead of silently falling back to the environment.
 */
export function envSecret(name: string): string | undefined {
  const file = process.env[`${name}_FILE`]
  if (file !== undefined && file !== '') {
    let raw: string
    try {
      raw = readFileSync(file, 'utf8')
    } catch {
      throw new Error(`${name}_FILE is unreadable: ${file}`)
    }
    const value = raw.trim()
    if (!value) throw new Error(`${name}_FILE is empty`)
    return value
  }
  const value = process.env[name]
  return value === undefined || value === '' ? undefined : value
}

/** `envSecret` that throws when the value is absent (required credential). */
export function requireEnvSecret(name: string): string {
  const value = envSecret(name)
  if (!value) throw new Error(`${name} is required`)
  return value
}
