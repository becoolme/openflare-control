#!/usr/bin/env node
/**
 * Renders a kustomize overlay and fails if any placeholder or unsafe
 * posture survives — the gate ops run before `kubectl apply`.
 *
 * Usage: node scripts/vrt-k8s-check.mjs [--help] [--template] [overlay-dir]
 * Requires `kubectl kustomize` (or `kustomize build`).
 *
 * RV-R83 image rules (every container AND initContainer `image:`):
 *   - deployable overlay (default): each image must end in
 *     `@sha256:<64 lowercase hex>`; any REPLACE_ME / VRT_IMAGE_TAG /
 *     `:latest` survivor fails. `newTag: <sha>` renders `name:<sha>` and
 *     is therefore rejected — tags are mutable, digests are not.
 *   - template overlay (`--template`, e.g. overlays/internal-test and
 *     overlays/example, which carry placeholders for operators): must
 *     STILL contain at least one REPLACE_ME, and each image must be
 *     `@sha256:` + (64 hex | the literal REPLACE_ME_DIGEST). A tag-only
 *     image fails even in a template.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

// RV-R67: the YAML parser is the server workspace's pinned `yaml` dep
// (the repo root has no node_modules/yaml). Failing to load it throws —
// the gate never silently degrades to text matching.
const repoRequire = createRequire(new URL('../package.json', import.meta.url))
const { parseAllDocuments } = repoRequire('yaml')
const { parse: parseToml } = repoRequire('smol-toml')

export const USAGE = `Usage: node scripts/vrt-k8s-check.mjs [--help] [--template] [overlay-dir]

Renders a kustomize overlay (default: server/tools/workers-runtime/
deploy/k8s/overlays/internal-test) and fails if any REPLACE_ME
placeholder, floating :latest tag, non-digest image reference
(must be name@sha256:<64 hex>), plaintext credential, or internal
port reference survives. --template validates a placeholder-carrying
template overlay instead: placeholders must remain, image digests may
be the REPLACE_ME_DIGEST literal, tags are still rejected.
Requires 'kubectl kustomize' or 'kustomize' on PATH.`

const DEFAULT_OVERLAY = 'deploy/k8s/overlays/example'
const EXEC_OPTS = { encoding: 'utf8', timeout: 30_000 }

/// Render the overlay. Falls back from `kubectl kustomize` to
/// `kustomize build` ONLY when kubectl itself is missing (ENOENT) —
/// a render failure in kubectl is reported, not masked by the fallback.
/// Throws Error('tool-missing') when neither binary exists, or an
/// Error carrying the renderer's stderr first line otherwise.
export function renderOverlay(dir, exec = execFileSync) {
  try {
    return exec('kubectl', ['kustomize', dir], EXEC_OPTS)
  } catch (e) {
    if (e?.code !== 'ENOENT') throw renderError(e)
    try {
      return exec('kustomize', ['build', dir], EXEC_OPTS)
    } catch (e2) {
      if (e2?.code === 'ENOENT') {
        throw new Error(
          'tool-missing: needs `kubectl` (for `kubectl kustomize`) or the `kustomize` binary on PATH'
        )
      }
      throw renderError(e2)
    }
  }
}

function renderError(e) {
  const detail = String(e?.stderr ?? e?.message ?? 'render failed')
    .split('\n')
    .find((l) => l.trim())
  const err = new Error(`kustomize render failed: ${detail ?? 'unknown error'}`)
  err.cause = undefined
  return err
}

const IMAGE_LINE = /^\s*(?:-\s+)?image:\s*["']?([^"'\s#]+)/gm
const DIGEST_REF = /@sha256:[0-9a-f]{64}$/
const TEMPLATE_DIGEST_REF = /@sha256:(?:[0-9a-f]{64}|REPLACE_ME_DIGEST)$/

const docsOf = (rendered) => rendered.split(/^---\s*$/m)
const docKind = (d) => /^kind:\s*(\S+)/m.exec(d)?.[1]
const docName = (d) =>
  /^metadata:\s*\n(?:[ ]{2}\S.*\n)*?[ ]{2}name:\s*["']?([^"'\s]+)/m.exec(d)?.[1] ?? '?'

/// `Kind/name[key]: TOKEN` for each REPLACE_ME_* token. For a ConfigMap
/// the data key (e.g. `vrt-host.toml`) is the block header the line sits
/// under. Only the token NAME is printed, never surrounding values.
export function placeholderLocations(rendered) {
  const out = []
  for (const d of docsOf(rendered)) {
    const kind = docKind(d)
    if (!kind) continue
    let key = ''
    const seen = new Set()
    for (const line of d.split('\n')) {
      const k = /^ {2}([^\s:#][^:]*):\s*(?:[|>][-+]?)?\s*$/.exec(line)
      if (k) key = k[1]
      for (const m of line.matchAll(/REPLACE_ME[A-Z0-9_]*/g)) {
        const loc = `${kind}/${docName(d)}${kind === 'ConfigMap' && key ? `[${key}]` : ''}: ${m[0]}`
        if (!seen.has(loc)) {
          seen.add(loc)
          out.push(loc)
        }
      }
    }
  }
  return out
}

/// RV-R67: every Ingress backend must RESOLVE (through its rendered
/// Service) to the Service port named `ingress`, port 8080, targetPort
/// `ingress`/8080. Checked on parsed YAML, so `port: {number: 9091}`,
/// a Service whose `ingress` port was repointed, or a backend whose
/// Service is not rendered all fail (names alone proved nothing).
export function ingressBackendFailures(rendered) {
  const out = []
  const parsed = []
  for (const d of docsOf(rendered)) {
    const kind = docKind(d)
    if (kind !== 'Ingress' && kind !== 'Service') continue
    const doc = parseAllDocuments(d)[0]
    if (!doc || doc.errors.length) {
      out.push(`${kind}/${docName(d)}: unparseable YAML — cannot verify ingress backend`)
      continue
    }
    const obj = doc.toJS() ?? {}
    parsed.push({ kind, name: obj.metadata?.name ?? docName(d), obj })
  }
  const services = new Map(
    parsed.filter((p) => p.kind === 'Service').map((p) => [p.name, p.obj.spec?.ports ?? []])
  )
  for (const ing of parsed.filter((p) => p.kind === 'Ingress')) {
    const backends = []
    const spec = ing.obj.spec ?? {}
    if (spec.defaultBackend) backends.push(spec.defaultBackend)
    for (const r of spec.rules ?? []) {
      for (const p of r?.http?.paths ?? []) backends.push(p?.backend ?? {})
    }
    for (const b of backends) {
      const tag = `Ingress/${ing.name} backend`
      const svc = b.service
      if (!svc?.name) {
        out.push(`${tag} has no service (resource backends are not allowed)`)
        continue
      }
      const ports = services.get(svc.name)
      if (!ports) {
        out.push(`${tag} references Service ${svc.name} which is not in the render`)
        continue
      }
      const want = svc.port ?? {}
      const hit = ports.find((p) =>
        want.name !== undefined
          ? p.name === want.name
          : want.number !== undefined && p.port === want.number
      )
      if (!hit) {
        out.push(`${tag} port ${want.name ?? want.number} does not exist on Service ${svc.name}`)
      } else if (
        hit.name !== 'ingress' ||
        hit.port !== 8080 ||
        !['ingress', 8080].includes(hit.targetPort)
      ) {
        out.push(
          `${tag} must resolve to Service ${svc.name} port ingress/8080 -> targetPort ingress (got ${hit.name}/${hit.port} -> ${hit.targetPort})`
        )
      }
    }
  }
  return out
}

