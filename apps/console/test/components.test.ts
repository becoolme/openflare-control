import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { defineComponent, h } from 'vue'
import BindingChip from '~/components/resource/BindingChip.vue'
import Badge from '~/components/ui/Badge.vue'
import Button from '~/components/ui/Button.vue'
import Icon from '~/components/ui/Icon.vue'
import IconButton from '~/components/ui/IconButton.vue'

/** Renders NuxtLink as a plain anchor so tests do not need a router. */
const NuxtLink = defineComponent({
  inheritAttrs: false,
  props: { to: { type: [String, Object], required: true } },
  setup(props, { slots, attrs }) {
    return () => h('a', { ...attrs, href: String(props.to), 'data-link': '' }, slots.default?.())
  },
})
const global = { components: { NuxtLink } }

describe('UiIcon', () => {
  it('renders a decorative svg at the requested size', () => {
    const svg = mount(Icon, { props: { name: 'plus', size: 12 } }).find('svg')
    expect(svg.attributes()).toMatchObject({ width: '12', height: '12', 'aria-hidden': 'true' })
    expect(svg.element.innerHTML).not.toBe('')
  })

  it('defaults to 14px and has a spinner variant', () => {
    expect(mount(Icon, { props: { name: 'plus' } }).attributes('width')).toBe('14')
    expect(mount(Icon, { props: { name: 'spin' } }).classes()).toContain('spin')
  })
})

describe('UiBadge', () => {
  it('maps tone to the design class and renders an optional dot', () => {
    const plain = mount(Badge, { props: { tone: 'ok' }, slots: { default: 'LIVE' } })
    expect(plain.classes()).toEqual(['badge', 'b-ok'])
    expect(plain.find('i').exists()).toBe(false)
    expect(plain.text()).toBe('LIVE')
    const dotted = mount(Badge, { props: { tone: 'err', dot: true }, slots: { default: 'ERRORS' } })
    expect(dotted.element.outerHTML).toBe('<span class="badge b-err"><i></i>ERRORS</span>')
  })
})

describe('UiButton', () => {
  it('renders a typed button by default', () => {
    const wrapper = mount(Button, {
      props: { variant: 'primary', size: 'sm' },
      slots: { default: 'Create' },
      global,
    })
    expect(wrapper.element.tagName).toBe('BUTTON')
    expect(wrapper.attributes('type')).toBe('button')
    expect(wrapper.classes()).toEqual(['btn', 'btn-p', 'btn-sm'])
  })

  it('renders an in-app link for `to` and an anchor for `href`', () => {
    const link = mount(Button, { props: { variant: 'secondary', to: '/storage' }, global })
    expect(link.attributes()).toMatchObject({ href: '/storage', 'data-link': '' })
    expect(link.classes()).toEqual(['btn', 'btn-s'])
    const anchor = mount(Button, { props: { href: '#bindings' }, global })
    expect(anchor.element.tagName).toBe('A')
    expect(anchor.attributes('data-link')).toBeUndefined()
    expect(anchor.attributes('href')).toBe('#bindings')
  })

  it('forwards click listeners', async () => {
    let clicks = 0
    const wrapper = mount(Button, { attrs: { onClick: () => clicks++ }, global })
    await wrapper.trigger('click')
    expect(clicks).toBe(1)
  })
})

describe('UiIconButton', () => {
  it('labels the icon-only control', () => {
    const wrapper = mount(IconButton, { props: { icon: 'x', label: 'Close drawer' }, global })
    expect(wrapper.element.tagName).toBe('BUTTON')
    expect(wrapper.attributes('aria-label')).toBe('Close drawer')
    expect(wrapper.classes()).toEqual(['ib'])
  })

  it('becomes a link when given a route', () => {
    const wrapper = mount(IconButton, {
      props: { icon: 'ext', label: 'Open', to: '/workers' },
      global,
    })
    expect(wrapper.attributes()).toMatchObject({
      href: '/workers',
      'aria-label': 'Open',
      class: 'ib',
    })
  })
})

describe('ResourceBindingChip', () => {
  it('uses the default label for a kind', () => {
    const wrapper = mount(BindingChip, { props: { kind: 'sv' }, slots: { default: () => ' 1' } })
    expect(wrapper.element.outerHTML).toBe('<span class="bnd sv"><b>SVC</b> 1</span>')
  })

  it('lets the board override the label', () => {
    const wrapper = mount(BindingChip, { props: { kind: 'kv', label: 'SESSIONS' } })
    expect(wrapper.find('b').text()).toBe('SESSIONS')
  })
})
