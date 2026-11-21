/**
 * Ed25519 signing context for the reference plane. The seed is derived from
 * PLANE_SIGNING_SECRET with HKDF (different salt than vibeploy's control
 * plane, so the two trust roots never collide). The public key is printed at
 * startup and must be pasted into each component's `trustedKeys`.
 */
import { createHash, createPrivateKey, createPublicKey, hkdfSync } from 'node:crypto'
import type { SnapshotSigningContext } from 'openflare-control'

export function resolvePlaneSigningKey(
  secret = process.env.PLANE_SIGNING_SECRET
): SnapshotSigningContext {
  if (!secret || secret.length < 16) {
    throw new Error('PLANE_SIGNING_SECRET must be at least 16 characters')
  }
  const seed = Buffer.from(
    hkdfSync(
      'sha256',
      Buffer.from(secret),
      Buffer.from('openflare-control-v1'),
      Buffer.from('ed25519'),
      32
    )
  )
  try {
    const privateKey = createPrivateKey({
      key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]),
      format: 'der',
      type: 'pkcs8',
    })
    const publicKey = createPublicKey(privateKey)
      .export({ format: 'der', type: 'spki' })
      .toString('base64')
    const keyId = createHash('sha256').update(publicKey).digest('hex').slice(0, 24)
    return { keyId, publicKey, privateKey }
  } finally {
    seed.fill(0)
  }
}
