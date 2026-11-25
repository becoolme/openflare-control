import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from 'yaml'

const file = 'deploy/k8s/components/runtime-alerts/vmrules.yaml'
const doc = parse(readFileSync(file, 'utf8'))

test('VMRule carries the runtime alert groups', () => {
  assert.equal(doc.apiVersion, 'operator.victoriametrics.com/v1beta1')
  assert.equal(doc.kind, 'VMRule')
  assert.equal(doc.metadata?.name, 'openflare-runtime')
  assert.equal(doc.metadata?.namespace, 'openflare-system')
  const names = (doc.spec?.groups ?? []).map((g) => g.name).sort()
  assert.deepEqual(names, [
    'openflare-d1-failover',
    'openflare-do-alarms',
    'openflare-scale-to-zero',
  ])
  const rules = doc.spec.groups.flatMap((g) => g.rules ?? [])
  assert.equal(rules.length, 8)
  assert.ok(rules.every((r) => r.alert && r.expr))
  assert.ok(rules.some((r) => r.alert === 'OpenflareAlarmWakeSlow'))
})

const openflare = process.env.OPENFLARE_DIR

test(
  'VMRule groups match the canonical runtime rules',
  { skip: !openflare && 'OPENFLARE_DIR unset' },
  () => {
    const canonical = parse(
      readFileSync(join(openflare, 'deploy/alerts/openflare-runtime.yaml'), 'utf8')
    )
    assert.deepEqual(doc.spec.groups, canonical.groups)
  }
)
