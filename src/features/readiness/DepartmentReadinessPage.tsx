/**
 * The readiness page for a department-level account: their department's light,
 * the way to fix it, and the recent record. No hospital roll-up -- that is a
 * hospital-level view, and this account cannot read the other rows anyway.
 */

import { type ReactNode } from 'react'
import { ShieldAlert } from 'lucide-react'
import { useAuth, useCurrentHospitalId } from '@/auth/AuthProvider'
import { Alert, Card, CardBody, PageHeader } from '@/components/ui'
import { SUPPORT_EMAIL } from '@/lib/constants'
import { ReadinessDuty } from '@/features/dashboard/ReadinessDuty'
import { RecentSubmissions } from './RecentSubmissions'
import { useDepartmentReadiness, useNowTick } from './useReadiness'
import { minutesLeftInShift } from '@/domain/shifts'

export function DepartmentReadinessPage({ shiftChip }: { shiftChip: ReactNode }) {
  const { hospital, timezone, scope } = useAuth()
  const hospitalId = useCurrentHospitalId()
  const now = useNowTick()
  const remaining = minutesLeftInShift(now, timezone)
  const readiness = useDepartmentReadiness(scope.departmentIds.length > 0 ? hospitalId : null)
  const mine = (readiness.data ?? []).filter((row) =>
    scope.departmentIds.includes(row.department_id),
  )
  const names = mine.map((row) => row.department_name).join(', ')

  return (
    <div className="space-y-5">
      <PageHeader
        title={names ? `${names} readiness` : 'Your readiness'}
        description={
          hospital
            ? `${hospital.name} - shift times shown in ${timezone}`
            : 'Readiness reporting for your department'
        }
        actions={shiftChip}
      />

      {scope.departmentIds.length === 0 ? (
        <Alert tone="warning" title="Your account has no department yet">
          <p>
            Ask your hospital administrator to assign your department, or contact {SUPPORT_EMAIL}.
            Until then there is no readiness form to file.
          </p>
        </Alert>
      ) : (
        <>
          <ReadinessDuty
            hospitalId={hospitalId}
            departmentIds={scope.departmentIds}
            minutesLeft={remaining}
            now={now}
          />

          {scope.departmentIds.map((departmentId) => (
            <RecentSubmissions
              key={departmentId}
              departmentId={departmentId}
              days={14}
              title={
                scope.departmentIds.length > 1
                  ? `Recent submissions - ${
                      mine.find((row) => row.department_id === departmentId)?.department_name ??
                      'department'
                    }`
                  : 'Recent submissions'
              }
              description="The last fourteen days."
            />
          ))}

          <Card>
            <CardBody className="flex items-start gap-3">
              <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-slate-400" aria-hidden />
              <p className="hint">
                This page shows your own department only. The hospital-wide board, compliance
                figures and other departments are visible to hospital-level accounts.
              </p>
            </CardBody>
          </Card>
        </>
      )}
    </div>
  )
}
