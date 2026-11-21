#!/usr/bin/env node
/**
 * Guard: the deployment layer is public. No private topology, credentials or
 * product-brand references may leak into `deploy/`.
 *
 * Allowed on purpose: the k3s default pod/service CIDRs (10.42.0.0/16,
 * 10.43.0.0/16) and the `vrt-*` namespace names the manifests ship with.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(fileURLToPath(new URL('..', import.meta.url)), 'deploy')

const FORBIDDEN = [
  [/\b10\.(?!42\.|43\.)\d{1,3}\.\d{1,3}\.\d{1,3}\b(?!\/)/, 'private 10/8 host address'],
  [/\b192\.168\.\d{1,3}\.\d{1,3}\b(?!\/)/, 'private 192.168 host address'],
  [/\b172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}\b(?!\/)/, 'private 172.16/12 host address'],
  [/\bvpes_[A-Za-z0-9_-]{16,}/, 'cell token'],
  [/BEGIN [A-Z ]*PRIVATE KEY/, 'private key'],
  [/\b(vibeploy|becool)\b/i, 'product-brand reference'],
]

const files = []
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) walk(path)
    else files.push(path)
  }
}
walk(root)

const problems = []
for (const file of files) {
  const text = readFileSync(file, 'utf8')
  for (const [pattern, what] of FORBIDDEN) {
    const match = pattern.exec(text)
    if (match) problems.push(`${file.slice(root.length + 1)}: ${what} (${match[0]})`)
  }
}
if (problems.length) {
  console.error(problems.join('\n'))
  process.exit(1)
}
console.log(`OK: ${files.length} deploy files are sanitized`)
