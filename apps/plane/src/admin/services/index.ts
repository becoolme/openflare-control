import type { Hono } from 'hono'
import { type AdminDeps, rows } from '../context.js'
import { registerD1Service } from './d1.js'
import { registerHyperdriveService } from './hyperdrive.js'
import { registerKvService } from './kv.js'
import { registerQueueService } from './queues.js'
import { registerR2Service } from './r2.js'
import { registerWorkflowService } from './workflows.js'
import { registerVectorizeService } from './vectorize.js'

export function registerServices(app: Hono, deps: AdminDeps): void {
  registerD1Service(app, deps)
  registerR2Service(app, deps)
  registerKvService(app, deps)
  registerHyperdriveService(app, deps)
  registerQueueService(app, deps)
  registerWorkflowService(app, deps)
  registerVectorizeService(app, deps)

  // One catalog for "what does this cell own?" — used by the console/CLI to
  // assemble worker bindings without knowing every resource table.
  app.get('/api/v1/cells/:cellId/services', async (c) => {
    const cell = c.req.param('cellId')
    const [d1, r2, kv, queues, workflows, hyperdrive, vectorize] = await Promise.all([
      rows(deps, 'select * from plane_d1_databases where cluster_id=$1 order by name', [cell]),
      rows(deps, 'select * from plane_r2_buckets where cluster_id=$1 order by bucket_name', [cell]),
      rows(deps, 'select * from plane_kv_namespaces where cluster_id=$1 order by title', [cell]),
      rows(deps, 'select * from plane_queues where cluster_id=$1 order by name', [cell]),
      rows(deps, 'select * from plane_workflows where cluster_id=$1 order by name', [cell]),
      rows(deps, 'select * from plane_hyperdrives where cluster_id=$1 order by name', [cell]),
      rows(deps, 'select * from plane_vectorize_indexes where cluster_id=$1 order by name', [cell]),
    ])
    return c.json({
      data: {
        d1: d1.map((r) => ({
          databaseId: r.database_id,
          teamId: r.team_id,
          name: r.name,
          binding: {
            type: 'D1',
            resourceId: r.database_id,
            permissionRead: true,
            permissionWrite: true,
          },
        })),
        r2: r2.map((r) => ({
          bucketName: r.bucket_name,
          bucketId: r.bucket_id,
          teamId: r.team_id,
          binding: {
            type: 'R2',
            resourceId: r.bucket_name,
            permissionRead: true,
            permissionWrite: true,
          },
        })),
        kv: kv.map((r) => ({
          namespaceId: r.namespace_id,
          title: r.title,
          teamId: r.team_id,
          binding: {
            type: 'KV',
            resourceId: r.namespace_id,
            permissionRead: true,
            permissionWrite: true,
          },
        })),
        queues: queues.map((r) => ({
          queueId: r.queue_id,
          name: r.name,
          teamId: r.team_id,
          deliveryDelaySeconds: r.delivery_delay_seconds,
          binding: {
            type: 'QUEUE',
            resourceId: r.queue_id,
            permissionRead: true,
            permissionWrite: true,
            ...(r.delivery_delay_seconds == null
              ? {}
              : { deliveryDelaySeconds: r.delivery_delay_seconds }),
          },
        })),
        workflows: workflows.map((r) => ({
          workflowId: r.workflow_id,
          workerId: r.worker_id,
          name: r.name,
          className: r.class_name,
          teamId: r.team_id,
        })),
        vectorize: vectorize.map((r) => ({
          indexId: r.index_id,
          teamId: r.team_id,
          name: r.name,
          dimensions: Number(r.dimensions),
          metric: r.metric,
          binding: {
            type: 'VECTORIZE',
            resourceId: r.index_id,
            indexName: r.name,
            dimensions: Number(r.dimensions),
            metric: r.metric,
            permissionRead: true,
            permissionWrite: true,
          },
        })),
        hyperdrive: hyperdrive.map((r) => ({
          hyperdriveId: r.hyperdrive_id,
          teamId: r.team_id,
          name: r.name,
          origin: r.origin,
          caching: r.caching,
          binding: {
            type: 'HYPERDRIVE',
            resourceId: `vrtdb:${r.hyperdrive_id}`,
            permissionRead: true,
            permissionWrite: true,
          },
        })),
      },
    })
  })
}
