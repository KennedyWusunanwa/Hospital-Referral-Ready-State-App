/**
 * One ranked hospital. Selection is always an explicit act -- the top-ranked
 * card is marked "Recommended" but never selects itself, because the person
 * holding the phone is the one accountable for where the patient goes.
 */

import { useId, useState } from 'react'
import { Check, ChevronDown, MapPin, Timer } from 'lucide-react'
import { Badge, BoolMark, Button, Meter, StatusDot } from '@/components/ui'
import { ScoreBreakdown } from './ScoreBreakdown'
import { formatDistance, formatDuration } from '@/domain/geo'
import { scoreBand } from '@/domain/scoring'
import { HOSPITAL_LEVEL_LABELS, type HospitalLevel, type ScoringConfig } from '@/lib/constants'
import type { ScoredHospital } from '@/lib/types'
import { cn, formatPercent } from '@/lib/utils'

export interface CandidateCardProps {
  candidate: ScoredHospital
  config: ScoringConfig
  selected: boolean
  /** Rank 1 among the eligible hospitals. */
  recommended: boolean
  tieBreakNote?: string | null
  onSelect?: (candidate: ScoredHospital) => void
}

const METER_TONES = { strong: 'success', moderate: 'warning', weak: 'danger' } as const

const SCORE_TEXT = {
  strong: 'text-emerald-600 dark:text-emerald-400',
  moderate: 'text-amber-600 dark:text-amber-400',
  weak: 'text-red-600 dark:text-red-400',
} as const

function readinessLabel(shiftsSinceUpdate: number): string {
  if (shiftsSinceUpdate < 0) return 'Never updated'
  if (shiftsSinceUpdate === 0) return 'Updated this shift'
  return `Updated ${shiftsSinceUpdate} shift${shiftsSinceUpdate === 1 ? '' : 's'} ago`
}

export function CandidateCard({
  candidate,
  config,
  selected,
  recommended,
  tieBreakNote,
  onSelect,
}: CandidateCardProps) {
  const [open, setOpen] = useState(false)
  const panelId = useId()
  const hospital = candidate.hospital
  const selectable = candidate.eligible && Boolean(onSelect)
  const band = scoreBand(candidate.score)

  const summary = (
    <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:gap-4">
      <span
        className={cn(
          'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
          selected
            ? 'bg-brand-600 text-white'
            : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
        )}
        aria-hidden
      >
        {candidate.rank}
      </span>

      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <h3 className="text-base font-semibold text-slate-900 dark:text-slate-50">
            {hospital.name}
          </h3>
          {recommended && <Badge tone="brand">Recommended</Badge>}
          {selected && (
            <Badge tone="success">
              <Check className="h-3 w-3" aria-hidden /> Selected
            </Badge>
          )}
        </div>

        <p className="text-xs text-slate-500 dark:text-slate-400">
          {HOSPITAL_LEVEL_LABELS[hospital.level as HospitalLevel] ?? hospital.level}
          {hospital.city ? ` - ${hospital.city}` : ''}
          {hospital.region ? `, ${hospital.region}` : ''}
        </p>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-slate-600 dark:text-slate-400">
          <StatusDot
            status={candidate.readiness}
            label={readinessLabel(candidate.shiftsSinceUpdate)}
            pulse={candidate.readiness !== 'green'}
          />
          <span className="inline-flex items-center gap-1">
            <MapPin className="h-3.5 w-3.5" aria-hidden />
            {formatDistance(candidate.roadDistanceKm)} by road
          </span>
          <span className="inline-flex items-center gap-1">
            <Timer className="h-3.5 w-3.5" aria-hidden />
            {formatDuration(candidate.etaMinutes)}
          </span>
        </div>

        <div className="flex flex-wrap gap-x-3 gap-y-1.5">
          <BoolMark
            value={hospital.operating_rooms_functional > 0}
            label={`Theatre ${hospital.operating_rooms_functional}`}
          />
          <BoolMark value={hospital.resident_surgeon_available} label="Surgeon" />
          <BoolMark
            value={hospital.icu_beds_available > 0}
            label={`ICU ${hospital.icu_beds_available}`}
          />
          <BoolMark
            value={hospital.ventilators_available > 0}
            label={`Ventilators ${hospital.ventilators_available}`}
          />
          <BoolMark
            value={hospital.oxygen_supply_percent >= 20}
            label={`Oxygen ${Math.round(hospital.oxygen_supply_percent)}%`}
          />
          <BoolMark
            value={hospital.blood_bank_functional}
            label={`Blood ${hospital.blood_units_total} u`}
          />
          <BoolMark value={hospital.ct_functional} label="CT" />
        </div>

        {!candidate.eligible && candidate.exclusions.length > 0 && (
          <p className="text-xs font-medium text-red-700 dark:text-red-300">
            Not eligible: {candidate.exclusions.join('; ')}
          </p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-3 sm:w-28 sm:flex-col sm:items-end sm:gap-1">
        <p
          className={cn(
            'text-3xl font-semibold tabular-nums',
            candidate.eligible ? SCORE_TEXT[band] : 'text-slate-400 dark:text-slate-500',
          )}
        >
          {formatPercent(candidate.score)}
        </p>
        <div className="flex-1 sm:w-full">
          <Meter
            value={candidate.score}
            tone={candidate.eligible ? METER_TONES[band] : 'danger'}
            label={`Referral match score for ${hospital.name}`}
          />
          <p className="mt-1 hidden text-right text-[11px] text-slate-500 sm:block dark:text-slate-400">
            match score
          </p>
        </div>
      </div>
    </div>
  )

  return (
    <li
      className={cn(
        'card overflow-hidden transition-colors',
        selected && 'border-brand-500 ring-1 ring-brand-500 dark:border-brand-500',
        !candidate.eligible && 'opacity-90',
      )}
    >
      {selectable ? (
        <button
          type="button"
          aria-pressed={selected}
          onClick={() => onSelect?.(candidate)}
          className="block w-full text-left hover:bg-slate-50 dark:hover:bg-slate-800/50"
        >
          {summary}
        </button>
      ) : (
        summary
      )}

      <div className="flex items-center justify-between gap-2 border-t border-slate-200 px-4 py-2 dark:border-slate-800">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-controls={panelId}
          className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline dark:text-brand-400"
        >
          <ChevronDown
            className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')}
            aria-hidden
          />
          {open ? 'Hide score detail' : 'Explain this score'}
        </button>

        {selectable && (
          <Button
            type="button"
            size="sm"
            variant={selected ? 'success' : 'outline'}
            onClick={() => onSelect?.(candidate)}
          >
            {selected ? 'Selected' : 'Select'}
          </Button>
        )}
      </div>

      <div id={panelId} hidden={!open}>
        {open && (
          <ScoreBreakdown candidate={candidate} config={config} tieBreakNote={tieBreakNote} />
        )}
      </div>
    </li>
  )
}
