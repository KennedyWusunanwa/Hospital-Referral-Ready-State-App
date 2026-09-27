/**
 * Shared UI primitives.
 *
 * Deliberately small and dependency-free: every feature composes from this
 * file so that spacing, focus rings and dark-mode behaviour stay consistent
 * without a component-library upgrade treadmill.
 */

import {
  createContext,
  forwardRef,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Search,
  X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { READINESS_COLOR_CLASSES } from '@/domain/readiness'
import type { ReadinessStatus } from '@/lib/constants'

// ---------------------------------------------------------------------------
// Button
// ---------------------------------------------------------------------------

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success' | 'outline'
type ButtonSize = 'sm' | 'md' | 'lg' | 'icon'

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-brand-600 text-brand-fg hover:bg-brand-700 active:bg-brand-800 disabled:hover:bg-brand-600',
  secondary:
    'bg-slate-100 text-slate-900 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700',
  ghost:
    'bg-transparent text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
  danger: 'bg-red-600 text-white hover:bg-red-700 active:bg-red-800',
  success: 'bg-emerald-600 text-white hover:bg-emerald-700 active:bg-emerald-800',
  outline:
    'border border-slate-300 bg-white text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800',
}

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-xs gap-1.5',
  md: 'h-10 px-4 text-sm gap-2',
  lg: 'h-12 px-6 text-base gap-2',
  icon: 'h-10 w-10',
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  fullWidth?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = 'primary', size = 'md', loading, fullWidth, children, disabled, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center rounded-lg font-medium transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-50',
        BUTTON_VARIANTS[variant],
        BUTTON_SIZES[size],
        fullWidth && 'w-full',
        className,
      )}
      {...props}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
      {children}
    </button>
  )
})

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('card', className)} {...props} />
}

export function CardHeader({
  title,
  description,
  action,
  className,
}: {
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4 dark:border-slate-800',
        className,
      )}
    >
      <div className="min-w-0">
        <h2 className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
          {title}
        </h2>
        {description && <p className="mt-0.5 hint">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}

export function CardBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-5', className)} {...props} />
}

export function CardFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'flex items-center justify-end gap-2 border-t border-slate-200 px-5 py-3 dark:border-slate-800',
        className,
      )}
      {...props}
    />
  )
}

// ---------------------------------------------------------------------------
// Form controls
// ---------------------------------------------------------------------------

const CONTROL_BASE =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 ' +
  'focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 ' +
  'disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500 ' +
  'dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500 dark:disabled:bg-slate-800'

export interface FieldProps {
  label?: ReactNode
  hint?: ReactNode
  error?: string | null
  required?: boolean
  className?: string
  children: (props: { id: string; describedBy: string | undefined }) => ReactNode
}

/** Label + control + hint + error, wired up with the right aria attributes. */
export function Field({ label, hint, error, required, className, children }: FieldProps) {
  const id = useId()
  const hintId = hint ? `${id}-hint` : undefined
  const errorId = error ? `${id}-error` : undefined
  const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined

  return (
    <div className={cn('space-y-1.5', className)}>
      {label && (
        <label htmlFor={id} className="field-label">
          {label}
          {required && (
            <span className="ml-0.5 text-red-600" aria-hidden>
              *
            </span>
          )}
        </label>
      )}
      {children({ id, describedBy })}
      {error ? (
        <p id={errorId} role="alert" className="text-xs font-medium text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : (
        hint && (
          <p id={hintId} className="hint">
            {hint}
          </p>
        )
      )}
    </div>
  )
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return <input ref={ref} className={cn(CONTROL_BASE, className)} {...props} />
  },
)

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, ...props }, ref) {
  return <textarea ref={ref} className={cn(CONTROL_BASE, 'min-h-24', className)} {...props} />
})

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, children, ...props }, ref) {
    return (
      <div className="relative">
        <select
          ref={ref}
          className={cn(CONTROL_BASE, 'appearance-none pr-9', className)}
          {...props}
        >
          {children}
        </select>
        <ChevronDown
          className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
          aria-hidden
        />
      </div>
    )
  },
)

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: ReactNode
  description?: ReactNode
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { label, description, className, ...props },
  ref,
) {
  const id = useId()
  return (
    <div className={cn('flex items-start gap-2.5', className)}>
      <input
        ref={ref}
        id={id}
        type="checkbox"
        className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500 dark:border-slate-600 dark:bg-slate-800"
        {...props}
      />
      <div className="min-w-0">
        <label htmlFor={id} className="text-sm text-slate-800 dark:text-slate-200">
          {label}
        </label>
        {description && <p className="hint">{description}</p>}
      </div>
    </div>
  )
})

