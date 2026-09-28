# Department scoping and referral initiation policy

Design note and change report for `0008_department_scope.sql` and the matching front-end work.
Read it with [SPECIFICATION.md](SPECIFICATION.md) section 2, [SECURITY.md](SECURITY.md) section 2
and [DATA_MODEL.md](DATA_MODEL.md).

## A. Summary

FERN's authorisation used to ask two questions: *does this role have the capability?* and *is this
the caller's hospital?* A Shift In-Charge in Cardiology therefore saw, and could submit, every
department in the building, received alerts about all of them, and could open any referral the
hospital was party to. This change adds the third question, *is this the caller's department?*, and
asks it in one place on each side of the wire:

- **Database**: a small set of `SECURITY DEFINER` helpers (`accessible_department_ids()`,
  `can_view_department()`, `can_manage_department()`, `can_view_referral()`,
  `can_create_referral()`) used by every affected policy and RPC.
- **Front end**: `src/lib/scope.ts` (`buildScope`, `canAccessDepartment`, `canSubmitReadinessFor`,
  `canCreateReferral`) used by every route guard, button, query consumer and palette entry.

Alongside it, each hospital now decides **who may initiate referrals** (`hospitals.referral_policy`),
a sixth role, **Department Coordinator**, exists for units that should be able to refer, and every
referral records the department it was raised from.

The same release fixes the tester's findings: readiness submission failed on every call with
*malformed array literal*; table column labels repeated on desktop; the console's hospital filters
were squeezed into one column; *Cancel referral* was not red; the awaiting-response notice had no
call button; incoming referrals did not announce themselves persistently or audibly; and there was
no way to attach X-rays or results.

## B. Authorisation model

| Level | Roles | Sees | Files readiness for | Raises referrals |
| --- | --- | --- | --- | --- |
| System | `super_admin` | Everything | Any department | Always |
| Hospital | `hospital_admin`, `referral_coordinator`, `viewer` | Every department of every hospital; the hospital's referrals and staff | Any department of own hospital (`hospital_admin` only) | `hospital_admin`, `referral_coordinator`, when the policy is `hospital_only` or `hospital_and_department` |
| Department | `shift_in_charge`, `department_coordinator` | Own department's readiness; referrals raised from it or by themselves; same-department colleagues plus the hospital's administrators and coordinators | Own department only | `department_coordinator`, when the policy is `department_only` or `hospital_and_department` |

Rules that hold regardless of table:

1. A role without a capability never gains it from scope or policy.
2. A department-level account with no department has an **empty** scope and every scoped check fails
   closed. The profile guard makes that state unreachable through the application.
3. A department must belong to the account's hospital. The guard refuses anything else.
4. Department membership is modelled as a list (`UserScope.departmentIds`,
   `accessible_department_ids()`), so one person covering two units later needs a
   `profile_departments` table and a one-line change in each helper, not a redesign.

## C. Database changes (`supabase/migrations/0008_department_scope.sql`)

Idempotent; safe to re-run. In order:

1. **Role** `department_coordinator` added to the `profiles` and `staff_invites` checks,
   `has_capability()`, and the signup trigger's whitelist. Capabilities: `readiness:submit`,
   `readiness:view`, `referral:create`, `referral:view`, `messaging:use`.
2. **Helpers**: `current_user_level()`, `accessible_department_ids()` (NULL = unrestricted, `{}` =
   nothing), `can_view_department(uuid)`, `can_manage_department(uuid)`,
   `referral_policy_allows(text, uuid)`, `can_create_referral()`, `can_view_referral(uuid)`.
   `is_referral_participant(uuid)` now delegates to `can_view_referral`, so the older policies that
   name it inherit the new rule.
3. **`hospitals.referral_policy`** text, default `hospital_only`, check-constrained.
4. **`referrals.origin_department_id`** → `departments`, indexed, set by `create_referral()` from the
   requester's profile.
