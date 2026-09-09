import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { Building2, ExternalLink, MapPin } from 'lucide-react'
import { useAuth } from '@/auth/AuthProvider'
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  EmptyState,
  Field,
  Input,
  Modal,
  Select,
  Toggle,
} from '@/components/ui'
import { HOSPITAL_LEVELS, HOSPITAL_LEVEL_LABELS, type HospitalLevel } from '@/lib/constants'
import { humanizeSupabaseError } from '@/lib/supabase'
import { isValidLatLng } from '@/domain/geo'
import { useUpsertHospital } from './useAdmin'

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

type FormValues = z.infer<typeof schema>

export default function HospitalSettings() {
  const { hospital, refreshProfile } = useAuth()
  const upsertHospital = useUpsertHospital()
  const [confirmDiversion, setConfirmDiversion] = useState(false)

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: '',
      code: '',
      level: 'district',
      address: '',
      city: '',
      region: '',
      phone: '',
      emergency_phone: '',
      email: '',
      timezone: 'Africa/Accra',
      latitude: 0,
      longitude: 0,
    },
  })

  const { reset, watch } = form

  useEffect(() => {
    if (!hospital) return
    reset({
      name: hospital.name,
      code: hospital.code,
      level: hospital.level,
      address: hospital.address ?? '',
      city: hospital.city ?? '',
      region: hospital.region ?? '',
      phone: hospital.phone ?? '',
      emergency_phone: hospital.emergency_phone ?? '',
      email: hospital.email ?? '',
      timezone: hospital.timezone,
      latitude: hospital.latitude,
      longitude: hospital.longitude,
    })
  }, [hospital, reset])

  const latitude = watch('latitude')
  const longitude = watch('longitude')
  const coordinatesUsable = isValidLatLng({ latitude, longitude })

  if (!hospital) {
    return (
      <Card>
        <EmptyState
          icon={<Building2 className="h-8 w-8" />}
          title="No hospital linked to your account"
          description="Ask a system administrator to attach your profile to a facility before editing its settings."
        />
      </Card>
    )
  }

  const timezoneOptions = COMMON_TIMEZONES.includes(hospital.timezone)
    ? COMMON_TIMEZONES
    : [hospital.timezone, ...COMMON_TIMEZONES]

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await upsertHospital.mutateAsync({
        id: hospital.id,
        name: values.name,
        code: values.code.toUpperCase(),
        level: values.level,
        address: values.address || null,
        city: values.city || null,
        region: values.region || null,
        phone: values.phone || null,
        emergency_phone: values.emergency_phone || null,
        email: values.email || null,
        timezone: values.timezone,
        latitude: values.latitude,
        longitude: values.longitude,
      })
      await refreshProfile()
      toast.success('Hospital details saved')
    } catch (error) {
      toast.error(humanizeSupabaseError(error))
    }
  })

  const setAcceptsReferrals = async (next: boolean) => {
    try {
      await upsertHospital.mutateAsync({ id: hospital.id, accepts_referrals: next })
      await refreshProfile()
      toast.success(
        next
          ? 'This hospital is back in the referral rankings'
          : 'This hospital has been removed from the referral rankings',
      )
    } catch (error) {
      toast.error(humanizeSupabaseError(error))
    } finally {
      setConfirmDiversion(false)
    }
  }

  const osmHref = `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=15/${latitude}/${longitude}`

  return (
    <div className="space-y-5">
      <form onSubmit={onSubmit} className="space-y-5" noValidate>
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

            <Field label="Region" error={form.formState.errors.region?.message}>
              {({ id, describedBy }) => (
                <Input id={id} aria-describedby={describedBy} {...form.register('region')} />
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

            <Field
              label="Email"
              className="sm:col-span-2"
              error={form.formState.errors.email?.message}
            >
              {({ id, describedBy }) => (
                <Input
                  id={id}
                  type="email"
                  aria-describedby={describedBy}
                  {...form.register('email')}
                />
              )}
            </Field>
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
          </CardBody>
          <CardFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => reset()}
              disabled={!form.formState.isDirty || upsertHospital.isPending}
            >
              Discard changes
            </Button>
            <Button type="submit" loading={upsertHospital.isPending}>
              Save hospital details
            </Button>
          </CardFooter>
        </Card>
      </form>

      <Card>
        <CardHeader
          title="Referral availability"
          description="Controls whether this hospital can be recommended as a destination."
        />
        <CardBody className="space-y-3">
          <Toggle
            checked={hospital.accepts_referrals}
            onChange={(next) => {
              if (next) void setAcceptsReferrals(true)
              else setConfirmDiversion(true)
            }}
            disabled={upsertHospital.isPending}
            label="Accepting incoming referrals"
            description={
              hospital.accepts_referrals
                ? 'This hospital is ranked normally against incoming cases.'
                : 'This hospital is currently excluded from every ranking.'
            }
          />
          {!hospital.accepts_referrals && (
            <Alert tone="warning" title="Not receiving referrals">
              No referring hospital can see or select this facility while this is switched off.
              Turn it back on as soon as the facility can receive patients again.
            </Alert>
          )}
        </CardBody>
      </Card>

      <Modal
        open={confirmDiversion}
        onClose={() => setConfirmDiversion(false)}
        title="Stop accepting referrals?"
        description="This takes effect immediately across the whole network."
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmDiversion(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={upsertHospital.isPending}
              onClick={() => void setAcceptsReferrals(false)}
            >
              Stop accepting referrals
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600 dark:text-slate-300">
          {hospital.name} will be removed from every referral ranking. Referring hospitals will not
          see it as an option, however strong its resources are, until this is switched back on.
        </p>
      </Modal>
    </div>
  )
}