export interface ToggleProps {
  checked: boolean
  onChange: (checked: boolean) => void
  label: ReactNode
  description?: ReactNode
  disabled?: boolean
}

export function Toggle({ checked, onChange, label, description, disabled }: ToggleProps) {
  return (
    <label
      className={cn(
        'flex items-center justify-between gap-4',
        disabled && 'cursor-not-allowed opacity-60',
      )}
    >
      <span className="min-w-0">
        <span className="block text-sm font-medium text-slate-800 dark:text-slate-200">
          {label}
        </span>
        {description && <span className="block hint">{description}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative h-6 w-11 shrink-0 rounded-full transition-colors',
          checked ? 'bg-brand-600' : 'bg-slate-300 dark:bg-slate-700',
        )}
      >
        <span
          className={cn(
            'absolute left-0 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform',
            checked ? 'translate-x-[22px]' : 'translate-x-0.5',
          )}
        />
      </button>
    </label>
  )
}

// ---------------------------------------------------------------------------
// Badge / status
// ---------------------------------------------------------------------------

type BadgeTone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info'

const BADGE_TONES: Record<BadgeTone, string> = {
  neutral:
    'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700',
  brand:
    'bg-brand-50 text-brand-700 border-brand-200 dark:bg-brand-950/40 dark:text-brand-300 dark:border-brand-900',
  success:
    'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900',
  warning:
    'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900',
  danger:
    'bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-900',
  info: 'bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-900',
}

export function Badge({
  tone = 'neutral',
  className,
  children,
}: {
  tone?: BadgeTone
  className?: string
  children: ReactNode
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium',
        BADGE_TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}

/** The Green / Yellow / Red traffic light, with an accessible text label. */
export function StatusDot({
  status,
  label,
  pulse,
  className,
}: {
  status: ReadinessStatus
  label?: string
  pulse?: boolean
  className?: string
}) {
  const colors = READINESS_COLOR_CLASSES[status]
  return (
    <span className={cn('inline-flex items-center gap-1.5', className)}>
      <span className="relative flex h-2.5 w-2.5 shrink-0">
        {pulse && status !== 'green' && (
          <span
            className={cn(
              'absolute inline-flex h-full w-full animate-pulse-ring rounded-full',
              colors.dot,
            )}
          />
        )}
        <span className={cn('relative inline-flex h-2.5 w-2.5 rounded-full', colors.dot)} />
      </span>
      {label && <span className={cn('text-xs font-medium', colors.text)}>{label}</span>}
      <span className="sr-only">{status} readiness</span>
    </span>
  )
}

// ---------------------------------------------------------------------------
// Feedback
// ---------------------------------------------------------------------------

export function Alert({
  tone = 'info',
  title,
  children,
  className,
}: {
  tone?: 'info' | 'warning' | 'danger' | 'success'
  title?: ReactNode
  children?: ReactNode
  className?: string
}) {
  const tones = {
    info: 'border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-200',
    warning:
      'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200',
    danger:
      'border-red-200 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200',
    success:
      'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200',
  }
  return (
    <div role="status" className={cn('rounded-lg border p-3 text-sm', tones[tone], className)}>
      {title && <p className="font-semibold">{title}</p>}
      {children && <div className={cn(title && 'mt-1')}>{children}</div>}
    </div>
  )
}

export function Spinner({ className }: { className?: string }) {
  return (
    <Loader2
      className={cn('h-5 w-5 animate-spin text-slate-400', className)}
      role="status"
      aria-label="Loading"
    />
  )
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <div className={cn('animate-pulse rounded-md bg-slate-200 dark:bg-slate-800', className)} />
  )
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode
  title: string
  description?: string
  action?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn('flex flex-col items-center justify-center px-6 py-12 text-center', className)}
    >
      {icon && <div className="mb-3 text-slate-300 dark:text-slate-600">{icon}</div>}
      <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">{title}</p>
      {description && <p className="mt-1 max-w-sm hint">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function LoadingBlock({ label = 'Loading', rows = 3 }: { label?: string; rows?: number }) {
  return (
    <div className="space-y-3 p-5" aria-busy="true" aria-label={label}>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-12 w-full" />
      ))}
    </div>
  )
}

