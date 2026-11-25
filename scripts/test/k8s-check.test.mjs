import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { parse } from 'smol-toml'

const script = new URL('../vrt-k8s-check.mjs', import.meta.url).pathname
const overlay = 'deploy/k8s/overlays/example'

function run(args) {
  return spawnSync(process.execPath, [script, ...args], {
    encoding: 'utf8',
    env: process.env,
  })
}

const hasOpenflare = Boolean(process.env.OPENFLARE_DIR)

test(
  'template mode accepts the shipped overlay',
  { skip: !hasOpenflare && 'OPENFLARE_DIR unset' },
  () => {
    const result = run(['--template', overlay])
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /template renders clean/)
  }
)

test(
  'an unfilled overlay is rejected outside template mode',
  { skip: !hasOpenflare && 'OPENFLARE_DIR unset' },
  () => {
    const result = run([overlay])
    assert.notEqual(result.status, 0)
    assert.match(`${result.stdout}${result.stderr}`, /REPLACE_ME|placeholder/i)
  }
)

test('a missing overlay fails closed', { skip: !hasOpenflare && 'OPENFLARE_DIR unset' }, () => {
  const result = run(['deploy/k8s/overlays/does-not-exist'])
  assert.notEqual(result.status, 0)
})

const hostConfigs = [
  'deploy/k8s/base/config/vrt-host.toml',
  'deploy/k8s/overlays/example/config/vrt-host.toml',
]

test('shipped cells enable scale-to-zero with detached WebSocket sessions', () => {
  for (const file of hostConfigs) {
    const cfg = parse(readFileSync(file, 'utf8'))
    assert.equal(cfg.scaleToZero?.enabled, true, `${file}: scaleToZero.enabled`)
    assert.ok(cfg.scaleToZero.idleMs >= 1000, `${file}: idleMs`)
    assert.ok(cfg.scaleToZero.alarmWakeGraceMs >= 1000, `${file}: alarmWakeGraceMs`)
    assert.equal(cfg.ingress?.websocket?.hibernation, true, `${file}: websocket.hibernation`)
    const replay = cfg.ingress.websocket.hibernationReplayBytes
    assert.ok(replay >= 1024 && replay <= 1048576, `${file}: hibernationReplayBytes`)
  }
})
