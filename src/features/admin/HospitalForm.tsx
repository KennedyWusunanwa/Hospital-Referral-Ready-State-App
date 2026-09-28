/**
 * The facility form, shared by a hospital administrator editing their own
 * facility and by the system console creating or editing any facility.
 */

import { useEffect, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { ExternalLink, ImageIcon, Link2, MapPin, Send, Trash2, Upload } from 'lucide-react'
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  Field,
  Input,
  Select,
  Textarea,
  Toggle,
} from '@/components/ui'
import { isValidLatLng } from '@/domain/geo'
import { HospitalLogo } from '@/features/hospitals/HospitalLogo'
import {
  GHANA_REGIONS,
  HOSPITAL_LEVELS,
  HOSPITAL_LEVEL_LABELS,
  REFERRAL_POLICIES,
  REFERRAL_POLICY_DESCRIPTIONS,
  REFERRAL_POLICY_LABELS,
  type HospitalLevel,
} from '@/lib/constants'
import type { Hospital } from '@/lib/types'
import { cn } from '@/lib/utils'
import {
  ACCEPTED_HOSPITAL_LOGO_TYPES,
  MAX_HOSPITAL_LOGO_BYTES,
  useUploadHospitalLogo,
} from './useAdmin'

/**
 * A short, curated zone list beats the full IANA database here: these
 * deployments sit in a handful of zones and a 400-entry select is unusable on
 * a ward tablet. The hospital's stored zone is appended if it is not listed.
 */
const COMMON_TIMEZONES = [
  'Africa/Accra',
  'Africa/Abidjan',
  'Africa/Lagos',
  'Africa/Kinshasa',
  'Africa/Nairobi',
  'Africa/Dar_es_Salaam',
  'Africa/Kampala',
  'Africa/Addis_Ababa',
  'Africa/Johannesburg',
  'Africa/Cairo',
  'Africa/Casablanca',
  'Europe/London',
  'Europe/Paris',
  'UTC',
]

/** Blank is allowed; the column is nullable and '' is stored as null on save. */
const optionalText = (max: number) =>
  z.string().trim().max(max, `Keep this under ${max} characters`)

const schema = z
  .object({
    name: z.string().trim().min(2, 'Enter the facility name').max(160),
    code: z
      .string()
      .trim()
      .min(2, 'Enter a short code')
      .max(20)
      .regex(/^[A-Za-z0-9-]+$/, 'Letters, digits and hyphens only'),
    level: z.enum(HOSPITAL_LEVELS),
    address: optionalText(240),
    city: optionalText(120),
    region: optionalText(120),
    country: z.string().trim().min(2, 'Enter the country').max(80),
    phone: optionalText(40),
    emergency_phone: optionalText(40),
    email: z
      .string()
      .trim()
      .max(160)
      .refine((value) => value === '' || z.string().email().safeParse(value).success, {
        message: 'Enter a valid email address',
      }),
    timezone: z.string().min(1, 'Choose a timezone'),
    latitude: z.number({ invalid_type_error: 'Enter a latitude' }),
    longitude: z.number({ invalid_type_error: 'Enter a longitude' }),
    notes: optionalText(1000),
    is_active: z.boolean(),
    accepts_referrals: z.boolean(),
    referral_policy: z.enum(REFERRAL_POLICIES),
  })
  .superRefine((values, ctx) => {
    if (!isValidLatLng({ latitude: values.latitude, longitude: values.longitude })) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['latitude'],
        message: 'These coordinates are not usable. Latitude -90..90, longitude -180..180.',
      })
    }
  })

export type HospitalFormValues = z.infer<typeof schema> & { logo_url: string | null }

function defaultsFor(hospital: Hospital | null): z.infer<typeof schema> {
  return {
    name: hospital?.name ?? '',
    code: hospital?.code ?? '',
    level: hospital?.level ?? 'district',
    address: hospital?.address ?? '',
    city: hospital?.city ?? '',
    region: hospital?.region ?? '',
    country: hospital?.country ?? 'Ghana',
    phone: hospital?.phone ?? '',
    emergency_phone: hospital?.emergency_phone ?? '',
    email: hospital?.email ?? '',
    timezone: hospital?.timezone ?? 'Africa/Accra',
    latitude: hospital?.latitude ?? 0,
    longitude: hospital?.longitude ?? 0,
    notes: hospital?.notes ?? '',
    is_active: hospital?.is_active ?? true,
    accepts_referrals: hospital?.accepts_referrals ?? true,
    referral_policy: hospital?.referral_policy ?? 'hospital_only',
  }
}

