/**
 * New referral request -- a three-step wizard on one route.
 *
 * The wizard keeps a single form instance across all three steps so the case
 * details survive a trip back from the ranking, and so the score snapshot
 * written to the referral is built from exactly the inputs the coordinator saw.
 */

import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  Phone,
  RefreshCw,
  Send,
  ShieldAlert,
  SlidersHorizontal,
} from 'lucide-react'
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Checkbox,
  ErrorBlock,
  Field,
  Input,
  LoadingBlock,
  PageHeader,
  Select,
  StatusDot,
  Textarea,
} from '@/components/ui'
import { CandidateList } from './CandidateList'
import {
  useCreateReferral,
  useEmergencyRequirements,
  useEmergencyTypes,
  useReferralCandidates,
  useScoringConfig,
} from './useReferrals'
import { useAuth } from '@/auth/AuthProvider'
import { formatDistance, formatDuration, isValidLatLng } from '@/domain/geo'
import {
  buildCandidateSnapshot,
  buildScoreSnapshot,
  rankHospitals,
  type RankingInput,
} from '@/domain/scoring'
import {
  AGE_BAND_LABELS,
  AGE_BANDS,
  CLINICAL_SUMMARY_MAX_LENGTH,
  DEFAULT_SCORING_CONFIG,
  HOSPITAL_LEVEL_LABELS,
  PATIENT_SEXES,
  RESOURCE_GROUP_LABELS,
  RESOURCE_KEYS,
  RESOURCES,
  URGENCY_LABELS,
  URGENCY_LEVELS,
  type AgeBand,
  type HospitalLevel,
  type PatientSex,
  type ResourceKey,
  type UrgencyLevel,
} from '@/lib/constants'
import { humanizeSupabaseError } from '@/lib/supabase'
import type { Json, ScoredHospital } from '@/lib/types'
import { cn, formatPercent, generatePatientRef, groupBy, telHref, unique } from '@/lib/utils'

const PATIENT_SEX_LABELS: Record<PatientSex, string> = {
  female: 'Female',
  male: 'Male',
  other: 'Other',
  undisclosed: 'Not disclosed',
}

const STEPS = [
  { number: 1, label: 'Case details' },
  { number: 2, label: 'Choose hospital' },
  { number: 3, label: 'Confirm & send' },
] as const

const caseSchema = z.object({
  emergencyTypeId: z.string().min(1, 'Choose the emergency type'),
  urgency: z.enum(URGENCY_LEVELS),
  patientRef: z
    .string()
    .trim()
    .min(3, 'Give the case a short reference')
    .max(40, 'Keep the reference under 40 characters'),
  ageBand: z.enum(AGE_BANDS),
  sex: z.enum(PATIENT_SEXES),
  clinicalSummary: z
    .string()
    .trim()
    .min(20, 'Describe the presentation in at least 20 characters')
    .max(CLINICAL_SUMMARY_MAX_LENGTH, 'The summary is too long'),
  additionalRequired: z.array(z.enum(RESOURCE_KEYS)),
  maxKm: z
    .number({ invalid_type_error: 'Enter a search radius in kilometres' })
    .min(5, 'Search at least 5 km')
    .max(1000, 'Search at most 1000 km'),
})

type CaseFormValues = z.infer<typeof caseSchema>

const RESOURCE_GROUPS = Object.keys(RESOURCE_GROUP_LABELS) as Array<
  keyof typeof RESOURCE_GROUP_LABELS
>

const RESOURCES_BY_GROUP = groupBy([...RESOURCE_KEYS], (key) => RESOURCES[key].group)

