/**
 * Worker binding-name schema — the runtime-neutral write-path rule for
 * var keys, secret names and binding names (RV-R2 #1). Anything written
 * through a route is guaranteed to satisfy the runtime's deploy-time
 * name re-check instead of failing every later deploy.
 *
 * Lives under lib/ rather than inside one runtime's validation module so
 * shared route files never import a runtime-specific symbol (RV-R8 #0).
 */
import { z } from 'zod'

/** Max characters in a binding name — mirrors the snapshot protocol bound. */
export const WORKER_BINDING_NAME_MAX_LEN = 64

export const workerBindingNameSchema = z
  .string()
  .min(1)
  .max(WORKER_BINDING_NAME_MAX_LEN)
  .regex(/^[A-Za-z_$][A-Za-z0-9_$]*$/, 'must be a valid JS identifier')

/**
 * DO class name bound (RV-R69 #1). A DO class is wired into the signed
 * snapshot as a JS identifier through the same Rust `valid_binding_name`
 * (<= 64) as binding names, so no TS entry point may accept more: a
 * 65-128 char name would be signed and then rejected by the cell.
 * Single shared constant/schema for project-config, deploy request, DO
 * validators and the compute-desired builder.
 */
export const WORKER_DO_CLASS_NAME_MAX_LEN = WORKER_BINDING_NAME_MAX_LEN

export const workerDoClassNameSchema = z
  .string()
  .min(1)
  .max(WORKER_DO_CLASS_NAME_MAX_LEN)
  .regex(/^[A-Za-z_$][A-Za-z0-9_$]*$/, 'JS class declaration name')
