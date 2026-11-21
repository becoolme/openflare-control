/**
 * Bounds the runtime enforces on workflow declarations — shared by the
 * control plane's validator and compute.desired so both reject the same
 * shapes.
 */
export const MAX_WORKFLOWS_PER_WORKER = 32
export const MAX_WORKFLOW_STEPS = 100_000
/** Rust `valid_workflow_name`: ASCII alnum + -_ , 1..=64. */
export const WORKFLOW_NAME_RE = /^[A-Za-z0-9_-]{1,64}$/
/** Rust `valid_binding_name` — the snapshot validator applies it to BOTH
 * workflow `binding` and `class_name` (unlike DO class names which allow
 * 128). JS identifier, <=64. */
export const WORKFLOW_IDENT_RE = /^[A-Za-z_$][A-Za-z0-9_$]{0,63}$/
