/**
 * Filter state that lives in the URL.
 *
 * Every list screen keeps its search box, chips and selects here rather than in
 * component state, so that the browser back button returns to the same view, a
 * filtered list can be bookmarked or pasted into a chat, and a hard refresh on
 * a ward terminal does not throw the filters away. Only values that differ from
 * the defaults are written, so an untouched screen keeps a clean address.
 */

import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'

export type UrlStateValue = string | number | boolean | string[]
export type UrlStateShape = Record<string, UrlStateValue>

const LIST_SEPARATOR = ','

export function parseUrlState<T extends UrlStateShape>(params: URLSearchParams, defaults: T): T {
  const result: Record<string, UrlStateValue> = { ...defaults }

  for (const key of Object.keys(defaults)) {
    const fallback = defaults[key]
    const raw = params.get(key)
    if (raw === null) continue

    if (Array.isArray(fallback)) {
      result[key] = raw === '' ? [] : raw.split(LIST_SEPARATOR).filter(Boolean)
    } else if (typeof fallback === 'boolean') {
      result[key] = raw === '1' || raw === 'true'
    } else if (typeof fallback === 'number') {
      const parsed = Number(raw)
      result[key] = Number.isFinite(parsed) ? parsed : fallback
    } else {
      result[key] = raw
    }
  }

  return result as T
}

/**
 * Writes `state` over `base`, dropping anything equal to its default. Keys the
 * shape does not know about are left untouched, so two independent widgets can
 * share one address.
 */
export function serializeUrlState<T extends UrlStateShape>(
  state: T,
  defaults: T,
  base?: URLSearchParams,
): URLSearchParams {
  const next = new URLSearchParams(base)

  for (const key of Object.keys(defaults)) {
    const value = state[key]
    const fallback = defaults[key]

    let text: string | null
    if (Array.isArray(value)) {
      const sorted = [...value].sort()
      const same =
        Array.isArray(fallback) &&
        sorted.length === fallback.length &&
        sorted.every((item, index) => item === [...fallback].sort()[index])
      text = same ? null : sorted.join(LIST_SEPARATOR)
    } else if (typeof value === 'boolean') {
      text = value === fallback ? null : value ? '1' : '0'
    } else if (typeof value === 'number') {
      text = value === fallback ? null : String(value)
    } else {
      text = value === fallback || value === '' ? null : value
    }

    if (text === null) next.delete(key)
    else next.set(key, text)
  }

  return next
}

export interface UseUrlState<T extends UrlStateShape> {
  state: T
  /** Merges a partial update. Pass `undefined` for a key to restore its default. */
  update: (patch: Partial<T>) => void
  /** Restores every key in the shape to its default, except any listed in `keep`. */
  reset: (keep?: ReadonlyArray<keyof T> | unknown) => void
  /** True when any value differs from its default. */
  dirty: boolean
}

/**
 * `defaults` must be referentially stable -- declare it once at module level.
 * Its keys define the shape and its values define both the types and what
 * counts as "no filter".
 */
export function useUrlState<T extends UrlStateShape>(defaults: T): UseUrlState<T> {
  const [params, setParams] = useSearchParams()

  const state = useMemo(() => parseUrlState(params, defaults), [params, defaults])

  const update = useCallback(
    (patch: Partial<T>) => {
      setParams(
        (previous) => {
          const current = parseUrlState(previous, defaults)
          const merged: Record<string, UrlStateValue> = { ...current }
          for (const key of Object.keys(patch)) {
            const value = patch[key]
            merged[key] = value === undefined ? defaults[key] : (value as UrlStateValue)
          }
          return serializeUrlState(merged as T, defaults, previous)
        },
        { replace: true },
      )
    },
    [defaults, setParams],
  )

  const reset = useCallback(
    (keep?: ReadonlyArray<keyof T> | unknown) => {
      // Tolerates `onClick={() => reset()}`: a click event is not a list of keys.
      const keys = Array.isArray(keep) ? keep : []
      setParams(
        (previous) => {
          const current = parseUrlState(previous, defaults)
          const next: Record<string, UrlStateValue> = { ...defaults }
          for (const key of keys) next[key as string] = current[key]
          return serializeUrlState(next as T, defaults, previous)
        },
        { replace: true },
      )
    },
    [defaults, setParams],
  )

  const dirty = useMemo(
    () => serializeUrlState(state, defaults).toString() !== '',
    [state, defaults],
  )

  return { state, update, reset, dirty }
}
