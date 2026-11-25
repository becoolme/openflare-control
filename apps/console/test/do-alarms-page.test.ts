import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { defineComponent, h } from 'vue'
import DoAlarmsView from '~/components/DoAlarmsView.vue'
import Badge from '~/components/ui/Badge.vue'
import Button from '~/components/ui/Button.vue'
import UiError from '~/components/ui/Error.vue'
import MetricCard from '~/components/ui/MetricCard.vue'

const NuxtLink = defineComponent({
  inheritAttrs: false,
  props: { to: { type: [String, Object], required: true } },
  setup(props, { slots, attrs }) {
    return () => h('a', { ...attrs, href: String(props.to) }, slots.default?.())
  },
})
const global = {
  components: {
    NuxtLink,
    UiBadge: Badge,
    UiButton: Button,
    UiError,
    UiMetricCard: MetricCard,
  },
}

const ref = (n: string) => ({ tenantId: 't1', workerId: 'w1', classKey: `${n}`.repeat(3) })
const data = {
  updatedAt: '2026-11-25T00:00:00Z',
  snapshot: {
    entries: [
      { ...ref('b'), objectId: 'obj-b', atMs: 2_000, observedAtMs: 0 },
      { ...ref('a'), objectId: 'obj-a', atMs: 1_000, observedAtMs: 0 },
    ],
    unknown: [{ ...ref('u'), objectId: '' }],
    truncated: [{ ...ref('x'), objectId: '' }],
    observed: [{ ...ref('a'), objectId: '' }],
  },
}

describe('do alarms page', () => {
  it('calls the alarm snapshot route and delegates rendering', () => {
    const src = readFileSync(join(process.cwd(), 'app/pages/do-alarms.vue'), 'utf8')
    expect(src).toContain('/do-alarms`')
    expect(src).toContain('<DoAlarmsView')
  })

  it('sorts alarms by due time and surfaces unsafe classes', () => {
    const w = mount(DoAlarmsView, {
      props: { activeCell: 'cell-1', data, pending: false, error: null },
      global,
    })
    const rows = w.findAll('tbody tr')
    expect(rows).toHaveLength(2)
    expect(rows[0].text()).toContain('t1')
    expect(rows[0].text()).toContain('obj-a'.slice(0, 12))
    expect(rows[1].text()).toContain('obj-b'.slice(0, 12))
    expect(w.findAll('.badge').map((b) => b.text())).toEqual(['unknown', 'truncated'])
    expect(w.text()).toContain('Known alarms')
    expect(w.text()).toContain('2')
  })

  it('shows loading, no-cell, no-snapshot and error states', () => {
    const base = { activeCell: 'cell-1', data: null, pending: false, error: null }
    expect(mount(DoAlarmsView, { props: { ...base, pending: true }, global }).text()).toContain(
      'Loading…'
    )
    expect(mount(DoAlarmsView, { props: { ...base, activeCell: '' }, global }).text()).toContain(
      'Select a cell.'
    )
    expect(mount(DoAlarmsView, { props: base, global }).text()).toContain(
      'No alarm snapshot reported'
    )
    const failed = mount(DoAlarmsView, {
      props: { ...base, error: 'alarm index unavailable' },
      global,
    })
    expect(failed.get('[role="alert"]').text()).toContain('alarm index unavailable')
  })

  it('emits refresh', async () => {
    const w = mount(DoAlarmsView, {
      props: { activeCell: 'cell-1', data, pending: false, error: null },
      global,
    })
    await w.find('button').trigger('click')
    expect(w.emitted('refresh')).toHaveLength(1)
  })
})
