import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { h } from 'vue'
import { routerKey, type Router } from 'vue-router'
import LinkRow from '~/components/ui/LinkRow.vue'

function setup() {
  const router = {
    push: vi.fn(() => Promise.resolve()),
    resolve: vi.fn((to: string) => ({ href: `/base${to}` })),
  }
  const table = mount(
    {
      render: () =>
        h('table', [
          h('tbody', [
            h(
              LinkRow,
              { to: '/kv/CHECKUMI_CACHE', class: 'sel' },
              {
                default: () => [
                  h('td', { 'data-cell': 'name' }, [
                    h('a', { href: '/kv/CHECKUMI_CACHE' }, 'CHECKUMI_CACHE'),
                  ]),
                  h('td', { 'data-cell': 'size' }, [h('span', '1.1 GB')]),
                  h('td', [h('button', { type: 'button', 'aria-label': 'More' }, '…')]),
                ],
              }
            ),
          ]),
        ]),
    },
    {
      global: { provide: { [routerKey as symbol]: router as unknown as Router } },
      attachTo: document.body,
    }
  )
  return { table, router }
}

afterEach(() => {
  window.getSelection()?.removeAllRanges()
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('UiLinkRow', () => {
  it('renders a row that keeps its design classes', () => {
    const { table } = setup()
    expect(table.find('tr').classes()).toContain('sel')
  })

  it('opens the target when a plain cell is clicked', async () => {
    const { table, router } = setup()
    await table.find('[data-cell="size"] span').trigger('click', { button: 0 })
    expect(router.push).toHaveBeenCalledWith('/kv/CHECKUMI_CACHE')
  })

  it('leaves clicks on its own links and buttons to them', async () => {
    const { table, router } = setup()
    await table.find('a').trigger('click', { button: 0 })
    await table.find('button').trigger('click', { button: 0 })
    expect(router.push).not.toHaveBeenCalled()
  })

  it('ignores non-primary buttons and clicks that end a text selection', async () => {
    const { table, router } = setup()
    await table.find('[data-cell="size"]').trigger('click', { button: 1 })
    const range = document.createRange()
    range.selectNodeContents(table.find('[data-cell="size"] span').element)
    window.getSelection()?.addRange(range)
    await table.find('[data-cell="size"]').trigger('click', { button: 0 })
    expect(router.push).not.toHaveBeenCalled()
  })

  it('opens a new tab for modifier clicks instead of navigating in place', async () => {
    const { table, router } = setup()
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    await table.find('[data-cell="size"]').trigger('click', { button: 0, metaKey: true })
    expect(open).toHaveBeenCalledWith('/base/kv/CHECKUMI_CACHE', '_blank', 'noopener')
    expect(router.push).not.toHaveBeenCalled()
  })
})
