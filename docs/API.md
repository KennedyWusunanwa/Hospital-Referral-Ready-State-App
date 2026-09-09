# FERN — API Reference

FERN has no bespoke backend. The browser talks directly to Supabase over three interfaces:

| Interface | Used for |
| --- | --- |
| **PostgREST** — `supabase.from(...)` | Reads, and the handful of writes that carry no invariants |
| **Postgres functions (RPC)** — `supabase.rpc(...)` | Every write that carries an invariant, and all aggregation |
| **Realtime** — `supabase.channel(...)` | Live chat, notification and referral updates |

Every one of them is constrained by row-level security. The client key is the **anon** key, which is
public by design; what a caller can actually see is decided by their JWT and the policies described
in [SECURITY.md](SECURITY.md).

Two conventions used throughout this document:

- **Errors.** PostgREST returns `{ data, error }` rather than throwing. Every hook checks `error`
  and passes it through `humanizeSupabaseError` before it reaches a user. SQLSTATE codes are given
  per function below.
- **Type arguments.** If the generated `Database` type disagrees with an RPC argument object, cast
  the argument object `as never` rather than weakening the `Database` type.

---

## Part 1 — Remote procedure calls

Eleven functions. All are `SECURITY DEFINER` — they run with the definer's privileges so they can
write tables that no client policy allows, and every one re-checks the caller's capability and
hospital scope as its first act. `search_path` is pinned to `public, pg_temp` on all of them.

### Common errors

These can be raised by any RPC:

| SQLSTATE | Meaning | What the user sees |
| --- | --- | --- |
| `42501` | Insufficient privilege — capability or scope check failed | "You do not have permission to do that." |
| `PGRST301` | JWT expired or invalid | "Your session has expired. Please sign in again." |
| `23514` | A `CHECK` constraint rejected a value | "Some values are outside the allowed range." |
| `23503` | A foreign key points at a row that does not exist | "That action refers to a record that no longer exists." |
| `23505` | Unique violation | "That record already exists." |

---

### `get_referral_candidates`

Returns every hospital within the search radius of the origin, with its full live resource snapshot,
its readiness inputs and its historical performance, plus the great-circle distance. This is the
single query that feeds the ranking engine.

| | |
| --- | --- |
| **Purpose** | Assemble the candidate set for a referral decision |
| **Volatility** | `stable` |
| **May call** | Any authenticated user (in practice, anyone with `referral:create`) |

**Arguments**

| Name | Type | Default | Meaning |
| --- | --- | --- | --- |
| `p_origin_hospital_id` | `uuid` | — | The referring hospital. Excluded from the result |
| `p_emergency_type_id` | `uuid` | — | Reserved for server-side pre-filtering; the client scores against the full requirement list |
| `p_max_km` | `numeric` | `250` | Straight-line search radius |

**Returns** `setof` rows matching `ReferralCandidateRow` in `src/lib/database.types.ts` — identity
and location (`hospital_id`, `name`, `code`, `level`, `city`, `region`, `phone`, `emergency_phone`,
`email`, `latitude`, `longitude`, `timezone`, `distance_km`, `accepts_referrals`), the diversion flag
(`er_open`, `diversion_reason`), all 22 resource columns with their capacity companions, freshness
(`resources_updated_at`, `oldest_department_update_at`, `departments_total`,
`departments_reporting`), blood availability (`blood_units_total`, `blood_stock` as JSON) and
history (`referrals_received`, `referrals_accepted`, `avg_response_seconds`).

**Errors** — `42501` when unauthenticated. An unknown `p_origin_hospital_id` yields an empty set
rather than an error.

```ts
const { data, error } = await supabase.rpc('get_referral_candidates', {
  p_origin_hospital_id: originHospitalId,
  p_emergency_type_id: emergencyTypeId,
  p_max_km: maxKm ?? 250,
})
if (error) throw new Error(humanizeSupabaseError(error))
const candidates = (data ?? []) as ReferralCandidateRow[]
```