export function ErrorBlock({
  error,
  onRetry,
  className,
}: {
  error: unknown
  onRetry?: () => void
  className?: string
}) {
  const message = error instanceof Error ? error.message : String(error ?? 'Unknown error')
  return (
    <Alert tone="danger" title="Could not load this" className={className}>
      <p>{message}</p>
      {onRetry && (
        <Button variant="outline" size="sm" className="mt-2" onClick={onRetry}>
          Try again
        </Button>
      )}
    </Alert>
  )
}

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  description?: ReactNode
  children: ReactNode
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl'
}) {
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [open, onClose])

  if (!open) return null

  const sizes = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">
      <div
        className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
        className={cn(
          'relative z-10 max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-white shadow-xl animate-fade-in sm:rounded-2xl dark:bg-slate-900',
          sizes[size],
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">{title}</h2>
            {description && <p className="mt-0.5 hint">{description}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer && (
          <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-5 py-3 dark:border-slate-800">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

const TabsContext = createContext<{ value: string; setValue: (value: string) => void } | null>(null)

export function Tabs({
  defaultValue,
  value: controlled,
  onValueChange,
  children,
  className,
}: {
  defaultValue: string
  value?: string
  onValueChange?: (value: string) => void
  children: ReactNode
  className?: string
}) {
  const [internal, setInternal] = useState(defaultValue)
  const value = controlled ?? internal
  const setValue = (next: string) => {
    setInternal(next)
    onValueChange?.(next)
  }
  return (
    <TabsContext.Provider value={{ value, setValue }}>
      <div className={className}>{children}</div>
    </TabsContext.Provider>
  )
}

export function TabList({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      role="tablist"
      className={cn(
        'flex gap-1 overflow-x-auto border-b border-slate-200 dark:border-slate-800',
        className,
      )}
    >
      {children}
    </div>
  )
}

export function Tab({
  value,
  children,
  count,
}: {
  value: string
  children: ReactNode
  count?: number
}) {
  const context = useContext(TabsContext)
  if (!context) throw new Error('Tab must be used inside Tabs')
  const active = context.value === value
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={() => context.setValue(value)}
      className={cn(
        'whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors',
        active
          ? 'border-brand-600 text-brand-700 dark:text-brand-400'
          : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200',
      )}
    >
      {children}
      {count !== undefined && count > 0 && (
        <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 py-0.5 text-xs dark:bg-slate-800">
          {count}
        </span>
      )}
    </button>
  )
}

export function TabPanel({ value, children }: { value: string; children: ReactNode }) {
  const context = useContext(TabsContext)
  if (!context) throw new Error('TabPanel must be used inside Tabs')
  if (context.value !== value) return null
  return (
    <div role="tabpanel" className="animate-fade-in">
      {children}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Layout helpers
// ---------------------------------------------------------------------------

export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between',
        className,
      )}
    >
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-50">
          {title}
        </h1>
        {description && (
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{description}</p>
        )}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

export function Stat({
  label,
  value,
  sublabel,
  tone,
  icon,
}: {
  label: string
  value: ReactNode
  sublabel?: ReactNode
  tone?: BadgeTone
  icon?: ReactNode
}) {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
          {label}
        </p>
        {icon && <span className="text-slate-300 dark:text-slate-600">{icon}</span>}
      </div>
      <p className="mt-1.5 text-2xl font-semibold tabular-nums text-slate-900 dark:text-slate-50">
        {value}
      </p>
      {sublabel && (
        <div className="mt-1">
          {tone ? <Badge tone={tone}>{sublabel}</Badge> : <p className="hint">{sublabel}</p>}
        </div>
      )}
    </Card>
  )
}

/** Horizontal 0-100 meter, used for referral scores and availability bars. */
export function Meter({
  value,
  max = 100,
  tone = 'brand',
  className,
  label,
}: {
  value: number
  max?: number
  tone?: 'brand' | 'success' | 'warning' | 'danger'
  className?: string
  label?: string
}) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100))
  const fills = {
    brand: 'bg-brand-500',
    success: 'bg-emerald-500',
    warning: 'bg-amber-500',
    danger: 'bg-red-500',
  }
  return (
    <div
      className={cn(
        'h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800',
        className,
      )}
      role="meter"
      aria-valuenow={Math.round(value)}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-label={label}
    >
      <div
        className={cn('h-full rounded-full transition-all', fills[tone])}
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}

