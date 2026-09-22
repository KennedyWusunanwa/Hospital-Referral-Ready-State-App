import { useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { Check, Eye, EyeOff, X } from 'lucide-react'
import { useAuth } from '@/auth/AuthProvider'
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  Field,
  Input,
  Meter,
  Spinner,
} from '@/components/ui'
import { APP_NAME, APP_TAGLINE, SUPPORT_EMAIL } from '@/lib/constants'
import { humanizeSupabaseError } from '@/lib/supabase'
import { useAuthPageTheme } from './authTheme'

const PASSWORD_RULES = [
  { id: 'length', label: 'At least 12 characters', test: (value: string) => value.length >= 12 },
  { id: 'upper', label: 'One uppercase letter', test: (value: string) => /[A-Z]/.test(value) },
  { id: 'lower', label: 'One lowercase letter', test: (value: string) => /[a-z]/.test(value) },
  { id: 'digit', label: 'One number', test: (value: string) => /\d/.test(value) },
]

const schema = z
  .object({
    password: z
      .string()
      .min(12, 'Use at least 12 characters')
      .regex(/[A-Z]/, 'Include an uppercase letter')
      .regex(/[a-z]/, 'Include a lowercase letter')
      .regex(/\d/, 'Include a number'),
    confirm: z.string().min(1, 'Re-enter the new password'),
  })
  .refine((values) => values.password === values.confirm, {
    path: ['confirm'],
    message: 'Passwords do not match',
  })

type FormValues = z.infer<typeof schema>

/**
 * Supabase reports a dead or already-used recovery link in the URL rather than
 * by failing a request, so the reason has to be read off the location.
 */
function readLinkError(): string | null {
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  const query = new URLSearchParams(window.location.search)
  const description = hash.get('error_description') ?? query.get('error_description')
  if (description) return description
  const code = hash.get('error') ?? query.get('error')
  return code ? 'The sign-in link could not be used.' : null
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10 sm:px-6">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-brand-600 text-sm font-bold text-white">
            {APP_NAME.slice(0, 2).toUpperCase()}
          </div>
          <div>
            <p className="text-base font-semibold text-slate-900 dark:text-slate-50">{APP_NAME}</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">{APP_TAGLINE}</p>
          </div>
        </div>
        {children}
        <p className="mt-5 text-center text-xs leading-5 text-slate-500 dark:text-slate-400">
          Trouble getting in? Email{' '}
          <a
            href={`mailto:${SUPPORT_EMAIL}`}
            className="font-medium text-brand-700 hover:underline dark:text-brand-400"
          >
            {SUPPORT_EMAIL}
          </a>
          .
        </p>
      </div>
    </main>
  )
}

