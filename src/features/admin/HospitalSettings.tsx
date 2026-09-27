import { useState } from 'react'
import { toast } from 'sonner'
import { Building2 } from 'lucide-react'
import { useAuth } from '@/auth/AuthProvider'
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  Modal,
  Toggle,
} from '@/components/ui'
import { humanizeSupabaseError } from '@/lib/supabase'
import { HospitalForm, type HospitalFormValues } from './HospitalForm'
import { useUpsertHospital } from './useAdmin'

export default function HospitalSettings() {
  const { hospital, refreshProfile } = useAuth()
  const upsertHospital = useUpsertHospital()
  const [confirmDiversion, setConfirmDiversion] = useState(false)

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

  const onSubmit = async (values: HospitalFormValues) => {
    try {
      await upsertHospital.mutateAsync({
        id: hospital.id,
        name: values.name,
        code: values.code,
        level: values.level,
        address: values.address || null,
        city: values.city || null,
        region: values.region || null,
        country: values.country,
        phone: values.phone || null,
        emergency_phone: values.emergency_phone || null,
        email: values.email || null,
        timezone: values.timezone,
        latitude: values.latitude,
        longitude: values.longitude,
        notes: values.notes || null,
        logo_url: values.logo_url,
      })
      await refreshProfile()
      toast.success('Hospital details saved')
    } catch (error) {
      toast.error(humanizeSupabaseError(error))
    }
  }

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

  return (
    <div className="space-y-5">
      <HospitalForm hospital={hospital} onSubmit={onSubmit} submitting={upsertHospital.isPending} />

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
              No referring hospital can see or select this facility while this is switched off. Turn
              it back on as soon as the facility can receive patients again.
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