**Note on `distance_km`.** It is a great-circle distance. Road distance and ETA are derived in
`src/domain/geo.ts` using the configurable road factor and per-urgency speeds — see
[SPECIFICATION.md](SPECIFICATION.md) section 4.3.

---

### `submit_readiness`

The only way readiness data enters the system. It writes the shift record, refreshes the live
resource snapshot the scorer reads, updates blood stock where the department collects it, and writes
an audit row — all in one transaction, so the three can never disagree.

| | |
| --- | --- |
| **Purpose** | File one department's readiness for the current shift |
| **May call** | `readiness:submit` — `shift_in_charge`, `hospital_admin`, `super_admin` — **for a department at their own hospital only** |

**Arguments**

| Name | Type | Default | Meaning |
| --- | --- | --- | --- |
| `p_department_id` | `uuid` | — | The department reporting |
| `p_payload` | `jsonb` | — | A `ReadinessPayload`: `{ resources: {...}, blood_stock?: {...}, er_open?: boolean, diversion_reason?: string \| null }` |
| `p_blood_stock` | `jsonb` | `null` | Per-group units, e.g. `{"O-": 4, "O+": 12}`. Ignored unless the department's template collects blood stock |
| `p_notes` | `text` | `null` | Free-text handover note |

**Behaviour**

1. Resolves the current shift from the **hospital's own timezone**, giving `(shift_date, shift_type)`.
2. Upserts `readiness_updates` on `(department_id, shift_date, shift_type)` — a second submission in
   the same shift is a correction, never a duplicate.
3. Applies the payload's resource keys to that hospital's `hospital_resources` row, mapping each
   `ResourceKey` to its column via the catalogue. Keys the department does not own are ignored.
4. Applies `er_open` / `diversion_reason` only when the template sets `controlsErStatus`.
5. Upserts `blood_stock` only when the template sets `collectsBloodStock`.
6. Writes a `readiness.submit` audit row.

**Returns** `jsonb` — the stored update: `{ id, department_id, hospital_id, shift_date, shift_type,
submitted_at }`.

**Errors** — `42501` if the caller lacks `readiness:submit` or the department belongs to another
hospital. `23503` if the department does not exist. `23514` if a value breaks a range constraint
(available beyond total, oxygen outside 0–100, a negative count).

```ts
const { data, error } = await supabase.rpc('submit_readiness', {
  p_department_id: departmentId,
  p_payload: payload as unknown as Json,
  p_blood_stock: (payload.blood_stock ?? null) as unknown as Json,
  p_notes: notes?.trim() ? notes.trim() : null,
})
```

---

### `create_referral`

Creates a referral and everything that must accompany it.

| | |
| --- | --- |
| **Purpose** | Raise a referral to a chosen hospital |
| **May call** | `referral:create` — `referral_coordinator`, `hospital_admin`, `super_admin` |

**Arguments**

| Name | Type | Meaning |
| --- | --- | --- |
| `p_receiving_hospital_id` | `uuid` | The selected hospital. Must not be the caller's own |
| `p_emergency_type_id` | `uuid` | From `emergency_types` |
| `p_urgency` | `text` | `critical` \| `urgent` \| `routine` |
| `p_patient_ref` | `text` | Generated non-identifying code, e.g. `PT-7K3QF2`. **Never a name or record number** |
| `p_patient_age_band` | `text` | `neonate` \| `infant` \| `child` \| `adolescent` \| `adult` \| `older_adult` |
| `p_patient_sex` | `text` | `female` \| `male` \| `other` \| `undisclosed` |
| `p_clinical_summary` | `text` | ≤ 1000 characters |
| `p_required_resources` | `text[]` | Resource keys the coordinator marked as must-haves |
| `p_score_snapshot` | `jsonb` | From `buildScoreSnapshot()` — config, requirements and the selected hospital's full breakdown |
| `p_candidate_snapshot` | `jsonb` | From `buildCandidateSnapshot()` — the top ten alternatives with scores and exclusion reasons |
| `p_distance_km` | `numeric` | Straight-line distance at the time of the decision |
| `p_eta_minutes` | `numeric` | Estimated transport time at the time of the decision |