export default function ResetPasswordPage() {
  useAuthPageTheme()

  const { session, profile, loading, updatePassword, refreshProfile, signOut } = useAuth()
  const navigate = useNavigate()

  const [linkError] = useState(readLinkError)
  const [formError, setFormError] = useState<string | null>(null)
  const [showPassword, setShowPassword] = useState(false)

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { password: '', confirm: '' },
    mode: 'onBlur',
  })

  const password = form.watch('password')
  const satisfied = useMemo(
    () => PASSWORD_RULES.filter((rule) => rule.test(password)).length,
    [password],
  )
  const strengthTone = satisfied >= 4 ? 'success' : satisfied >= 2 ? 'warning' : 'danger'
  const strengthLabel = satisfied >= 4 ? 'Strong' : satisfied >= 2 ? 'Getting there' : 'Too weak'

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null)
    try {
      await updatePassword(values.password)
      await refreshProfile()
      toast.success('Password updated.')
      navigate('/', { replace: true })
    } catch (error) {
      const message = humanizeSupabaseError(error)
      setFormError(message)
      toast.error(message)
    }
  })

  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Spinner className="h-8 w-8" />
      </div>
    )
  }

  if (!session) {
    return (
      <Shell>
        <Card>
          <CardBody className="space-y-4">
            <Alert tone="danger" title="This link is no longer valid">
              <p>
                {linkError ??
                  'Password reset links can only be used once and expire after a short time.'}
              </p>
              <p className="mt-2">
                Request a new link from the sign-in screen, or ask your hospital administrator to
                reset your account.
              </p>
            </Alert>
            <Link
              to="/login"
              className="inline-flex h-10 w-full items-center justify-center rounded-lg bg-brand-600 px-4 text-sm font-medium text-white transition-colors hover:bg-brand-700"
            >
              Back to sign in
            </Link>
          </CardBody>
        </Card>
      </Shell>
    )
  }

  const forced = profile?.must_change_password === true

  return (
    <Shell>
      <Card>
        <CardHeader
          title={forced ? 'Set your own password' : 'Choose a new password'}
          description={
            forced
              ? 'Your administrator created this account with a temporary password.'
              : 'You are signed in from the recovery link. Pick a password you have not used before.'
          }
        />
        <CardBody className="space-y-5">
          {forced && (
            <Alert tone="warning" title="One step before you continue">
              Temporary passwords are shared out of band and can be seen by others. Set your own now
              to unlock {APP_NAME}.
            </Alert>
          )}

          {formError && (
            <Alert tone="danger" title="Could not update your password">
              {formError}
            </Alert>
          )}

          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            <Field label="New password" required error={form.formState.errors.password?.message}>
              {({ id, describedBy }) => (
                <div className="relative">
                  <Input
                    id={id}
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    autoFocus
                    className="pr-11"
                    aria-describedby={describedBy}
                    aria-invalid={form.formState.errors.password ? true : undefined}
                    {...form.register('password')}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((visible) => !visible)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    aria-pressed={showPassword}
                    className="absolute right-1 top-1/2 -translate-y-1/2 rounded-md p-2 text-slate-400 transition-colors hover:text-slate-700 dark:hover:text-slate-200"
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4" aria-hidden />
                    ) : (
                      <Eye className="h-4 w-4" aria-hidden />
                    )}
                  </button>
                </div>
              )}
            </Field>

            <div className="space-y-2 rounded-lg bg-slate-50 p-3 dark:bg-slate-800/50">
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
                  Password strength
                </span>
                <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
                  {strengthLabel}
                </span>
              </div>
              <Meter
                value={satisfied}
                max={PASSWORD_RULES.length}
                tone={strengthTone}
                label="Password strength"
              />
              <ul className="grid gap-1.5 pt-1 sm:grid-cols-2">
                {PASSWORD_RULES.map((rule) => {
                  const met = rule.test(password)
                  return (
                    <li key={rule.id} className="flex items-center gap-1.5 text-xs">
                      {met ? (
                        <Check className="h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden />
                      ) : (
                        <X
                          className="h-3.5 w-3.5 shrink-0 text-slate-400 dark:text-slate-500"
                          aria-hidden
                        />
                      )}
                      <span
                        className={
                          met
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : 'text-slate-500 dark:text-slate-400'
                        }
                      >
                        {rule.label}
                      </span>
                      <span className="sr-only">{met ? 'requirement met' : 'not yet met'}</span>
                    </li>
                  )
                })}
              </ul>
            </div>

            <Field label="Confirm new password" required error={form.formState.errors.confirm?.message}>
              {({ id, describedBy }) => (
                <Input
                  id={id}
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  aria-describedby={describedBy}
                  aria-invalid={form.formState.errors.confirm ? true : undefined}
                  {...form.register('confirm')}
                />
              )}
            </Field>

            <Button type="submit" size="lg" fullWidth loading={form.formState.isSubmitting}>
              Update password and continue
            </Button>
          </form>

          <div className="flex justify-center">
            <Button variant="ghost" size="sm" onClick={() => void signOut()}>
              Sign out instead
            </Button>
          </div>
        </CardBody>
      </Card>
    </Shell>
  )
}
