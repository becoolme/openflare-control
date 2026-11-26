import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { envSecret, requireEnvSecret } from './envSecret.js'

const dirs: string[] = []
const tempFile = (body: string): string => {
  const dir = mkdtempSync(join(tmpdir(), 'env-secret-'))
  dirs.push(dir)
  const path = join(dir, 'secret')
  writeFileSync(path, body)
  return path
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  delete process.env.TEST_SECRET
  delete process.env.TEST_SECRET_FILE
})

describe('envSecret (M9)', () => {
  it('reads <NAME>_FILE and trims it, taking precedence over the env', () => {
    process.env.TEST_SECRET = 'from-env'
    process.env.TEST_SECRET_FILE = tempFile('  from-file\n')
    expect(envSecret('TEST_SECRET')).toBe('from-file')
  })

  it('falls back to the environment when no file is configured', () => {
    process.env.TEST_SECRET = 'from-env'
    expect(envSecret('TEST_SECRET')).toBe('from-env')
  })

  it('returns undefined when neither is set', () => {
    expect(envSecret('TEST_SECRET')).toBeUndefined()
  })

  it('fails closed on an empty file', () => {
    process.env.TEST_SECRET = 'from-env'
    process.env.TEST_SECRET_FILE = tempFile('   \n')
    expect(() => envSecret('TEST_SECRET')).toThrow(/TEST_SECRET_FILE is empty/)
  })

  it('fails closed on an unreadable file', () => {
    process.env.TEST_SECRET_FILE = join(tmpdir(), 'definitely-missing-secret-file')
    expect(() => envSecret('TEST_SECRET')).toThrow(/unreadable/)
  })

  it('requireEnvSecret throws when absent', () => {
    expect(() => requireEnvSecret('TEST_SECRET')).toThrow(/TEST_SECRET is required/)
    process.env.TEST_SECRET = 'present'
    expect(requireEnvSecret('TEST_SECRET')).toBe('present')
  })
})