function Stepper({ step, onNavigate }: { step: number; onNavigate: (target: number) => void }) {
  return (
    <ol className="flex items-center gap-2 overflow-x-auto pb-1">
      {STEPS.map((entry, index) => {
        const state = entry.number === step ? 'current' : entry.number < step ? 'done' : 'todo'
        return (
          <li key={entry.number} className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => entry.number < step && onNavigate(entry.number)}
              disabled={entry.number >= step}
              aria-current={state === 'current' ? 'step' : undefined}
              className={cn(
                'inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium transition-colors',
                state === 'current' && 'bg-brand-600 text-white',
                state === 'done' &&
                  'bg-brand-50 text-brand-700 hover:bg-brand-100 dark:bg-brand-950/40 dark:text-brand-300',
                state === 'todo' && 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400',
              )}
            >
              <span
                className={cn(
                  'inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px]',
                  state === 'current' ? 'bg-white/20' : 'bg-white/60 dark:bg-slate-900/60',
                )}
                aria-hidden
              >
                {state === 'done' ? <Check className="h-3 w-3" /> : entry.number}
              </span>
              {entry.label}
            </button>
            {index < STEPS.length - 1 && (
              <span className="h-px w-4 bg-slate-300 dark:bg-slate-700" aria-hidden />
            )}
          </li>
        )
      })}
    </ol>
  )
}

function SummaryRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <dt className="shrink-0 text-xs text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className="text-right text-sm text-slate-900 dark:text-slate-100">{value}</dd>
    </div>
  )
}

/**
 * Carried in router state when a coordinator re-refers after a decline, so the
 * clinical detail does not have to be retyped under time pressure.
 */
export interface ReferralPrefill {
  emergencyTypeId?: string
  urgency?: UrgencyLevel
  patientRef?: string
  ageBand?: AgeBand
  sex?: PatientSex
  clinicalSummary?: string
  additionalRequired?: ResourceKey[]
  /** Hospitals that already declined or were tried; excluded from selection. */
  excludeHospitalIds?: string[]
  fromReferral?: string
}

