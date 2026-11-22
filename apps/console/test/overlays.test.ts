import { beforeEach, describe, expect, it, vi } from 'vitest'

const route = { query: {} as Record<string, unknown> }
vi.mock('vue-router', () => ({ useRoute: () => route }))

const { useOverlays } = await import('~/composables/overlays')

describe('useOverlays', () => {
  beforeEach(() => {
    route.query = {}
  })

  it('starts with every overlay closed', () => {
    const overlays = useOverlays(['create', 'row'] as const)
    expect(overlays.isOpen('create')).toBe(false)
    expect(overlays.isOpen('row')).toBe(false)
  })

  it('opens everything for ?states=open to reproduce the boards', () => {
    route.query = { states: 'open' }
    const overlays = useOverlays(['create', 'row'] as const)
    expect(overlays.isOpen('create')).toBe(true)
    expect(overlays.isOpen('row')).toBe(true)
  })

  it('ignores other values of the states parameter', () => {
    for (const states of ['1', 'OPEN', ['open'], '']) {
      route.query = { states }
      expect(useOverlays(['create'] as const).isOpen('create')).toBe(false)
    }
  })

  it('toggles and closes overlays independently', () => {
    const overlays = useOverlays(['create', 'row'] as const)
    overlays.toggle('create')
    expect(overlays.isOpen('create')).toBe(true)
    expect(overlays.isOpen('row')).toBe(false)
    overlays.toggle('create')
    expect(overlays.isOpen('create')).toBe(false)
    overlays.toggle('row')
    overlays.close('row')
    overlays.close('row')
    expect(overlays.isOpen('row')).toBe(false)
  })
})
