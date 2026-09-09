# FERN database

The Postgres side of FERN: schema, row level security, the RPCs the app calls,
and demo data.

| File | What it does |
| --- | --- |
| `migrations/0001_schema.sql` | Tables, constraints, indexes, the `department_readiness` view, the `updated_at` and reference-number triggers, and the `auth.users -> profiles` bridge. |
| `migrations/0002_rls.sql` | RLS on every table, the `SECURITY DEFINER` authorisation helpers, the policies and the table grants. |
| `migrations/0003_functions.sql` | Shift arithmetic, readiness status, and every RPC the client calls. |
| `migrations/0004_seed.sql` | Eight Ghanaian facilities, their departments, resource snapshots, blood stock, twelve emergency types and a mixed readiness history. |
| `config.toml` | Supabase CLI settings for local development. |

`src/lib/database.types.ts` is a hand-maintained mirror of `0001_schema.sql`.
If you change a column here, change it there too — the whole app is typed
against that file.

---

## Applying the migrations

### Option A — linked project (recommended)

```bash
npm install -g supabase        # or: npx supabase@latest ...
supabase login
supabase link --project-ref YOUR-PROJECT-REF
supabase db push
```

`db push` applies the four files in filename order inside a transaction and
records them in `supabase_migrations.schema_migrations`, so a second push is a
no-op.

### Option B — SQL editor

Open the Supabase dashboard → **SQL Editor**, then paste and run each file **in
this order**, one at a time:

1. `migrations/0001_schema.sql`
2. `migrations/0002_rls.sql`
3. `migrations/0003_functions.sql`
4. `migrations/0004_seed.sql`

Order matters: `0002` creates the helper functions the policies depend on, and
`0003` calls those helpers. Every file is idempotent (`create ... if not
exists`, `create or replace`, `on conflict do nothing`), so re-running one is
safe — `0004` will not duplicate or overwrite seeded rows.

### Option C — local stack

```bash
supabase start        # Postgres on 54322, API on 54321, Studio on 54323
supabase db reset     # drops, recreates and re-applies every migration + seed
```

Local mail (invites, magic links, password resets) is captured by Inbucket at
<http://localhost:54324>.

### After applying

Copy the project URL and anon key into `.env`:

```
VITE_SUPABASE_URL=https://YOUR-PROJECT-REF.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR-PUBLISHABLE-ANON-KEY
```

If an RPC comes back as `404 / function not found`, PostgREST is still holding
an old schema cache. `0003` ends with `notify pgrst, 'reload schema';` — run
that statement again, or restart the project's API from the dashboard.

---

## Creating the first super_admin

There is deliberately **no self-service signup** and no way to insert into
`auth.users` from SQL safely — doing so by hand skips password hashing and the
identity row, and the account will not be able to log in.

1. Dashboard → **Authentication → Users → Add user**. Enter an email and
   password, tick *Auto Confirm User*.
2. The `on_auth_user_created` trigger fires and leaves behind a `profiles` row
   with role `viewer`.
3. Promote it in the SQL editor:

```sql
update public.profiles
set role = 'super_admin',
    full_name = 'Your Name',
    is_active = true
where email = 'you@example.org';
```

That account can now create hospitals, invite staff and edit the scoring config
from the admin screens.

### Inviting the rest of the team

Invite through the Admin API so that role and hospital arrive in
`app_metadata`, which only the service role can write:

```bash
curl -X POST "$SUPABASE_URL/auth/v1/admin/users"   -H "apikey: $SERVICE_ROLE_KEY"   -H "Authorization: Bearer $SERVICE_ROLE_KEY"   -H "Content-Type: application/json"   -d '{
    "email": "ama@hospital.org",
    "email_confirm": true,
    "user_metadata": { "full_name": "Ama Mensah" },
    "app_metadata":  { "role": "shift_in_charge",
                       "hospital_id": "11111111-1111-4111-8111-111111111101" }
  }'
```

`handle_new_auth_user()` reads privilege from `app_metadata` **only**, and
validates `role` against the five roles, falling back to `viewer`. Putting
`role` in `user_metadata` does nothing — deliberately, because that field is
client-writable at signup and would otherwise be a free promotion to
`super_admin`. It never raises: a malformed payload can leave a profile to be
repaired, but it can never break account creation.

The seeded hospital ids are stable: `KBTH`, `MIL37`, `RIDGE`, `TEMA`, `LEKMA`,
`GAEAST`, `KATH`, `CCTH` — look one up with
`select id, code, name from public.hospitals order by code;`.

---

## Scheduling the readiness sweep

