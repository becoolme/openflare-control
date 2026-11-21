#!/usr/bin/env node
/**
 * During the migration, vibeploy carries the same portable plane sources at
 * `server/src/vrt-control`. Nothing in this repository may diverge from that
 * copy: run this gate (or `--write` to propagate a change) before publishing.
 *
 *   VIBEPLOY_DIR=../vibeploy node scripts/check-vibeploy-sync.mjs
 *   VIBEPLOY_DIR=../vibeploy node scripts/check-vibeploy-sync.mjs --write
 */
import { copyFileSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const source = join(root, 'packages/control/src')
const vibeployDir = process.env.VIBEPLOY_DIR
if (!vibeployDir) {
  console.error('VIBEPLOY_DIR is required')
  process.exit(2)
}
const target = join(vibeployDir, 'server/src/vrt-control')
const write = process.argv.includes('--write')

const files = (dir) =>
  readdirSync(dir)
    .filter((name) => name.endsWith('.ts'))
    .sort()

const ours = files(source)
const theirs = files(target)
const problems = []
for (const name of ours) {
  if (!theirs.includes(name)) {
    problems.push(`missing in vibeploy: ${name}`)
    continue
  }
  const a = readFileSync(join(source, name))
  const b = readFileSync(join(target, name))
  if (a.equals(b)) continue
  if (write) {
    copyFileSync(join(source, name), join(target, name))
    console.log(`updated ${name}`)
  } else {
    problems.push(`differs: ${name}`)
  }
}
for (const name of theirs) {
  if (!ours.includes(name)) problems.push(`extra in vibeploy: ${name}`)
}
if (problems.length) {
  console.error(problems.join('\n'))
  console.error('run with --write to propagate this repository into vibeploy')
  process.exit(1)
}
console.log(`OK: ${ours.length} portable files match`)
void statSync
void relative