/// Tenant ingress must be a wildcard host with TLS (RV-R199).
function ingressTlsFailures(rendered) {
  const failures = []
  for (const d of docsOf(rendered)) {
    if (docKind(d) !== 'Ingress') continue
    const hosts = [...d.matchAll(/^\s*-?\s*host:\s*["']?([^"'\s]+)/gm)].map((m) => m[1])
    if (!hosts.length || hosts.some((h) => !h.startsWith('*.'))) {
      failures.push('Ingress host must be a wildcard `*.<routeBaseDomain>`')
    }
    // RV-R199 review: secretName and tls hosts must live INSIDE the
    // top-level `spec.tls` block (a secretName elsewhere must not
    // satisfy the check). Block = lines after `  tls:` until the next
    // indent-2 mapping key (list items `  - ` stay inside).
    const lines = d.split('\n')
    const start = lines.findIndex((l) => /^ {2}tls:\s*$/.test(l))
    const block = []
    if (start >= 0) {
      for (const l of lines.slice(start + 1)) {
        if (/^ {0,2}[^\s-]/.test(l)) break
        block.push(l)
      }
    }
    if (!block.some((l) => /^\s*(?:-\s+)?secretName:\s*["']?[^"'\s]+/.test(l))) {
      failures.push('Ingress has no tls with secretName (wildcard certificate Secret)')
    } else {
      const tlsHosts = block
        .map((l) => /^\s*-\s+["']?([^"'\s#:]+\.[^"'\s#:]+)["']?\s*$/.exec(l)?.[1])
        .filter(Boolean)
      if (tlsHosts.some((h) => !h.startsWith('*.'))) {
        failures.push('Ingress tls hosts must be wildcard `*.<routeBaseDomain>`')
      }
    }
  }
  return failures
}

/// Kvrocks 6666 / S3 9000 egress must exist (documented defaults). The
/// checker cannot read kvrocks-url (a Secret) or compare it with the
/// [s3] endpoint — it only guards that the policy still carries ports.
function dataEgressFailures(rendered) {
  const docs = docsOf(rendered)
  // Fail closed (RV-R199 review): a real stack (Deployment/Ingress) with
  // NO NetworkPolicy means an overlay deleted the egress policy.
  if (!docs.some((x) => docKind(x) === 'NetworkPolicy')) {
    return docs.some((x) => ['Deployment', 'Ingress'].includes(docKind(x)))
      ? ['NetworkPolicy vrt-host-data-egress (Kvrocks/S3 egress) is missing']
      : []
  }
  const d = docs.find(
    (x) => docKind(x) === 'NetworkPolicy' && docName(x) === 'vrt-host-data-egress'
  )
  if (!d) return ['NetworkPolicy vrt-host-data-egress (Kvrocks/S3 egress) is missing']
  const out = []
  // Overlays may patch the Kvrocks/S3 ports, so the defaults (6666/9000)
  // are NOT hard-coded here: require at least two distinct, valid
  // numeric ports (Kvrocks + S3) and reject non-numeric/out-of-range.
  const ports = [...d.matchAll(/(?:^|[\s{,-])port:\s*([^\s,}]+)/gm)].map((m) =>
    m[1].replace(/['"]/g, '')
  )
  for (const p of ports) {
    if (!/^\d+$/.test(p) || Number(p) < 1 || Number(p) > 65535) {
      out.push(
        `NetworkPolicy vrt-host-data-egress has invalid egress port '${p}' (need integer 1-65535)`
      )
    }
  }
  // Kvrocks is OPTIONAL in v1: a rendered provider config without a
  // [kvrocks] table (KV ops fail closed with RESOURCE_UNAVAILABLE) needs
  // only the S3 port. Without a recognisable provider config (policy-only
  // render) keep the conservative two-port requirement.
  const providerCfg = /^\s*cursorSecretFile\s*=/m.test(rendered)
  const needKvPort = !providerCfg || /^\s*\[kvrocks\]/m.test(rendered)
  if (new Set(ports).size < (needKvPort ? 2 : 1)) {
    out.push(
      needKvPort
        ? 'NetworkPolicy vrt-host-data-egress needs at least two distinct egress ports (Kvrocks and S3)'
        : 'NetworkPolicy vrt-host-data-egress needs at least one egress port (S3)'
    )
  }
  return out
}

/// S3-compatible object store (Cloudflare R2): credentials are mounted as
/// 0600 FILES from the out-of-band `vrt-secrets` Secret (never inline), and
/// vrt-sql needs HTTPS egress to the endpoint. Active only when the rendered
/// configs actually use an s3 backend/table.
export function s3Failures(rendered) {
  const out = []
  const docs = docsOf(rendered)
  const fileKeys = [
    ...rendered.matchAll(/^\s*(accessKeyFile|secretKeyFile)\s*=\s*["']([^"']*)["']/gm),
  ]
  for (const [, key, path] of fileKeys) {
    const want = key === 'accessKeyFile' ? 's3-access-key' : 's3-secret-key'
    if (path !== `/run/vrt/secrets/${want}`) {
      out.push(
        `s3 ${key} must be /run/vrt/secrets/${want} (init-normalized copy of the vrt-secrets key), got '${path}'`
      )
    }
  }
  for (const m of rendered.matchAll(/^\s*(accessKeyEnv|secretKeyEnv)\s*=\s*["']([^"']*)["']/gm)) {
    // accessKeyEnv/secretKeyEnv only appear in the R2 binding store tables
    // (provider [s3] / cell [storage_purge.s3]); vrt-sql + placement use
    // FILE credentials. Pinned to the dedicated r2-binding-* Secret keys.
    const want = m[1] === 'accessKeyEnv' ? 'VRT_R2_BINDING_ACCESS_KEY' : 'VRT_R2_BINDING_SECRET_KEY'
    if (m[2] !== want) out.push(`s3 ${m[1]} must be ${want}, got '${m[2]}'`)
  }
  const usesS3 =
    fileKeys.length > 0 ||
    /^\s*\[(?:s3|persistence\.s3|placement\.s3)\]/m.test(rendered) ||
    /^\s*backend\s*=\s*["']s3["']/m.test(rendered)
  if (!usesS3) return out
  const deployments = docs.filter((d) => docKind(d) === 'Deployment')
  if (deployments.length > 0) {
    for (const k of ['s3-access-key', 's3-secret-key']) {
      if (!deployments.some((d) => new RegExp(`key:\\s*${k}\\b`).test(d))) {
        out.push(`s3 backend configured but no Deployment mounts vrt-secrets key '${k}'`)
      }
    }
  }
  const sqlCfg = docs.find((d) => /^\s*\[persistence\]/m.test(d)) ?? ''
  if (
    /^\s*backend\s*=\s*["']s3["']/m.test(sqlCfg) &&
    docs.some((d) => docKind(d) === 'NetworkPolicy')
  ) {
    const np = docs.find(
      (d) => docKind(d) === 'NetworkPolicy' && docName(d) === 'vrt-sql-s3-egress'
    )
    if (!np || !/port:\s*['"]?443['"]?\b/.test(np) || !/protocol:\s*TCP/.test(np)) {
      out.push(
        'NetworkPolicy vrt-sql-s3-egress must allow TCP 443 egress to the S3-compatible endpoint (vrt-sql backend = "s3")'
      )
    }
  }
  return out
}

const MEM_UNITS = { Ki: 1024, Mi: 1024 ** 2, Gi: 1024 ** 3, K: 1e3, M: 1e6, G: 1e9 }
const memBytes = (v) => {
  const m = /^(\d+)(Ki|Mi|Gi|K|M|G)?$/.exec(String(v).replace(/['"]/g, ''))
  return m ? Number(m[1]) * (m[2] ? MEM_UNITS[m[2]] : 1) : null
}
/// Fixed headroom above the per-tenant RSS cap for the host's own runtime.
export const HOST_MEMORY_MARGIN_BYTES = 256 * 1024 ** 2

/// RV-R55 workload posture for each Deployment document:
///  - replicas=1 + a PVC mount => strategy Recreate (no RollingUpdate overlap
///    of two writers on one RWO volume / static cell identity);
///  - every emptyDir has a sizeLimit; every container has ephemeral-storage
///    request AND limit;
///  - ConfigMap volume refs carry a content-hash suffix (or the pod template
///    a checksum/config annotation) so a config change rolls the pod;
///  - vrt-host container memory limit >= toml [limits] maxRssBytes + margin.
function workloadFailures(rendered) {
  const out = []
  const docs = docsOf(rendered)
  const rssMatch = /maxRssBytes\s*=\s*(\d+)/.exec(rendered)
  for (const d of docs) {
    if (docKind(d) !== 'Deployment') continue
    const name = /^ {2}name:\s*["']?([^"'\s]+)/m.exec(d)?.[1] ?? docName(d)
    const tag = `Deployment ${name}`
    if (/^ {2}replicas:\s*1\s*$/m.test(d) && /persistentVolumeClaim:/.test(d)) {
      if (!/^ {2}strategy:\s*\n {4}type:\s*Recreate\s*$/m.test(d)) {
        out.push(`${tag}: single-replica Deployment with a PVC must use strategy.type Recreate`)
      }
    }
    for (const m of d.matchAll(/emptyDir:([^\n]*)\n?( *)([^\n]*)/g)) {
      const inline = m[1].trim()
      if (inline === '{}' || (inline === '' && !/^sizeLimit:/.test(m[3]))) {
        out.push(`${tag}: emptyDir without sizeLimit`)
      }
    }
    const containers = [...d.matchAll(/^\s*(?:-\s+)?image:\s*\S+/gm)].length
    const es = [...d.matchAll(/ephemeral-storage:\s*\S+/g)].length
    if (es < containers * 2) {
      out.push(`${tag}: every container needs ephemeral-storage requests and limits`)
    }
    const hashed = /checksum\/config:/.test(d)
    for (const m of d.matchAll(/configMap:\s*\n\s*name:\s*(\S+)/g)) {
      if (!hashed && !/-[a-z0-9]{10}$/.test(m[1])) {
        out.push(
          `${tag}: ConfigMap ${m[1]} has no content-hash name suffix (disableNameSuffixHash?) — config changes would not restart the pod`
        )
      }
    }
    if (name === 'vrt-host' && rssMatch) {
      // Rendered keys are sorted: the container's `name: vrt-host` is
      // followed by ports, then resources (limits before requests).
      const at = d.search(/^\s+name: vrt-host\n\s+ports:/m)
      const lim = at < 0 ? undefined : /limits:\s*\n[\s\S]*?memory:\s*(\S+)/.exec(d.slice(at))?.[1]
      const bytes = lim ? memBytes(lim) : null
      if (bytes === null || bytes < Number(rssMatch[1]) + HOST_MEMORY_MARGIN_BYTES) {
        out.push(`${tag}: vrt-host memory limit must be >= [limits] maxRssBytes + 256Mi`)
      }
    }
  }
  return out
}

/// RV-R72: dev-only / insecure TOML values must never reach a deployable
/// overlay (the binaries also refuse them at startup — this is the
/// pre-flight). Only the key name is reported, never surrounding values.
export function devConfigFailures(rendered) {
  const out = []
  if (/^\s*allowDevBackend\s*=\s*true\b/m.test(rendered)) {
    out.push('dev-only config: allowDevBackend = true is forbidden in a deployable overlay')
  }
  if (/^\s*backend\s*=\s*["']none["']/m.test(rendered)) {
    out.push('dev-only config: persistence backend = "none" is forbidden in a deployable overlay')
  }
  // The cell-controller's `[d1sql].endpoint` is the in-cluster vrt-sql data
  // plane (cleartext, HMAC-signed, like the provider's `[vrtSql].addr`); its
  // shape is enforced by configContractFailures. Every OTHER http:// endpoint
  // (object stores) still fails: strip only the `[d1sql]` table body.
  const withoutD1sql = rendered.replace(/^[ \t]*\[d1sql\][ \t]*\n(?:(?![ \t]*\[).*\n?)*/gm, '')
  // The R2 binding store tables (provider `[s3]`, cell `[storage_purge.s3]`)
  // may address an in-cluster object store over cleartext ONLY at the strict
  // `http://<svc>.<ns>.svc[.cluster.local]:<port>` shape; r2BindingFailures
  // then requires vrt-host-data-egress to admit exactly that namespace +
  // port (fail closed when the policy is absent). Any other http endpoint in
  // these tables (bare host, localhost, external) still fails here.
  const withoutClusterR2 = withoutD1sql.replace(
    /^[ \t]*\[(?:s3|storage_purge\.s3)\][ \t]*\n(?:(?![ \t]*\[).*\n?)*/gm,
    (body) => {
      const ep = /^\s*endpoint\s*=\s*["']([^"']*)["']/m.exec(body)?.[1]
      return ep !== undefined && R2_CLUSTER_ENDPOINT.test(ep)
        ? body.replace(/^\s*endpoint\s*=.*$/m, '')
        : body
    }
  )
  if (/^\s*endpoint\s*=\s*["']http:\/\//im.test(withoutClusterR2)) {
    out.push('insecure config: object-store endpoint must be https')
  }
  return out
}

/// RV-R66: durability posture. fs persistence on the same PVC as the
/// local DB, and a vrt-host without an object-store [placement], both mean
/// a single copy of D1/Queue/DO/workflow state. A deployable overlay must
/// use s3; template overlays (internal-test/example) may stay single-copy
/// only by carrying the explicit acknowledgement flag (the binaries
/// refuse to start without it).
export function durabilityFailures(rendered, { template = false } = {}) {
  const out = []
  for (const d of docsOf(rendered)) {
    if (/^\s*\[persistence\]/m.test(d)) {
      const fs = /^\s*backend\s*=\s*["']fs["']/m.test(d)
      const ack = /^\s*allowSameDeviceDurability\s*=\s*true\b/m.test(d)
      if (fs && (!template || !ack)) {
        out.push(
          template
            ? 'single-copy durability: vrt-sql backend = "fs" needs allowSameDeviceDurability = true (no disaster recovery)'
            : 'single-copy durability: vrt-sql backend = "fs" is forbidden in a deployable overlay (use s3)'
        )
      }
      if (ack && !template) {
        out.push(
          'dev-only config: allowSameDeviceDurability = true is forbidden in a deployable overlay'
        )
      }
    }
    if (/^\s*doStorageDir\s*=/m.test(d)) {
      const s3 = /^\s*\[placement\][\s\S]*?^\s*backend\s*=\s*["']s3["']/m.test(d)
      const ack = /^\s*allowLocalDurability\s*=\s*true\b/m.test(d)
      if (!s3 && (!template || !ack)) {
        out.push(
          template
            ? 'single-copy durability: vrt-host without [placement] backend = "s3" needs allowLocalDurability = true (DO/workflow state is single-copy)'
            : 'single-copy durability: vrt-host requires [placement] backend = "s3" in a deployable overlay'
        )
      }
      if (ack && !template) {
        out.push(
          'dev-only config: allowLocalDurability = true is forbidden in a deployable overlay'
        )
      }
    }
  }
  return out
}

/// Pod Security posture. Base is pure `restricted`. The ONLY sanctioned
/// root workload is the first init `vrt-data-perms` from the opt-in
/// components/local-path-perms (fsGroup-less PVs such as k3s local-path):
/// exact name + command shape + CHOWN/FOWNER caps + PVC-only mounts, and
/// only with the namespace at enforce=baseline / audit,warn=restricted.
/// Any other root / added-cap / privileged container fails; a local-path
/// PVC without the component fails (explicit storageClassName only — an
/// unset class cannot be resolved offline).
export const DATA_PERMS_NAME = 'vrt-data-perms'

function parseDocs(rendered) {
  const out = []
  for (const d of parseAllDocuments(rendered)) {
    const js = d.toJS()
    if (js && typeof js === 'object') out.push(js)
  }
  return out
}

function isRootish(c) {
  const sc = c.securityContext ?? {}
  return (
    sc.runAsUser === 0 ||
    sc.runAsNonRoot === false ||
    sc.privileged === true ||
    (sc.capabilities?.add ?? []).length > 0 ||
    sc.allowPrivilegeEscalation === true
  )
}

/// Violations of the sanctioned vrt-data-perms shape (empty = exact match).
export function dataPermsShapeViolations(c, spec, isFirstInit) {
  const out = []
  const sc = c.securityContext ?? {}
  const pvcVols = new Set(
    (spec.volumes ?? []).filter((v) => v.persistentVolumeClaim).map((v) => v.name)
  )
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)
  if (!isFirstInit) out.push('must be the first initContainer')
  if (sc.runAsUser !== 0) out.push('runAsUser must be 0')
  if (sc.allowPrivilegeEscalation !== false) out.push('allowPrivilegeEscalation must be false')
  if (sc.readOnlyRootFilesystem !== true) out.push('readOnlyRootFilesystem must be true')
  if (sc.privileged) out.push('privileged is forbidden')
  if (!eq(sc.capabilities?.drop, ['ALL'])) out.push('capabilities.drop must be [ALL]')
  if (!eq([...(sc.capabilities?.add ?? [])].sort(), ['CHOWN', 'FOWNER'])) {
    out.push('capabilities.add must be exactly [CHOWN, FOWNER]')
  }
  const mounts = c.volumeMounts ?? []
  if (mounts.length === 0 || mounts.some((m) => !pvcVols.has(m.name)))
    out.push('must mount PVC volumes only')
  const paths = mounts.map((m) => String(m.mountPath)).join(' ')
  const lines = [...(c.command ?? []), ...(c.args ?? [])]
    .join('\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  const want = ['/bin/sh', '-ec', 'set -eu', `chown 10001:10001 ${paths}`, `chmod 2770 ${paths}`]
  if (!eq(lines, want))
    out.push(
      'command must be exactly chown 10001:10001 + chmod 2770 on the PVC mount roots (gid=fsGroup+setgid+g+rwx is what fsGroupChangePolicy OnRootMismatch treats as already-correct)'
    )
  return out
}

export function podSecurityFailures(rendered) {
  const out = []
  let docs
  try {
    docs = parseDocs(rendered)
  } catch {
    return out // unparsable text is reported by the other checks
  }
  const ns = docs.find((d) => d.kind === 'Namespace' && d.metadata?.name === 'openflare-system')
  const labels = ns?.metadata?.labels ?? {}
  const enforce = labels['pod-security.kubernetes.io/enforce']
  const audit = labels['pod-security.kubernetes.io/audit']
  const warn = labels['pod-security.kubernetes.io/warn']
  const localPathClaims = new Set(
    docs
      .filter(
        (d) => d.kind === 'PersistentVolumeClaim' && d.spec?.storageClassName === 'local-path'
      )
      .map((d) => d.metadata?.name)
  )
  let permsSeen = false
  const coveredClaims = new Set()
  for (const w of docs.filter((d) => ['Deployment', 'StatefulSet', 'DaemonSet'].includes(d.kind))) {
    const spec = w.spec?.template?.spec ?? {}
    const inits = spec.initContainers ?? []
    const claimOf = (volName) =>
      (spec.volumes ?? []).find((v) => v.name === volName)?.persistentVolumeClaim?.claimName
    for (const [kind, list] of [
      ['initContainer', inits],
      ['container', spec.containers ?? []],
    ]) {
      list.forEach((c, i) => {
        const tag = `${w.metadata?.name}/${c.name}`
        if (!isRootish(c)) return
        if (kind === 'initContainer' && c.name === DATA_PERMS_NAME) {
          permsSeen = true
          for (const v of dataPermsShapeViolations(c, spec, i === 0))
            out.push(`pod-security: ${tag}: ${v}`)
          for (const m of c.volumeMounts ?? []) {
            const claim = claimOf(m.name)
            if (claim) coveredClaims.add(claim)
          }
          return
        }
        out.push(
          `pod-security: ${tag}: root/privileged/added-capability ${kind} is forbidden (only ${DATA_PERMS_NAME} is sanctioned)`
        )
      })
    }
  }
  if (permsSeen) {
    if (!ns)
      out.push(`pod-security: ${DATA_PERMS_NAME} rendered without the openflare-system Namespace`)
    else if (enforce !== 'baseline') {
      out.push(
        `pod-security: ${DATA_PERMS_NAME} needs namespace enforce=baseline (got ${enforce ?? 'unset'})`
      )
    }
    if (ns && audit !== 'restricted')
      out.push(`pod-security: namespace audit must stay restricted (got ${audit ?? 'unset'})`)
    if (ns && warn !== 'restricted')
      out.push(`pod-security: namespace warn must stay restricted (got ${warn ?? 'unset'})`)
  }
  for (const claim of localPathClaims) {
    if (!coveredClaims.has(claim)) {
      out.push(
        `local-path PVC ${claim} has no ${DATA_PERMS_NAME} init: local-path ignores fsGroup and vrt-securefs rejects the world-writable PV root — enable components/local-path-perms in the overlay`
      )
    }
  }
  return out
}

/// Bug 1: kubelet re-applies fsGroup recursively on EVERY Pod start of a
/// PVC-backed pod unless `fsGroupChangePolicy: OnRootMismatch` — turning
/// securefs 0700/0711 dirs into 2770 (securefs then refuses them and the
/// cache silently degrades). Every workload that mounts a PVC and sets
/// fsGroup MUST declare OnRootMismatch (an unset policy defaults to
/// Always). A pod without fsGroup is unaffected.
export function fsGroupPolicyFailures(rendered) {
  const out = []
  let docs
  try {
    docs = parseDocs(rendered)
  } catch {
    return out
  }
  for (const w of docs.filter((d) => ['Deployment', 'StatefulSet', 'DaemonSet'].includes(d.kind))) {
    const spec = w.spec?.template?.spec ?? {}
    const usesPvc = (spec.volumes ?? []).some((v) => v.persistentVolumeClaim)
    const sc = spec.securityContext ?? {}
    if (usesPvc && sc.fsGroup !== undefined && sc.fsGroupChangePolicy !== 'OnRootMismatch') {
      out.push(
        `fsgroup: ${w.metadata?.name}: PVC-backed pod sets fsGroup without fsGroupChangePolicy: OnRootMismatch (kubelet would recursively chmod securefs dirs to 2770 on every start)`
      )
    }
  }
  return out
}

const CLUSTER_SVC_ENDPOINT =
  /^http:\/\/(?:localhost|127(?:\.\d{1,3}){3}|[a-z0-9]([-a-z0-9]*[a-z0-9])?\.[a-z0-9]([-a-z0-9]*[a-z0-9])?\.svc(?:\.cluster\.local)?):[1-9]\d{0,4}\/?$/

/// Bugs 2 + 3: cross-file config contracts on the rendered ConfigMaps.
///   - cell-controller.toml MUST carry `[d1sql]` (vrt-sql is a separate
///     Pod; without it d1/queue capability is never reported) whose
///     endpoint is loopback or an in-cluster Service DNS name (never a
///     public host) and whose auth_secret_file is the same secret the
///     provider's [vrtSql].authSecretFile uses.
///   - vrt-provider.toml MUST carry `[assets] dir` equal to the host's
///     `[assets] dir` (else every ASSETS route is 503).
/// Only checked when the rendered config set is present (a bare overlay
/// without the generated ConfigMaps is reported by the other checks).
export function configContractFailures(rendered) {
  const out = []
  let docs
  try {
    docs = parseDocs(rendered)
  } catch {
    return out
  }
  const files = {}
  for (const d of docs.filter((x) => x.kind === 'ConfigMap')) {
    for (const [k, v] of Object.entries(d.data ?? {})) {
      if (k.endsWith('.toml')) {
        try {
          files[k] = parseToml(String(v))
        } catch {
          out.push(`config: ${k} is not valid TOML`)
        }
      }
    }
  }
  const cell = files['cell-controller.toml']
  const provider = files['vrt-provider.toml']
  const host = files['vrt-host.toml']
  if (cell) {
    const d1 = cell.d1sql
    if (!d1) {
      out.push(
        'config: cell-controller.toml has no [d1sql] (vrt-sql is a separate Pod; D1/queue capability would never be reported)'
      )
    } else {
      if (typeof d1.endpoint !== 'string' || !CLUSTER_SVC_ENDPOINT.test(d1.endpoint)) {
        out.push(
          `config: cell-controller.toml [d1sql].endpoint must be http loopback or <svc>.<ns>.svc[.cluster.local]:<port> (got ${JSON.stringify(d1.endpoint)})`
        )
      }
      if (
        provider?.vrtSql?.authSecretFile &&
        d1.auth_secret_file !== provider.vrtSql.authSecretFile
      ) {
        out.push(
          'config: cell-controller [d1sql].auth_secret_file must equal vrt-provider [vrtSql].authSecretFile (one shared vrt-sql secret)'
        )
      }
    }
  }
  if (provider && host?.assets?.dir) {
    if (provider.assets?.dir !== host.assets.dir) {
      out.push(
        `config: vrt-provider.toml [assets].dir must equal vrt-host.toml [assets].dir (${host.assets.dir}); otherwise ASSETS routes answer 503 ASSETS_ROUTE_UNAVAILABLE`
      )
    }
  }
  return out
}

/// KV1: the Kvrocks wiring is a THREE-way contract — provider
/// `[kvrocks]` (KV bindings + data-plane), cell-controller
/// `[storage_purge.kvrocks]` (STORAGE_PURGE + KV data cell-ops), and
/// both containers' `VRT_KVROCKS_URL` env (the Secret key the toml
/// `urlEnv` names). One side wired without the other means KV deploys
/// land on a cell that can never serve or purge them — fail the
/// render instead of discovering it at runtime. The data-egress port
/// itself is covered by dataEgressFailures (needKvPort).
export function kvrocksFailures(rendered) {
  const out = []
  let docs
  try {
    docs = parseDocs(rendered)
  } catch {
    return out
  }
  const files = {}
  for (const d of docs.filter((x) => x.kind === 'ConfigMap')) {
    for (const [k, v] of Object.entries(d.data ?? {})) {
      if (k.endsWith('.toml')) {
        try {
          files[k] = parseToml(String(v))
        } catch {
          // malformed toml is already reported by configContractFailures
        }
      }
    }
  }
  const provider = files['vrt-provider.toml']
  const cell = files['cell-controller.toml']
  const providerKv = provider?.kvrocks
  const cellKv = cell?.storage_purge?.kvrocks
  if (!providerKv && !cellKv) return out
  if (providerKv && !cellKv) {
    out.push(
      'kvrocks: vrt-provider.toml has [kvrocks] but cell-controller.toml has no [storage_purge.kvrocks] — KV namespaces would be unservable/unpurgeable on this cell'
    )
  }
  if (cellKv && !providerKv) {
    out.push(
      'kvrocks: cell-controller.toml has [storage_purge.kvrocks] but vrt-provider.toml has no [kvrocks] — purge backend wired with no KV data plane'
    )
  }
  const envs = [providerKv?.urlEnv, cellKv?.urlEnv].filter(Boolean)
  if (providerKv && cellKv && providerKv.urlEnv !== cellKv.urlEnv) {
    out.push(
      `kvrocks: vrt-provider [kvrocks].urlEnv (${providerKv.urlEnv}) must equal cell-controller [storage_purge.kvrocks].urlEnv (${cellKv.urlEnv}) — one store, one URL`
    )
  }
  const envName = providerKv?.urlEnv ?? cellKv?.urlEnv
  if (typeof envName !== 'string' || envName.length === 0) {
    out.push(
      'kvrocks: urlEnv must name the env var carrying the Kvrocks URL (expected VRT_KVROCKS_URL)'
    )
    return out
  }
  for (const name of envs) {
    if (name !== 'VRT_KVROCKS_URL') {
      out.push(
        `kvrocks: urlEnv must be VRT_KVROCKS_URL (got ${name}) — the name is pinned with the vrt-secrets kvrocks-url key`
      )
    }
  }
  // Both containers in the vrt-host Deployment must receive the env.
  const dep = docs.find((d) => d.kind === 'Deployment' && d.metadata?.name === 'vrt-host')
  const containers = dep?.spec?.template?.spec?.containers ?? []
  if (dep) {
    for (const cname of ['vrt-provider', 'cell-controller']) {
      const c = containers.find((x) => x?.name === cname)
      const has = (c?.env ?? []).some((e) => e?.name === envName)
      if (!has) {
        out.push(
          `kvrocks: Deployment vrt-host container ${cname} has no env ${envName} — [kvrocks]/[storage_purge.kvrocks] urlEnv would resolve to nothing`
        )
      }
    }
  }
  // Data egress must allow the Kvrocks port (default 6666 — keep in
  // sync with kvrocks-url when the store listens elsewhere).
  const np = docs.find(
    (d) => d.kind === 'NetworkPolicy' && d.metadata?.name === 'vrt-host-data-egress'
  )
  if (np) {
    const ports = (np.spec?.egress ?? []).flatMap((r) => r?.ports ?? []).map((p) => Number(p?.port))
    if (!ports.includes(6666)) {
      out.push(
        'kvrocks: NetworkPolicy vrt-host-data-egress must allow TCP port 6666 (Kvrocks) when [kvrocks] is configured'
      )
    }
  }
  return out
}

/// R2 binding store is a THREE-way contract like Kvrocks: provider `[s3]`
/// (R2 bindings), cell-controller `[storage_purge.s3]` (STORAGE_PURGE + R2
/// data cell-ops), and both containers' env sourced from the dedicated
/// vrt-secrets keys r2-binding-access-key / r2-binding-secret-key. The two
/// tables must address the SAME store (endpoint/region/bucket/env/
/// conditionalWrites/multipartTtlMs identical, defaults applied) -
/// otherwise purge/import writes land somewhere the binding never reads.
/// An in-cluster http endpoint `http://<svc>.<ns>.svc[.cluster.local]:<port>`
/// additionally needs vrt-host-data-egress to admit that namespace AND port.
/// Strict in-cluster Service shape for a cleartext R2 binding store
/// (lowercase DNS-1123 labels, explicit port, no userinfo/path/query).
const R2_CLUSTER_ENDPOINT =
  /^http:\/\/([a-z0-9](?:[-a-z0-9]*[a-z0-9])?)\.([a-z0-9](?:[-a-z0-9]*[a-z0-9])?)\.svc(?:\.cluster\.local)?:([1-9]\d{0,4})\/?$/
const R2_BINDING_ENV = {
  accessKeyEnv: ['VRT_R2_BINDING_ACCESS_KEY', 'r2-binding-access-key'],
  secretKeyEnv: ['VRT_R2_BINDING_SECRET_KEY', 'r2-binding-secret-key'],
}
const R2_LOCKSTEP_KEYS = [
  ['endpoint', undefined],
  ['region', undefined],
  ['bucket', undefined],
  ['accessKeyEnv', undefined],
  ['secretKeyEnv', undefined],
  ['conditionalWrites', true],
  ['multipartTtlMs', 604800000],
]
export function r2BindingFailures(rendered) {
  const out = []
  let docs
  try {
    docs = parseDocs(rendered)
  } catch {
    return out
  }
  const files = {}
  for (const d of docs.filter((x) => x.kind === 'ConfigMap')) {
    for (const [k, v] of Object.entries(d.data ?? {})) {
      if (k.endsWith('.toml')) {
        try {
          files[k] = parseToml(String(v))
        } catch {
          // malformed toml is already reported by configContractFailures
        }
      }
    }
  }
  const prov = files['vrt-provider.toml']?.s3
  const cell = files['cell-controller.toml']?.storage_purge?.s3
  if (!prov && !cell) return out
  if (prov && !cell) {
    out.push(
      'r2: vrt-provider.toml has [s3] but cell-controller.toml has no [storage_purge.s3] - R2 buckets would be unpurgeable and R2 data cell-ops unavailable on this cell'
    )
  }
  if (cell && !prov) {
    out.push(
      'r2: cell-controller.toml has [storage_purge.s3] but vrt-provider.toml has no [s3] - purge backend wired with no R2 binding store'
    )
  }
  if (prov && cell) {
    for (const [k, dflt] of R2_LOCKSTEP_KEYS) {
      const a = prov[k] ?? dflt
      const b = cell[k] ?? dflt
      if (a !== b) {
        out.push(
          `r2: vrt-provider [s3].${k} (${String(a)}) must equal cell-controller [storage_purge.s3].${k} (${String(b)}) - one store`
        )
      }
    }
  }
  const tbl = prov ?? cell
  const dep = docs.find((d) => d.kind === 'Deployment' && d.metadata?.name === 'vrt-host')
  const containers = dep?.spec?.template?.spec?.containers ?? []
  if (dep) {
    for (const [field, [envName, secretKey]] of Object.entries(R2_BINDING_ENV)) {
      if (tbl[field] !== envName) continue // name pinned (and reported) by s3Failures
      for (const cname of ['vrt-provider', 'cell-controller']) {
        const c = containers.find((x) => x?.name === cname)
        const e = (c?.env ?? []).find((x) => x?.name === envName)
        const ref = e?.valueFrom?.secretKeyRef
        if (!e) {
          out.push(
            `r2: Deployment vrt-host container ${cname} has no env ${envName} - ${field} would resolve to nothing`
          )
        } else if (e.value !== undefined || ref?.name !== 'vrt-secrets' || ref?.key !== secretKey) {
          out.push(
            `r2: container ${cname} env ${envName} must come from secretKeyRef vrt-secrets/${secretKey} (never inline, never the vrt-sql s3-* keys)`
          )
        }
      }
    }
  }
  const m = R2_CLUSTER_ENDPOINT.exec(String(tbl.endpoint ?? ''))
  const np = docs.find(
    (d) => d.kind === 'NetworkPolicy' && d.metadata?.name === 'vrt-host-data-egress'
  )
  if (m && !np) {
    out.push(
      'r2: [s3] endpoint is an in-cluster cleartext Service but NetworkPolicy vrt-host-data-egress is not rendered - refusing an unscoped cleartext store'
    )
  }
  if (m && np) {
    const [, , ns, port] = m
    const ok = (np.spec?.egress ?? []).some(
      (r) =>
        (r?.to ?? []).some(
          (t) =>
            t?.namespaceSelector?.matchLabels?.['kubernetes.io/metadata.name'] === ns && !t?.ipBlock
        ) && (r?.ports ?? []).some((p) => Number(p?.port) === Number(port))
    )
    if (!ok) {
      out.push(
        `r2: [s3] endpoint is in-cluster (namespace ${ns}, port ${port}) but NetworkPolicy vrt-host-data-egress has no rule admitting that namespace + port`
      )
    }
  }
  return out
}

/// MIG-9: parse `a.b.c.d`/`v6` strings (+ `::ffff:`-mapped forms) to a
/// (bits, BigInt value) pair — the CIDR containment math below needs
/// both sides in the same family; a mapped v6 literal is canonicalized
/// to its v4 value so `10.0.0.1/32` still covers `::ffff:10.0.0.1`.
function parseIp(ip) {
  const text = String(ip ?? '').trim()
  if (/^\d+\.\d+\.\d+\.\d+$/.test(text)) {
    const parts = text.split('.').map(Number)
    if (parts.some((p) => p > 255)) return null
    return { bits: 32, value: parts.reduce((a, p) => (a << 8n) | BigInt(p), 0n) }
  }
  if (text.includes(':')) {
    // Expand `::` then join — a v6 is 8 groups of ≤4 hex.
    let t = text.toLowerCase()
    const mapped = t.match(/^(.*):(\d+\.\d+\.\d+\.\d+)$/)
    if (mapped) {
      const v4 = parseIp(mapped[2])
      if (!v4) return null
      const hex = v4.value.toString(16).padStart(8, '0')
      t = `${mapped[1]}:${hex.slice(0, 4)}:${hex.slice(4)}`
      // `::ffff:` prefix ⇒ this was a mapped address — canonicalize
      // the whole thing back to v4 so it can only ever match v4 CIDRs.
      if (
        t.startsWith('::ffff:') ||
        t === '0:0:0:0:0:ffff:' + hex.slice(0, 4) + ':' + hex.slice(4)
      ) {
        return v4
      }
    }
    const halves = t.split('::')
    if (halves.length > 2) return null
    const left = halves[0] ? halves[0].split(':') : []
    const right = halves.length === 2 && halves[1] ? halves[1].split(':') : []
    const groups = [...left, ...Array(8 - left.length - right.length).fill('0'), ...right]
    if (groups.length !== 8) return null
    let v = 0n
    for (const g of groups) {
      if (!/^[0-9a-f]{1,4}$/.test(g)) return null
      v = (v << 16n) | BigInt(`0x${g}`)
    }
    return { bits: 128, value: v }
  }
  return null
}

/// MIG-9: `cidr ⊆ trusted` — same family and the trusted prefix covers
/// the cidr's base address. `except` entries are ignored deliberately:
/// the admitted SOURCE set is `cidr − except`, always ⊆ cidr itself.
function cidrContainedBy(cidr, trustedCidr) {
  const cm = String(cidr)
    .trim()
    .match(/^(.+)\/(\d+)$/)
  const tm = String(trustedCidr)
    .trim()
    .match(/^(.+)\/(\d+)$/)
  if (!cm || !tm) return false
  const c = parseIp(cm[1])
  const t = parseIp(tm[1])
  if (!c || !t || c.bits !== t.bits) return false
  const cp = BigInt(cm[2])
  const tp = BigInt(tm[2])
  if (tp > cp || cp > BigInt(c.bits)) return false
  const mask = ((1n << BigInt(t.bits)) - 1n) << (BigInt(t.bits) - tp)
  return (c.value & mask) === (t.value & mask)
}

/// MIG-9: an ipBlock is only a pinned proxy when it names exactly one
/// address — /32 (v4) or /128 (v6). A broader cidr (incl. 0.0.0.0/0 or
/// a whole pod CIDR) is never a pinned source. `except` entries, when
/// present, must be single addresses too (a broad except under a /32
/// is impossible, and a broad cidr+except pair is already refused).
function ipBlockIsSingleAddress(ipBlock) {
  const m = String(ipBlock?.cidr ?? '')
    .trim()
    .match(/^(.+)\/(\d+)$/)
  if (!m) return false
  const addr = parseIp(m[1])
  if (!addr) return false
  if (Number(m[2]) !== addr.bits) return false
  for (const ex of ipBlock.except ?? []) {
    const em = String(ex)
      .trim()
      .match(/^(.+)\/(\d+)$/)
    const ea = em && parseIp(em[1])
    if (!em || !ea || Number(em[2]) !== ea.bits) return false
  }
  return true
}

/// MIG-9: trusted TCP-peer CIDRs from the rendered vrt-host.toml —
/// `forwardedProtoTrusted` and `clientIp.trustedCidrs` are the two
/// peer-trust lists the ingress honors; the NP `from` set must stay
/// inside their union (NP is authoritative on disagreement — a source
/// it admits but the toml does NOT trust is drift, fail closed).
function trustedIngressCidrs(docs) {
  const out = []
  for (const d of docs.filter((x) => x.kind === 'ConfigMap')) {
    for (const [k, v] of Object.entries(d.data ?? {})) {
      if (k !== 'vrt-host.toml') continue
      try {
        const toml = parseToml(String(v))
        for (const c of toml?.ingress?.forwardedProtoTrusted ?? []) out.push(c)
        for (const c of toml?.ingress?.clientIp?.trustedCidrs ?? []) out.push(c)
      } catch {
        // unparseable toml is configContractFailures' business — here
        // an unresolvable trust set simply admits nothing.
      }
    }
  }
  return out
}

/// MIG-8: tenant port :8080 must only be reachable from the front
/// proxy. Without a `from:` any pod in the cluster could hit :8080 and
/// forge the x-forwarded-* headers that vrt-host's forwardedProtoTrusted
/// honors (trusted CIDRs = exactly the range this rule admits; the
/// NetworkPolicy is authoritative on disagreement). Checked on parsed
/// YAML only when the vrt-host policy renders — policy-only fixtures
/// and renders without the policy are other checks' business. A
/// Deployment vrt-host rendered with NetworkPolicies but NOT the
/// vrt-host one means an overlay deleted it — fail closed.
/// MIG-9: ipBlock peers are allowed for hostNetwork proxies (pod
/// selectors never match host-network traffic) — each must be a single
/// /32 or /128 address inside the toml's trusted CIDR set.
export function tenantIngressNetpolFailures(rendered) {
  const out = []
  let docs
  try {
    docs = parseDocs(rendered)
  } catch {
    return out // unparsable text is reported by the other checks
  }
  const np = docs.find((d) => d.kind === 'NetworkPolicy' && d.metadata?.name === 'vrt-host')
  if (!np) {
    const hasHost = docs.some((d) => d.kind === 'Deployment' && d.metadata?.name === 'vrt-host')
    if (hasHost && docs.some((d) => d.kind === 'NetworkPolicy')) {
      out.push('NetworkPolicy vrt-host is missing')
    }
    return out
  }
  const covering = (np.spec?.ingress ?? []).filter((r) =>
    (r?.ports ?? []).some((p) => Number(p?.port) === 8080)
  )
  if (!covering.length) {
    out.push('NetworkPolicy vrt-host has no ingress rule covering tenant port 8080')
    return out
  }
  for (const r of covering) {
    const tag = 'NetworkPolicy vrt-host :8080 ingress'
    if (!Array.isArray(r.from) || !r.from.length) {
      out.push(
        `${tag} has no \`from:\` — every pod can reach tenants and forge trusted-proxy headers`
      )
      continue
    }
    // A proxy peer is a namespaceSelector+podSelector PAIR (one frontend
    // identity, overlay-retargetable) — or, MIG-9, a single-address
    // ipBlock for hostNetwork proxies whose traffic pod selectors can
    // never match (k3s Traefik hostNetwork DaemonSet arrives with the
    // node IP / flannel gateway as source). A bare podSelector =
    // openflare-system pods, a bare namespaceSelector = every pod in that
    // namespace, and a broad ipBlock = a whole CIDR — none of those is
    // a pinned proxy.
    const trusted = trustedIngressCidrs(docs)
    for (const peer of r.from) {
      if (peer?.ipBlock) {
        if (!ipBlockIsSingleAddress(peer.ipBlock)) {
          out.push(
            `${tag} ipBlock must be a single address (/32 or /128, single-address except only) — ${JSON.stringify(peer.ipBlock)}`
          )
        } else if (!trusted.length) {
          out.push(
            `${tag} ipBlock ${peer.ipBlock.cidr} cannot be verified — vrt-host.toml carries no trusted ingress CIDRs`
          )
        } else if (!trusted.some((t) => cidrContainedBy(peer.ipBlock.cidr, t))) {
          out.push(
            `${tag} ipBlock ${peer.ipBlock.cidr} is outside the trusted CIDRs of vrt-host.toml (forwardedProtoTrusted ∪ clientIp.trustedCidrs) — NP/toml drift`
          )
        }
        continue
      }
      if (!peer?.namespaceSelector || !peer?.podSelector) {
        out.push(
          `${tag} \`from:\` peers must be namespaceSelector+podSelector pairs or single-address ipBlocks — no bare selectors or broad CIDRs`
        )
      }
    }
  }
  return out
}

/// True when a CIDR/address text is an IPv4-mapped IPv6 (::ffff:0:0/96)
/// address — decided on the parsed 128-bit value, not on the spelling.
export function isIpv4MappedCidr(text) {
  const addr = String(text ?? '').split('/')[0]
  if (!addr.includes(':')) return false
  const ip = parseIp(addr)
  if (!ip) return false
  // parseIp canonicalizes dotted `::ffff:a.b.c.d` to a 32-bit value.
  return ip.bits === 32 || ip.value >> 32n === 0xffffn
}

/// Kubernetes IANA_SVC_NAME: ≤15 chars, [a-z0-9-], ≥1 letter, no
/// leading/trailing '-', no '--'. Rejected by the API server otherwise.
export function isIanaSvcName(name) {
  const s = String(name)
  return (
    s.length >= 1 &&
    s.length <= 15 &&
    /^[a-z0-9-]+$/.test(s) &&
    /[a-z]/.test(s) &&
    !s.startsWith('-') &&
    !s.endsWith('-') &&
    !s.includes('--')
  )
}

/// Kubernetes DNS-1123 label: ≤63 chars, [a-z0-9-], starts and ends
/// alphanumeric. This (NOT IANA_SVC_NAME) is what the apiserver
/// enforces on Service `spec.ports[].name`.
export function isDns1123Label(name) {
  const s = String(name)
  return s.length >= 1 && s.length <= 63 && /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(s)
}

/// Port-name validity (apiserver rejects bad names at apply time),
/// mirroring the apiserver's per-field rules:
/// - workload containerPort `name` → IANA_SVC_NAME;
/// - Service port `name` → DNS-1123 label (≤63; a 16+ char Service
///   port name such as `controller-metrics` IS accepted);
/// - Service `targetPort` given as a string → IANA_SVC_NAME (it must
///   name a containerPort).
export function portNameFormatFailures(rendered) {
  const out = []
  let docs
  try {
    docs = parseDocs(rendered)
  } catch {
    return out
  }
  const check = (where, name) => {
    if (name === undefined || name === null) return
    if (!isIanaSvcName(name)) {
      out.push(
        `ports: ${where}: port name '${name}' is not a valid IANA_SVC_NAME (<=15 chars, [a-z0-9-], at least one letter, no leading/trailing/double '-')`
      )
    }
  }
  for (const w of docs.filter((d) => ['Deployment', 'StatefulSet', 'DaemonSet'].includes(d.kind))) {
    const spec = w.spec?.template?.spec ?? {}
    for (const c of [...(spec.initContainers ?? []), ...(spec.containers ?? [])]) {
      for (const p of c.ports ?? []) check(`${w.metadata?.name}/${c.name} containerPort`, p?.name)
    }
  }
  for (const svc of docs.filter((d) => d.kind === 'Service')) {
    for (const p of svc.spec?.ports ?? []) {
      const name = p?.name
      if (name !== undefined && name !== null && !isDns1123Label(name)) {
        out.push(
          `ports: Service ${svc.metadata?.name}: port name '${name}' is not a valid DNS-1123 label (<=63 chars, [a-z0-9-], alphanumeric start/end)`
        )
      }
      if (typeof p?.targetPort === 'string')
        check(`Service ${svc.metadata?.name} targetPort`, p.targetPort)
    }
  }
  return out
}

/// MIG-10: containerPort `name:` values must be unique within a pod —
/// kubectl apply warns on dupes and Service/probe name resolution
/// becomes ambiguous. Checked across containers + initContainers of
/// every rendered workload.
export function portNameFailures(rendered) {
  const out = []
  let docs
  try {
    docs = parseDocs(rendered)
  } catch {
    return out
  }
  for (const w of docs.filter((d) => ['Deployment', 'StatefulSet', 'DaemonSet'].includes(d.kind))) {
    const spec = w.spec?.template?.spec ?? {}
    const seen = new Map()
    for (const c of [...(spec.initContainers ?? []), ...(spec.containers ?? [])]) {
      for (const p of c.ports ?? []) {
        if (p?.name === undefined || p?.name === null) continue
        const key = String(p.name)
        const prev = seen.get(key)
        if (prev && prev.container !== c.name) {
          out.push(
            `ports: ${w.metadata?.name}: containerPort name '${key}' used by both '${prev.container}' and '${c.name}' — names must be unique within a pod`
          )
        } else if (prev && prev.port !== p.containerPort) {
          out.push(
            `ports: ${w.metadata?.name}: containerPort name '${key}' maps to both ${prev.port} and ${p.containerPort}`
          )
        }
        seen.set(key, { container: c.name, port: p.containerPort })
      }
    }
  }
  return out
}

/// MIG-10/MIG-14: tenant egress (tenant worker fetch() + raw-TCP
/// connect() via workerd outbound-network) needs TCP 43+80+443 to
/// PUBLIC space only — never an unrestricted (no `to:`) egress rule at
/// all (a port-only rule admits every destination), and the public
/// ipBlock's `except` list must cover every deny-range CIDR of
/// egress.rs (mirrored in contract/egress-deny-ranges.json: v4 +
/// v6 + embedded-IPv4 prefixes). Applies to every NetworkPolicy whose
/// podSelector selects vrt-host pods.
export function tenantEgressNetpolFailures(rendered) {
  const out = []
  let docs
  try {
    docs = parseDocs(rendered)
  } catch {
    return out // unparsable text is reported by the other checks
  }
  const hostPolicies = docs.filter(
    (d) =>
      d.kind === 'NetworkPolicy' &&
      d.spec?.podSelector?.matchLabels?.['app.kubernetes.io/name'] === 'vrt-host'
  )
  if (!hostPolicies.length) return out
  const fixture = JSON.parse(
    readFileSync(
      new URL(
        resolve(process.env.OPENFLARE_DIR ?? '../openflare', 'contract/egress-deny-ranges.json'),
        import.meta.url
      )
    )
  )
  const needV4 = new Set(fixture.ipv4.map((r) => r.cidr))
  // The k8s API server rejects IPv4-mapped ipBlock excepts; that prefix
  // stays worker-side only (a v4-mapped connect() leaves as an IPv4
  // packet and is covered by the v4 except list).
  const needV6 = new Set(
    [...fixture.ipv6.map((r) => r.cidr), ...fixture.embeddedPrefixes].filter(
      (c) => !isIpv4MappedCidr(c)
    )
  )
  let publicPorts = new Set()
  for (const np of hostPolicies) {
    const tag = `NetworkPolicy ${np.metadata?.name}`
    for (const r of np.spec?.egress ?? []) {
      const ports = new Set((r.ports ?? []).map((p) => Number(p?.port)))
      const coversPublicPort = ports.has(43) || ports.has(80) || ports.has(443) || ports.size === 0
      // MIG-14: ANY egress rule without `to:` admits every destination
      // on its ports — pod-wide rules cannot tell tenant from platform
      // traffic, so a missing `to:` is forbidden outright, not only on
      // the public ports.
      if (!Array.isArray(r.to)) {
        out.push(
          `${tag} egress rule on ports {${[...ports].join(',')}} has no \`to:\` — tenant egress could reach private/cluster space (pod-wide rule cannot tell tenant from platform traffic)`
        )
      }
      // MIG-15: the tenant pg-wire TCP data plane (internalTcpTargets →
      // provider pgproxy → tenant gateway :5432) must never widen the pod
      // egress surface — TCP 5432 egress may ONLY reach the platform's
      // postgres-tenant-gateway pods, never another namespace/pod/segment.
      if (ports.has(5432)) {
        const peers = r.to ?? []
        const isGatewayPeer = (p) =>
          p?.podSelector?.matchLabels?.['app.kubernetes.io/name'] === 'postgres-tenant-gateway'
        // Hyperdrive `database` bindings: the ONE other admitted peer is a
        // CNPG pod (cnpg.io/cluster Exists), TCP 5432 only; the database-side
        // per-binding ingress NetworkPolicy decides real admission.
        const isCnpgPeer = (p) => {
          const exprs = p?.podSelector?.matchExpressions
          return (
            !p?.ipBlock &&
            !p?.podSelector?.matchLabels &&
            Array.isArray(exprs) &&
            exprs.length === 1 &&
            exprs[0].key === 'cnpg.io/cluster' &&
            exprs[0].operator === 'Exists' &&
            ports.size === 1
          )
        }
        if (!peers.length || peers.some((p) => !isGatewayPeer(p) && !isCnpgPeer(p))) {
          out.push(
            `${tag} egress rule on TCP 5432 must target only postgres-tenant-gateway pods or CNPG pods (cnpg.io/cluster Exists, 5432 only) — the pg-wire data plane may not reach other in-cluster segments`
          )
        }
      }
      for (const peer of r.to ?? []) {
        const ib = peer?.ipBlock
        if (!ib) continue
        if (ib.cidr === '0.0.0.0/0' || ib.cidr === '::/0') {
          if (!coversPublicPort) continue // public ipBlock on other ports is the backends' business
          const mapped = (ib.except ?? []).filter((c) => isIpv4MappedCidr(c))
          if (mapped.length) {
            out.push(
              `${tag} ipBlock ${ib.cidr} except lists IPv4-mapped prefixes (${mapped.join(', ')}) — the Kubernetes API server rejects them; the v4 except list already covers mapped destinations`
            )
          }
          const missing = [...(ib.cidr === '0.0.0.0/0' ? needV4 : needV6)].filter(
            (c) => !(ib.except ?? []).includes(c)
          )
          if (missing.length) {
            out.push(
              `${tag} public ipBlock ${ib.cidr} except misses deny CIDRs: ${missing.join(', ')}`
            )
          }
          for (const p of ports) publicPorts.add(p)
        }
      }
    }
  }
  for (const port of [43, 80, 443]) {
    if (!publicPorts.has(port)) {
      out.push(
        `vrt-host pod has no public ipBlock egress rule for TCP ${port} — tenant fetch()/connect() to the internet is denied (MIG-10/MIG-14 regression)`
      )
    }
  }
  return out
}

/// Posture assertions on the rendered YAML — returns failure strings.
/// `template` selects the placeholder-carrying template rules (see the
/// header); the default is the deployable rule set.
export function validateRendered(rendered, { template = false } = {}) {
  const failures = []
  if (template) {
    if (!/REPLACE_ME/.test(rendered)) {
      failures.push(
        'template overlay no longer carries REPLACE_ME placeholders (use a deployable check)'
      )
    }
    if (/VRT_IMAGE_TAG|:latest/.test(rendered)) {
      failures.push('floating image tag survived the render')
    }
  } else if (/REPLACE_ME|VRT_IMAGE_TAG|:latest/.test(rendered)) {
    failures.push('placeholder or floating image tag survived the render')
    // RV-R199: name WHERE each placeholder survived (ConfigMap data
    // key / resource), so the operator edits the right file.
    for (const loc of placeholderLocations(rendered)) {
      failures.push(`placeholder survived: ${loc}`)
    }
  }
  const digestRef = template ? TEMPLATE_DIGEST_REF : DIGEST_REF
  for (const m of rendered.matchAll(IMAGE_LINE)) {
    if (!digestRef.test(m[1])) {
      failures.push(`image is not pinned by sha256 digest (name@sha256:<64 hex>): ${m[1]}`)
    }
  }
  // RV-R25: the real Secret is created out-of-band; a rendered Secret
  // carrying stringData/data would be applied over the operator's one.
  // Split per YAML document so a ConfigMap's `data:` never matches.
  for (const docText of rendered.split(/^---\s*$/m)) {
    if (!/^kind:\s*Secret\s*$/m.test(docText)) continue
    if (/vpev_|vpes_|password\s*[:=]\s*\S+|bearer\s+\S+/i.test(docText)) {
      failures.push('plaintext credential material in rendered Secret')
    }
    if (/^(?:stringData|data):/m.test(docText)) {
      failures.push(
        'rendered Secret carries stringData/data — Secrets must be created out-of-band (secrets.example.yaml is not a resource)'
      )
    }
  }
  // Ingress must target ONLY the ingress port — no control/metrics/data.
  // Per Ingress document (RV-R199 review: not only the first one).
  if (
    docsOf(rendered).some(
      (d) => docKind(d) === 'Ingress' && /name: (control|metrics|data)\b/.test(d)
    )
  ) {
    failures.push('Ingress references an internal port')
  }
  failures.push(
    ...ingressBackendFailures(rendered),
    ...ingressTlsFailures(rendered),
    ...dataEgressFailures(rendered),
    ...s3Failures(rendered),
    ...workloadFailures(rendered),
    ...devConfigFailures(rendered),
    ...podSecurityFailures(rendered),
    ...fsGroupPolicyFailures(rendered),
    ...configContractFailures(rendered),
    ...kvrocksFailures(rendered),
    ...r2BindingFailures(rendered),
    ...tenantIngressNetpolFailures(rendered),
    ...tenantEgressNetpolFailures(rendered),
    ...portNameFailures(rendered),
    ...portNameFormatFailures(rendered),
    ...durabilityFailures(rendered, { template })
  )
  return failures
}

export function main({
  argv = process.argv.slice(2),
  exec = execFileSync,
  fs = { existsSync, statSync },
  log = console.log,
  err = (m) => console.error(m),
} = {}) {
  const fail = (msg, code = 1) => {
    err(`error: ${msg}`)
    process.exitCode = code
    return { failed: true }
  }

  let template = false
  const positional = []
  for (const a of argv) {
    // `--name=value` — errors print `name` only; the value may be a
    // secret and is never echoed. No flag maps exist here (flags are
    // compared literally), so prototype-chain keys are a non-issue.
    const eq = a.indexOf('=')
    const name = eq === -1 ? a : a.slice(0, eq)
    if (name === '--help' || name === '-h') {
      if (eq !== -1) return fail(`unknown argument: ${name}\n${USAGE}`, 2)
      log(USAGE)
      return { help: true }
    }
    if (name === '--template' && eq === -1) {
      template = true
      continue
    }
    if (name.startsWith('-')) return fail(`unknown argument: ${name}\n${USAGE}`, 2)
    positional.push(a)
  }
  if (positional.length > 1) return fail(`expected at most one overlay dir\n${USAGE}`, 2)

  const dir = resolve(positional[0] ?? DEFAULT_OVERLAY)
  const stat = fs.existsSync(dir) && fs.statSync(dir)
  if (!stat?.isDirectory?.()) {
    return fail(`not a kustomize overlay directory: ${dir}`, 2)
  }

  let rendered
  try {
    rendered = renderOverlay(dir, exec)
  } catch (e) {
    // One clean line — never a stack trace from a missing tool or a
    // failed render.
    return fail(e.message, 2)
  }

  const failures = validateRendered(rendered, { template })
  if (failures.length) {
    for (const f of failures) err(`FAIL: ${f}`)
    process.exitCode = 1
    return { failed: true }
  }
  log(
    template
      ? `OK: ${dir} template renders clean (placeholders intact, images digest-pinned, ingress = :8080 only)`
      : `OK: ${dir} renders clean (no placeholders, images digest-pinned, no plaintext creds, ingress = :8080 only)`
  )
  return { ok: true }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
}
