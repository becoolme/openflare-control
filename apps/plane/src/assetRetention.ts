/** GC for uploaded asset manifests/objects. A row is live while any retained
 * publication references its manifest; objects are live while any remaining
 * manifest lists them. Both wait for the retention window. */
import type { Pool } from 'pg'
import type { AssetStore } from './assetStore.js'

export interface AssetRetentionReport {
  manifestsDeleted: number
  objectsDeleted: number
}

const BATCH = 500

async function referencedManifests(pool: Pool): Promise<Set<string>> {
  const { rows } = await pool.query(
    `select distinct binding->>'manifestDigest' as digest
       from plane_publications p,
            jsonb_array_elements(
              case when jsonb_typeof(p.envelope->'payload'->'tenants')='array'
                then p.envelope->'payload'->'tenants' else '[]'::jsonb end
            ) tenant,
            jsonb_array_elements(
              case when jsonb_typeof(tenant->'workers')='array'
                then tenant->'workers' else '[]'::jsonb end
            ) worker,
            jsonb_array_elements(
              case when jsonb_typeof(worker->'bindings')='array'
                then worker->'bindings' else '[]'::jsonb end
            ) binding
      where binding->>'type'='assets' and binding->>'manifestDigest' is not null`
  )
  return new Set((rows as { digest?: string }[]).flatMap((row) => (row.digest ? [row.digest] : [])))
}

async function referencedObjects(pool: Pool): Promise<Set<string>> {
  const { rows } = await pool.query(
    `select distinct object->>'digest' as digest
       from plane_asset_manifests m,
            jsonb_array_elements(
              case when jsonb_typeof(m.objects)='array' then m.objects else '[]'::jsonb end
            ) object
      where object->>'digest' is not null`
  )
  return new Set((rows as { digest?: string }[]).flatMap((row) => (row.digest ? [row.digest] : [])))
}

export async function pruneAssets(
  pool: Pool,
  assets: AssetStore,
  retentionDays: number
): Promise<AssetRetentionReport> {
  if (retentionDays <= 0) return { manifestsDeleted: 0, objectsDeleted: 0 }
  const liveManifests = await referencedManifests(pool)
  let manifestsDeleted = 0
  for (;;) {
    const { rows } = await pool.query(
      `select team_id, digest, objects from plane_asset_manifests
        where created_at < now() - ($1::int * interval '1 day')
        order by created_at limit $2`,
      [retentionDays, BATCH]
    )
    const expired = (rows as { team_id: string; digest: string; objects: unknown }[]).filter(
      (row) => !liveManifests.has(row.digest)
    )
    if (expired.length === 0) break
    for (const row of expired) {
      // A corrupt stored digest can't name a file — drop only the row, and
      // never let assertDigest abort the whole sweep.
      if (/^[0-9a-f]{64}$/.test(row.digest)) {
        await assets.deleteManifest(row.team_id, row.digest)
      }
      await pool.query('delete from plane_asset_manifests where team_id=$1 and digest=$2', [
        row.team_id,
        row.digest,
      ])
      manifestsDeleted++
    }
    if (rows.length < BATCH) break
  }

  const liveObjects = await referencedObjects(pool)
  let objectsDeleted = 0
  for (;;) {
    const { rows } = await pool.query(
      `select team_id, digest from plane_asset_objects
        where created_at < now() - ($1::int * interval '1 day')
        order by created_at limit $2`,
      [retentionDays, BATCH]
    )
    const expired = (rows as { team_id: string; digest: string }[]).filter(
      (row) => !liveObjects.has(row.digest)
    )
    if (expired.length === 0) break
    for (const row of expired) {
      if (/^[0-9a-f]{64}$/.test(row.digest)) {
        await assets.deleteObject(row.team_id, row.digest)
      }
      await pool.query('delete from plane_asset_objects where team_id=$1 and digest=$2', [
        row.team_id,
        row.digest,
      ])
      objectsDeleted++
    }
    if (rows.length < BATCH) break
  }
  return { manifestsDeleted, objectsDeleted }
}
