/**
 * Administration: branding and staff invitations.
 *
 * Creating an auth user needs the service_role key, which cannot live in a
 * browser-only app without handing every visitor a key that bypasses RLS. So an
 * invitation is a row saying which role a given email should get, and the
 * signup trigger applies it when that person first signs in. Privilege comes
 * from this table -- writable only by administrators -- never from anything the
 * signing-up client sends.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query'
import { queryKeys } from '@/lib/queryKeys'
import { supabase } from '@/lib/supabase'
import { humanizeSupabaseError } from '@/lib/supabase'
import type { AuditAction, UserRole } from '@/lib/constants'
import type { Json, Tables, TablesUpdate } from '@/lib/database.types'

export type AppSettingsRow = Tables<'app_settings'>
export type StaffInvite = Tables<'staff_invites'>

const LOGO_BUCKET = 'branding'
/** Generous for a logo, small enough that a phone upload is not a surprise. */
export const MAX_LOGO_BYTES = 1024 * 1024
export const ACCEPTED_LOGO_TYPES = ['image/png', 'image/svg+xml', 'image/jpeg', 'image/webp']

async function logAudit(
  action: AuditAction,
  entityType: string,
  entityId: string | null,
  details: Json,
): Promise<void> {
  const { error } = await supabase.rpc('log_audit_event', {
    p_action: action,
    p_entity_type: entityType,
    p_entity_id: entityId,
    p_details: details,
  })
  if (error) console.warn(`audit event ${action} was not recorded: ${error.message}`)
}

// ---------------------------------------------------------------------------
// Branding
// ---------------------------------------------------------------------------

export interface UpdateAppSettingsInput {
  brand_color?: string
  logo_url?: string | null
  app_name?: string
  app_tagline?: string
  support_email?: string | null
}

export function useUpdateAppSettings(): UseMutationResult<
  AppSettingsRow,
  Error,
  UpdateAppSettingsInput
> {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (changes: UpdateAppSettingsInput) => {
      const patch: TablesUpdate<'app_settings'> = changes
      const { data, error } = await supabase
        .from('app_settings')
        .update(patch)
        .eq('id', 1)
        .select('*')
        .single()
      if (error) throw new Error(humanizeSupabaseError(error))

      await logAudit('config.update', 'app_settings', '1', changes as Json)
      return data as AppSettingsRow
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.appSettings })
    },
  })
}

export interface UploadLogoResult {
  publicUrl: string
  path: string
}

/**
 * Uploads to the public `branding` bucket and returns the URL to store. The
 * filename carries a timestamp because the bucket is CDN-cached: overwriting a
 * fixed name would keep serving the previous logo.
 */
export function useUploadLogo(): UseMutationResult<UploadLogoResult, Error, File> {
  return useMutation({
    mutationFn: async (file: File) => {
      if (!ACCEPTED_LOGO_TYPES.includes(file.type)) {
        throw new Error('Use a PNG, SVG, JPEG or WebP image.')
      }
      if (file.size > MAX_LOGO_BYTES) {
        throw new Error(
          `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB. Keep the logo under 1 MB.`,
        )
      }

      const extension = file.name.includes('.') ? file.name.split('.').pop() : 'png'
      const path = `logo-${Date.now()}.${extension}`

      const { error } = await supabase.storage
        .from(LOGO_BUCKET)
        .upload(path, file, { contentType: file.type, upsert: false, cacheControl: '31536000' })
      if (error) {
        if (/bucket not found/i.test(error.message)) {
          throw new Error(
            'The "branding" storage bucket does not exist yet. Run migration 0005, or create a public bucket named "branding" in the Supabase dashboard.',
          )
        }
        throw new Error(humanizeSupabaseError(error))
      }

      const { data } = supabase.storage.from(LOGO_BUCKET).getPublicUrl(path)
      return { publicUrl: data.publicUrl, path }
    },
  })
}

// ---------------------------------------------------------------------------
// Invitations
// ---------------------------------------------------------------------------

export function useStaffInvites(hospitalId: string | null): UseQueryResult<StaffInvite[]> {
  return useQuery({
    queryKey: queryKeys.admin.invites(hospitalId),
    queryFn: async () => {
      let query = supabase
        .from('staff_invites')
        .select('*')
        .is('accepted_at', null)
        .order('created_at', { ascending: false })

      if (hospitalId) query = query.eq('hospital_id', hospitalId)

      const { data, error } = await query
      if (error) {
        if (/does not exist|schema cache|relation/i.test(error.message)) return []
        throw new Error(humanizeSupabaseError(error))
      }
      return (data ?? []) as StaffInvite[]
    },
    retry: false,
  })
}

export interface CreateInviteInput {
  email: string
  full_name?: string | null
  role: UserRole
  hospital_id: string | null
  department_id?: string | null
}

export function useCreateInvite(): UseMutationResult<StaffInvite, Error, CreateInviteInput> {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: CreateInviteInput) => {
      const email = input.email.trim().toLowerCase()
      const { data, error } = await supabase
        .from('staff_invites')
        .insert({
          email,
          full_name: input.full_name?.trim() || null,
          role: input.role,
          hospital_id: input.hospital_id,
          department_id: input.department_id ?? null,
        })
        .select('*')
        .single()

      if (error) {
        if (error.code === '23505') {
          throw new Error('That email already has a pending invitation.')
        }
        throw new Error(humanizeSupabaseError(error))
      }

      await logAudit('user.invite', 'staff_invite', data.id, {
        email,
        role: input.role,
        hospital_id: input.hospital_id,
      } as Json)

      return data as StaffInvite
    },
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.admin.invites(variables.hospital_id),
      })
      void queryClient.invalidateQueries({ queryKey: queryKeys.admin.invites(null) })
    },
  })
}

export interface RevokeInviteInput {
  id: string
  hospitalId: string | null
}

export function useRevokeInvite(): UseMutationResult<void, Error, RevokeInviteInput> {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ id }: RevokeInviteInput) => {
      const { error } = await supabase.from('staff_invites').delete().eq('id', id)
      if (error) throw new Error(humanizeSupabaseError(error))
    },
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.admin.invites(variables.hospitalId),
      })
      void queryClient.invalidateQueries({ queryKey: queryKeys.admin.invites(null) })
    },
  })
}