export function Divider({ className }: { className?: string }) {
  return <hr className={cn('border-slate-200 dark:border-slate-800', className)} />
}

/** A yes/no capability marker used throughout the readiness tables. */
export function BoolMark({ value, label }: { value: boolean; label?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm">
      {value ? (
        <Check className="h-4 w-4 text-emerald-600" aria-hidden />
      ) : (
        <X className="h-4 w-4 text-slate-300 dark:text-slate-600" aria-hidden />
      )}
      {label && (
        <span className={value ? 'text-slate-800 dark:text-slate-200' : 'text-slate-400'}>
          {label}
        </span>
      )}
      <span className="sr-only">{value ? 'available' : 'not available'}</span>
    </span>
  )
}

// ---------------------------------------------------------------------------
// Search and filters
// ---------------------------------------------------------------------------

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        'inline-flex h-5 min-w-5 items-center justify-center rounded border border-slate-200 bg-slate-50 px-1 font-sans text-[10px] font-medium text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400',
        className,
      )}
    >
      {children}
    </kbd>
  )
}

export interface SearchInputProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'onChange' | 'value' | 'type'
> {
  value: string
  onChange: (value: string) => void
  /** Styles the wrapper; `className` styles the input itself. */
  containerClassName?: string
  /** A keyboard hint shown on the right while the box is empty. */
  shortcut?: string
}

/** A search box with a clear button, styled like every other control. */
export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(function SearchInput(
  { value, onChange, containerClassName, className, shortcut, placeholder = 'Search', ...props },
  ref,
) {
  return (
    <div className={cn('relative', containerClassName)}>
      <Search
        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
        aria-hidden
      />
      <input
        ref={ref}
        type="search"
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className={cn(
          CONTROL_BASE,
          'pl-9 pr-9 [&::-webkit-search-cancel-button]:hidden',
          className,
        )}
        {...props}
      />
      {value ? (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="Clear search"
          className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      ) : shortcut ? (
        <Kbd className="absolute right-2 top-1/2 hidden -translate-y-1/2 sm:inline-flex">
          {shortcut}
        </Kbd>
      ) : null}
    </div>
  )
})

type ChipTone = 'brand' | 'success' | 'warning' | 'danger' | 'neutral'

const CHIP_ACTIVE: Record<ChipTone, string> = {
  brand: 'border-brand-600 bg-brand-600 text-brand-fg',
  success: 'border-emerald-600 bg-emerald-600 text-white',
  warning: 'border-amber-600 bg-amber-600 text-white',
  danger: 'border-red-600 bg-red-600 text-white',
  neutral:
    'border-slate-800 bg-slate-800 text-white dark:border-slate-200 dark:bg-slate-200 dark:text-slate-900',
}

/** A toggling filter pill. */
export function Chip({
  active,
  onClick,
  children,
  count,
  tone = 'brand',
  className,
  disabled,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
  count?: number
  tone?: ChipTone
  className?: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        active
          ? CHIP_ACTIVE[tone]
          : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-slate-600 dark:hover:bg-slate-800',
        className,
      )}
    >
      {children}
      {count !== undefined && (
        <span
          className={cn(
            'rounded-full px-1.5 text-[10px] tabular-nums',
            active ? 'bg-white/20' : 'bg-slate-100 dark:bg-slate-800',
          )}
        >
          {count}
        </span>
      )}
    </button>
  )
}

export interface SegmentedOption<T extends string> {
  value: T
  label: ReactNode
  icon?: ReactNode
  count?: number
}

