#!/usr/bin/env node
// Host-side wrapper: the hello-world proof itself ships inside the plane
// image (apps/plane/src/hello.ts → dist/hello.js) so it needs nothing on
// the host beyond Docker. COMPOSE_FILE is honored for dev-override users.
//
//   node scripts/hello-all-in-one.mjs

import { execFileSync } from 'node:child_process'

const files = (process.env.COMPOSE_FILE ?? 'docker-compose.all-in-one.yml')
  .split(':')
  .filter(Boolean)
const args = [
  'compose',
  ...files.flatMap((f) => ['-f', f]),
  'exec',
  '-T',
  'plane',
  'node',
  'dist/hello.js',
]
try {
  execFileSync('docker', args, { stdio: 'inherit' })
} catch (e) {
  console.error('')
  console.error(
    'hello failed. Is the stack up?  docker compose -f docker-compose.all-in-one.yml ps'
  )
  console.error(
    'plane logs:                   docker compose -f docker-compose.all-in-one.yml logs plane'
  )
  process.exit(typeof e.status === 'number' ? e.status : 1)
}