**Behaviour** — inserts the referral as `pending` with `requesting_hospital_id` taken from the
caller's profile (never from an argument); a `BEFORE INSERT` trigger assigns the reference number
`FERN-YYYYMMDD-NNNN` under a row lock so concurrent referrals cannot collide; writes a `created`
`referral_events` row; notifies the receiving hospital's coordinators and administrators with a
`referral_incoming` notification; writes a `referral.create` audit row.

**Returns** `jsonb` — the inserted referral row. The client reads `id` and `reference_number`.

**Errors** — `42501` without `referral:create`. `23514` if the summary exceeds 1000 characters, an
enumerated value is invalid, a required resource is not a known key, or the receiving hospital is the
requesting one (`referrals_not_self`). `23503` for an unknown hospital or emergency type.

```ts
const { data, error } = await supabase.rpc('create_referral', {
  p_receiving_hospital_id: input.receivingHospitalId,
  p_emergency_type_id: input.emergencyTypeId,
  p_urgency: input.urgency,
  p_patient_ref: input.patientRef,
  p_patient_age_band: input.ageBand,
  p_patient_sex: input.sex,
  p_clinical_summary: input.clinicalSummary,
  p_required_resources: input.requiredResources,
  p_score_snapshot: input.scoreSnapshot as unknown as Json,
  p_candidate_snapshot: input.candidateSnapshot as unknown as Json,
  p_distance_km: input.distanceKm,
  p_eta_minutes: input.etaMinutes,
})
const referral = data as { id: string; reference_number: string }
```

---

### `update_referral_status`

The only writer of referral status. It enforces the state machine, so an illegal transition is
impossible rather than merely hidden.

| | |
| --- | --- |
| **Purpose** | Move a referral through its lifecycle |
| **May call** | `referral:respond`, and only a participant hospital. Accepting or declining is the **receiving** hospital's right; cancelling is the requesting hospital's |

**Arguments**

| Name | Type | Default | Meaning |
| --- | --- | --- | --- |
| `p_referral_id` | `uuid` | — | The referral |
| `p_status` | `text` | — | `accepted` \| `declined` \| `in_transit` \| `completed` \| `cancelled` \| `expired` |
| `p_notes` | `text` | `null` | Decline reason, or a note on the timeline entry |
| `p_outcome` | `text` | `null` | Required when completing: `transferred` \| `stabilised_on_site` \| `referred_elsewhere` \| `died_before_transfer` \| `declined_by_patient` \| `other` |

**Permitted transitions** — see [SPECIFICATION.md](SPECIFICATION.md) section 3.2. Anything else is
rejected with SQLSTATE `22023`.

**Behaviour** — validates the transition and the caller's side of it; sets the matching timestamp
(`accepted_at`, `in_transit_at`, `completed_at`, `cancelled_at`); on the first response, sets
`responded_by`, `responded_at` and `response_seconds`; records `decline_reason` or `outcome` /
`outcome_notes`; writes a `referral_events` row with `from_status` and `to_status`; notifies the
counterpart hospital; writes the matching audit action.

**Returns** `jsonb` — the updated referral row.

**Errors** — `42501` if the caller is not a participant or lacks `referral:respond`. `22023` for an
illegal transition or a missing outcome on completion. `23503` for an unknown referral id.

```ts
const { data, error } = await supabase.rpc('update_referral_status', {
  p_referral_id: referralId,
  p_status: status,
  p_notes: notes ?? null,
  p_outcome: outcome ?? null,
})
```

---

### `flag_overdue_readiness`

The scheduled job behind the automatic alerts. Called by `pg_cron` every 30 minutes, not by the
browser.

