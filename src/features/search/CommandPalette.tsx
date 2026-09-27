/**
 * Search everywhere. Ctrl+K (or ⌘K) on any screen, the search box in the
 * header, or "/" when nothing else has focus.
 *
 * It is a jump list, not a report: it takes the person to the hospital,
 * referral, department, person or page they typed, in as few keystrokes as
 * possible, and stays out of the way otherwise.
 */

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { CornerDownLeft, Loader2, Search, X } from 'lucide-react'
import { Kbd } from '@/components/ui'
import { cn } from '@/lib/utils'
import { clearRecent, rememberRecent, useGlobalSearch, type SearchItem } from './useGlobalSearch'

export interface CommandPaletteProps {
  open: boolean
  onClose: () => void
}

/** True on Apple platforms, where the shortcut is shown as ⌘K instead of Ctrl K. */
export function isApplePlatform(): boolean {
  if (typeof navigator === 'undefined') return false
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform) || /Mac OS X/.test(navigator.userAgent)
}

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const navigate = useNavigate()
  const [term, setTerm] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const [recentRevision, setRecentRevision] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const { groups, loading, empty } = useGlobalSearch(term, open, recentRevision)

  const flat = useMemo(() => groups.flatMap((group) => group.items), [groups])

  useEffect(() => {
    if (!open) return
    setTerm('')
    setActiveIndex(0)
    const timer = window.setTimeout(() => inputRef.current?.focus(), 10)
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.clearTimeout(timer)
      document.body.style.overflow = previous
    }
  }, [open])

  useEffect(() => {
    setActiveIndex(0)
  }, [term])

  useEffect(() => {
    if (activeIndex >= flat.length) setActiveIndex(Math.max(0, flat.length - 1))
  }, [flat.length, activeIndex])

  useEffect(() => {
    const element = document.getElementById(`palette-item-${activeIndex}`)
    element?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  if (!open) return null

  const select = (item: SearchItem) => {
    if (item.to) {
      rememberRecent({ id: item.id, title: item.title, subtitle: item.subtitle, to: item.to })
      navigate(item.to)
    }
    item.run?.()
    onClose()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        setActiveIndex((index) => (flat.length === 0 ? 0 : (index + 1) % flat.length))
        break
      case 'ArrowUp':
        event.preventDefault()
        setActiveIndex((index) => (flat.length === 0 ? 0 : (index - 1 + flat.length) % flat.length))
        break
      case 'Enter': {
        event.preventDefault()
        const item = flat[activeIndex]
        if (item) select(item)
        break
      }
      case 'Escape':
        event.preventDefault()
        onClose()
        break
      default:
        break
    }
  }

  let runningIndex = -1

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center p-4 pt-[max(1rem,8vh)]"
      role="dialog"
      aria-modal="true"
      aria-label="Search"
    >
      <div
        className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm animate-overlay-in"
        onClick={onClose}
        aria-hidden
      />

      <div className="relative z-10 flex max-h-[min(36rem,80vh)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl animate-fade-in dark:border-slate-700 dark:bg-slate-900">
        <div className="flex items-center gap-3 border-b border-slate-200 px-4 dark:border-slate-800">
          {loading ? (
            <Loader2 className="h-5 w-5 shrink-0 animate-spin text-slate-400" aria-hidden />
          ) : (
            <Search className="h-5 w-5 shrink-0 text-slate-400" aria-hidden />
          )}
          <input
            ref={inputRef}
            type="text"
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search hospitals, referrals, departments, people, pages"
            aria-label="Search"
            aria-activedescendant={flat.length > 0 ? `palette-item-${activeIndex}` : undefined}
            aria-controls="palette-results"
            aria-expanded
            role="combobox"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            className="h-14 min-w-0 flex-1 bg-transparent text-base text-slate-900 placeholder:text-slate-400 focus:outline-none dark:text-slate-50 dark:placeholder:text-slate-500"
          />
          {term ? (
            <button
              type="button"
              onClick={() => setTerm('')}
              aria-label="Clear"
              className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          ) : (
            <Kbd className="hidden sm:inline-flex">Esc</Kbd>
          )}
        </div>

        <div id="palette-results" role="listbox" className="min-h-0 flex-1 overflow-y-auto p-2">
          {empty ? (
            <div className="px-3 py-10 text-center">
              <p className="text-sm font-medium text-slate-800 dark:text-slate-200">
                {loading ? 'Searching…' : term ? `Nothing matches “${term}”` : 'Type to search'}
              </p>
              <p className="mt-1 hint">
                Try a hospital name or code, a referral reference such as FERN-20250101-0001, a
                patient code, or a colleague&rsquo;s email.
              </p>
            </div>
          ) : (
            groups.map((group) => (
              <div key={group.key} className="mb-1">
                <div className="flex items-center justify-between px-2.5 pb-1 pt-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                    {group.label}
                  </p>
                  {group.key === 'recent' && (
                    <button
                      type="button"
                      onClick={() => {
                        clearRecent()
                        setRecentRevision((value) => value + 1)
                      }}
                      className="text-[11px] font-medium text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                    >
                      Clear
                    </button>
                  )}
                </div>
                {group.items.map((item) => {
                  runningIndex += 1
                  const index = runningIndex
                  const active = index === activeIndex
                  return (
                    <button
                      key={item.id}
                      id={`palette-item-${index}`}
                      type="button"
                      role="option"
                      aria-selected={active}
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => select(item)}
                      className={cn(
                        'flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors',
                        active
                          ? 'bg-brand-50 text-brand-900 dark:bg-brand-950/50 dark:text-brand-100'
                          : 'text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800/60',
                      )}
                    >
                      <span
                        className={cn(
                          'grid h-8 w-8 shrink-0 place-items-center rounded-lg',
                          active
                            ? 'text-brand-700 dark:text-brand-300'
                            : 'text-slate-400 dark:text-slate-500',
                        )}
                      >
                        {item.icon ?? <Search className="h-4 w-4" aria-hidden />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{item.title}</span>
                        {item.subtitle && (
                          <span className="block truncate text-xs text-slate-500 dark:text-slate-400">
                            {item.subtitle}
                          </span>
                        )}
                      </span>
                      {item.trailing && <span className="shrink-0">{item.trailing}</span>}
                      {active && (
                        <CornerDownLeft className="h-4 w-4 shrink-0 text-brand-500" aria-hidden />
                      )}
                    </button>
                  )
                })}
              </div>
            ))
          )}
        </div>

        <div className="hidden items-center gap-4 border-t border-slate-200 px-4 py-2 text-[11px] text-slate-500 sm:flex dark:border-slate-800 dark:text-slate-400">
          <span className="inline-flex items-center gap-1">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd> navigate
          </span>
          <span className="inline-flex items-center gap-1">
            <Kbd>↵</Kbd> open
          </span>
          <span className="inline-flex items-center gap-1">
            <Kbd>Esc</Kbd> close
          </span>
          <span className="ml-auto">
            {isApplePlatform() ? '⌘K' : 'Ctrl K'} opens this from anywhere
          </span>
        </div>
      </div>
    </div>
  )
}
