import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import {
  DEFAULT_TIMEZONE,
  REFERRAL_RESPONSE_TARGET_MINUTES,
  ROLE_CAPABILITIES,
  type Capability,
  type UserRole,
} from './constants'

/** Tailwind-aware class joiner. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

// ---------------------------------------------------------------------------
// Authorisation helpers (UI affordances only -- RLS is the real boundary)
// ---------------------------------------------------------------------------

export function can(role: UserRole | null | undefined, capability: Capability): boolean {
  if (!role) return false
  const capabilities = ROLE_CAPABILITIES[role] as readonly string[] | undefined
  return capabilities?.includes(capability) ?? false
}

export function canAny(role: UserRole | null | undefined, capabilities: Capability[]): boolean {
  return capabilities.some((capability) => can(role, capability))
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

export function formatDateTime(
  value: string | Date | null | undefined,
  timeZone: string = DEFAULT_TIMEZONE,
): string {
  if (!value) return '-'
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone,
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(date)
  } catch {
    return date.toISOString().slice(0, 16).replace('T', ' ')
  }
}

export function formatTime(
  value: string | Date | null | undefined,
  timeZone: string = DEFAULT_TIMEZONE,
): string {
  if (!value) return '-'
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(date)
  } catch {
    return date.toISOString().slice(11, 16)
  }
}

export function formatDate(
  value: string | Date | null | undefined,
  timeZone: string = DEFAULT_TIMEZONE,
): string {
  if (!value) return '-'
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone,
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    }).format(date)
  } catch {
    return date.toISOString().slice(0, 10)
  }
}

/** "just now", "12 min ago", "3 h ago", "5 d ago". */
export function relativeTime(value: string | Date | null | undefined, now = new Date()): string {
  if (!value) return 'never'
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return 'never'

  const seconds = Math.round((now.getTime() - date.getTime()) / 1000)
  const future = seconds < 0
  const abs = Math.abs(seconds)

  const render = (n: number, unit: string) =>
    future ? `in ${n} ${unit}` : `${n} ${unit} ago`

  if (abs < 45) return future ? 'shortly' : 'just now'
  if (abs < 3600) return render(Math.round(abs / 60), 'min')
  if (abs < 86400) return render(Math.round(abs / 3600), 'h')
  if (abs < 2_592_000) return render(Math.round(abs / 86400), 'd')
  return formatDate(date)
}

/** Seconds -> "4 m 12 s" / "1 h 05 m". */
export function formatSeconds(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '-'
  const total = Math.max(0, Math.round(seconds))
  if (total < 60) return `${total} s`
  const minutes = Math.floor(total / 60)
  if (minutes < 60) return `${minutes} m ${String(total % 60).padStart(2, '0')} s`
  const hours = Math.floor(minutes / 60)
  return `${hours} h ${String(minutes % 60).padStart(2, '0')} m`
}

export function formatPercent(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '-'
  return `${value.toFixed(digits)}%`
}

export function initials(name: string | null | undefined): string {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

/** A pending referral that has gone unanswered longer than the target. */
export function isReferralOverdue(requestedAt: string, now = new Date()): boolean {
  const elapsedMinutes = (now.getTime() - new Date(requestedAt).getTime()) / 60000
  return elapsedMinutes > REFERRAL_RESPONSE_TARGET_MINUTES
}

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

/** Digits-only tel: href, so the "call" button works on a phone. */
export function telHref(phone: string | null | undefined): string | undefined {
  if (!phone) return undefined
  const cleaned = phone.replace(/[^\d+]/g, '')
  return cleaned.length >= 5 ? `tel:${cleaned}` : undefined
}

export function groupBy<T, K extends string | number>(
  items: T[],
  keyOf: (item: T) => K,
): Record<K, T[]> {
  return items.reduce(
    (acc, item) => {
      const key = keyOf(item)
      ;(acc[key] ||= []).push(item)
      return acc
    },
    {} as Record<K, T[]>,
  )
}

export function sum(values: Array<number | null | undefined>): number {
  return values.reduce<number>((total, value) => total + (value ?? 0), 0)
}

export function median(values: number[]): number | null {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b)
  if (sorted.length === 0) return null
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

export function unique<T>(items: T[]): T[] {
  return [...new Set(items)]
}

/** RFC4180-ish CSV, safe against formula injection in spreadsheet apps. */
export function toCsv(rows: Array<Record<string, unknown>>, columns?: string[]): string {
  if (rows.length === 0) return ''
  const headers = columns ?? Object.keys(rows[0])

  const escape = (value: unknown): string => {
    if (value === null || value === undefined) return ''
    let text = String(value)
    if (/^[=+\-@]/.test(text)) text = `'${text}`
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
  }

  return [
    headers.map(escape).join(','),
    ...rows.map((row) => headers.map((header) => escape(row[header])).join(',')),
  ].join('\r\n')
}

export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename.endsWith('.csv') ? filename : `${filename}.csv`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

/** Non-identifying patient reference, e.g. "PT-7K3QF2". */
export function generatePatientRef(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const bytes = new Uint8Array(6)
  crypto.getRandomValues(bytes)
  const body = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('')
  return `PT-${body}`
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
