import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { defineComponent, h } from 'vue'
import SideNav from '~/components/shell/SideNav.vue'
import { NAV_FOOTER, NAV_GROUPS } from '~/utils/nav'

const NuxtLink = defineComponent({
  inheritAttrs: false,
  props: { to: { type: [String, Object], required: true } },
  setup(props, { slots, attrs }) {
    return () => h('a', { ...attrs, href: String(props.to), 'data-link': '' }, slots.default?.())
  },
})

const mountNav = (active?: string) =>
  mount(SideNav, { props: { active }, global: { components: { NuxtLink } } })

describe('ShellSideNav', () => {
  it('renders every design entry in order', () => {
    const keys = mountNav()
      .findAll('.nv')
      .map((item) => item.attributes('data-k'))
    expect(keys).toEqual(
      [...NAV_GROUPS.flatMap((group) => group.items), ...NAV_FOOTER].map((item) => item.key)
    )
  })

  it('routes sections with pages through NuxtLink and keeps the rest as placeholders', () => {
    const nav = mountNav()
    expect(nav.find('[data-k="Workers"]').attributes()).toMatchObject({
      href: '/workers',
      'data-link': '',
    })
    const overview = nav.find('[data-k="Overview"]')
    expect(overview.attributes('href')).toBe('#')
    expect(overview.attributes('data-link')).toBeUndefined()
    expect(nav.find('nuxtlink').exists()).toBe(false)
  })

  it('marks only the active section', () => {
    const nav = mountNav('KV')
    const active = nav.findAll('[aria-current="page"]')
    expect(active).toHaveLength(1)
    expect(active[0]!.attributes('data-k')).toBe('KV')
    expect(active[0]!.classes()).toContain('on')
  })

  it('shows counts from the fixture', () => {
    expect(mountNav().find('[data-k="Workers"] .cnt').text()).toBe('27')
    expect(mountNav().find('[data-k="Logs"] .cnt').exists()).toBe(false)
  })
})
