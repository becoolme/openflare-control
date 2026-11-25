import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { defineComponent, h } from 'vue'
import D1WriterView from '~/components/D1WriterView.vue'
import Badge from '~/components/ui/Badge.vue'
import Button from '~/components/ui/Button.vue'
import UiError from '~/components/ui/Error.vue'
import MetricCard from '~/components/ui/MetricCard.vue'
import MetricFoot from '~/components/ui/MetricFoot.vue'

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
    UiMetricFoot: MetricFoot,
  },
}

const detail = {
  writer: { epoch: 7, addr: '10.0.0.2:8082', lsn: 42, updatedAt: '2026-11-25T00:00:00Z' },
  promotions: [
    {
      id: 'p1',
      seq: 2,
      status: 'PENDING',
      result: null,
      error: null,
      created_at: '2026-11-25T00:00:01Z',
    },
    {
      id: 'p0',
      seq: 1,
      status: 'DONE',
      result: { epoch: 7, lsn: 42 },
      error: null,
      created_at: '2026-11-25T00:00:00Z',
    },
  ],
}
const databases = [
  { database_id: 'db-1', name: 'primary' },
  { database_id: 'db-2', name: '' },
]

describe('d1 writer page', () => {
  it('calls the documented plane routes and delegates rendering', () => {
    const src = readFileSync(join(process.cwd(), 'app/pages/d1-writer.vue'), 'utf8')
    expect(src).toContain('/d1/databases`')
    expect(src).toContain('/promotions`')
    expect(src).toContain('<D1WriterView')
  })

  it('renders writer metrics, promotion results and status badges', () => {
    const w = mount(D1WriterView, {
      props: {
        activeCell: 'cell-1',
        databases,
        selected: 'db-1',
        detail,
        pending: false,
        error: null,
      },
      global,
    })
    expect(w.text()).toContain('7')
    expect(w.text()).toContain('10.0.0.2:8082')
    expect(w.text()).toContain('42')
    expect(w.text()).toContain('2 recent')
    const rows = w.findAll('tbody tr')
    expect(rows).toHaveLength(2)
    expect(rows[0].text()).toContain('PENDING')
    expect(rows[0].find('.badge').classes()).toContain('b-warn')
    expect(rows[1].find('.badge').classes()).toContain('b-ok')
    expect(w.text()).toContain('db-1')
    expect(w.findAll('option').map((o) => o.text())).toEqual(['primary', 'db-2'])
  })

  it('shows explicit empty, missing-cell and error states', () => {
    const empty = mount(D1WriterView, {
      props: {
        activeCell: 'cell-1',
        databases,
        selected: 'db-1',
        detail: { writer: detail.writer, promotions: [] },
        pending: false,
        error: null,
      },
      global,
    })
    expect(empty.text()).toContain('No promotions yet.')

    const noCell = mount(D1WriterView, {
      props: {
        activeCell: '',
        databases: [],
        selected: '',
        detail: null,
        pending: false,
        error: null,
      },
      global,
    })
    expect(noCell.text()).toContain('Select a cell.')

    const failed = mount(D1WriterView, {
      props: {
        activeCell: 'cell-1',
        databases,
        selected: 'db-1',
        detail: null,
        pending: false,
        error: 'promotions unavailable',
      },
      global,
    })
    expect(failed.get('[role="alert"]').text()).toContain('promotions unavailable')
    expect(failed.text()).not.toContain('Writer epoch')
  })

  it('emits selection and refresh interactions', async () => {
    const w = mount(D1WriterView, {
      props: {
        activeCell: 'cell-1',
        databases,
        selected: 'db-1',
        detail,
        pending: false,
        error: null,
      },
      global,
    })
    await w.find('select').setValue('db-2')
    expect(w.emitted('update:selected')?.at(-1)).toEqual(['db-2'])
    await w.find('button').trigger('click')
    expect(w.emitted('refresh')).toHaveLength(1)
  })
})
