import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Calculator, RotateCcw } from 'lucide-react'
import { useAuth } from '@/auth/AuthProvider'
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  ErrorBlock,
  Field,
  Input,
  LoadingBlock,
  Meter,
  Select,
  Toggle,
} from '@/components/ui'
import {
  DEFAULT_SCORING_CONFIG,
  READINESS_LABELS,
  READINESS_STATUSES,
  type ReadinessStatus,
  type ScoringConfig,
} from '@/lib/constants'
import { estimateEtaMinutes, formatDistance, formatDuration, proximityScore, roadDistanceKm } from '@/domain/geo'
import { humanizeSupabaseError } from '@/lib/supabase'
import { formatDateTime, formatPercent } from '@/lib/utils'
import { rowToScoringConfig, useScoringConfigRow, useUpdateScoringConfig } from './useAdmin'

function SliderField({
  label,
  hint,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string
  hint?: string
  value: number
  min: number
  max: number
  step: number
  format: (value: number) => string
  onChange: (value: number) => void
}) {
  return (
    <Field label={label} hint={hint}>
      {({ id, describedBy }) => (
        <div className="flex items-center gap-3">
          <input
            id={id}
            type="range"
            aria-describedby={describedBy}
            className="h-2 w-full cursor-pointer accent-brand-600"
            min={min}
            max={max}
            step={step}
            value={value}
            onChange={(event) => onChange(Number(event.target.value))}
          />
          <span className="w-20 shrink-0 text-right text-sm font-medium tabular-nums text-slate-900 dark:text-slate-100">
            {format(value)}
          </span>
        </div>
      )}
    </Field>
  )
}

interface WorkedExample {
  resourceScore: number
  distanceKm: number
  readiness: ReadinessStatus
}

interface ExampleResult {
  etaMinutes: number
  roadKm: number
  proximity: number
  weighted: number
  penaltyPoints: number
  final: number
  excluded: string | null
}

function evaluateExample(config: ScoringConfig, example: WorkedExample): ExampleResult {
  const etaMinutes = estimateEtaMinutes(example.distanceKm, 'urgent', config)
  const proximity = proximityScore(etaMinutes, config.maxEtaMinutes)
  const weighted = example.resourceScore * config.resourceWeight + proximity * config.proximityWeight

  const penaltyRate =
    example.readiness === 'yellow'
      ? config.yellowPenalty
      : example.readiness === 'red'
        ? config.redPenalty
        : 0
  const penaltyPoints = weighted * penaltyRate

  const excluded =
    example.distanceKm > config.maxDistanceKm
      ? `Beyond the ${config.maxDistanceKm} km cut-off, so this hospital is not considered at all.`
      : example.readiness === 'red' && config.excludeRedHospitals
        ? 'Readiness is red and red hospitals are excluded outright.'
        : null

  return {
    etaMinutes,
    roadKm: roadDistanceKm(example.distanceKm, config.roadDistanceFactor),
    proximity,
    weighted,
    penaltyPoints,
    final: weighted - penaltyPoints,
    excluded,
  }
}

