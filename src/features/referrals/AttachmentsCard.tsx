/**
 * Imaging and results attached to a referral.
 *
 * Both facilities on the referral can add files while it is live and see every
 * file on it; nobody else can. The card carries the same de-identification
 * rule as the clinical summary: nothing that names or shows the patient.
 */

import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { FileImage, FileText, Paperclip, Trash2, Upload } from 'lucide-react'
import { useAuth } from '@/auth/AuthProvider'
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  ErrorBlock,
  IconButton,
  LoadingBlock,
  Modal,
} from '@/components/ui'
import type { ReferralStatus } from '@/lib/constants'
import type { ReferralAttachment, ReferralAttachmentWithUploader } from '@/lib/types'
import { formatDateTime, relativeTime } from '@/lib/utils'
import {
  ACCEPTED_ATTACHMENT_TYPES,
  ATTACHMENT_OPEN_STATUSES,
  MAX_ATTACHMENT_BYTES,
  formatBytes,
  openAttachment,
  useDeleteAttachment,
  useReferralAttachments,
  useUploadAttachment,
} from './useAttachments'

function kindOf(contentType: string): 'image' | 'document' {
  return contentType.startsWith('image/') ? 'image' : 'document'
}

function AttachmentRow({
  attachment,
  canDelete,
  onDelete,
  timezone,
}: {
  attachment: ReferralAttachmentWithUploader
  canDelete: boolean
  onDelete: () => void
  timezone: string
}) {
  const [opening, setOpening] = useState(false)
  const Icon = kindOf(attachment.content_type) === 'image' ? FileImage : FileText

  const open = async () => {
    setOpening(true)
    try {
      await openAttachment(attachment)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not open the file')
    } finally {
      setOpening(false)
    }
  }

  return (
    <li className="flex items-center gap-3 px-5 py-3">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
        <Icon className="h-5 w-5" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={() => void open()}
          disabled={opening}
          className="block max-w-full truncate text-left text-sm font-medium text-brand-700 underline-offset-2 hover:underline disabled:opacity-60 dark:text-brand-400"
        >
          {attachment.file_name}
        </button>
        <p className="hint truncate" title={formatDateTime(attachment.created_at, timezone)}>
          {formatBytes(attachment.size_bytes)}
          {' · '}
          {attachment.uploader?.full_name ?? 'Unknown staff'}
          {', '}
          {relativeTime(attachment.created_at)}
          {attachment.caption ? ` · ${attachment.caption}` : ''}
        </p>
      </div>
      {canDelete && (
        <IconButton
          label={`Remove ${attachment.file_name}`}
          onClick={onDelete}
          className="h-9 w-9 min-h-0 min-w-0 text-slate-500 hover:text-red-600 dark:hover:text-red-400"
        >
          <Trash2 className="h-4 w-4" aria-hidden />
        </IconButton>
      )}
    </li>
  )
}

export interface AttachmentsCardProps {
  referralId: string
  status: ReferralStatus
  className?: string
}

export function AttachmentsCard({ referralId, status, className }: AttachmentsCardProps) {
  const { can, profile, role, timezone } = useAuth()
  const query = useReferralAttachments(referralId)
  const upload = useUploadAttachment()
  const remove = useDeleteAttachment()
  const fileInput = useRef<HTMLInputElement>(null)
  const [pendingDelete, setPendingDelete] = useState<ReferralAttachment | null>(null)

  const live = (ATTACHMENT_OPEN_STATUSES as readonly string[]).includes(status)
  const canUpload = live && can('messaging:use')
  const rows = query.data ?? []

  const onPick = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    for (const file of Array.from(files)) {
      try {
        await upload.mutateAsync({ referralId, file })
        toast.success(`${file.name} attached`)
      } catch (error) {
        toast.error(error instanceof Error ? error.message : `Could not attach ${file.name}`)
      }
    }
    if (fileInput.current) fileInput.current.value = ''
  }

  const confirmDelete = async () => {
    if (!pendingDelete) return
    try {
      await remove.mutateAsync({ referralId, attachment: pendingDelete })
      toast.success('Attachment removed')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not remove the attachment')
    } finally {
      setPendingDelete(null)
    }
  }

  return (
    <Card className={className}>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <Paperclip className="h-4 w-4 text-slate-400" aria-hidden />
            Attachments
            {rows.length > 0 && <span className="hint font-normal">({rows.length})</span>}
          </span>
        }
        description="X-rays, scans and results for the receiving team."
        action={
          canUpload ? (
            <>
              <input
                ref={fileInput}
                type="file"
                multiple
                accept={ACCEPTED_ATTACHMENT_TYPES.join(',')}
                className="sr-only"
                onChange={(event) => void onPick(event.target.files)}
              />
              <Button
                size="sm"
                variant="outline"
                loading={upload.isPending}
                onClick={() => fileInput.current?.click()}
              >
                <Upload className="h-4 w-4" aria-hidden />
                Add file
              </Button>
            </>
          ) : undefined
        }
      />

      {query.isPending ? (
        <LoadingBlock label="Loading attachments" rows={2} />
      ) : query.isError ? (
        <CardBody>
          <ErrorBlock error={query.error} onRetry={() => void query.refetch()} />
        </CardBody>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<Paperclip className="h-7 w-7" aria-hidden />}
          title="No files attached"
          description={
            canUpload
              ? 'Attach imaging or results so the receiving team can prepare before the patient arrives.'
              : live
                ? 'Nothing has been attached to this referral.'
                : 'This referral is closed. Nothing was attached while it was live.'
          }
          action={
            canUpload ? (
              <Button size="sm" onClick={() => fileInput.current?.click()}>
                <Upload className="h-4 w-4" aria-hidden />
                Add a file
              </Button>
            ) : undefined
          }
        />
      ) : (
        <ul className="divide-y divide-slate-200 dark:divide-slate-800">
          {rows.map((attachment) => (
            <AttachmentRow
              key={attachment.id}
              attachment={attachment}
              timezone={timezone}
              canDelete={live && (role === 'super_admin' || attachment.uploaded_by === profile?.id)}
              onDelete={() => setPendingDelete(attachment)}
            />
          ))}
        </ul>
      )}

      {canUpload && (
        <CardBody className="border-t border-slate-200 pt-4 dark:border-slate-800">
          <Alert tone="warning" title="No patient identifiers">
            Crop or redact the patient&apos;s name, hospital number, date of birth and face before
            uploading. JPEG, PNG, WebP or PDF, up to {formatBytes(MAX_ATTACHMENT_BYTES)} each. Files
            are visible only to the referring and receiving facilities and stay with the referral
            record.
          </Alert>
        </CardBody>
      )}

      <Modal
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        title="Remove this attachment?"
        description={pendingDelete?.file_name}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setPendingDelete(null)}>
              Keep it
            </Button>
            <Button
              variant="danger"
              loading={remove.isPending}
              onClick={() => void confirmDelete()}
            >
              Remove
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600 dark:text-slate-300">
          The other facility will no longer be able to open it. The audit log keeps a record that it
          was attached.
        </p>
      </Modal>
    </Card>
  )
}