5. **RLS** re-created: `departments_select`, `readiness_updates_select` (department scope, which also
   scopes the `department_readiness` view), `referrals_select`, `referral_events_select`,
   `messages_select`, `messages_insert`, `profiles_select`, `staff_invites_insert` and
   `staff_invites_update` (a department-level invitation must name a department).
6. **Profile guard**: `guard_profile_privileges()` treats `department_id` as privileged for
   department-level roles, requires it, and requires it to be in the account's hospital; a new
   `BEFORE INSERT` guard drops an inconsistent department at signup rather than refusing the profile.
7. **`submit_readiness()`**: adds `can_manage_department()`, and fixes the typed-literal bug
   (`v_sets || 'updated_at = now()'::text`) that made every submission fail.
8. **`create_referral()`**: adds `can_create_referral()`, stores `origin_department_id`, logs it.
9. **`get_referral_candidates()`**: adds `can_create_referral()`.
10. **`notify_on_message()`**: recipients are the other side's referral desk and, on the requesting
    side, the requester and the origin department; no longer every shift in-charge in the hospital.
11. **`flag_overdue_readiness()`**: also alerts the overdue department's own accounts; still the
    hospital's administrators; never other departments.
12. **`referral_attachments`** table, owner-stamping and audit triggers (`referral.attach`), policies,
    and the private `referral-attachments` bucket (JPEG, PNG, WebP, PDF; 20 MB) with object policies
    that read the referral id out of the path.

Rollback: the migration only adds objects and re-creates functions and policies. To revert the
behaviour without a restore, re-run `0002_rls.sql` and `0003_functions.sql` (they are idempotent) and
drop the two policies on `storage.objects`; the new columns and table can stay. Note that this also
reverts the `submit_readiness` fix, so re-apply that one line.

## D. Front-end changes

- `src/lib/scope.ts`: the scope model and every predicate. `AuthProvider` exposes `scope`
  (`useScope()`), built from role, hospital, department and the hospital's `referral_policy`.
- `src/auth/RequireAuth.tsx`: `RequireScope`, `RequireDepartmentAccess` (route
  `readiness/:departmentId`), `RequireReferralCreate` (route `referrals/new`), `ScopeGate`,
  `NotAllowedCard`. The update page re-checks with the department's hospital once the row loads.
- Department-focused screens: `DepartmentDashboard` (scoped *Needs attention*, own duty card,
  department tiles, recent submissions, referrals from the department) and
  `DepartmentReadinessPage` (replaces the board at `/readiness` for department-level accounts).
  `ReadinessDuty` takes a list of departments. `NeedsAttention` accepts a department filter.
- Every entry to the referral wizard (dashboard, referral list, empty state, hospital page, declined
  banner, command palette) uses `canCreateReferral(scope)`; the wizard route refuses with the policy
  explanation.
- Other hospitals' department boards are shown to hospital-level accounts; department-level accounts
  see a note on the hospital page instead.
- Administration: `HospitalForm` gains a **Referral initiation** card (saved by both the hospital's own
  settings page and the console); staff and console user editors refuse to save a department-level
  role without a department.
- Notifications: incoming referrals toast persistently with a chime (`src/lib/alertSound.ts`, Web
  Audio, per-device mute in the sidebar); critical alerts chime; the toaster sits bottom-right on
  desktop, top on phones; install banners moved bottom-left.
- Referral page: `AttachmentsCard` (upload, open through signed URL, remove own, PHI warning);
  *Call now* on the awaiting-response banner once the target is missed; red *Cancel referral* and
  red *Call* on the chat header; *Requested by* shows the origin department.
- Fixes: responsive table labels confined to phones (`index.css`); console hospital filters unwrapped
  so the four selects and the readiness chips lay out horizontally.

## E. Referral initiation policy

| `referral_policy` | Hospital level may refer | Department Coordinator may refer |
| --- | :---: | :---: |
| `hospital_only` (default) | yes | no |
| `department_only` | no | yes |
| `hospital_and_department` | yes | yes |

Evaluated as *role capability AND policy admits level*; a System Administrator passes always. The
receiving side is unaffected: accepting, declining and progressing a referral remain hospital-level
functions in every policy. Set under Administration → Hospital → Referral initiation, or in the
console's hospital editor.

