/**
 * At-rest encryption for `plane_secrets.value`. Worker secrets are readable
 * by design (render-inputs hands them to the cell), but a Postgres dump,
 * backup or volume leak must not hand them out in cleartext. AES-256-GCM
 * with a random IV per write; the key is HKDF-derived from
 * PLANE_SIGNING_SECRET under a domain salt distinct from the signing key,
 * so no separate key management is needed and the two uses never collide.
 *
 * Stored shape: `enc:v1:<iv_b64>:<tag_b64>:<ct_b64>`. Rows written before
 * this change carry no prefix and decrypt as themselves — a lazy migration;
 * each value is re-sealed the next time it is written.
 */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto'

const PREFIX = 'enc:v1:'

export interface SecretsCipher {
  encrypt(plaintext: string): string
  /** Rows without the `enc:v1:` prefix are pre-encryption plaintext. */
  decrypt(stored: string): string
}

export function createSecretsCipher(signingSecret: string): SecretsCipher {
  const key = Buffer.from(
    hkdfSync(
      'sha256',
      Buffer.from(signingSecret),
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
