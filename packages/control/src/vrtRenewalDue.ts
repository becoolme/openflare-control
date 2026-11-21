/**
 * Shared "is this compute.desired publication due for renewal" predicate —
 * used by the renewal job and the RV-R46 publish de-dupe. Kept in its own
 * module so neither caller imports the other (no cycle).
 */

/** A publication is due when less than two-thirds of its TTL remains. */
export function vrtPublicationNeedsRenewal(
  pub: { issuedAt: Date; expiresAt: Date },
  now: Date
): boolean {
  const ttl = pub.expiresAt.getTime() - pub.issuedAt.getTime()
  if (ttl <= 0) return true
  return pub.expiresAt.getTime() - now.getTime() < (ttl * 2) / 3
}
