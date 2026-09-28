/**
 * Files on a referral: X-rays, scans, results.
 *
 * Objects live in the private `referral-attachments` bucket under
 * `<referral_id>/`, so the storage policy can read the referral back out of
 * the path and apply the same visibility rule as the rows. Nothing here is
 * ever public: a file is opened through a short-lived signed URL.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query'
import { queryKeys } from '@/lib/queryKeys'
import { humanizeSupabaseError, supabase } from '@/lib/supabase'
import type { ReferralAttachment, ReferralAttachmentWithUploader } from '@/lib/types'

export const ATTACHMENT_BUCKET = 'referral-attachments'
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024
export const ACCEPTED_ATTACHMENT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
] as const

/** Statuses during which files may still be added or removed. */
export const ATTACHMENT_OPEN_STATUSES = ['pending', 'accepted', 'in_transit'] as const

function fail(error: unknown): never {
  throw new Error(humanizeSupabaseError(error))
}

const ATTACHMENT_SELECT: string = `
  *,
  uploader:profiles!referral_attachments_uploaded_by_fkey ( id, full_name )
`

export function useReferralAttachments(
  referralId: string | null,
): UseQueryResult<ReferralAttachmentWithUploader[]> {
  return useQuery({
    queryKey: queryKeys.referrals.attachments(referralId ?? 'none'),
    enabled: Boolean(referralId),
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('referral_attachments')
        .select(ATTACHMENT_SELECT)
        .eq('referral_id', referralId as string)
        .order('created_at', { ascending: true })
        .returns<ReferralAttachmentWithUploader[]>()
      if (error) fail(error)
      return data ?? []
    },
  })
}

/** Storage object keys are picky; the display name is kept separately on the row. */
function safeFileName(name: string): string {
  const cleaned = name
    .trim()
    .slice(-120)
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return cleaned || 'file'
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export interface UploadAttachmentInput {
  referralId: string
  file: File
  caption?: string
}

export function useUploadAttachment(): UseMutationResult<
  ReferralAttachment,
  Error,
  UploadAttachmentInput
> {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ referralId, file, caption }: UploadAttachmentInput) => {
      if (!(ACCEPTED_ATTACHMENT_TYPES as readonly string[]).includes(file.type)) {
        throw new Error('Use a JPEG, PNG or WebP image, or a PDF.')
      }
      if (file.size === 0) throw new Error('That file is empty.')
      if (file.size > MAX_ATTACHMENT_BYTES) {
        throw new Error(
          `That file is ${formatBytes(file.size)}. Keep each attachment under ${formatBytes(MAX_ATTACHMENT_BYTES)}.`,
        )
      }

      const path = `${referralId}/${Date.now()}-${safeFileName(file.name)}`
      const upload = await supabase.storage
        .from(ATTACHMENT_BUCKET)
        .upload(path, file, { contentType: file.type, upsert: false, cacheControl: '3600' })
      if (upload.error) {
        if (/bucket not found/i.test(upload.error.message)) {
          throw new Error(
            'The "referral-attachments" storage bucket does not exist yet. Run migration 0008, or create a private bucket with that name in the Supabase dashboard.',
          )
        }
        throw new Error(humanizeSupabaseError(upload.error))
      }

      const { data, error } = await supabase
        .from('referral_attachments')
        .insert({
          referral_id: referralId,
          file_name: file.name.trim().slice(0, 200) || 'file',
          content_type: file.type,
          size_bytes: file.size,
          storage_path: path,
          caption: caption?.trim() ? caption.trim().slice(0, 200) : null,
        })
        .select('*')
        .single()
      if (error || !data) {
        // Do not leave an orphan object behind a failed row.
        await supabase.storage.from(ATTACHMENT_BUCKET).remove([path])
        fail(error ?? new Error('The file was stored but could not be recorded.'))
      }
      return data
    },
    onSuccess: (_row, { referralId }) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.referrals.attachments(referralId) })
    },
  })
}

export interface DeleteAttachmentInput {
  referralId: string
  attachment: ReferralAttachment
}

export function useDeleteAttachment(): UseMutationResult<void, Error, DeleteAttachmentInput> {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ attachment }: DeleteAttachmentInput) => {
      const { error } = await supabase.from('referral_attachments').delete().eq('id', attachment.id)
      if (error) fail(error)
      // Best effort: the row is the record; a stranded object costs storage, not correctness.
      await supabase.storage.from(ATTACHMENT_BUCKET).remove([attachment.storage_path])
    },
    onSuccess: (_void, { referralId }) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.referrals.attachments(referralId) })
    },
  })
}

/**
 * Opens a file in a new tab through a five-minute signed URL. The tab is
 * opened before the network round trip so popup blockers treat it as the
 * result of the click.
 */
export async function openAttachment(attachment: ReferralAttachment): Promise<void> {
  const popup = window.open('', '_blank')
  try {
    const { data, error } = await supabase.storage
      .from(ATTACHMENT_BUCKET)
      .createSignedUrl(attachment.storage_path, 300)
    if (error || !data?.signedUrl) {
      throw new Error(humanizeSupabaseError(error ?? new Error('Could not open the file.')))
    }
    if (popup) {
      popup.location.replace(data.signedUrl)
    } else {
      window.location.assign(data.signedUrl)
    }
  } catch (error) {
    popup?.close()
    throw error
  }
}
