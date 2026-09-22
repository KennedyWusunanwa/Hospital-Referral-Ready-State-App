import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import {
  ArrowLeft,
  ClipboardCheck,
  Eye,
  EyeOff,
  KeyRound,
  Mail,
  MessageSquare,
  Route,
  ShieldCheck,
} from 'lucide-react'
import { useAuth } from '@/auth/AuthProvider'
import {
  Alert,
  Button,
  Card,
  CardBody,
  Field,
  Input,
  Tab,
  TabList,
  TabPanel,
  Tabs,
} from '@/components/ui'
import { APP_NAME, APP_TAGLINE, SUPPORT_EMAIL } from '@/lib/constants'
import { humanizeSupabaseError } from '@/lib/supabase'
import { useAuthPageTheme } from './authTheme'

/** Long enough that a slow inbox is not mistaken for a failed send. */
const RESEND_COOLDOWN_SECONDS = 30

const VALUE_PROPS = [
  { icon: ClipboardCheck, text: 'Green, yellow, red readiness for every department, every shift.' },
  { icon: Route, text: 'Receiving hospitals ranked on live resources and travel time.' },
  {
    icon: MessageSquare,
    text: 'Printable referral form, real-time chat and one-tap call on accept.',
  },
  { icon: ShieldCheck, text: 'Anonymous by design - no patient identifiers are ever stored.' },
]

const passwordSchema = z.object({
  email: z.string().trim().min(1, 'Enter your work email').email('Enter a valid email address'),
  password: z.string().min(1, 'Enter your password'),
})

const otpEmailSchema = z.object({
  email: z.string().trim().min(1, 'Enter your work email').email('Enter a valid email address'),
})

const otpCodeSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'Enter the 6-digit code from your email'),
})

type PasswordValues = z.infer<typeof passwordSchema>
type OtpEmailValues = z.infer<typeof otpEmailSchema>
type OtpCodeValues = z.infer<typeof otpCodeSchema>

function BrandPanel() {
  return (
    <aside className="relative hidden overflow-hidden bg-brand-700 lg:flex lg:flex-col lg:justify-between lg:p-12 dark:bg-brand-950">
      <div
        aria-hidden
        className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-brand-400/30 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-28 -left-20 h-80 w-80 rounded-full bg-brand-300/20 blur-3xl"
      />

      <div className="relative">
        <div className="flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-xl bg-white/15 text-base font-bold text-white ring-1 ring-white/25">
            {APP_NAME.slice(0, 2).toUpperCase()}
          </div>
          <div>
            <p className="text-lg font-semibold text-white">{APP_NAME}</p>
            <p className="text-sm text-brand-100">{APP_TAGLINE}</p>
          </div>
        </div>

        <h2 className="mt-14 max-w-md text-3xl font-semibold leading-tight text-white">
          Know which hospital can take the patient before the ambulance moves.
        </h2>

        <ul className="mt-8 max-w-md space-y-4">
          {VALUE_PROPS.map(({ icon: Icon, text }) => (
            <li key={text} className="flex items-start gap-3">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white/10 ring-1 ring-white/15">
                <Icon className="h-4 w-4 text-white" aria-hidden />
              </span>
              <span className="pt-1 text-sm leading-6 text-brand-50">{text}</span>
            </li>
          ))}
        </ul>
      </div>

      <p className="relative mt-12 text-xs text-brand-200">
        Emergency readiness and inter-hospital referral coordination.
      </p>
    </aside>
  )
}

