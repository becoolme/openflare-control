/**
 * Smoke coverage for the ops entrypoints (seed.ts, maintain.ts): nothing
 * else in CI executes them, so a broken import or a lost fail-fast ships
 * silently. argv checks run without Postgres; the deploy path is gated on
 * DATABASE_URL like the rest of this package's suite.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash } from 'node:crypto'
import { afterAll, describe, expect, it } from 'vitest'
import { Pool } from 'pg'

const run = promisify(execFile)
const url = process.env.DATABASE_URL
const maybe = url ? describe : describe.skip
const sha256 = (b: string) => createHash('sha256').update(b).digest('hex')

const cli = (script: string, args: string[], env: NodeJS.ProcessEnv = {}) =>
  run('pnpm', ['exec', 'tsx', `src/${script}`, ...args], {
    env: { ...process.env, ...env },
    timeout: 60_000,
  })

const seedArgs = (cell: string, team: string, worker: string, digest: string, version = 'v1') => [
  '--cluster',
  cell,
  '--team',
  team,
  '--name',
  worker,
  '--version',
  version,
  '--digest',
  digest,
]

describe('ops CLI fail-fast', () => {
  it('maintain requires DATABASE_URL', async () => {
    await expect(cli('maintain.ts', [], { DATABASE_URL: '' })).rejects.toMatchObject({
      stderr: expect.stringContaining('DATABASE_URL is required'),
    })
  })

  it('seed requires the deploy args', async () => {
    await expect(cli('seed.ts', [], { DATABASE_URL: '' })).rejects.toMatchObject({
      stderr: expect.stringContaining('--cluster --team --name --version --digest are required'),
    })
  })

  it('seed rejects a non-hex digest before touching the DB', async () => {
    await expect(
      cli('seed.ts', seedArgs('cell-1', 'team-1', 'w', 'not-hex'), { DATABASE_URL: '' })
    ).rejects.toMatchObject({ stderr: expect.stringContaining('64-hex sha256') })
  })
})

maybe('ops CLI against Postgres', () => {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
  const pool = new Pool({ connectionString: url })
  const cell = `cli-${suffix}`
  const team = `cli-t-${suffix}`

  afterAll(async () => {
    await pool.end()
  })

  it('maintain runs a real retention sweep', async () => {
    const res = await cli('maintain.ts', ['--keep', '1'], { DATABASE_URL: url! })
    expect(res.stdout).toContain('openflare-plane retention:')
  })

  it('seed publishes through the whole deploy path', async () => {
    await pool.query('insert into plane_cells (cell_id, cluster_id) values ($1,$1)', [cell])
    await pool.query('insert into plane_teams (team_id, name) values ($1,$2)', [team, 'smoke'])
    const env = {
      DATABASE_URL: url!,
      PLANE_SIGNING_SECRET: 'cli-smoke-signing-secret-0123456789',
      PLANE_SECRETS_KEY: 'cli-smoke-secrets-key-0123456789abc',
      SEED_SECRET_API_KEY: 's3cret',
    }
    const digest = sha256('cli-smoke-bundle')
    const res = await cli(
      'seed.ts',
      [...seedArgs(cell, team, `w-${suffix}`, digest), '--secret', 'API_KEY'],
      env
    )
    expect(res.stdout).toContain('published revision')
    const stored = await pool.query('select 1 from plane_secrets where worker_id=$1 and key=$2', [
      `${team}:w-${suffix}`,
      'API_KEY',
    ])
    expect(stored.rowCount).toBe(1)

    // KEY=VALUE on argv is refused — the value must come via SEED_SECRET_*.
    await expect(
      cli(
        'seed.ts',
        [...seedArgs(cell, team, `w2-${suffix}`, digest, 'v2'), '--secret', 'API_KEY=x'],
        env
      )
    ).rejects.toMatchObject({ stderr: expect.stringContaining('takes a KEY only') })
  })
})
