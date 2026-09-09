/**
 * The "explain this score" panel.
 *
 * A coordinator is being asked to trust a number that decides where a patient
 * goes, so every term in the formula is shown with the value that produced it
 * -- including the configured weights, which a deployment can change.
 */

import { AlertTriangle, Info } from 'lucide-react'
import { Badge, Meter } from '@/components/ui'
import { READINESS_COLOR_CLASSES } from '@/domain/readiness'
import { formatDistance, formatDuration } from '@/domain/geo'
import { READINESS_LABELS, RESOURCES, type ScoringConfig } from '@/lib/constants'
import type { ResourceScoreDetail, ScoredHospital } from '@/lib/types'
import { cn, formatPercent } from '@/lib/utils'

export interface ScoreBreakdownProps {
  candidate: ScoredHospital
  config: ScoringConfig
  /** Set when the tie-break rule, not the raw score, decided this position. */
  tieBreakNote?: string | null
  className?: string
}

function reportedValue(detail: ResourceScoreDetail): string {
  const definition = RESOURCES[detail.key]
  if (definition.kind === 'boolean') return detail.value === true ? 'Yes' : 'No'
  const numeric = typeof detail.value === 'number' ? detail.value : 0
  if (definition.kind === 'percent') return `${Math.round(numeric)}%`
  const unit = definition.unit ? ` ${definition.unit}` : ''
  return detail.capacity != null && detail.capacity > 0
    ? `${numeric} of ${detail.capacity}${unit}`
    : `${numeric}${unit}`
}

function availabilityTone(availability: number): 'success' | 'warning' | 'danger' {
  if (availability >= 0.7) return 'success'
  if (availability >= 0.3) return 'warning'
  return 'danger'
}

function Term({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 sm:block">
      <dt className="text-xs text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className="text-sm font-medium tabular-nums text-slate-900 dark:text-slate-100">
        {value}
      </dd>
    </div>
  )
}