| | |
| --- | --- |
| **Purpose** | Turn yellow and red departments into notifications for their administrators |
| **May call** | The scheduler (no JWT), the service role, and `super_admin` for a manual run |

**Arguments** — none.

**Behaviour** — for every active department where `requires_shift_update` is true, computes shifts
elapsed against the hospital's own timezone; for yellow inserts a `warning` `readiness_overdue`
notification and for red a `critical` one, addressed to every active `hospital_admin` at that
hospital and to `super_admin`s; de-duplicates against recent notifications so a persistently red
department does not alert every half hour.

**Returns** `integer` — the number of notifications created.

```sql
select public.flag_overdue_readiness();
```

```ts
// manual run from an admin screen
const { data } = await supabase.rpc('flag_overdue_readiness')
toast.success(`${data ?? 0} alerts raised`)
```

---

### `hospital_performance`

| | |
| --- | --- |
| **Purpose** | Per-hospital referral throughput, responsiveness and readiness compliance |
| **May call** | `reports:view` (scoped to own hospital) and `reports:view_all` (any) |

**Arguments**

| Name | Type | Default | Meaning |
| --- | --- | --- | --- |
| `p_hospital_id` | `uuid` | `null` | `null` = every hospital the caller may see |
| `p_from` | `timestamptz` | `null` | Window start; `null` = unbounded |
| `p_to` | `timestamptz` | `null` | Window end; `null` = now |

**Returns** `setof HospitalPerformanceRow` — `hospital_id`, `hospital_name`, `referrals_sent`,
`referrals_received`, `referrals_accepted`, `referrals_declined`, `referrals_completed`,
`acceptance_rate`, `avg_response_seconds`, `avg_completion_minutes`, `compliance_rate`.

```ts
const { data, error } = await supabase.rpc('hospital_performance', {
  p_hospital_id: filters.hospitalId ?? null,
  p_from: filters.from ?? null,
  p_to: filters.to ?? null,
})
```

---

### `referral_analytics`

| | |
| --- | --- |
| **Purpose** | The whole analytics dashboard in one round trip |
| **May call** | `reports:view` (own hospital) / `reports:view_all` (any) |

**Arguments** — `p_hospital_id uuid default null`, `p_from timestamptz default null`,
`p_to timestamptz default null`.

**Returns** a single `jsonb` object matching the `ReferralAnalytics` type: `total`, `by_status`,
`by_urgency`, `by_emergency_type[]`, `acceptance_rate`, `avg_response_seconds`,
`median_response_seconds`, `avg_completion_minutes`, `daily[]`, `top_receiving[]`, `top_referring[]`.

Aggregating in Postgres is deliberate: the browser never downloads a year of referrals to count
them, which is what keeps the report inside its 3-second target.

```ts
const { data, error } = await supabase.rpc('referral_analytics', {
  p_hospital_id: filters.hospitalId ?? null,
  p_from: filters.from ?? null,
  p_to: filters.to ?? null,
})
if (error) throw new Error(humanizeSupabaseError(error))
const analytics = data as unknown as ReferralAnalytics
```

---

### `compliance_report`

| | |
| --- | --- |
| **Purpose** | Per-department readiness compliance over a rolling window |
| **May call** | `reports:view` (own hospital) / `reports:view_all` (any) |

**Arguments** — `p_hospital_id uuid default null`, `p_days integer default 7`.

**Returns** `setof ComplianceRow` — `hospital_id`, `hospital_name`, `department_id`,
`department_name`, `expected_updates` (`p_days × 3`), `actual_updates`, `compliance_rate`,
`missed_shifts`, `last_submitted_at`.

```ts
const { data, error } = await supabase.rpc('compliance_report', {
  p_hospital_id: filters.hospitalId ?? null,
  p_days: filters.days ?? 7,
})
```

---

### `current_user_role` / `current_user_hospital`

| | |
| --- | --- |
| **Purpose** | The authorisation primitives every RLS policy is built on |
| **May call** | Any authenticated user, about themselves only |