// ---------------------------------------------------------------------------
// Logo field
// ---------------------------------------------------------------------------

export function HospitalLogoField({
  hospitalId,
  name,
  code,
  value,
  onChange,
}: {
  /** Null until the facility has been created: uploads need a folder to land in. */
  hospitalId: string | null
  name: string
  code: string
  value: string | null
  onChange: (next: string | null) => void
}) {
  const upload = useUploadHospitalLogo()
  const fileInput = useRef<HTMLInputElement>(null)
  const [urlDraft, setUrlDraft] = useState('')
  const [linking, setLinking] = useState(false)

  const onPickFile = async (file: File | undefined) => {
    if (!file || !hospitalId) return
    try {
      const url = await upload.mutateAsync({ hospitalId, file })
      onChange(url)
      toast.success('Logo uploaded. Save to apply it.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Upload failed')
    } finally {
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  const applyUrl = () => {
    const trimmed = urlDraft.trim()
    if (!/^https:\/\/\S+$/i.test(trimmed)) {
      toast.error('Paste a full https:// image address.')
      return
    }
    onChange(trimmed)
    setUrlDraft('')
    setLinking(false)
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-4">
        <HospitalLogo hospital={{ name: name || 'Hospital', code, logo_url: value }} size="xl" />
        <div className="flex flex-wrap gap-2">
          <input
            ref={fileInput}
            type="file"
            accept={ACCEPTED_HOSPITAL_LOGO_TYPES.join(',')}
            className="sr-only"
            onChange={(event) => void onPickFile(event.target.files?.[0])}
          />
          <Button
            type="button"
            variant="outline"
            onClick={() => fileInput.current?.click()}
            loading={upload.isPending}
            disabled={!hospitalId}
          >
            <Upload className="h-4 w-4" aria-hidden />
            {value ? 'Replace' : 'Upload'}
          </Button>
          <Button type="button" variant="ghost" onClick={() => setLinking((open) => !open)}>
            <Link2 className="h-4 w-4" aria-hidden />
            Use a link
          </Button>
          {value && (
            <Button type="button" variant="ghost" onClick={() => onChange(null)}>
              <Trash2 className="h-4 w-4" aria-hidden />
              Remove
            </Button>
          )}
        </div>
      </div>

      {linking && (
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            type="url"
            placeholder="https://example.org/logo.png"
            value={urlDraft}
            onChange={(event) => setUrlDraft(event.target.value)}
            aria-label="Logo image address"
          />
          <Button type="button" variant="secondary" onClick={applyUrl}>
            Apply link
          </Button>
        </div>
      )}

      <p className="hint">
        {hospitalId
          ? `PNG, SVG, JPEG or WebP under ${(MAX_HOSPITAL_LOGO_BYTES / 1024 / 1024).toFixed(0)} MB. Without a logo the facility shows a coloured monogram of its code.`
          : 'Create the facility first, then upload its logo. A link can be pasted straight away.'}
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Form
// ---------------------------------------------------------------------------

export interface HospitalFormProps {
  hospital: Hospital | null
  onSubmit: (values: HospitalFormValues) => Promise<void>
  submitting: boolean
  submitLabel?: string
  onCancel?: () => void
  cancelLabel?: string
  /** The console shows the active / accepting switches inline; the hospital's own page has a dedicated card. */
  showFlags?: boolean
  className?: string
}

export function HospitalForm({
  hospital,
  onSubmit,
  submitting,
  submitLabel = 'Save hospital details',
  onCancel,
  cancelLabel = 'Discard changes',
  showFlags = false,
  className,
}: HospitalFormProps) {
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: defaultsFor(hospital),
  })
  const [logoUrl, setLogoUrl] = useState<string | null>(hospital?.logo_url ?? null)

  const { reset, watch } = form

  useEffect(() => {
    reset(defaultsFor(hospital))
    setLogoUrl(hospital?.logo_url ?? null)
  }, [hospital, reset])

  const latitude = watch('latitude')
  const longitude = watch('longitude')
  const name = watch('name')
  const code = watch('code')
  const isActive = watch('is_active')
  const acceptsReferrals = watch('accepts_referrals')
  const referralPolicy = watch('referral_policy')
  const coordinatesUsable = isValidLatLng({ latitude, longitude })
  const logoDirty = (hospital?.logo_url ?? null) !== logoUrl

  const timezoneOptions =
    hospital && !COMMON_TIMEZONES.includes(hospital.timezone)
      ? [hospital.timezone, ...COMMON_TIMEZONES]
      : COMMON_TIMEZONES

  const submit = form.handleSubmit(async (values) => {
    await onSubmit({ ...values, code: values.code.toUpperCase(), logo_url: logoUrl })
  })

  const osmHref = `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=15/${latitude}/${longitude}`

  return (
    <form onSubmit={submit} className={cn('space-y-5', className)} noValidate>
      <Card>
        <CardHeader
          title="Facility details"
          description="These appear on every referral request this hospital sends or receives."
        />
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <Field label="Hospital name" required error={form.formState.errors.name?.message}>
            {({ id, describedBy }) => (
              <Input id={id} aria-describedby={describedBy} {...form.register('name')} />
            )}
          </Field>

          <Field
            label="Short code"
            required
            hint="Used on printed referral forms, e.g. KBTH."
            error={form.formState.errors.code?.message}
          >
            {({ id, describedBy }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                className="uppercase"
                {...form.register('code')}
              />
            )}
          </Field>

          <Field label="Facility level" required error={form.formState.errors.level?.message}>
            {({ id, describedBy }) => (
              <Select id={id} aria-describedby={describedBy} {...form.register('level')}>
                {HOSPITAL_LEVELS.map((level: HospitalLevel) => (
                  <option key={level} value={level}>
                    {HOSPITAL_LEVEL_LABELS[level]}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field
            label="Timezone"
            required
            hint="Shift windows and readiness deadlines are evaluated in this zone."
            error={form.formState.errors.timezone?.message}
          >
            {({ id, describedBy }) => (
              <Select id={id} aria-describedby={describedBy} {...form.register('timezone')}>
                {timezoneOptions.map((zone) => (
                  <option key={zone} value={zone}>
                    {zone}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field
            label="Street address"
            className="sm:col-span-2"
            error={form.formState.errors.address?.message}
          >
            {({ id, describedBy }) => (
              <Input id={id} aria-describedby={describedBy} {...form.register('address')} />
            )}
          </Field>

          <Field label="City / town" error={form.formState.errors.city?.message}>
            {({ id, describedBy }) => (
              <Input id={id} aria-describedby={describedBy} {...form.register('city')} />
            )}
          </Field>

          <Field
            label="Region"
            hint="Start typing to pick one of the sixteen regions, or enter another."
            error={form.formState.errors.region?.message}
          >
            {({ id, describedBy }) => (
              <>
                <Input
                  id={id}
                  list="hospital-regions"
                  aria-describedby={describedBy}
                  autoComplete="off"
                  {...form.register('region')}
                />
                <datalist id="hospital-regions">
                  {GHANA_REGIONS.map((region) => (
                    <option key={region} value={region} />
                  ))}
                </datalist>
              </>
            )}
          </Field>

          <Field label="Country" required error={form.formState.errors.country?.message}>
            {({ id, describedBy }) => (
              <Input id={id} aria-describedby={describedBy} {...form.register('country')} />
            )}
          </Field>

          <Field label="Switchboard phone" error={form.formState.errors.phone?.message}>
            {({ id, describedBy }) => (
              <Input
                id={id}
                type="tel"
                inputMode="tel"
                aria-describedby={describedBy}
                {...form.register('phone')}
              />
            )}
          </Field>

          <Field
            label="Emergency phone"
            hint="The number a referring hospital calls at 3am."
            error={form.formState.errors.emergency_phone?.message}
          >
            {({ id, describedBy }) => (
              <Input
                id={id}
                type="tel"
                inputMode="tel"
                aria-describedby={describedBy}
                {...form.register('emergency_phone')}
              />
            )}
          </Field>

          <Field label="Email" error={form.formState.errors.email?.message}>
            {({ id, describedBy }) => (
              <Input
                id={id}
                type="email"
                aria-describedby={describedBy}
                {...form.register('email')}
              />
            )}
          </Field>

          <Field
            label="Notes"
            className="sm:col-span-2"
            hint="Shown on the facility page: access instructions, referral desk hours, anything a referring team should know."
            error={form.formState.errors.notes?.message}
          >
            {({ id, describedBy }) => (
              <Textarea
                id={id}
                rows={3}
                aria-describedby={describedBy}
                {...form.register('notes')}
              />
            )}
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Referral initiation"
          description="Which levels of staff may raise a referral from this hospital. Roles without referral rights are never included, whatever is chosen here."
          action={<Send className="h-5 w-5 text-slate-300 dark:text-slate-600" aria-hidden />}
        />
        <CardBody className="space-y-3">
          <Field label="Who may raise referrals" required>
            {({ id, describedBy }) => (
              <Select id={id} aria-describedby={describedBy} {...form.register('referral_policy')}>
                {REFERRAL_POLICIES.map((policy) => (
                  <option key={policy} value={policy}>
                    {REFERRAL_POLICY_LABELS[policy]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600 dark:bg-slate-950/40 dark:text-slate-300">
            {REFERRAL_POLICY_DESCRIPTIONS[referralPolicy]}
          </p>
          {referralPolicy === 'department_only' && (
            <Alert tone="warning">
              Hospital Administrators and Referral Coordinators at this hospital will lose the New
              referral button. They keep every other referral function, including answering incoming
              requests.
            </Alert>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Logo"
          description="Shown on directory cards, referral requests and the printed referral form."
          action={<ImageIcon className="h-5 w-5 text-slate-300 dark:text-slate-600" aria-hidden />}
        />
        <CardBody>
          <HospitalLogoField
            hospitalId={hospital?.id ?? null}
            name={name}
            code={code}
            value={logoUrl}
            onChange={setLogoUrl}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Location"
          description="Referral ranking scores proximity from these coordinates. If they are wrong, this hospital is ranked against the wrong distance for every incoming case."
        />
        <CardBody className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Latitude"
              required
              hint="Decimal degrees, e.g. 5.5600"
              error={form.formState.errors.latitude?.message}
            >
              {({ id, describedBy }) => (
                <Input
                  id={id}
                  type="number"
                  step="0.000001"
                  inputMode="decimal"
                  aria-describedby={describedBy}
                  {...form.register('latitude', { valueAsNumber: true })}
                />
              )}
            </Field>

            <Field
              label="Longitude"
              required
              hint="Decimal degrees, e.g. -0.2050"
              error={form.formState.errors.longitude?.message}
            >
              {({ id, describedBy }) => (
                <Input
                  id={id}
                  type="number"
                  step="0.000001"
                  inputMode="decimal"
                  aria-describedby={describedBy}
                  {...form.register('longitude', { valueAsNumber: true })}
                />
              )}
            </Field>
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950/40">
            <div className="flex items-start gap-3">
              <MapPin className="mt-0.5 h-5 w-5 shrink-0 text-brand-600" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                  Current pinned position
                </p>
                <p className="mt-1 font-mono text-sm tabular-nums text-slate-700 dark:text-slate-300">
                  {Number.isFinite(latitude) ? latitude.toFixed(6) : '--'},{' '}
                  {Number.isFinite(longitude) ? longitude.toFixed(6) : '--'}
                </p>
                <p className="mt-1 hint">
                  {coordinatesUsable
                    ? 'Open the position in OpenStreetMap to confirm it lands on the hospital compound.'
                    : 'These coordinates cannot be used for ranking yet.'}
                </p>
                {coordinatesUsable && (
                  <a
                    href={osmHref}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-brand-700 hover:underline dark:text-brand-400"
                  >
                    View on OpenStreetMap
                    <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                  </a>
                )}
              </div>
              <Badge tone={coordinatesUsable ? 'success' : 'danger'}>
                {coordinatesUsable ? 'Valid' : 'Invalid'}
              </Badge>
            </div>
          </div>

          {showFlags && (
            <div className="space-y-3 border-t border-slate-200 pt-4 dark:border-slate-800">
              <Toggle
                checked={isActive}
                onChange={(next) => form.setValue('is_active', next, { shouldDirty: true })}
                label="Active on the network"
                description="Inactive facilities are hidden from the directory and never ranked."
              />
              <Toggle
                checked={acceptsReferrals}
                onChange={(next) => form.setValue('accepts_referrals', next, { shouldDirty: true })}
                label="Accepting incoming referrals"
                description="Switch off to take the facility out of every ranking while it is on diversion."
              />
              {!acceptsReferrals && (
                <Alert tone="warning">
                  No referring hospital can select this facility until this is switched back on.
                </Alert>
              )}
            </div>
          )}
        </CardBody>
        <CardFooter>
          {onCancel ? (
            <Button type="button" variant="ghost" onClick={onCancel} disabled={submitting}>
              {cancelLabel}
            </Button>
          ) : (
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                reset()
                setLogoUrl(hospital?.logo_url ?? null)
              }}
              disabled={(!form.formState.isDirty && !logoDirty) || submitting}
            >
              {cancelLabel}
            </Button>
          )}
          <Button type="submit" loading={submitting}>
            {submitLabel}
          </Button>
        </CardFooter>
      </Card>
    </form>
  )
}
