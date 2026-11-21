#!/usr/bin/env node
/**
 * Fetches the pinned workerd binary from npm or the fork GitHub release,
 * verifies archive and binary digests, extracts the binary and writes
 * it to deploy/docker/workerd with WORKERD_SHA256 output for
 * Dockerfile.vrt-host's `file` stage.
 *
 * Safety: https-only, URL shape allowlisted from the lock file (npm
 * tarball, or this project's release asset), 60 s request budget, at
 * most 3 redirects, 128 MiB archive and 256 MiB decompressed limits.
 * The npm tarball sha512 is verified BEFORE extraction; the release
 * archive sha256 is verified BEFORE decompression; the binary that
 * comes out is then checked against the lock's `binarySha256`. npm
 * extraction goes through `tar -tzf` allowlist (only
 * package/bin/workerd is written) — no path traversal surface (tar is
 * invoked with the single member name, never extracted to a tree).
 * A failed verification never replaces an existing output binary.
 *
 * Offline verification (CI/tests): `--local-tgz <file>` for npm locks,
 * `--local-archive <file>` for github-release locks; the digest,
 * decompression and extraction checks are identical to the fetch path.
 *
 * Usage: node scripts/vrt-fetch-workerd.mjs --arch linux-x64 \
 *          [--lock $OPENFLARE_DIR/deploy/docker/workerd.lock] \
 *          [--out $OPENFLARE_DIR/deploy/docker/workerd] \
 *          [--local-tgz <tarball> | --local-archive <release .gz>]
 */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { gunzipSync } from 'node:zlib'

