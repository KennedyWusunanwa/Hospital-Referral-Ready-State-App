import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase, humanizeSupabaseError } from '@/lib/supabase'
import { DEFAULT_TIMEZONE, type Capability, type UserRole } from '@/lib/constants'
import type { Hospital, Profile } from '@/lib/types'
import { can as hasCapability } from '@/lib/utils'

export interface AuthState {
  session: Session | null
  user: User | null
  profile: Profile | null
  hospital: Hospital | null
  role: UserRole | null
  /** True until the initial session + profile load settles. */
  loading: boolean
  /** Set when the profile could not be loaded for a signed-in user. */
  profileError: string | null
}

export interface AuthContextValue extends AuthState {
  signInWithPassword: (email: string, password: string) => Promise<void>
  signInWithOtp: (email: string) => Promise<void>
  verifyOtp: (email: string, token: string) => Promise<void>
  requestPasswordReset: (email: string) => Promise<void>
  updatePassword: (password: string) => Promise<void>
  signOut: () => Promise<void>
  refreshProfile: () => Promise<void>
  can: (capability: Capability) => boolean
  /** The hospital's IANA timezone, or the deployment default. */
  timezone: string
}

const AuthContext = createContext<AuthContextValue | null>(null)

const PROFILE_COLUMNS =
  'id, full_name, email, phone, role, hospital_id, department_id, is_active, must_change_password, last_login_at, created_at, updated_at'

const HOSPITAL_COLUMNS =
  'id, name, code, level, address, city, region, country, latitude, longitude, phone, emergency_phone, email, timezone, is_active, accepts_referrals, notes, created_at, updated_at'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    session: null,
    user: null,
    profile: null,
    hospital: null,
    role: null,
    loading: true,
    profileError: null,
  })

  // Guards against a slow profile fetch resolving after sign-out and
  // resurrecting a stale identity.
  const requestIdRef = useRef(0)

  const loadProfile = useCallback(async (session: Session | null) => {
    const requestId = ++requestIdRef.current

    if (!session?.user) {
      if (requestId === requestIdRef.current) {
        setState({
          session: null,
          user: null,
          profile: null,
          hospital: null,
          role: null,
          loading: false,
          profileError: null,
        })
      }
      return
    }

    const { data: profile, error } = await supabase
      .from('profiles')
      .select(PROFILE_COLUMNS)
      .eq('id', session.user.id)
      .maybeSingle()

    if (requestId !== requestIdRef.current) return

    if (error) {
      setState((prev) => ({
        ...prev,
        session,
        user: session.user,
        loading: false,
        profileError: humanizeSupabaseError(error),
      }))
      return
    }

    if (!profile) {
      setState((prev) => ({
        ...prev,
        session,
        user: session.user,
        profile: null,
        hospital: null,
        role: null,
        loading: false,
        profileError:
          'No staff profile is linked to this account. Ask your hospital administrator to complete your setup.',
      }))
      return
    }

    const typedProfile = profile as Profile

    if (!typedProfile.is_active) {
      await supabase.auth.signOut()
      if (requestId !== requestIdRef.current) return
      setState({
        session: null,
        user: null,
        profile: null,
        hospital: null,
        role: null,
        loading: false,
        profileError: 'This account has been deactivated. Contact your administrator.',
      })
      return
    }

    let hospital: Hospital | null = null
    if (typedProfile.hospital_id) {
      const { data } = await supabase
        .from('hospitals')
        .select(HOSPITAL_COLUMNS)
        .eq('id', typedProfile.hospital_id)
        .maybeSingle()
      hospital = (data as Hospital | null) ?? null
    }

    if (requestId !== requestIdRef.current) return

    setState({
      session,
      user: session.user,
      profile: typedProfile,
      hospital,
      role: typedProfile.role,
      loading: false,
      profileError: null,
    })
  }, [])

  useEffect(() => {
    let active = true

    supabase.auth.getSession().then(({ data }) => {
      if (active) void loadProfile(data.session)
    })

    const { data: subscription } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return
      // TOKEN_REFRESHED fires often and carries no profile change; re-fetching
      // on it would put the whole app into a loading state every hour.
      if (event === 'TOKEN_REFRESHED') {
        setState((prev) => ({ ...prev, session }))
        return
      }
      void loadProfile(session)
    })

    return () => {
      active = false
      subscription.subscription.unsubscribe()
    }
  }, [loadProfile])

  const signInWithPassword = useCallback(async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    })
    if (error) throw new Error(humanizeSupabaseError(error))
    // Best-effort: a failed audit write must not block a clinician signing in.
    if (data.user) {
      await supabase.rpc('record_login').then(undefined, () => undefined)
    }
  }, [])

  const signInWithOtp = useCallback(async (email: string) => {
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: { shouldCreateUser: false },
    })
    if (error) throw new Error(humanizeSupabaseError(error))
  }, [])

  const verifyOtp = useCallback(async (email: string, token: string) => {
    const { error } = await supabase.auth.verifyOtp({
      email: email.trim().toLowerCase(),
      token: token.trim(),
      type: 'email',
    })
    if (error) throw new Error(humanizeSupabaseError(error))
  }, [])

  const requestPasswordReset = useCallback(async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
      redirectTo: `${window.location.origin}/reset-password`,
    })
    if (error) throw new Error(humanizeSupabaseError(error))
  }, [])

  const updatePassword = useCallback(async (password: string) => {
    const { error } = await supabase.auth.updateUser({ password })
    if (error) throw new Error(humanizeSupabaseError(error))
    const { data } = await supabase.auth.getUser()
    if (data.user) {
      await supabase
        .from('profiles')
        .update({ must_change_password: false })
        .eq('id', data.user.id)
        .then(undefined, () => undefined)
    }
  }, [])

  const signOut = useCallback(async () => {
    requestIdRef.current++
    await supabase.auth.signOut()
    setState({
      session: null,
      user: null,
      profile: null,
      hospital: null,
      role: null,
      loading: false,
      profileError: null,
    })
  }, [])

  const refreshProfile = useCallback(async () => {
    const { data } = await supabase.auth.getSession()
    await loadProfile(data.session)
  }, [loadProfile])

  const value = useMemo<AuthContextValue>(
    () => ({
      ...state,
      signInWithPassword,
      signInWithOtp,
      verifyOtp,
      requestPasswordReset,
      updatePassword,
      signOut,
      refreshProfile,
      can: (capability: Capability) => hasCapability(state.role, capability),
      timezone: state.hospital?.timezone || DEFAULT_TIMEZONE,
    }),
    [
      state,
      signInWithPassword,
      signInWithOtp,
      verifyOtp,
      requestPasswordReset,
      updatePassword,
      signOut,
      refreshProfile,
    ],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used within an AuthProvider')
  return context
}

/** Convenience for the very common "who am I and where do I work" read. */
export function useCurrentHospitalId(): string | null {
  return useAuth().profile?.hospital_id ?? null
}