export default function ScoringSettings() {
  const { timezone } = useAuth()
  const configQuery = useScoringConfigRow()
  const updateConfig = useUpdateScoringConfig()

  const [draft, setDraft] = useState<ScoringConfig>(DEFAULT_SCORING_CONFIG)
  const [configId, setConfigId] = useState(1)
  const [example, setExample] = useState<WorkedExample>({
    resourceScore: 78,
    distanceKm: 42,
    readiness: 'yellow',
  })

  const row = configQuery.data ?? null

  useEffect(() => {
    if (!row) return
    setDraft(rowToScoringConfig(row))
    setConfigId(row.id)
  }, [row])

  const saved = useMemo(
    () => (row ? rowToScoringConfig(row) : DEFAULT_SCORING_CONFIG),
    [row],
  )

  const draftResult = evaluateExample(draft, example)
  const savedResult = evaluateExample(saved, example)
  const delta = draftResult.final - savedResult.final

  const set = <K extends keyof ScoringConfig>(key: K, value: ScoringConfig[K]) =>
    setDraft((current) => ({ ...current, [key]: value }))

  /** The two weights are one dial: whatever one gives up, the other takes. */
  const setResourceWeight = (percent: number) => {
    const resourceWeight = Math.round(percent) / 100
    setDraft((current) => ({
      ...current,
      resourceWeight,
      proximityWeight: Number((1 - resourceWeight).toFixed(2)),
    }))
  }

  const save = async () => {
    try {
      await updateConfig.mutateAsync({ id: configId, ...draft })
      toast.success('Scoring configuration saved')
    } catch (error) {
      toast.error(humanizeSupabaseError(error))
    }
  }

  if (configQuery.isLoading) {
    return (
      <Card>
        <LoadingBlock label="Loading scoring configuration" rows={5} />
      </Card>
    )
  }

  if (configQuery.isError) {
    return (
      <Card>
        <CardBody>
          <ErrorBlock error={configQuery.error} onRetry={() => void configQuery.refetch()} />
        </CardBody>
      </Card>
    )
  }

  const resourcePercent = Math.round(draft.resourceWeight * 100)

  return (
    <div className="space-y-5">
      <Alert tone="warning" title="These settings change every future ranking">
        Referrals already raised keep the score they were ranked with: their snapshots are never
        rewritten, so historical decisions stay auditable exactly as they were made.
      </Alert>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Weighting"
            description="How much of the final percentage comes from resources versus proximity."
          />
          <CardBody className="space-y-5">
            <SliderField
              label="Resource availability weight"
              hint={`Proximity automatically takes the remaining ${100 - resourcePercent}%.`}
              value={resourcePercent}
              min={0}
              max={100}
              step={5}
              format={(value) => `${value}%`}
              onChange={setResourceWeight}
            />

            <div className="flex h-3 overflow-hidden rounded-full">
              <div
                className="bg-brand-600"
                style={{ width: `${resourcePercent}%` }}
                aria-hidden
              />
              <div
                className="bg-sky-400"
                style={{ width: `${100 - resourcePercent}%` }}
                aria-hidden
              />
            </div>
            <p className="hint">
              Resources {resourcePercent}% - Proximity {100 - resourcePercent}%. The spec default is
              70 / 30.
            </p>

            <SliderField
              label="Yellow readiness penalty"
              hint="Deducted from a hospital that missed its last shift update."
              value={Math.round(draft.yellowPenalty * 100)}
              min={0}
              max={60}
              step={1}
              format={(value) => `-${value}%`}
              onChange={(value) => set('yellowPenalty', value / 100)}
            />

            <SliderField
              label="Red readiness penalty"
              hint="Deducted from a hospital with no update for three shifts."
              value={Math.round(draft.redPenalty * 100)}
              min={0}
              max={90}
              step={1}
              format={(value) => `-${value}%`}
              onChange={(value) => set('redPenalty', value / 100)}
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Distance and transport"
            description="How straight-line distance becomes an estimated arrival time."
          />
          <CardBody className="space-y-4">
            <Field
              label="Maximum straight-line distance"
              hint="Hospitals further away than this are not considered at all."
            >
              {({ id, describedBy }) => (
                <div className="flex items-center gap-2">
                  <Input
                    id={id}
                    type="number"
                    min={1}
                    max={2000}
                    aria-describedby={describedBy}
                    value={draft.maxDistanceKm}
                    onChange={(event) => set('maxDistanceKm', Number(event.target.value))}
                  />
                  <span className="hint w-10 shrink-0">km</span>
                </div>
              )}
            </Field>

            <Field
              label="Maximum ETA"
              hint="Proximity scores zero at this arrival time and above."
            >
              {({ id, describedBy }) => (
                <div className="flex items-center gap-2">
                  <Input
                    id={id}
                    type="number"
                    min={5}
                    max={1440}
                    aria-describedby={describedBy}
                    value={draft.maxEtaMinutes}
                    onChange={(event) => set('maxEtaMinutes', Number(event.target.value))}
                  />
                  <span className="hint w-10 shrink-0">min</span>
                </div>
              )}
            </Field>

            <Field
              label="Road distance factor"
              hint="Straight-line distance is multiplied by this to approximate the road route."
            >
              {({ id, describedBy }) => (
                <Input
                  id={id}
                  type="number"
                  step="0.05"
                  min={1}
                  max={3}
                  aria-describedby={describedBy}
                  value={draft.roadDistanceFactor}
                  onChange={(event) => set('roadDistanceFactor', Number(event.target.value))}
                />
              )}
            </Field>

            <Field
              label="Fixed transport overhead"
              hint="Dispatch and handover time added to every ETA."
            >
              {({ id, describedBy }) => (
                <div className="flex items-center gap-2">
                  <Input
                    id={id}
                    type="number"
                    min={0}
                    max={120}
                    aria-describedby={describedBy}
                    value={draft.fixedTransportOverheadMinutes}
                    onChange={(event) =>
                      set('fixedTransportOverheadMinutes', Number(event.target.value))
                    }
                  />
                  <span className="hint w-10 shrink-0">min</span>
                </div>
              )}
            </Field>

            <Field
              label="Tie-break epsilon"
              hint="Scores within this many percentage points count as tied, and are then ordered by historical acceptance rate."
            >
              {({ id, describedBy }) => (
                <Input
                  id={id}
                  type="number"
                  step="0.1"
                  min={0}
                  max={10}
                  aria-describedby={describedBy}
                  value={draft.tieBreakEpsilon}
                  onChange={(event) => set('tieBreakEpsilon', Number(event.target.value))}
                />
              )}
            </Field>
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader title="Exclusions" description="Hard filters applied before any score is computed." />
        <CardBody className="space-y-4">
          <Toggle
            checked={draft.excludeRedHospitals}
            onChange={(next) => set('excludeRedHospitals', next)}
            label="Exclude hospitals with red readiness"
            description="When off, a red hospital can still be recommended but carries the red penalty."
          />
          <Toggle
            checked={draft.excludeHospitalsOnDiversion}
            onChange={(next) => set('excludeHospitalsOnDiversion', next)}
            label="Exclude hospitals on diversion"
            description="A closed emergency room is a hard no; leaving this on is strongly recommended."
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Worked example"
          description="A sample hospital scored with your unsaved settings, so the numbers are not abstract."
          action={<Calculator className="h-5 w-5 text-slate-300 dark:text-slate-600" aria-hidden />}
        />
        <CardBody className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-3">
            <SliderField
              label="Resource sub-score"
              value={example.resourceScore}
              min={0}
              max={100}
              step={1}
              format={(value) => `${value}%`}
              onChange={(value) => setExample((current) => ({ ...current, resourceScore: value }))}
            />
            <SliderField
              label="Straight-line distance"
              value={example.distanceKm}
              min={0}
              max={300}
              step={1}
              format={(value) => `${value} km`}
              onChange={(value) => setExample((current) => ({ ...current, distanceKm: value }))}
            />
            <Field label="Readiness">
              {({ id }) => (
                <Select
                  id={id}
                  value={example.readiness}
                  onChange={(event) =>
                    setExample((current) => ({
                      ...current,
                      readiness: event.target.value as ReadinessStatus,
                    }))
                  }
                >
                  {READINESS_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {READINESS_LABELS[status]} ({status})
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>

          {draftResult.excluded ? (
            <Alert tone="danger" title="Not ranked with these settings">
              {draftResult.excluded}
            </Alert>
          ) : (
            <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950/40">
              <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-500 dark:text-slate-400">Road distance</dt>
                  <dd className="tabular-nums text-slate-900 dark:text-slate-100">
                    {formatDistance(draftResult.roadKm)}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-500 dark:text-slate-400">Estimated arrival</dt>
                  <dd className="tabular-nums text-slate-900 dark:text-slate-100">
                    {formatDuration(draftResult.etaMinutes)}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-500 dark:text-slate-400">
                    Resources x {formatPercent(draft.resourceWeight * 100)}
                  </dt>
                  <dd className="tabular-nums text-slate-900 dark:text-slate-100">
                    {formatPercent(example.resourceScore * draft.resourceWeight, 1)}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-500 dark:text-slate-400">
                    Proximity {formatPercent(draftResult.proximity, 1)} x{' '}
                    {formatPercent(draft.proximityWeight * 100)}
                  </dt>
                  <dd className="tabular-nums text-slate-900 dark:text-slate-100">
                    {formatPercent(draftResult.proximity * draft.proximityWeight, 1)}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-500 dark:text-slate-400">
                    Readiness penalty ({example.readiness})
                  </dt>
                  <dd className="tabular-nums text-red-600 dark:text-red-400">
                    -{formatPercent(draftResult.penaltyPoints, 1)}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-500 dark:text-slate-400">Currently saved settings</dt>
                  <dd className="tabular-nums text-slate-500 dark:text-slate-400">
                    {formatPercent(savedResult.final, 1)}
                  </dd>
                </div>
              </dl>

              <div className="flex items-center gap-3 border-t border-slate-200 pt-3 dark:border-slate-800">
                <div className="min-w-0 flex-1">
                  <Meter
                    value={draftResult.final}
                    tone={
                      draftResult.final >= 70 ? 'success' : draftResult.final >= 45 ? 'warning' : 'danger'
                    }
                    label="Referral score with these settings"
                  />
                </div>
                <p className="shrink-0 text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-50">
                  {formatPercent(draftResult.final, 1)}
                </p>
                {Math.abs(delta) >= 0.05 && (
                  <Badge tone={delta > 0 ? 'success' : 'danger'}>
                    {delta > 0 ? '+' : ''}
                    {delta.toFixed(1)} pts vs saved
                  </Badge>
                )}
              </div>
            </div>
          )}
        </CardBody>
        <CardFooter className="justify-between">
          <span className="hint">
            {row?.updated_at
              ? `Last changed ${formatDateTime(row.updated_at, timezone)}`
              : 'Never changed'}
          </span>
          <span className="flex items-center gap-2">
            <Button
              variant="ghost"
              onClick={() => setDraft(DEFAULT_SCORING_CONFIG)}
              disabled={updateConfig.isPending}
            >
              <RotateCcw className="h-4 w-4" aria-hidden />
              Restore defaults
            </Button>
            <Button loading={updateConfig.isPending} onClick={() => void save()}>
              Save configuration
            </Button>
          </span>
        </CardFooter>
      </Card>
    </div>
  )
}
