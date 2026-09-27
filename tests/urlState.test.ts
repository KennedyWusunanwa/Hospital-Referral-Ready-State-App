import { describe, expect, it } from 'vitest'
import { parseUrlState, serializeUrlState } from '@/lib/useUrlState'

const DEFAULTS = {
  q: '',
  status: [] as string[],
  accepting: false,
  page: 1,
  sort: 'newest',
}

describe('parseUrlState', () => {
  it('returns the defaults for an empty address', () => {
    expect(parseUrlState(new URLSearchParams(), DEFAULTS)).toEqual(DEFAULTS)
  })

  it('reads every supported type back from the address', () => {
    const params = new URLSearchParams(
      'q=korle&status=pending,accepted&accepting=1&page=3&sort=oldest',
    )
    expect(parseUrlState(params, DEFAULTS)).toEqual({
      q: 'korle',
      status: ['pending', 'accepted'],
      accepting: true,
      page: 3,
      sort: 'oldest',
    })
  })

  it('falls back to the default for a malformed number', () => {
    expect(parseUrlState(new URLSearchParams('page=abc'), DEFAULTS).page).toBe(1)
  })

  it('treats an empty list parameter as no selection', () => {
    expect(parseUrlState(new URLSearchParams('status='), DEFAULTS).status).toEqual([])
  })

  it('ignores parameters the shape does not know about', () => {
    const state = parseUrlState(new URLSearchParams('other=1&q=x'), DEFAULTS)
    expect(state).toEqual({ ...DEFAULTS, q: 'x' })
  })
})

describe('serializeUrlState', () => {
  it('writes nothing for an untouched screen', () => {
    expect(serializeUrlState(DEFAULTS, DEFAULTS).toString()).toBe('')
  })

  it('writes only the values that differ from their defaults', () => {
    const params = serializeUrlState({ ...DEFAULTS, q: 'tema', page: 2 }, DEFAULTS)
    expect(params.get('q')).toBe('tema')
    expect(params.get('page')).toBe('2')
    expect(params.has('sort')).toBe(false)
    expect(params.has('accepting')).toBe(false)
  })

  it('sorts list values so the same selection always gives the same address', () => {
    const a = serializeUrlState({ ...DEFAULTS, status: ['pending', 'accepted'] }, DEFAULTS)
    const b = serializeUrlState({ ...DEFAULTS, status: ['accepted', 'pending'] }, DEFAULTS)
    expect(a.toString()).toBe(b.toString())
    expect(a.get('status')).toBe('accepted,pending')
  })

  it('leaves parameters owned by other widgets alone', () => {
    const base = new URLSearchParams('tab=all&q=old')
    const params = serializeUrlState({ ...DEFAULTS, q: 'new' }, DEFAULTS, base)
    expect(params.get('tab')).toBe('all')
    expect(params.get('q')).toBe('new')
  })

  it('round-trips through parse', () => {
    const state = { q: 'ridge', status: ['declined'], accepting: true, page: 4, sort: 'urgency' }
    expect(parseUrlState(serializeUrlState(state, DEFAULTS), DEFAULTS)).toEqual(state)
  })
})