export default function NewReferralPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const prefill = (location.state as { prefill?: ReferralPrefill } | null)?.prefill
  const { hospital } = useAuth()
  const hospitalId = hospital?.id ?? null

  const [step, setStep] = useState(1)
  const [selectedHospitalId, setSelectedHospitalId] = useState<string | null>(null)
  const radiusTouched = useRef(false)
  const initialPatientRef = useRef(generatePatientRef())

  const emergencyTypesQuery = useEmergencyTypes()
  const configQuery = useScoringConfig()

  const { control, formState, handleSubmit, register, setValue, trigger, watch } =
    useForm<CaseFormValues>({
      resolver: zodResolver(caseSchema),
      mode: 'onTouched',
      defaultValues: {
        emergencyTypeId: prefill?.emergencyTypeId ?? '',
        urgency: prefill?.urgency ?? 'urgent',
        // The patient reference carries over deliberately: a re-referral after a
        // decline is the same patient, and keeping the code lets the two records
        // be tied together afterwards.
        patientRef: prefill?.patientRef ?? initialPatientRef.current,
        ageBand: prefill?.ageBand ?? 'adult',
        sex: prefill?.sex ?? 'undisclosed',
        clinicalSummary: prefill?.clinicalSummary ?? '',
        additionalRequired: prefill?.additionalRequired ?? [],
        maxKm: DEFAULT_SCORING_CONFIG.maxDistanceKm,
      },
    })

  const emergencyTypeId = watch('emergencyTypeId')
  const urgency = watch('urgency')
  const maxKm = watch('maxKm')
  const additionalRequired = watch('additionalRequired')
  const clinicalSummary = watch('clinicalSummary')

  const requirementsQuery = useEmergencyRequirements(emergencyTypeId || null)
  const candidatesQuery = useReferralCandidates({
    originHospitalId: step >= 2 ? hospitalId : null,
    emergencyTypeId: step >= 2 ? emergencyTypeId || null : null,
    maxKm,
  })
  const createReferral = useCreateReferral()

  const config = configQuery.data ?? DEFAULT_SCORING_CONFIG

  // The coordinator's radius overrides the configured default for this case.
  const effectiveConfig = useMemo(() => ({ ...config, maxDistanceKm: maxKm }), [config, maxKm])

  useEffect(() => {
    if (radiusTouched.current || !configQuery.data) return
    setValue('maxKm', configQuery.data.maxDistanceKm)
  }, [configQuery.data, setValue])

  const emergencyTypes = useMemo(() => emergencyTypesQuery.data ?? [], [emergencyTypesQuery.data])
  const emergencyTypesByCategory = useMemo(
    () => groupBy(emergencyTypes, (type) => type.category),
    [emergencyTypes],
  )
  const selectedEmergencyType = useMemo(
    () => emergencyTypes.find((type) => type.id === emergencyTypeId) ?? null,
    [emergencyTypes, emergencyTypeId],
  )

  // A hospital that has already declined this patient is dropped outright
  // rather than ranked and excluded, so the coordinator is not re-offered the
  // facility that just said no.
  const excludedIds = useMemo(
    () => new Set(prefill?.excludeHospitalIds ?? []),
    [prefill?.excludeHospitalIds],
  )

  const rankingInput = useMemo<RankingInput>(
    () => ({
      candidates: (candidatesQuery.data ?? []).filter(
        (candidate) => !excludedIds.has(candidate.hospital_id),
      ),
      requirements: requirementsQuery.data ?? [],
      additionalRequired,
      urgency,
      config: effectiveConfig,
      originHospitalId: hospitalId ?? undefined,
    }),
    [
      candidatesQuery.data,
      excludedIds,
      requirementsQuery.data,
      additionalRequired,
      urgency,
      effectiveConfig,
      hospitalId,
    ],
  )

  const ranked = useMemo(() => rankHospitals(rankingInput), [rankingInput])
  const eligible = useMemo(() => ranked.filter((entry) => entry.eligible), [ranked])
  const recommended: ScoredHospital | null = eligible[0] ?? null
  const selected = useMemo(
    () => ranked.find((entry) => entry.hospital.hospital_id === selectedHospitalId) ?? null,
    [ranked, selectedHospitalId],
  )
  const isOverride = Boolean(
    selected && recommended && selected.hospital.hospital_id !== recommended.hospital.hospital_id,
  )

  // A widened radius or a changed requirement can retire the chosen hospital.
  useEffect(() => {
    if (!selectedHospitalId || ranked.length === 0) return
    const stillEligible = ranked.some(
      (entry) => entry.hospital.hospital_id === selectedHospitalId && entry.eligible,
    )
    if (!stillEligible) setSelectedHospitalId(null)
  }, [ranked, selectedHospitalId])

  const originHasCoordinates = hospital
    ? isValidLatLng({ latitude: hospital.latitude, longitude: hospital.longitude })
    : false

  const candidatesLoading = candidatesQuery.isPending || candidatesQuery.isFetching
  const requirements = requirementsQuery.data ?? []

  async function goToStepTwo() {
    const valid = await trigger([
      'emergencyTypeId',
      'urgency',
      'patientRef',
      'ageBand',
      'sex',
      'clinicalSummary',
      'maxKm',
    ])
    if (!valid) return
    setStep(2)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function goToStep(target: number) {
    setStep(target)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function widenRadius(extraKm: number) {
    radiusTouched.current = true
    setValue('maxKm', Math.min(1000, Math.round(maxKm + extraKm)), { shouldValidate: true })
  }

  const onSubmit = handleSubmit(async (values) => {
    if (!selected) {
      toast.error('Choose a receiving hospital first')
      setStep(2)
      return
    }

    const snapshot = buildScoreSnapshot(selected, rankingInput, new Date())
    // There is no column for "the coordinator disagreed with the ranking", and
    // that is exactly the question an audit asks first, so it rides along in
    // the score snapshot jsonb.
    const scoreSnapshot =
      isOverride && recommended
        ? {
            ...snapshot,
            override: {
              recommended_hospital_id: recommended.hospital.hospital_id,
              recommended_hospital_name: recommended.hospital.name,
              recommended_score: recommended.score,
              selected_rank: selected.rank,
              selected_score: selected.score,
            },
          }
        : snapshot

    const requiredResources = unique<ResourceKey>([
      ...requirements.map((requirement) => requirement.resource_key),
      ...values.additionalRequired,
    ])

    try {
      const result = await createReferral.mutateAsync({
        receivingHospitalId: selected.hospital.hospital_id,
        emergencyTypeId: values.emergencyTypeId,
        urgency: values.urgency,
        patientRef: values.patientRef.trim(),
        patientAgeBand: values.ageBand,
        patientSex: values.sex,
        clinicalSummary: values.clinicalSummary.trim(),
        requiredResources,
        // The snapshot interfaces carry no index signature, so they need a
        // widening cast before they can travel as jsonb.
        scoreSnapshot: scoreSnapshot as unknown as Json,
        candidateSnapshot: buildCandidateSnapshot(ranked) as unknown as Json,
        distanceKm: selected.roadDistanceKm,
        etaMinutes: selected.etaMinutes,
      })
      toast.success(`Referral ${result.reference_number} sent to ${selected.hospital.name}`)
      navigate(`/referrals/${result.id}`)
    } catch (error) {
      toast.error(humanizeSupabaseError(error))
    }
  })

  const summaryLength = clinicalSummary?.length ?? 0
  const selectedPhone = selected?.hospital.phone ?? null
  const selectedEmergencyPhone = selected?.hospital.emergency_phone ?? null

  return (
    <form onSubmit={onSubmit} className="space-y-5 pb-4">
      <PageHeader
        title="New referral request"
        description="Describe the case, compare the ranked hospitals, then send the request."
      />

      <Stepper step={step} onNavigate={goToStep} />

      {!hospitalId && (
        <Alert tone="danger" title="Your account is not linked to a hospital">
          A referral must be raised from a facility. Ask an administrator to attach your profile to
          a hospital before you continue.
        </Alert>
      )}

      {hospitalId && !originHasCoordinates && (
        <Alert tone="danger" title={`${hospital?.name ?? 'Your hospital'} has no map coordinates`}>
          Hospitals are ranked on distance from your facility, so nothing can be scored until an
          administrator sets your latitude and longitude in the hospital record.
        </Alert>
      )}

      {/* ---------------- Step 1: case details ---------------- */}
      {step === 1 && (
        <div className="space-y-4">
          <Card>
            <CardHeader
              title="What is the emergency?"
              description="The emergency type decides which resources a receiving hospital must have."
            />
            <CardBody className="space-y-4">
              {emergencyTypesQuery.isPending ? (
                <LoadingBlock label="Loading emergency types" rows={2} />
              ) : emergencyTypesQuery.isError ? (
                <ErrorBlock
                  error={emergencyTypesQuery.error}
                  onRetry={() => void emergencyTypesQuery.refetch()}
                />
              ) : (
                <Field
                  label="Emergency type"
                  required
                  error={formState.errors.emergencyTypeId?.message}
                  hint={selectedEmergencyType?.description ?? undefined}
                >
                  {({ id, describedBy }) => (
                    <Select
                      id={id}
                      aria-describedby={describedBy}
                      {...register('emergencyTypeId', {
                        onChange: (event: ChangeEvent<HTMLSelectElement>) => {
                          const type = emergencyTypes.find(
                            (candidate) => candidate.id === event.target.value,
                          )
                          if (type) setValue('urgency', type.default_urgency)
                          setSelectedHospitalId(null)
                        },
                      })}
                    >
                      <option value="">Select an emergency type</option>
                      {Object.entries(emergencyTypesByCategory).map(([category, types]) => (
                        <optgroup key={category} label={category}>
                          {types.map((type) => (
                            <option key={type.id} value={type.id}>
                              {type.name}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </Select>
                  )}
                </Field>
              )}

              <Field label="Urgency" required error={formState.errors.urgency?.message}>
                {({ id, describedBy }) => (
                  <Select id={id} aria-describedby={describedBy} {...register('urgency')}>
                    {URGENCY_LEVELS.map((level) => (
                      <option key={level} value={level}>
                        {URGENCY_LABELS[level]}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Patient"
              description="Anonymous by design - FERN never stores identifying details."
            />
            <CardBody className="space-y-4">
              <Field
                label="Patient reference"
                required
                error={formState.errors.patientRef?.message}
                hint="A non-identifying local code. Keep your own note of which patient it maps to."
              >
                {({ id, describedBy }) => (
                  <div className="flex gap-2">
                    <Input id={id} aria-describedby={describedBy} {...register('patientRef')} />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      aria-label="Generate a new patient reference"
                      onClick={() =>
                        setValue('patientRef', generatePatientRef(), { shouldValidate: true })
                      }
                    >
                      <RefreshCw className="h-4 w-4" aria-hidden />
                    </Button>
                  </div>
                )}
              </Field>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Age band" required error={formState.errors.ageBand?.message}>
                  {({ id, describedBy }) => (
                    <Select id={id} aria-describedby={describedBy} {...register('ageBand')}>
                      {AGE_BANDS.map((band) => (
                        <option key={band} value={band}>
                          {AGE_BAND_LABELS[band]}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>

                <Field label="Sex" required error={formState.errors.sex?.message}>
                  {({ id, describedBy }) => (
                    <Select id={id} aria-describedby={describedBy} {...register('sex')}>
                      {PATIENT_SEXES.map((value) => (
                        <option key={value} value={value}>
                          {PATIENT_SEX_LABELS[value]}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              </div>

              <Field
                label="Clinical summary"
                required
                error={formState.errors.clinicalSummary?.message}
              >
                {({ id, describedBy }) => (
                  <>
                    <Textarea
                      id={id}
                      aria-describedby={describedBy}
                      rows={5}
                      maxLength={CLINICAL_SUMMARY_MAX_LENGTH}
                      placeholder="Presentation, vital signs, interventions given, what the receiving team needs to be ready for."
                      {...register('clinicalSummary')}
                    />
                    <p
                      className={cn(
                        'text-right text-xs tabular-nums',
                        summaryLength > CLINICAL_SUMMARY_MAX_LENGTH - 100
                          ? 'text-amber-600 dark:text-amber-400'
                          : 'text-slate-500 dark:text-slate-400',
                      )}
                      aria-live="polite"
                    >
                      {summaryLength} / {CLINICAL_SUMMARY_MAX_LENGTH}
                    </p>
                  </>
                )}
              </Field>

              <Alert tone="warning" title="No patient identifiers">
                <p className="flex items-start gap-2">
                  <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                  <span>
                    Do not enter names, dates of birth, hospital or folder numbers, or anything else
                    that identifies the patient. This field is stored on the referral record and is
                    audited.
                  </span>
                </p>
              </Alert>
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Search settings"
              description="Optional. These tighten the ranking for this case only."
            />
            <CardBody className="space-y-5">
              <Field
                label="Search radius"
                error={formState.errors.maxKm?.message}
                hint={`Hospitals further than this from ${hospital?.name ?? 'your facility'} are not considered.`}
              >
                {({ id, describedBy }) => (
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="flex items-center gap-2">
                      <Input
                        id={id}
                        aria-describedby={describedBy}
                        type="number"
                        inputMode="numeric"
                        min={5}
                        max={1000}
                        step={5}
                        className="w-28"
                        {...register('maxKm', {
                          valueAsNumber: true,
                          onChange: () => {
                            radiusTouched.current = true
                          },
                        })}
                      />
                      <span className="text-sm text-slate-600 dark:text-slate-400">km</span>
                    </div>
                    {[50, 100].map((extra) => (
                      <Button
                        key={extra}
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => widenRadius(extra)}
                      >
                        +{extra} km
                      </Button>
                    ))}
                  </div>
                )}
              </Field>

              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <SlidersHorizontal className="h-4 w-4 text-slate-400" aria-hidden />
                  <p className="field-label">Additional resources required</p>
                </div>
                <p className="hint">
                  Anything ticked here becomes a hard requirement: hospitals without it are excluded
                  from the ranking.
                </p>
                <Controller
                  control={control}
                  name="additionalRequired"
                  render={({ field }) => (
                    <div className="space-y-4">
                      {RESOURCE_GROUPS.map((group) => (
                        <fieldset key={group} className="space-y-2">
                          <legend className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                            {RESOURCE_GROUP_LABELS[group]}
                          </legend>
                          <div className="grid gap-2 sm:grid-cols-2">
                            {(RESOURCES_BY_GROUP[group] ?? []).map((key) => (
                              <Checkbox
                                key={key}
                                label={RESOURCES[key].label}
                                description={RESOURCES[key].help}
                                checked={field.value.includes(key)}
                                onChange={(event) => {
                                  const next = event.target.checked
                                    ? [...field.value, key]
                                    : field.value.filter((value) => value !== key)
                                  field.onChange(next)
                                  setSelectedHospitalId(null)
                                }}
                              />
                            ))}
                          </div>
                        </fieldset>
                      ))}
                    </div>
                  )}
                />
              </div>
            </CardBody>
          </Card>
        </div>
      )}

      {/* ---------------- Step 2: ranked hospitals ---------------- */}
      {step === 2 && (
        <div className="space-y-4">
          <Card>
            <CardBody className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                  {selectedEmergencyType?.name ?? 'Emergency'} - {URGENCY_LABELS[urgency]}
                </p>
                <p className="hint">
                  Within {Math.round(maxKm)} km of {hospital?.name ?? 'your facility'}
                  {additionalRequired.length > 0 &&
                    ` - ${additionalRequired.length} extra requirement${
                      additionalRequired.length === 1 ? '' : 's'
                    }`}
                </p>
              </div>
              <div className="flex gap-2">
                <Button type="button" size="sm" variant="outline" onClick={() => goToStep(1)}>
                  Edit case
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => void candidatesQuery.refetch()}
                  loading={candidatesQuery.isFetching}
                >
                  <RefreshCw className="h-4 w-4" aria-hidden />
                  Refresh
                </Button>
              </div>
            </CardBody>
          </Card>

          {candidatesQuery.isError ? (
            <ErrorBlock
              error={candidatesQuery.error}
              onRetry={() => void candidatesQuery.refetch()}
            />
          ) : candidatesLoading && ranked.length === 0 ? (
            <Card>
              <LoadingBlock label="Scoring nearby hospitals" rows={4} />
            </Card>
          ) : (candidatesQuery.data ?? []).length === 0 ? (
            <Card>
              <CardBody className="space-y-4 text-center">
                <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                  No hospital found within {Math.round(maxKm)} km
                </p>
                <p className="hint">
                  Widen the search radius to look further afield, or ask an administrator to check
                  that nearby facilities are registered.
                </p>
                <div className="flex flex-wrap justify-center gap-2">
                  <Button type="button" variant="outline" onClick={() => widenRadius(50)}>
                    Search {Math.round(maxKm) + 50} km
                  </Button>
                  <Button type="button" variant="outline" onClick={() => widenRadius(150)}>
                    Search {Math.round(maxKm) + 150} km
                  </Button>
                </div>
              </CardBody>
            </Card>
          ) : (
            <>
              {isOverride && recommended && selected && (
                <Alert tone="warning" title="This is not the recommended hospital">
                  <p className="flex items-start gap-2">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                    <span>
                      {recommended.hospital.name} scored {formatPercent(recommended.score)} against{' '}
                      {formatPercent(selected.score)} for {selected.hospital.name}. You can still
                      send this referral - the override is recorded with the request.
                    </span>
                  </p>
                </Alert>
              )}

              <CandidateList
                ranked={ranked}
                config={effectiveConfig}
                selectedHospitalId={selectedHospitalId}
                onSelect={(candidate) => setSelectedHospitalId(candidate.hospital.hospital_id)}
              />
            </>
          )}
        </div>
      )}

      {/* ---------------- Step 3: confirm ---------------- */}
      {step === 3 && selected && (
        <div className="space-y-4">
          <Card>
            <CardHeader title="Receiving hospital" />
            <CardBody className="space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-base font-semibold text-slate-900 dark:text-slate-50">
                    {selected.hospital.name}
                  </p>
                  <p className="hint">
                    {HOSPITAL_LEVEL_LABELS[selected.hospital.level as HospitalLevel] ??
                      selected.hospital.level}
                    {selected.hospital.city ? ` - ${selected.hospital.city}` : ''}
                    {selected.hospital.region ? `, ${selected.hospital.region}` : ''}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600 dark:text-slate-400">
                    <StatusDot
                      status={selected.readiness}
                      label={
                        selected.shiftsSinceUpdate <= 0
                          ? 'Updated this shift'
                          : `Updated ${selected.shiftsSinceUpdate} shift${
                              selected.shiftsSinceUpdate === 1 ? '' : 's'
                            } ago`
                      }
                    />
                    <span>{formatDistance(selected.roadDistanceKm)} by road</span>
                    <span>{formatDuration(selected.etaMinutes)} estimated</span>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-2xl font-semibold tabular-nums text-slate-900 dark:text-slate-50">
                    {formatPercent(selected.score)}
                  </p>
                  <p className="hint">match score</p>
                  {isOverride ? (
                    <Badge tone="warning" className="mt-1">
                      Rank {selected.rank} - override
                    </Badge>
                  ) : (
                    <Badge tone="brand" className="mt-1">
                      Recommended
                    </Badge>
                  )}
                </div>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row">
                {telHref(selectedEmergencyPhone) && (
                  <a
                    href={telHref(selectedEmergencyPhone)}
                    className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-lg bg-red-600 px-4 text-sm font-medium text-white hover:bg-red-700"
                  >
                    <Phone className="h-4 w-4" aria-hidden />
                    Emergency line {selectedEmergencyPhone}
                  </a>
                )}
                {telHref(selectedPhone) && (
                  <a
                    href={telHref(selectedPhone)}
                    className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-lg border border-slate-300 px-4 text-sm font-medium text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-100 dark:hover:bg-slate-800"
                  >
                    <Phone className="h-4 w-4" aria-hidden />
                    Switchboard {selectedPhone}
                  </a>
                )}
                {!telHref(selectedPhone) && !telHref(selectedEmergencyPhone) && (
                  <p className="hint">
                    No telephone number is on record for this hospital. Use the referral chat once
                    the request is sent.
                  </p>
                )}
              </div>
            </CardBody>
          </Card>

          {isOverride && recommended && (
            <Alert tone="warning" title="Recommendation overridden">
              The ranking put {recommended.hospital.name} first at{' '}
              {formatPercent(recommended.score)}. Your choice and the alternatives are recorded with
              the referral.
            </Alert>
          )}

          <Card>
            <CardHeader title="Case summary" description="Check this before it is sent." />
            <CardBody>
              <dl className="divide-y divide-slate-200 dark:divide-slate-800">
                <SummaryRow label="Emergency" value={selectedEmergencyType?.name ?? '-'} />
                <SummaryRow label="Urgency" value={URGENCY_LABELS[urgency]} />
                <SummaryRow label="Patient reference" value={watch('patientRef')} />
                <SummaryRow label="Age band" value={AGE_BAND_LABELS[watch('ageBand')]} />
                <SummaryRow label="Sex" value={PATIENT_SEX_LABELS[watch('sex')]} />
                <SummaryRow
                  label="Required resources"
                  value={
                    unique<ResourceKey>([
                      ...requirements.map((requirement) => requirement.resource_key),
                      ...additionalRequired,
                    ])
                      .map((key) => RESOURCES[key]?.label ?? key)
                      .join(', ') || 'None recorded'
                  }
                />
              </dl>
              <div className="mt-3 rounded-lg bg-slate-50 p-3 text-sm text-slate-800 dark:bg-slate-800/50 dark:text-slate-200">
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Clinical summary
                </p>
                <p className="whitespace-pre-wrap">{clinicalSummary}</p>
              </div>
            </CardBody>
          </Card>
        </div>
      )}

      {step === 3 && !selected && (
        <Alert tone="warning" title="No hospital selected">
          The hospital you chose is no longer available. Go back and pick another.
        </Alert>
      )}

      {/* ---------------- actions ---------------- */}
      <div className="sticky bottom-0 z-10 flex flex-col gap-2 border-t border-slate-200 bg-slate-50/95 py-3 backdrop-blur sm:flex-row sm:items-center sm:justify-between dark:border-slate-800 dark:bg-slate-950/95">
        <div className="hidden text-xs text-slate-500 sm:block dark:text-slate-400">
          {step === 2 && selected
            ? `${selected.hospital.name} selected`
            : step === 2
              ? 'Select a hospital to continue'
              : ''}
        </div>
        <div className="flex gap-2">
          {step > 1 && (
            <Button type="button" variant="outline" onClick={() => goToStep(step - 1)} fullWidth>
              <ArrowLeft className="h-4 w-4" aria-hidden />
              Back
            </Button>
          )}
          {step === 1 && (
            <Button
              type="button"
              onClick={() => void goToStepTwo()}
              disabled={!hospitalId || !originHasCoordinates}
              fullWidth
            >
              Find hospitals
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Button>
          )}
          {step === 2 && (
            <Button type="button" onClick={() => goToStep(3)} disabled={!selected} fullWidth>
              Review request
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Button>
          )}
          {step === 3 && (
            <Button
              type="submit"
              variant="success"
              disabled={!selected}
              loading={createReferral.isPending}
              fullWidth
            >
              <Send className="h-4 w-4" aria-hidden />
              Send referral request
            </Button>
          )}
        </div>
      </div>
    </form>
  )
}