const args = process.argv.slice(2)
function opt(name, def) {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : def
}
const arch = opt('arch')
const openflareDir = process.env.OPENFLARE_DIR ?? '../openflare'
const lockPath = resolve(opt('lock', `${openflareDir}/deploy/docker/workerd.lock`))
const outPath = resolve(opt('out', `${openflareDir}/deploy/docker/workerd`))
if (!arch) {
  console.error('FATAL: --arch required (linux-x64 | linux-arm64)')
  process.exit(2)
}
if (!['linux-x64', 'linux-arm64'].includes(arch)) {
  console.error(`FATAL: unsupported --arch ${arch} (linux-x64 | linux-arm64)`)
  process.exit(2)
}
const lock = JSON.parse(readFileSync(lockPath, 'utf8'))
const art = lock.artifacts?.[arch]
const source = lock.source ?? 'npm'
if (!['npm', 'github-release'].includes(source)) {
  throw new Error(`unsupported workerd source: ${source}`)
}
if (!art?.url) {
  console.error(`FATAL: lock has no artifact for arch ${arch}`)
  process.exit(2)
}
if (source === 'npm' && !art.integrity?.startsWith('sha512-')) {
  console.error(`FATAL: npm lock has no sha512 integrity for arch ${arch}`)
  process.exit(2)
}
if (
  source === 'github-release' &&
  (!/^[0-9a-f]{64}$/.test(art.archiveSha256 ?? '') ||
    !/^[0-9a-f]{64}$/.test(art.binarySha256 ?? ''))
) {
  throw new Error('github-release requires archiveSha256 and binarySha256 pins')
}
// Exact-URL + https enforcement: the URL is taken verbatim from the
// lock; it must parse as https and match its source's artifact path.
const localTgz = opt('local-tgz')
const localArchive = opt('local-archive')
if ((localTgz && source !== 'npm') || (localArchive && source !== 'github-release')) {
  throw new Error('local archive option does not match the lock source')
}
if (!localTgz && !localArchive) {
  const u = new URL(art.url)
  const allowed =
    source === 'npm'
      ? u.hostname === 'registry.npmjs.org' &&
        /^\/@cloudflare\/workerd-[a-z0-9-]+\/-\/[a-z0-9.-]+\.tgz$/.test(u.pathname)
      : u.hostname === 'github.com' &&
        u.pathname === `/becoolme/workerd/releases/download/${lock.version}/workerd-${arch}.gz`
  if (
    u.protocol !== 'https:' ||
    u.username ||
    u.password ||
    u.port ||
    u.search ||
    u.hash ||
    !allowed
  ) {
    console.error('FATAL: lock URL rejected (https + approved artifact path only)')
    process.exit(2)
  }
}
const tmp = mkdtempSync(join(tmpdir(), 'vrt-workerd-'))
const tgz = join(tmp, 'workerd.tgz')
try {
  // --local-tgz: offline verification mode (CI/tests). The tarball is
  // read from disk; sha512 + member checks are identical to the fetch path.
  const buf =
    localTgz || localArchive
      ? readFileSync(resolve(localTgz || localArchive))
      : await (async () => {
          const ctl = new AbortController()
          const timer = setTimeout(() => ctl.abort(), 60_000)
          try {
            let url = art.url
            for (let redirects = 0; redirects <= 3; redirects++) {
              const res = await fetch(url, { signal: ctl.signal, redirect: 'manual' })
              if ([301, 302, 303, 307, 308].includes(res.status)) {
                await res.body?.cancel()
                const location = res.headers.get('location')
                if (!location) throw new Error('artifact redirect lacks location')
                const next = new URL(location, url)
                if (
                  source !== 'github-release' ||
                  next.protocol !== 'https:' ||
                  next.hostname !== 'release-assets.githubusercontent.com' ||
                  next.username ||
                  next.password ||
                  next.port
                ) {
                  throw new Error('artifact redirect rejected')
                }
                url = next.href
                continue
              }
              if (!res.ok) {
                await res.body?.cancel()
                throw new Error(`HTTP ${res.status}`)
              }
              const body = res.body
              if (!body) throw new Error('artifact response has no body')
              const chunks = []
              let size = 0
              for await (const chunk of body) {
                size += chunk.length
                if (size > 128 * 1024 * 1024) throw new Error('artifact exceeds size limit')
                chunks.push(chunk)
              }
              return Buffer.concat(chunks)
            }
            throw new Error('too many artifact redirects')
          } finally {
            ctl.abort()
            clearTimeout(timer)
          }
        })()
  if (buf.length > 128 * 1024 * 1024) throw new Error('artifact exceeds size limit')
  let bytes
  if (source === 'github-release') {
    const got = createHash('sha256').update(buf).digest('hex')
    if (got !== art.archiveSha256) throw new Error('archiveSha256 mismatch')
    try {
      bytes = gunzipSync(buf, { maxOutputLength: 256 * 1024 * 1024 })
    } catch (error) {
      throw new Error(`release archive is not readable gzip: ${error.message}`)
    }
  } else {
    const got = `sha512-${createHash('sha512').update(buf).digest('base64')}`
    if (got !== art.integrity) {
      throw new Error(`sha512 mismatch: expected ${art.integrity} got ${got}`)
    }
    writeFileSync(tgz, buf)
    // List members; require exactly the binary path to exist and extract
    // ONLY that member by name (no tree extraction → no traversal).
    const list = execFileSync('tar', ['-tzf', tgz], { encoding: 'utf8' })
      .split('\n')
      .map((s) => s.replace(/^\.\//, '').trim())
      .filter(Boolean)
    for (const m of list) {
      if (m.includes('..') || m.startsWith('/')) {
        throw new Error(`tarball member traversal rejected: ${m}`)
      }
    }
    if (!list.includes('package/bin/workerd')) {
      throw new Error('tarball lacks package/bin/workerd')
    }
    const bin = execFileSync('tar', ['-xzf', tgz, '-C', tmp, 'package/bin/workerd'])
    void bin
    bytes = readFileSync(join(tmp, 'package/bin/workerd'))
  }
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  // RV-R25: when the lock carries the in-repo binary pin, the extracted
  // binary must match it (the tarball sha512 alone is not the pin the
  // image build checks).
  if (art.binarySha256 && art.binarySha256 !== sha256) {
    throw new Error(`binarySha256 mismatch: lock ${art.binarySha256} got ${sha256}`)
  }
  writeFileSync(outPath, bytes)
  chmodSync(outPath, 0o755)
  const label = lock.upstream?.version ? `${lock.upstream.version} (${lock.version})` : lock.version
  console.log(`workerd ${label} (${arch}) -> ${outPath}`)
  console.log(`WORKERD_SHA256=${sha256}`)
} finally {
  rmSync(tmp, { recursive: true, force: true })
}