export function ScoreBreakdown({ candidate, config, tieBreakNote, className }: ScoreBreakdownProps) {
  const readinessColors = READINESS_COLOR_CLASSES[candidate.readiness]
  const resourceTerm = candidate.resourceScore * config.resourceWeight
  const proximityTerm = candidate.proximityScore * config.proximityWeight

  return (
    <div
      className={cn(
        'space-y-4 border-t border-slate-200 bg-slate-50 px-4 py-4 dark:border-slate-800 dark:bg-slate-950/40',
        className,
      )}
    >
      <section className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
            Resource availability
          </h4>
          <span className="text-sm font-semibold tabular-nums text-slate-900 dark:text-slate-100">
            {formatPercent(candidate.resourceScore, 1)}
          </span>
        </div>

        {candidate.breakdown.length === 0 ? (
          <p className="hint">No resource requirements are configured for this emergency type.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[30rem] text-left text-sm">
              <thead>
                <tr className="text-xs text-slate-500 dark:text-slate-400">
                  <th scope="col" className="py-1 pr-3 font-medium">
                    Resource
                  </th>
                  <th scope="col" className="py-1 pr-3 font-medium">
                    Weight
                  </th>
                  <th scope="col" className="py-1 pr-3 font-medium">
                    Reported
                  </th>
                  <th scope="col" className="py-1 font-medium">
                    Availability
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {candidate.breakdown.map((detail) => (
                  <tr key={detail.key} className="align-middle">
                    <th
                      scope="row"
                      className="max-w-[12rem] py-2 pr-3 text-sm font-normal text-slate-800 dark:text-slate-200"
                    >
                      <span className="flex flex-wrap items-center gap-1.5">
                        {detail.label}
                        {detail.isCritical && (
                          <Badge tone={detail.blocking ? 'danger' : 'warning'}>
                            {detail.blocking ? 'Required - missing' : 'Required'}
                          </Badge>
                        )}
                      </span>
                    </th>
                    <td className="py-2 pr-3 tabular-nums text-slate-600 dark:text-slate-400">
                      x{detail.weight}
                    </td>
                    <td className="py-2 pr-3 tabular-nums text-slate-800 dark:text-slate-200">
                      {reportedValue(detail)}
                    </td>
                    <td className="py-2">
                      <div className="flex items-center gap-2">
                        <Meter
                          value={detail.availability * 100}
                          tone={availabilityTone(detail.availability)}
                          className="w-16 sm:w-24"
                          label={`${detail.label} availability`}
                        />
                        <span className="w-10 shrink-0 text-xs tabular-nums text-slate-500 dark:text-slate-400">
                          {formatPercent(detail.availability * 100)}
                        </span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
            Proximity
          </h4>
          <span className="text-sm font-semibold tabular-nums text-slate-900 dark:text-slate-100">
            {formatPercent(candidate.proximityScore, 1)}
          </span>
        </div>
        <dl className="grid grid-cols-1 gap-2 sm:grid-cols-4">
          <Term label="Straight line" value={formatDistance(candidate.distanceKm)} />
          <Term
            label={`By road (x${config.roadDistanceFactor})`}
            value={formatDistance(candidate.roadDistanceKm)}
          />
          <Term label="Estimated transport" value={formatDuration(candidate.etaMinutes)} />
          <Term label="Scores zero beyond" value={formatDuration(config.maxEtaMinutes)} />
        </dl>
      </section>

      <section className="space-y-1">
        <div className="flex items-center justify-between gap-3">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
            Readiness penalty
          </h4>
          <span
            className={cn(
              'text-sm font-semibold tabular-nums',
              candidate.penaltyApplied > 0
                ? 'text-red-600 dark:text-red-400'
                : 'text-slate-900 dark:text-slate-100',
            )}
          >
            {candidate.penaltyApplied > 0 ? '-' : ''}
            {formatPercent(candidate.penaltyApplied, 1)} points
          </span>
        </div>
        <p className="hint">
          <span className={readinessColors.text}>{READINESS_LABELS[candidate.readiness]}</span>
          {' - '}
          {candidate.shiftsSinceUpdate <= 0
            ? 'updated this shift'
            : `last update ${candidate.shiftsSinceUpdate} shift${
                candidate.shiftsSinceUpdate === 1 ? '' : 's'
              } ago`}
          {candidate.readiness === 'yellow' &&
            ` (-${Math.round(config.yellowPenalty * 100)}% of the weighted score)`}
          {candidate.readiness === 'red' &&
            ` (-${Math.round(config.redPenalty * 100)}% of the weighted score)`}
        </p>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
        <p className="flex flex-wrap items-baseline gap-x-1.5 gap-y-1 text-sm tabular-nums text-slate-700 dark:text-slate-300">
          <span>{candidate.resourceScore.toFixed(1)}</span>
          <span className="text-slate-400">x</span>
          <span>{formatPercent(config.resourceWeight * 100)}</span>
          <span className="text-slate-400">+</span>
          <span>{candidate.proximityScore.toFixed(1)}</span>
          <span className="text-slate-400">x</span>
          <span>{formatPercent(config.proximityWeight * 100)}</span>
          <span className="text-slate-400">-</span>
          <span>{candidate.penaltyApplied.toFixed(1)}</span>
          <span className="text-slate-400">=</span>
          <span className="font-semibold text-slate-900 dark:text-slate-100">
            {candidate.score.toFixed(1)}
          </span>
        </p>
        <p className="mt-1 hint">
          {resourceTerm.toFixed(1)} resource points + {proximityTerm.toFixed(1)} proximity points,
          less the readiness penalty.
        </p>
      </section>

      {tieBreakNote && (
        <p className="flex items-start gap-2 text-xs text-slate-600 dark:text-slate-400">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>{tieBreakNote}</span>
        </p>
      )}

      {candidate.exclusions.length > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <div>
            <p className="font-semibold">Cannot receive this case</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              {candidate.exclusions.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  )
}