**Arguments** — none. Identity comes from `auth.uid()`; there is no argument to spoof.

**Returns** `text` (the role) and `uuid` (the hospital). Both return `null` for an unauthenticated
**or deactivated** account — which is what makes deactivation take effect instantly, because every
scoped policy then fails closed.

The client rarely calls these directly; it reads the profile once through `AuthProvider`. They are
listed because they are the load-bearing pieces of the security model. Sibling helpers used only
inside policies: `is_super_admin()`, `is_admin()`, `has_capability(text)`,
`is_referral_participant(uuid)`.

```ts
const { data: role } = await supabase.rpc('current_user_role')
```

---

### `record_login`

| | |
| --- | --- |
| **Purpose** | Stamp `profiles.last_login_at` and write an `auth.login` audit row |
| **May call** | Any authenticated user, for themselves |

**Arguments** — none. **Returns** — `void`.

Called by `AuthProvider` immediately after a successful password sign-in, and deliberately
**best-effort**: the promise is swallowed on failure, because a failed audit write must never stop a
clinician signing in at 3am.

```ts
await supabase.rpc('record_login').then(undefined, () => undefined)
```

---

### `log_audit_event`

| | |
| --- | --- |
| **Purpose** | Append a row to the audit trail |
| **May call** | Any authenticated user. The actor is taken from `auth.uid()`, never from an argument, so a caller can only ever log as themselves |

**Arguments**

| Name | Type | Default | Meaning |
| --- | --- | --- | --- |
| `p_action` | `text` | — | From `AUDIT_ACTIONS` in `constants.ts` |
| `p_entity_type` | `text` | `null` | `referral`, `department`, `hospital`, `report`, … |
| `p_entity_id` | `uuid` | `null` | The affected row |
| `p_details` | `jsonb` | `{}` | Context. **Never** a password, token or clinical summary |

**Returns** — `void`.

The RPCs above write their own audit rows; this function exists for client-side actions that have no
RPC of their own — chiefly `report.export`.

```ts
await supabase.rpc('log_audit_event', {
  p_action: 'report.export',
  p_entity_type: 'report',
  p_entity_id: null,
  p_details: { report: 'compliance', rows: rows.length } as unknown as Json,
})
```

---

### `mark_notifications_read`

| | |
| --- | --- |
| **Purpose** | Mark some or all of the caller's notifications as read |
| **May call** | Any authenticated user, for their own notifications only |

**Arguments** — `p_ids uuid[] default null`. Passing `null` marks **all** of the caller's unread
notifications read; passing an array marks only those, and ids belonging to another user are ignored
rather than raising.

**Returns** `integer` — the number of rows updated.

```ts
const { data, error } = await supabase.rpc('mark_notifications_read', {
  p_ids: ids && ids.length > 0 ? ids : null,
})
```

---

## Part 2 — PostgREST table endpoints

Only the endpoints the client actually uses are listed. Anything absent here is absent from the
client too.

Read the "RLS visibility" column as the complete answer to "what comes back" — it is enforced by the
database, not by the query.

### Read endpoints

