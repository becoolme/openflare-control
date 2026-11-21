#!/usr/bin/env node
/**
 * The wire contract is owned by the OpenFlare runtime, not this repository.
 * `packages/control/test/fixtures/*` are vendored copies of
 * `fixtures/vrt-wire/*`; this gate makes that dependency explicit.
 *
 *   OPENFLARE_DIR=../openflare node scripts/check-openflare-contract.mjs
 *   OPENFLARE_DIR=../openflare node scripts/check-openflare-contract.mjs --write
 *
 * CI checks out becoolme/openflare and runs this gate against its latest
 * `main`, so a runtime contract change cannot silently diverge here.
 */
import { copyFileSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { isDeepStrictEqual } from 'node:util'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const upstream = process.env.OPENFLARE_DIR
if (!upstream) {
  console.error('OPENFLARE_DIR is required')
  process.exit(2)
}
const write = process.argv.includes('--write')

/** Files the control package actually validates against. Keep this list explicit:
 * adding a new fixture here is how a new cross-language contract becomes a
 * dependency of this repository. */
const FILES = ['desired-ack-partial.json', 'desired-ack-tenant-failures.json']

const localDir = join(root, 'packages/control/test/fixtures')
const upstreamDir = join(upstream, 'fixtures/vrt-wire')
const problems = []

for (const name of FILES) {
  const src = join(upstreamDir, name)
  const dst = join(localDir, name)
  if (!existsSync(src)) {
    problems.push(`missing upstream fixture: fixtures/vrt-wire/${name}`)
    continue
  }
  if (!existsSync(dst)) {
    problems.push(`missing local fixture: ${name}`)
    continue
  }
  // Compare the JSON value, not bytes: Prettier formats the vendored copies and
  // must not fight the runtime's file layout.
  const a = JSON.parse(readFileSync(src, 'utf8'))
  const b = JSON.parse(readFileSync(dst, 'utf8'))
  if (isDeepStrictEqual(a, b)) continue
  if (write) {
    copyFileSync(src, dst)
    console.log(`updated ${name}`)
  } else {
    problems.push(`differs from OpenFlare: ${name}`)
  }
}

if (problems.length) {
  console.error(problems.join('\n'))
  console.error(
    'run with --write to pull the canonical copies from OpenFlare (the runtime owns this contract)'
  )
  process.exit(1)
}

let rev = 'unknown'
try {
  rev = execFileSync('git', ['-C', upstream, 'rev-parse', '--short=12', 'HEAD'], {
    encoding: 'utf8',
  }).trim()
} catch {
  // A source archive without .git is fine; the file comparison already ran.
}
console.log(`OK: ${FILES.length} wire fixtures match OpenFlare ${rev}`)
