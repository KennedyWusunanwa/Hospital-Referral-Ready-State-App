/**
 * The ranked hospital list.
 *
 * The order comes straight from `rankHospitals` and is never re-sorted here --
 * this component only decides how the ranking is presented, including the
 * ineligible hospitals, which stay visible so a coordinator can see why the
 * nearest trauma centre was skipped.
 */

import { useMemo, useState } from 'react'
import { ChevronDown, Hospital as HospitalIcon } from 'lucide-react'
import { EmptyState } from '@/components/ui'
import { CandidateCard } from './CandidateCard'
import type { ScoringConfig } from '@/lib/constants'
import type { ScoredHospital } from '@/lib/types'
import { cn, formatPercent } from '@/lib/utils'

export interface CandidateListProps {
  ranked: ScoredHospital[]
  config: ScoringConfig
  selectedHospitalId: string | null
  onSelect: (candidate: ScoredHospital) => void
  className?: string
}

/**
 * Explain the cases where the historical acceptance rate, not the raw score,
 * settled the order -- the tie-break rule in the project plan.
 */
function tieBreakNotes(ranked: ScoredHospital[], epsilon: number): Record<string, string> {
  const notes: Record<string, string> = {}
  const eligible = ranked.filter((candidate) => candidate.eligible)

  const describe = (rate: number | null) =>
    rate === null ? 'no referral history' : `${formatPercent(rate * 100)} accepted`

  for (let index = 1; index < eligible.length; index += 1) {
    const above = eligible[index - 1]
    const below = eligible[index]
    if (Math.abs(above.score - below.score) > epsilon) continue

    const aboveRate = above.historicalAcceptanceRate
    const belowRate = below.historicalAcceptanceRate
    const decidedByHistory =
      (aboveRate !== null && belowRate !== null && aboveRate !== belowRate) ||
      (aboveRate !== null && belowRate === null)
    if (!decidedByHistory) continue

    const note =
      `Scores were within ${epsilon} points, so the order was settled on historical acceptance: ` +
      `${above.hospital.name} (${describe(aboveRate)}) ahead of ${below.hospital.name} ` +
      `(${describe(belowRate)}).`

    if (!notes[above.hospital.hospital_id]) notes[above.hospital.hospital_id] = note
    if (!notes[below.hospital.hospital_id]) notes[below.hospital.hospital_id] = note
  }

  return notes
}

export function CandidateList({
  ranked,
  config,
  selectedHospitalId,
  onSelect,
  className,
}: CandidateListProps) {
  const eligible = useMemo(() => ranked.filter((candidate) => candidate.eligible), [ranked])
  const ineligible = useMemo(() => ranked.filter((candidate) => !candidate.eligible), [ranked])
  const notes = useMemo(() => tieBreakNotes(ranked, config.tieBreakEpsilon), [ranked, config])

  // When nothing is eligible the exclusions are the whole story, so open them.
  const [showIneligible, setShowIneligible] = useState(eligible.length === 0)

  if (ranked.length === 0) {
    return (
      <EmptyState
        icon={<HospitalIcon className="h-8 w-8" aria-hidden />}
        title="No hospitals found in this radius"
        description="Widen the search radius, or ask an administrator to check that nearby facilities are registered with coordinates."
      />
    )
  }

  const recommendedId = eligible[0]?.hospital.hospital_id ?? null

  return (
    <div className={cn('space-y-4', className)}>
      {eligible.length > 0 ? (
        <>
          <p className="hint">
            {eligible.length} hospital{eligible.length === 1 ? '' : 's'} can receive this case,
            ranked by match score. Tap one to select it.
          </p>
          <ul className="space-y-3">
            {eligible.map((candidate) => (
              <CandidateCard
                key={candidate.hospital.hospital_id}
                candidate={candidate}
                config={config}
                selected={selectedHospitalId === candidate.hospital.hospital_id}
                recommended={candidate.hospital.hospital_id === recommendedId}
                tieBreakNote={notes[candidate.hospital.hospital_id] ?? null}
                onSelect={onSelect}
              />
            ))}
          </ul>
        </>
      ) : (
        <EmptyState
          icon={<HospitalIcon className="h-8 w-8" aria-hidden />}
          title="No hospital in range can take this case"
          description="Every facility found was excluded. Review the reasons below, widen the radius, or relax the additional resource requirements."
        />
      )}

      {ineligible.length > 0 && (
        <div className="card overflow-hidden">
          <button
            type="button"
            onClick={() => setShowIneligible((value) => !value)}
            aria-expanded={showIneligible}
            className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800/50"
          >
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
              Not eligible ({ineligible.length})
            </span>
            <ChevronDown
              className={cn(
                'h-4 w-4 shrink-0 text-slate-400 transition-transform',
                showIneligible && 'rotate-180',
              )}
              aria-hidden
            />
          </button>

          {showIneligible && (
            <ul className="space-y-3 border-t border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/40">
              {ineligible.map((candidate) => (
                <CandidateCard
                  key={candidate.hospital.hospital_id}
                  candidate={candidate}
                  config={config}
                  selected={false}
                  recommended={false}
                  tieBreakNote={null}
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
