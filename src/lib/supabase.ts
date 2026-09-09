import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './database.types'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

/**
 * Fail loudly and early. A silently unconfigured client produces a wall of
 * "Failed to fetch" errors deep inside the app; this points straight at the
 * missing environment variable instead.
 */
function assertConfigured(): void {
  const missing: string[] = []
  if (!url) missing.push('VITE_SUPABASE_URL')
  if (!anonKey) missing.push('VITE_SUPABASE_ANON_KEY')
  if (missing.length > 0) {
    throw new Error(
      `Supabase is not configured. Missing ${missing.join(', ')}. ` +
        'Copy .env.example to .env and fill in your project credentials.',
    )
  }
}

assertConfigured()

export const supabase: SupabaseClient<Database> = createClient<Database>(url, anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    // Sessions are scoped to this tab's storage; a shared ward terminal should
    // not silently keep a clinician signed in across browser profiles.
    storageKey: 'fern.auth',
    flowType: 'pkce',
  },
  global: {
    headers: { 'x-application-name': 'fern-web' },
  },
  realtime: {
    params: { eventsPerSecond: 5 },
  },
  db: { schema: 'public' },
})

export const isSupabaseConfigured = Boolean(url && anonKey)

/**
 * Turn a PostgREST / GoTrue error into something a clinician can act on.
 * Raw Postgres errors leak schema detail and read as noise at 3am.
 */
export function humanizeSupabaseError(error: unknown): string {
  if (!error) return 'Something went wrong.'

  const err = error as { message?: string; code?: string; details?: string; hint?: string }
  const message = err.message ?? String(error)

  switch (err.code) {
    case '23505':
      return 'That record already exists.'
    case '23503':
      return 'That action refers to a record that no longer exists.'
    case '23514':
      return 'Some values are outside the allowed range.'
    case '42501':
      // The RPCs raise 42501 with specific, actionable messages -- "Only the
      // receiving hospital can accept or decline a referral." tells a clinician
      // who to call; the generic string does not. Only bare RLS rejections,
      // which leak table names, get replaced.
      return /row-level security|violates row-level|permission denied/i.test(message)
        ? 'You do not have permission to do that.'
        : message
    case 'PGRST301':
      return 'Your session has expired. Please sign in again.'
    default:
      break
  }

  if (/JWT expired|invalid claim/i.test(message)) {
    return 'Your session has expired. Please sign in again.'
  }
  if (/Invalid login credentials/i.test(message)) {
    return 'Email or password is incorrect.'
  }
  if (/Email not confirmed/i.test(message)) {
    return 'Please confirm your email address before signing in.'
  }
  if (/Failed to fetch|NetworkError|network request failed/i.test(message)) {
    return 'Cannot reach the server. Check your connection and try again.'
  }
  if (/row-level security|violates row-level/i.test(message)) {
    return 'You do not have permission to do that.'
  }
  if (/rate limit|too many requests/i.test(message)) {
    return 'Too many attempts. Please wait a moment and try again.'
  }

  return message
}