| Table / view | Client usage | RLS visibility |
| --- | --- | --- |
| `hospitals` | `useHospitals`, `useHospital`, `AuthProvider` | **Every authenticated user reads every hospital.** Ranking a referral is inherently a cross-hospital query, and readiness is the network-wide signal the product exists to publish |
| `departments` | `useDepartments`, admin screens | All authenticated users |
| `department_readiness` (view) | `useDepartmentReadiness`, `useHospitalReadiness` | All authenticated users. The view is `security_invoker`, so it is filtered by the caller's own policies — a hospital cannot read a colleague's name out of another facility through it |
| `hospital_resources` | `useHospitalResources`, hospital detail | All authenticated users |
| `blood_stock` | `useBloodStock` | All authenticated users |
| `readiness_updates` | `useReadinessHistory`, `useCurrentShiftUpdate` | All authenticated users |
| `emergency_types` | `useEmergencyTypes` | All authenticated users |
| `emergency_requirements` | `useEmergencyRequirements` | All authenticated users |
| `scoring_config` | `useScoringConfig` | All authenticated users (read-only) |
| `referrals` | `useReferrals`, `useReferral`, `usePendingReferralCount` | **Only where the caller's hospital is the requesting or receiving party**, plus `super_admin` |
| `referral_events` | `useReferralEvents` | Participants only, via `is_referral_participant()` |
| `messages` | `useMessages` | Participants only |
| `message_receipts` | Read-receipt tracking | `user_id = auth.uid()` only |
| `notifications` | `useNotifications`, `useUnreadNotificationCount` | `user_id = auth.uid()` only |
| `profiles` | `AuthProvider`, `useStaff` | Yourself, colleagues at your own hospital, and `super_admin` |
| `audit_logs` | `useAuditLogs` | `super_admin` network-wide; `hospital_admin` for their own hospital's rows |

Two tables the client **cannot** write through PostgREST at all — `referrals` and `referral_events`
have no INSERT or UPDATE policy and no grant beyond `SELECT`, because a referral is never just a row
(see [SECURITY.md](SECURITY.md) section 2.2). `referral_reference_counters` has every privilege
revoked from both client roles and no policies at all.

### Write endpoints

| Table | Verb | Who |
| --- | --- | --- |
| `hospitals` | insert / delete | `super_admin` |
| `hospitals` | update | `super_admin`, or `hospital_admin` on their own hospital |
| `departments` | all | `super_admin`, or `admin:hospital` on their own hospital |
| `hospital_resources`, `blood_stock` | all | `super_admin`, or `admin:hospital` on their own hospital. Routine updates go through `submit_readiness()` instead, so the shift record and the snapshot stay in step |
| `readiness_updates` | insert | `readiness:submit`, own hospital, own department. No UPDATE or DELETE policy exists: a new shift is a new row, and a correction goes through the RPC's upsert |
| `emergency_types`, `emergency_requirements` | all | `super_admin` |
| `scoring_config` | update | `super_admin` |
| `profiles` | update | Yourself, `super_admin`, or `hospital_admin` within their hospital — and the `guard_profile_privileges` trigger still rejects any self-promotion. No INSERT policy (the `auth.users` trigger creates profiles) and no DELETE policy (deactivate, never delete) |
| `messages` | insert | `messaging:use`, a participant hospital, `sender_id = auth.uid()`, and **only while the referral is pending, accepted or in transit** |
| `message_receipts` | insert / update | Own rows only |
| `notifications` | update | Own rows only (marking read) |

### Query patterns worth copying

**Referrals with their relations.** Named foreign-key joins, not `select('*')` across relations:

```ts
const REFERRAL_SELECT = `
  *,
  requesting_hospital:hospitals!referrals_requesting_hospital_id_fkey (
    id, name, code, phone, emergency_phone, city, region
  ),
  receiving_hospital:hospitals!referrals_receiving_hospital_id_fkey (
    id, name, code, phone, emergency_phone, city, region
  ),
  emergency_type:emergency_types!referrals_emergency_type_id_fkey (id, name, code, category),
  requested_by_profile:profiles!referrals_requested_by_fkey (id, full_name, phone),
  responded_by_profile:profiles!referrals_responded_by_fkey (id, full_name, phone)
`

// direction: 'all'
const { data } = await supabase
  .from('referrals')
  .select(REFERRAL_SELECT)
  .or(`requesting_hospital_id.eq.${hospitalId},receiving_hospital_id.eq.${hospitalId}`)
  .order('requested_at', { ascending: false })
```

The explicit constraint names matter: `referrals` has two foreign keys to `hospitals`, and PostgREST
cannot guess which one an alias means.

**Counting without fetching.** The two badges mounted on every screen use `head: true`, so the
response carries a count header and **zero rows**:

