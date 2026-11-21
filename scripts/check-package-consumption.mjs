#!/usr/bin/env node
/**
 * Integration smoke: build the package, pack it the way a registry/tarball
 * consumer receives it, install it into an empty project, and import the
 * public exports from Node.
 *
 * This catches the class of failure where `files`/`exports`/`dist` are wrong but
 * the in-repo unit tests (which import `src/`) still pass.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const run = (cmd, args, cwd = root) =>
  execFileSync(cmd, args, { cwd, stdio: 'inherit', env: process.env })

const tmp = mkdtempSync(join(tmpdir(), 'openflare-control-consumer-'))
try {
  // Build output is not committed; produce it before packing.
  run('pnpm', ['--filter', 'openflare-control', 'build'])
  run('pnpm', ['pack', '--pack-destination', tmp], join(root, 'packages/control'))

  const { version } = JSON.parse(readFileSync(join(root, 'packages/control/package.json'), 'utf8'))
  const tarball = join(tmp, `openflare-control-${version}.tgz`)
  const consumer = join(tmp, 'consumer')
  mkdirSync(consumer)
  writeFileSync(
    join(consumer, 'package.json'),
    JSON.stringify({ name: 'consumer', private: true, type: 'module' }, null, 2)
  )
  run('pnpm', ['add', tarball, '--ignore-scripts'], consumer)
  run(
    'node',
    [
      '--input-type=module',
      '-e',
      `import { serializeBinding, VRT_CELL_CAPABILITY_KEYS } from 'openflare-control';
       const b = serializeBinding({ name: 'B', type: 'QUEUE', resourceId: 'b'.repeat(26), permissionRead: true, permissionWrite: false }, 'self', null, []);
       if (b.type !== 'queue' || !VRT_CELL_CAPABILITY_KEYS.includes('serviceProps')) process.exit(1);
       console.log('OK: packed package imports and serializes');`,
    ],
    consumer
  )
} finally {
  rmSync(tmp, { recursive: true, force: true })
}
