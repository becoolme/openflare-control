/**
 * At-rest encryption for `plane_secrets.value`. Worker secrets are readable
 * by design (render-inputs hands them to the cell), but a Postgres dump,
 * backup or volume leak must not hand them out in cleartext. AES-256-GCM
 * with a random IV per write; the key is HKDF-derived from
 * PLANE_SECRETS_KEY. It is deliberately independent of the Ed25519 signing
 * secret: rotating the signing key must not make every stored secret
 * unreadable.
 *
 * Stored shape: `enc:v1:<iv_b64>:<tag_b64>:<ct_b64>`. Rows written before
 * this change carry no prefix and decrypt as themselves; the read path
 * re-seals them so upgrading actually encrypts existing values.
 */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto'

const PREFIX = 'enc:v1:'

export interface SecretsCipher {
  encrypt(plaintext: string): string
  /** Rows without the `enc:v1:` prefix are pre-encryption plaintext. */
  decrypt(stored: string): string
  /** True when a stored value already carries the sealed shape. */
  isEncrypted(stored: string): boolean
}

export function createSecretsCipher(secretsKey: string): SecretsCipher {
  if (!secretsKey || secretsKey.length < 16) {
    throw new Error('PLANE_SECRETS_KEY must be at least 16 characters')
  }
  const key = Buffer.from(
    hkdfSync(
      'sha256',
      Buffer.from(secretsKey),
      Buffer.from('openflare-secrets-v1'),
      Buffer.from('aes-256-gcm'),
      32
    )
  )
  return {
    encrypt(plaintext) {
      const iv = randomBytes(12)
      const cipher = createCipheriv('aes-256-gcm', key, iv)
      const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
      return `${PREFIX}${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${body.toString('base64')}`
    },
    isEncrypted(stored) {
      return stored.startsWith(PREFIX)
    },
    decrypt(stored) {
      if (!stored.startsWith(PREFIX)) return stored
      const parts = stored
        .slice(PREFIX.length)
        .split(':')
        .map((part) => Buffer.from(part, 'base64'))
      const [iv, tag, body] = parts
      // Empty ciphertext is legitimate — the GCM of an empty secret is
      // zero bytes; only iv/tag must be present.
      if (parts.length !== 3 || !iv?.length || !tag?.length || body === undefined) {
        throw new Error('malformed enc:v1 secret value')
      }
      const decipher = createDecipheriv('aes-256-gcm', key, iv)
      decipher.setAuthTag(tag)
      return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8')
    },
  }
}