## F. Security review of the previous state

| Finding | Before | After |
| --- | --- | --- |
| `departments` / `readiness_updates` readable by every signed-in user | `using (true)` | `can_view_department(id)` |
| `submit_readiness` accepted any department in the caller's hospital | capability + hospital | `can_manage_department()` |
| `referrals`, events, messages visible to every role at either hospital | hospital match | `can_view_referral()`: hospital level as before, department level by origin department or requester |
| `notify_on_message` alerted every `shift_in_charge` in the hospital | role list | requester, origin department, referral desk |
| `department_id` self-editable by anyone | unguarded | guarded for department-level roles; must be in-hospital; required |
| No department requirement on department-level invitations | client hint only | RLS `with check` |
| `profiles` fully visible within a hospital | hospital match | department-level accounts see own department plus administrators and coordinators |
| Readiness submission failed for everyone | `text[] \|\| 'literal'` | typed literal |

Residual risks, by design: hospital-level accounts still see other hospitals' departments (a referral
decision needs them); the anon role sees nothing new; attachments are private but are not scanned
for burned-in identifiers.

## G. Tests

- `tests/scope.test.ts` (20 cases): scenarios A–H as unit checks of the scope predicates — department
  user restricted to own department and refused elsewhere; hospital admin unrestricted within the
  hospital and refused outside it; super admin unrestricted; each of the three policies for each
  role; roles without `referral:create` never refer; unassigned department accounts have no scope;
  list filters; directory browsing default.
- `tests/tiers.test.ts` updated for the sixth role.
- Manual acceptance cases DS-01 to DS-19 in [ACCEPTANCE_TESTS.md](ACCEPTANCE_TESTS.md) section O
  cover the database refusals (RPC and RLS), the direct-URL guard, the policy switch, notifications,
  the incoming-referral toast, attachments and the call button.
- Suite: 262 unit tests pass; `tsc -b` clean; production build clean.

## H. Deployment

1. Run `supabase/migrations/0008_department_scope.sql` in the SQL editor (or `supabase db push`).
   The front end selects `hospitals.referral_policy` at sign-in, so deploy the migration **before**
   or together with the front end.
2. Confirm the private bucket `referral-attachments` exists (the migration creates it; if the
   notice *Skipped storage bucket setup* appears, create it by hand: private, 20 MB, MIME types
   `image/jpeg, image/png, image/webp, application/pdf`).
3. Check every department-level account has a department:
   `select id, email, role from public.profiles where role in ('shift_in_charge','department_coordinator') and department_id is null;`
   Assign one to each before staff sign in, or they will see the "no department" warning.
4. Each hospital's `referral_policy` is `hospital_only`, which matches the previous behaviour;
   change it only where the hospital has decided to.
5. Smoke test with DS-01, DS-04, DS-06, DS-09 and DS-17.

## I. Pending business decisions

1. **Multiple departments per person.** Supported by the model (a list on both sides) but not by the
   data: `profiles.department_id` is single-valued. Needs a `profile_departments` table, an
   administrator UI, and a one-line union in `accessible_department_ids()` / `buildScope`.
2. **Hospital directory for department-level accounts.** Currently allowed (they can browse
   facilities and contacts but not other hospitals' department boards). Flip
   `DEPARTMENT_LEVEL_BROWSES_DIRECTORY` in `src/lib/scope.ts` and add `canBrowseHospitals` to the
   `hospitals` routes to restrict them to referral contexts.
3. **Department visibility on the receiving side.** A referral records its *origin* department but no
   destination department, so a receiving hospital's departments never see incoming referrals. If a
   receiving unit should follow a case, add `destination_department_id` (set on accept) and extend
   `can_view_referral()`.
4. **Reports for department-level roles.** Neither department role has `reports:view`; a
   department-scoped compliance report would need a scoped RPC.
5. **Attachment retention.** Files inherit the referral's lifetime today; a retention period and a
   purge job should be agreed with the data-protection owner.