export default function LoginPage() {
  useAuthPageTheme()

  const { signInWithPassword, signInWithOtp, verifyOtp, requestPasswordReset } = useAuth()

  const [method, setMethod] = useState('password')
  const [authError, setAuthError] = useState<string | null>(null)
  const [showPassword, setShowPassword] = useState(false)
  const [resetPending, setResetPending] = useState(false)
  const [otpEmail, setOtpEmail] = useState<string | null>(null)
  const [resending, setResending] = useState(false)
  const [cooldown, setCooldown] = useState(0)

  useEffect(() => {
    if (cooldown <= 0) return
    const timer = window.setTimeout(() => setCooldown((seconds) => seconds - 1), 1000)
    return () => window.clearTimeout(timer)
  }, [cooldown])

  const passwordForm = useForm<PasswordValues>({
    resolver: zodResolver(passwordSchema),
    defaultValues: { email: '', password: '' },
  })

  const otpEmailForm = useForm<OtpEmailValues>({
    resolver: zodResolver(otpEmailSchema),
    defaultValues: { email: '' },
  })

  const otpCodeForm = useForm<OtpCodeValues>({
    resolver: zodResolver(otpCodeSchema),
    defaultValues: { code: '' },
  })

  const fail = (error: unknown) => {
    const message = humanizeSupabaseError(error)
    setAuthError(message)
    toast.error(message)
  }

  const onPasswordSubmit = passwordForm.handleSubmit(async (values) => {
    setAuthError(null)
    try {
      // RedirectIfAuthenticated sends the user onward once the session lands.
      await signInWithPassword(values.email, values.password)
    } catch (error) {
      passwordForm.resetField('password')
      fail(error)
    }
  })

  const onForgotPassword = async () => {
    setAuthError(null)
    const valid = await passwordForm.trigger('email')
    if (!valid) {
      setAuthError('Enter your work email above, then choose "Forgot password?" again.')
      return
    }
    setResetPending(true)
    try {
      await requestPasswordReset(passwordForm.getValues('email'))
      toast.success('If that email is registered, a password reset link is on its way.')
    } catch (error) {
      fail(error)
    } finally {
      setResetPending(false)
    }
  }

  const onRequestCode = otpEmailForm.handleSubmit(async (values) => {
    setAuthError(null)
    try {
      await signInWithOtp(values.email)
      setOtpEmail(values.email)
      setCooldown(RESEND_COOLDOWN_SECONDS)
      otpCodeForm.reset({ code: '' })
      toast.success(`Sign-in code sent to ${values.email}.`)
    } catch (error) {
      fail(error)
    }
  })

  const onResendCode = async () => {
    if (!otpEmail || cooldown > 0) return
    setAuthError(null)
    setResending(true)
    try {
      await signInWithOtp(otpEmail)
      setCooldown(RESEND_COOLDOWN_SECONDS)
      toast.success('A new code is on its way.')
    } catch (error) {
      fail(error)
    } finally {
      setResending(false)
    }
  }

  const onVerifyCode = otpCodeForm.handleSubmit(async (values) => {
    if (!otpEmail) return
    setAuthError(null)
    try {
      await verifyOtp(otpEmail, values.code)
    } catch (error) {
      fail(error)
    }
  })

  const onChangeEmail = () => {
    setAuthError(null)
    setOtpEmail(null)
    setCooldown(0)
    otpCodeForm.reset({ code: '' })
  }

  const onMethodChange = (next: string) => {
    setAuthError(null)
    setMethod(next)
  }

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[1.05fr_1fr]">
      <BrandPanel />

      <main className="flex min-h-dvh items-center justify-center px-4 py-10 sm:px-6">
        <div className="w-full max-w-md">
          <div className="mb-6 flex items-center gap-3 lg:hidden">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-brand-600 text-sm font-bold text-white">
              {APP_NAME.slice(0, 2).toUpperCase()}
            </div>
            <div>
              <p className="text-base font-semibold text-slate-900 dark:text-slate-50">{APP_NAME}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">{APP_TAGLINE}</p>
            </div>
          </div>

          <Card>
            <CardBody className="space-y-5">
              <div>
                <h1 className="text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-50">
                  Sign in
                </h1>
                <p className="mt-1 hint">
                  Use the work email your hospital administrator registered for you.
                </p>
              </div>

              <Tabs defaultValue="password" value={method} onValueChange={onMethodChange}>
                <TabList>
                  <Tab value="password">
                    <span className="inline-flex items-center gap-1.5">
                      <KeyRound className="h-3.5 w-3.5" aria-hidden />
                      Password
                    </span>
                  </Tab>
                  <Tab value="otp">
                    <span className="inline-flex items-center gap-1.5">
                      <Mail className="h-3.5 w-3.5" aria-hidden />
                      Email code
                    </span>
                  </Tab>
                </TabList>

                {authError && (
                  <Alert tone="danger" title="Could not sign you in" className="mt-4">
                    {authError}
                  </Alert>
                )}

                <TabPanel value="password">
                  <form onSubmit={onPasswordSubmit} className="mt-4 space-y-4" noValidate>
                    <Field
                      label="Work email"
                      required
                      error={passwordForm.formState.errors.email?.message}
                    >
                      {({ id, describedBy }) => (
                        <Input
                          id={id}
                          type="email"
                          autoComplete="username"
                          autoCapitalize="none"
                          spellCheck={false}
                          placeholder="you@hospital.org"
                          aria-describedby={describedBy}
                          aria-invalid={passwordForm.formState.errors.email ? true : undefined}
                          {...passwordForm.register('email')}
                        />
                      )}
                    </Field>

                    <Field
                      label="Password"
                      required
                      error={passwordForm.formState.errors.password?.message}
                    >
                      {({ id, describedBy }) => (
                        <div className="relative">
                          <Input
                            id={id}
                            type={showPassword ? 'text' : 'password'}
                            autoComplete="current-password"
                            className="pr-11"
                            aria-describedby={describedBy}
                            aria-invalid={passwordForm.formState.errors.password ? true : undefined}
                            {...passwordForm.register('password')}
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

                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={() => void onForgotPassword()}
                        disabled={resetPending}
                        className="text-xs font-medium text-brand-700 hover:underline disabled:opacity-60 dark:text-brand-400"
                      >
                        {resetPending ? 'Sending reset link...' : 'Forgot password?'}
                      </button>
                    </div>

                    <Button
                      type="submit"
                      size="lg"
                      fullWidth
                      loading={passwordForm.formState.isSubmitting}
                    >
                      Sign in
                    </Button>
                  </form>
                </TabPanel>

                <TabPanel value="otp">
                  {otpEmail === null ? (
                    <form onSubmit={onRequestCode} className="mt-4 space-y-4" noValidate>
                      <Field
                        label="Work email"
                        required
                        hint="We will email you a 6-digit code that signs you in without a password."
                        error={otpEmailForm.formState.errors.email?.message}
                      >
                        {({ id, describedBy }) => (
                          <Input
                            id={id}
                            type="email"
                            autoComplete="username"
                            autoCapitalize="none"
                            spellCheck={false}
                            placeholder="you@hospital.org"
                            aria-describedby={describedBy}
                            aria-invalid={otpEmailForm.formState.errors.email ? true : undefined}
                            {...otpEmailForm.register('email')}
                          />
                        )}
                      </Field>

                      <Button
                        type="submit"
                        size="lg"
                        fullWidth
                        loading={otpEmailForm.formState.isSubmitting}
                      >
                        <Mail className="h-4 w-4" aria-hidden />
                        Email me a code
                      </Button>
                    </form>
                  ) : (
                    <form onSubmit={onVerifyCode} className="mt-4 space-y-4" noValidate>
                      <p className="text-sm text-slate-600 dark:text-slate-300">
                        We sent a 6-digit code to{' '}
                        <span className="font-medium text-slate-900 dark:text-slate-100">
                          {otpEmail}
                        </span>
                        . It expires shortly, so enter it now.
                      </p>

                      <Field
                        label="6-digit code"
                        required
                        error={otpCodeForm.formState.errors.code?.message}
                      >
                        {({ id, describedBy }) => (
                          <Input
                            id={id}
                            inputMode="numeric"
                            autoComplete="one-time-code"
                            maxLength={6}
                            autoFocus
                            placeholder="000000"
                            className="text-center text-lg font-semibold tracking-[0.35em]"
                            aria-describedby={describedBy}
                            aria-invalid={otpCodeForm.formState.errors.code ? true : undefined}
                            {...otpCodeForm.register('code')}
                          />
                        )}
                      </Field>

                      <Button
                        type="submit"
                        size="lg"
                        fullWidth
                        loading={otpCodeForm.formState.isSubmitting}
                      >
                        Verify and sign in
                      </Button>

                      <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
                        <button
                          type="button"
                          onClick={onChangeEmail}
                          className="inline-flex items-center gap-1 font-medium text-slate-600 hover:underline dark:text-slate-300"
                        >
                          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
                          Change email
                        </button>
                        <button
                          type="button"
                          onClick={() => void onResendCode()}
                          disabled={cooldown > 0 || resending}
                          className="font-medium text-brand-700 hover:underline disabled:cursor-not-allowed disabled:text-slate-400 disabled:no-underline dark:text-brand-400 dark:disabled:text-slate-500"
                        >
                          {cooldown > 0
                            ? `Resend code in ${cooldown}s`
                            : resending
                              ? 'Sending...'
                              : 'Resend code'}
                        </button>
                      </div>
                    </form>
                  )}
                </TabPanel>
              </Tabs>
            </CardBody>
          </Card>

          <p className="mt-5 text-center text-xs leading-5 text-slate-500 dark:text-slate-400">
            {APP_NAME} accounts are created by your hospital administrator - there is no public
            sign-up. Need access or locked out? Email{' '}
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
    </div>
  )
}