/** A compact set of mutually exclusive choices -- tabs for a filter, not a page. */
export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
  size = 'md',
  className,
}: {
  value: T
  onChange: (value: T) => void
  options: ReadonlyArray<SegmentedOption<T>>
  ariaLabel: string
  size?: 'sm' | 'md'
  className?: string
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn(
        'inline-flex max-w-full items-center gap-0.5 overflow-x-auto rounded-lg bg-slate-100 p-0.5 dark:bg-slate-800',
        className,
      )}
    >
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={cn(
              'inline-flex shrink-0 items-center gap-1.5 rounded-md font-medium transition-colors',
              size === 'sm' ? 'h-7 px-2.5 text-xs' : 'h-8 px-3 text-sm',
              active
                ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-slate-50'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100',
            )}
          >
            {option.icon}
            {option.label}
            {option.count !== undefined && option.count > 0 && (
              <span className="rounded-full bg-slate-200 px-1.5 text-[10px] tabular-nums text-slate-700 dark:bg-slate-700 dark:text-slate-200">
                {option.count > 999 ? '999+' : option.count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

/**
 * The card that holds a screen's filters. The footer appears only when there is
 * something to say: how many rows match, and a way to clear what is set.
 */
export function FilterBar({
  children,
  activeCount = 0,
  onClear,
  summary,
  gridClassName = 'grid gap-3 sm:grid-cols-2 lg:grid-cols-4',
  className,
}: {
  children: ReactNode
  activeCount?: number
  onClear?: () => void
  summary?: ReactNode
  gridClassName?: string
  className?: string
}) {
  const showFooter = Boolean(summary) || (activeCount > 0 && Boolean(onClear))
  return (
    <Card className={cn('p-3 sm:p-4', className)}>
      <div className={gridClassName}>{children}</div>
      {showFooter && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
          <p className="hint" aria-live="polite">
            {summary}
          </p>
          {activeCount > 0 && onClear && (
            <Button variant="ghost" size="sm" onClick={onClear}>
              <X className="h-4 w-4" aria-hidden />
              Clear {activeCount} {activeCount === 1 ? 'filter' : 'filters'}
            </Button>
          )}
        </div>
      )}
    </Card>
  )
}

export function Pagination({
  page,
  pageCount,
  onChange,
  total,
  pageSize,
  noun = 'entries',
  busy,
  className,
}: {
  page: number
  pageCount: number
  onChange: (page: number) => void
  total?: number
  pageSize?: number
  noun?: string
  busy?: boolean
  className?: string
}) {
  const first = total && pageSize ? Math.min(total, (page - 1) * pageSize + 1) : null
  const last = total && pageSize ? Math.min(total, page * pageSize) : null
  return (
    <div className={cn('flex flex-wrap items-center justify-between gap-2', className)}>
      <span className="hint tabular-nums">
        {total !== undefined
          ? total === 0
            ? `No ${noun}`
            : first !== null && last !== null
              ? `${first}-${last} of ${total} ${noun}`
              : `${total} ${noun}`
          : `Page ${page} of ${pageCount}`}
      </span>
      <span className="flex items-center gap-1">
        <Button
          variant="outline"
          size="sm"
          disabled={page <= 1 || busy}
          onClick={() => onChange(page - 1)}
          aria-label="Previous page"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden />
          Previous
        </Button>
        <span className="px-2 text-xs tabular-nums text-slate-500 dark:text-slate-400">
          {page} / {Math.max(1, pageCount)}
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={page >= pageCount || busy}
          onClick={() => onChange(page + 1)}
          aria-label="Next page"
        >
          Next
          <ChevronRight className="h-4 w-4" aria-hidden />
        </Button>
      </span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

const AVATAR_SIZES = {
  xs: 'h-6 w-6 text-[10px]',
  sm: 'h-8 w-8 text-xs',
  md: 'h-9 w-9 text-xs',
  lg: 'h-12 w-12 text-sm',
}

export function Avatar({
  name,
  src,
  size = 'md',
  className,
}: {
  name: string | null | undefined
  src?: string | null
  size?: keyof typeof AVATAR_SIZES
  className?: string
}) {
  const letters = (() => {
    const parts = (name ?? '').trim().split(/\s+/).filter(Boolean)
    if (parts.length === 0) return '?'
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
  })()
  return (
    <span
      aria-hidden
      className={cn(
        'inline-grid shrink-0 place-items-center overflow-hidden rounded-full bg-slate-200 font-semibold text-slate-700 dark:bg-slate-700 dark:text-slate-200',
        AVATAR_SIZES[size],
        className,
      )}
    >
      {src ? <img src={src} alt="" className="h-full w-full object-cover" /> : letters}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Icon button and menu
// ---------------------------------------------------------------------------

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Announced to assistive tech and shown as a tooltip. */
  label: string
  size?: 'sm' | 'md'
  active?: boolean
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, size = 'md', active, className, children, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        'grid shrink-0 place-items-center rounded-lg text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-slate-100',
        size === 'md' ? 'tap-target' : 'h-8 w-8',
        active && 'bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-100',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  )
})

/**
 * A small dropdown anchored to its trigger. Closes on outside click, Escape and
 * on selecting an item. Enough for a settings menu; not a full combobox.
 */
export function Menu({
  trigger,
  children,
  align = 'end',
  label,
  className,
  menuClassName,
}: {
  trigger: (state: { open: boolean; toggle: () => void }) => ReactNode
  children: ReactNode | ((close: () => void) => ReactNode)
  align?: 'start' | 'end'
  label?: string
  className?: string
  menuClassName?: string
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('touchstart', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('touchstart', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const close = () => setOpen(false)

  return (
    <div ref={ref} className={cn('relative inline-block', className)}>
      {trigger({ open, toggle: () => setOpen((value) => !value) })}
      {open && (
        <div
          role="menu"
          aria-label={label}
          className={cn(
            'absolute z-40 mt-1.5 min-w-48 overflow-hidden rounded-xl border border-slate-200 bg-white p-1 shadow-lg animate-fade-in dark:border-slate-700 dark:bg-slate-900',
            align === 'end' ? 'right-0' : 'left-0',
            menuClassName,
          )}
        >
          {typeof children === 'function' ? children(close) : children}
        </div>
      )}
    </div>
  )
}

export function MenuItem({
  icon,
  children,
  description,
  onSelect,
  active,
  danger,
  disabled,
}: {
  icon?: ReactNode
  children: ReactNode
  description?: ReactNode
  onSelect: () => void
  active?: boolean
  danger?: boolean
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        'flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        danger
          ? 'text-red-700 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950/40'
          : 'text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800',
        active && !danger && 'bg-brand-50 text-brand-700 dark:bg-brand-950/40 dark:text-brand-300',
      )}
    >
      {icon && <span className="mt-0.5 shrink-0 opacity-70">{icon}</span>}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{children}</span>
        {description && <span className="block hint">{description}</span>}
      </span>
      {active && <Check className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />}
    </button>
  )
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return (
    <p className="px-2.5 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
      {children}
    </p>
  )
}

export function MenuSeparator() {
  return <div role="separator" className="my-1 h-px bg-slate-100 dark:bg-slate-800" />
}

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

export const TH_CLASS =
  'border-b border-slate-200 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:text-slate-400'
export const TD_CLASS =
  'border-b border-slate-100 px-3 py-2.5 align-middle dark:border-slate-800/70'

export function Table({
  children,
  minWidth = '48rem',
  className,
}: {
  children: ReactNode
  minWidth?: string
  className?: string
}) {
  return (
    <div className="overflow-x-auto">
      <table className={cn('w-full border-collapse text-sm', className)} style={{ minWidth }}>
        {children}
      </table>
    </div>
  )
}

export type SortDirection = 'asc' | 'desc'

export function Th({
  children,
  className,
  align = 'left',
  sortable,
  active,
  direction,
  onSort,
}: {
  children?: ReactNode
  className?: string
  align?: 'left' | 'right' | 'center'
  sortable?: boolean
  active?: boolean
  direction?: SortDirection
  onSort?: () => void
}) {
  const alignment =
    align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left'
  if (!sortable) {
    return (
      <th scope="col" className={cn(TH_CLASS, alignment, className)}>
        {children}
      </th>
    )
  }
  const Icon = !active ? ArrowUpDown : direction === 'asc' ? ArrowUp : ArrowDown
  return (
    <th
      scope="col"
      aria-sort={active ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={cn(TH_CLASS, alignment, 'p-0', className)}
    >
      <button
        type="button"
        onClick={onSort}
        className={cn(
          'inline-flex w-full items-center gap-1 px-3 py-2 text-xs font-semibold uppercase tracking-wide transition-colors hover:text-slate-800 dark:hover:text-slate-200',
          align === 'right' && 'justify-end',
          active && 'text-slate-900 dark:text-slate-100',
        )}
      >
        {children}
        <Icon className="h-3.5 w-3.5" aria-hidden />
      </button>
    </th>
  )
}

export function Td({
  children,
  className,
  align = 'left',
  colSpan,
}: {
  children?: ReactNode
  className?: string
  align?: 'left' | 'right' | 'center'
  colSpan?: number
}) {
  return (
    <td
      colSpan={colSpan}
      className={cn(
        TD_CLASS,
        align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left',
        className,
      )}
    >
      {children}
    </td>
  )
}