```ts
const { count } = await supabase
  .from('notifications')
  .select('id', { count: 'exact', head: true })
  .eq('user_id', userId)
  .eq('is_read', false)
```

---

## Part 3 — Realtime channels

Three subscriptions, all `postgres_changes` over `wss://`. Each is server-side filtered so a client
is never sent a row it could not have read anyway; RLS applies to realtime exactly as it does to a
query. The client is configured for a maximum of 5 events per second.

Every subscription follows the same shape: **receive a change, invalidate the relevant TanStack
Query key, let the refetch bring authoritative data**. Payloads are never merged into the cache
directly — a payload is a signal that something changed, not a trusted copy of it.

| Channel | Table | Filter | Effect |
| --- | --- | --- | --- |
| `referral-messages-<referralId>` | `messages` | `referral_id=eq.<id>`, INSERT only | Invalidates `queryKeys.messages.byReferral(referralId)` — the chat thread refreshes |
| `notifications:<userId>` | `notifications` | `user_id=eq.<id>` | Invalidates the notification list and the unread count |
| `referrals:<hospitalId>` | `referrals` | two listeners — `receiving_hospital_id=eq.<id>` and `requesting_hospital_id=eq.<id>` | Invalidates `queryKeys.referrals.all` and the notification keys, so the inbox, the detail view and the sidebar badge all move together |

```ts
useEffect(() => {
  if (!referralId) return

  const channel = supabase
    .channel(`referral-messages-${referralId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'messages', filter: `referral_id=eq.${referralId}` },
      () => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.messages.byReferral(referralId) })
      },
    )
    .subscribe()

  return () => {
    void supabase.removeChannel(channel)
  }
}, [referralId, queryClient])
```

**Always remove the channel on unmount.** A leaked subscription survives navigation and quietly
consumes the project's concurrent-connection budget.

Realtime is enabled by adding `messages`, `notifications` and `referrals` to the
`supabase_realtime` publication at the end of `0001_schema.sql`. If live updates stop working after
a database restore, that publication is the first thing to check — see
[DEPLOYMENT.md](DEPLOYMENT.md) section 14.

---

## Part 4 — Client hook contract

The hooks that wrap all of the above. Each feature owns one module; components call hooks, never
`supabase` directly (the single exception being one-line `log_audit_event` calls).

| Module | Hooks |
| --- | --- |
| `features/readiness/useReadiness.ts` | `useDepartments`, `useDepartmentReadiness`, `useHospitalReadiness`, `useHospitalResources`, `useBloodStock`, `useReadinessHistory`, `useCurrentShiftUpdate`, `useSubmitReadiness` |
| `features/referrals/useReferrals.ts` | `useEmergencyTypes`, `useEmergencyRequirements`, `useScoringConfig`, `useReferralCandidates`, `useReferrals`, `useReferral`, `useReferralEvents`, `usePendingReferralCount`, `useCreateReferral`, `useUpdateReferralStatus` |
| `features/notifications/useNotifications.ts` | `useNotifications`, `useUnreadNotificationCount`, `useMarkNotificationsRead` |
| `features/messaging/useMessages.ts` | `useMessages`, `useSendMessage`, `useMessageRealtime` |
| `features/hospitals/useHospitals.ts` | `useHospitals`, `useHospital` |
| `features/reports/useReports.ts` | `useReferralAnalytics`, `useHospitalPerformance`, `useComplianceReport` |
| `features/admin/useAdmin.ts` | `useStaff`, `useUpdateStaff`, `useAuditLogs`, `useUpsertHospital`, `useUpsertDepartment`, `useUpdateScoringConfig`, `useDeleteDepartment` |

Cache keys come from the central registry in `src/lib/queryKeys.ts`; invalidation is written against
a namespace (`queryKeys.referrals.all`) rather than a guessed array literal, which is what lets a
readiness submission refresh the department light, the hospital roll-up and the resource snapshot in
one pass.