`flag_overdue_readiness()` walks every active department that owes a shift
update, and raises a notification for each hospital administrator whose
department has gone yellow or red. It de-duplicates per department per shift, so
running it more often than once a shift is harmless — it simply returns `0`.

Enable `pg_cron` (Dashboard → **Database → Extensions → pg_cron**, or
`create extension if not exists pg_cron with schema extensions;`), then:

```sql
-- Every 30 minutes: catches a department the moment its shift turns yellow.
select cron.schedule(
  'fern-flag-overdue-readiness',
  '*/30 * * * *',
  $$select public.flag_overdue_readiness()$$
);
```

Shift boundaries are 07:00, 15:00 and 23:00 local time. If you would rather
alert once per shift, an hour into each one, use:

```sql
select cron.schedule(
  'fern-flag-overdue-readiness',
  '0 8,16,0 * * *',       -- pg_cron runs on UTC; Africa/Accra is UTC+0
  $$select public.flag_overdue_readiness()$$
);
```

Check and remove schedules with:

```sql
select jobid, jobname, schedule, active from cron.job;
select cron.unschedule('fern-flag-overdue-readiness');
```

`pg_cron` runs as `postgres`, so `auth.uid()` is null inside the function and it
takes the unauthenticated (system) path. A signed-in user can also call it, but
only an administrator.

---

## How authorisation is arranged

**Reads are policy-driven, writes to the sensitive tables are RPC-driven.**

- Everything readable cross-hospital — hospitals, departments, resources, blood
  stock, the emergency catalogue — is `select`-able by any authenticated user.
  Ranking a referral is inherently a cross-hospital query, so hiding those rows
  would break the product.
- `referrals`, `referral_events`, `notifications` and `audit_logs` have **no
  client-side insert or update path at all**. `create_referral()`,
  `update_referral_status()` and `submit_readiness()` are the only writers,
  because a referral is never just a row: it carries a score snapshot, a
  timeline event, notifications for the other hospital and an audit entry. The
  grants are revoked as well as the policies omitted, so a missing policy can
  never be papered over by a lingering default privilege.
- The helper functions (`current_user_role()`, `current_user_hospital()`,
  `is_super_admin()`, `is_admin()`, `has_capability()`) are `SECURITY DEFINER`
  on purpose: a policy on `profiles` that queries `profiles` would recurse
  forever. Running the lookup as the definer, for whom RLS does not apply,
  breaks the cycle. They take no caller-supplied identity — only `auth.uid()` —
  and pin `search_path`.
- A `WITH CHECK` expression cannot see the old row, so it cannot tell an
  unchanged row from a user who has just promoted themselves. The real guard on
  `profiles.role` / `hospital_id` / `is_active` is the `BEFORE UPDATE` trigger
  `guard_profile_privileges()`.

`ROLE_CAPABILITIES` in `src/lib/constants.ts` and `has_capability()` in
`0002_rls.sql` say the same thing twice, once for the UI and once for the
database. Keep them in step.

---

## Things worth knowing

**Shift attribution.** Shifts are 07:00–15:00, 15:00–23:00 and 23:00–07:00 in
the *hospital's* timezone. The night shift straddles midnight and is filed under
the date it started, so 02:00 on the 5th belongs to the night shift of the 4th.
`shift_for()`, `shift_index()` and `shifts_elapsed()` implement exactly the same
rule as `src/domain/shifts.ts`; the traffic light is `readiness_status()`:
0 shifts elapsed → green, 1–2 → yellow, 3+ or never → red.

**Distance.** `get_referral_candidates()` computes great-circle distance with
the haversine formula and a 6371.0088 km mean radius — the same constant as
`src/domain/geo.ts`, so the SQL and the client never disagree about how far away
a hospital is. Road distance, ETA and the actual score are computed client-side
in `src/domain/scoring.ts` and snapshotted onto the referral row.

**Reference numbers.** `FERN-YYYYMMDD-NNNN`, assigned by a `BEFORE INSERT`
trigger from a per-day counter row. The `on conflict do update ... returning`
takes a row lock, which serialises concurrent referrals on the same day and
hands each one a distinct number.

**No PHI.** A referral carries a generated `patient_ref`, an age band, a sex and
a clinical summary. There is no name, date of birth or national ID column and
none should ever be added.

**Regenerating types.**

```bash
supabase gen types typescript --linked > src/lib/database.types.ts   # npm run db:types
```

Review the diff before committing: `database.types.ts` also carries the
hand-written `ReferralCandidateRow`, `HospitalPerformanceRow` and `ComplianceRow`
interfaces, which the generator does not produce.
