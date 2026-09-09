# FERN — Deployment Runbook

End-to-end, followable instructions for standing FERN up on a client's own Supabase and Vercel
accounts, plus the backup, restore, rollback and smoke-test procedures needed to operate it.

Work through the sections in order. Sections 1–8 are the first deployment; 9–14 are ongoing
operations, incident procedures and troubleshooting.

**Prerequisites**

- Node 20 or newer (`node -v`)
- Git, and access to the FERN repository
- A GitHub account (for Vercel's git integration and for CI)
- A Supabase account — **Pro plan or above for production**, because point-in-time recovery and
  longer backup retention are not available on Free
- A Vercel account
- `psql` and `pg_dump` locally if you intend to take off-platform backups (they ship with
  PostgreSQL client tools)

---

## 1. Create the Supabase project

1. Sign in at <https://supabase.com/dashboard> and choose **New project**.
2. Fill in:
   - **Name**: `fern-production` (use `fern-staging` for the non-production copy)
   - **Database password**: generate a long random password. **Store it in the client's password
     manager now** — Supabase will not show it again, and a restore needs it.
   - **Region**: the region closest to the hospitals. For a Ghanaian deployment, `eu-west-1`
     (Ireland) or `eu-west-2` (London) gives the lowest round trip.
   - **Plan**: Pro or above for production.
3. Wait for provisioning (2–3 minutes).
4. Go to **Project Settings → API** and record two values — you will need them repeatedly:
   - **Project URL** → becomes `VITE_SUPABASE_URL`
   - **anon / public key** → becomes `VITE_SUPABASE_ANON_KEY`

   The **service_role** key is on the same page. Copy it into the password manager and then forget
   it. It bypasses row-level security entirely. It must never be put into a `VITE_*` variable, a
   `.env` file that could be committed, or any client-side code.

5. Go to **Project Settings → Database** and enable **Point in Time Recovery**. Set retention to at
   least 14 days. Do this before go-live, not after — PITR only protects data written after it is
   turned on.

---

## 2. Apply the migrations

The SQL in `supabase/migrations/` is the schema of record. Files apply **in filename order** and
each is idempotent (`create ... if not exists`, `drop policy if exists` before `create policy`), so
re-running one is safe.

| Order | File | Contents |
| --- | --- | --- |
| 1 | `0001_schema.sql` | Tables, constraints, indexes, the `department_readiness` view, the reference-number counter, the `auth.users` → `profiles` bridge, realtime publication |
| 2 | `0002_rls.sql` | Authorisation helper functions, row-level security policies on every table, the privilege-escalation guard trigger, table grants |
| 3 | `0003_functions.sql` | The RPC surface — `get_referral_candidates`, `submit_readiness`, `create_referral`, `update_referral_status`, `flag_overdue_readiness`, `hospital_performance`, `referral_analytics`, `compliance_report`, `record_login`, `log_audit_event`, `mark_notifications_read` |
| 4 | `0004_seed.sql` | Reference data — the emergency-type catalogue with its weighted requirements, and demo hospitals/departments for a pilot |

Confirm the actual filenames present in `supabase/migrations/` before you start; apply every file
you find there, in ascending filename order.

### Option A — Supabase SQL editor (no local tooling)

1. Open **SQL Editor → New query** in the dashboard.
2. Paste the entire contents of `0001_schema.sql`. Press **Run**. Wait for success.
3. Repeat for each remaining file, in order. Do not run them concurrently or out of order — later
   files depend on tables and helpers created by earlier ones.
4. If `0001_schema.sql` emits the notice *"Skipped auth.users trigger: run this migration as the
   postgres role"*, the dashboard editor did not have permission to attach the trigger on
   `auth.users`. Automatic profile creation for invited users will not work until it is attached.
   Fix it by re-running that migration through the CLI (Option B), which connects as `postgres`.

### Option B — Supabase CLI (recommended, and what CI/CD would use)

```bash
npm install -g supabase          # or: npx supabase ...
supabase login                   # opens a browser to authorise
supabase link --project-ref <your-project-ref>   # the ref is in the project URL
supabase db push                 # applies every migration in supabase/migrations/, in order
```

`supabase db push` records what it has applied, so re-running it only applies what is new.

### Verify

Run this in the SQL editor. Every line should return a row.

```sql
select count(*) as tables      from information_schema.tables
  where table_schema = 'public' and table_type = 'BASE TABLE';        -- expect 16
select count(*) as rls_enabled from pg_tables
  where schemaname = 'public' and rowsecurity;                        -- expect 16
select count(*) as policies    from pg_policies where schemaname = 'public';
select count(*) as functions   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public';
select * from public.scoring_config;                                  -- expect exactly one row, id = 1
select count(*) as emergency_types from public.emergency_types;       -- after 0004, > 0
```

The 16 base tables are the 15 documented in [DATA_MODEL.md](DATA_MODEL.md) plus the internal
`referral_reference_counters`. If `rowsecurity` is not true for all 16, stop and re-run
`0002_rls.sql` — an unprotected table is a data breach waiting to happen.

---

## 3. Configure authentication

All of this is dashboard configuration, under **Authentication**. None of it is in code, and
skipping it leaves the deployment open.

### 3.1 Providers and signup

**Authentication → Providers → Email**

| Setting | Value | Why |
| --- | --- | --- |
| Enable email provider | On | Password and OTP sign-in both use it |
| Confirm email | On | An invited user must prove they control the address |
| Secure email change | On | Changing an address requires confirming both old and new |
| **Allow new users to sign up** | **Off** | FERN is invitation-only. This is the single most important setting on the page |

### 3.2 Password policy

**Authentication → Policies** (or **Providers → Email**, depending on dashboard version)

| Setting | Value |
| --- | --- |
| Minimum password length | **12** |
| Required characters | Lowercase, uppercase and digits |
| Leaked password protection (HaveIBeenPwned) | **On** |

### 3.3 URLs

**Authentication → URL Configuration**

| Setting | Production value |
| --- | --- |
| Site URL | `https://fern.yourdomain.org` — your real origin, no trailing slash |
| Redirect URLs | `https://fern.yourdomain.org/reset-password` and `https://fern.yourdomain.org/**` |

Add `http://localhost:5173/**` **only** to a staging or development project. Never add a localhost
or wildcard-domain entry to production: the allow-list is what stops a password-recovery link from
being redirected to an attacker's site.

### 3.4 Session and OTP timing

**Authentication → Sessions / Providers → Email**

| Setting | Value | Why |
| --- | --- | --- |
| Email OTP expiry | **600** seconds (10 minutes) | Long enough for hospital email to arrive, short enough to limit a leaked code |
| JWT expiry | 3600 seconds (1 hour) | The client refreshes automatically; the app never blanks on refresh |
| Refresh token rotation | On | A stolen refresh token is single-use |
| Refresh token reuse interval | 10 seconds | Tolerates a flaky mobile connection retrying |

### 3.5 Email templates

**Authentication → Email Templates.** Edit at minimum **Confirm signup**, **Magic Link**,
**Reset Password** and **Invite user** so they carry the hospital network's name rather than
"Supabase". Keep `{{ .ConfirmationURL }}` and `{{ .Token }}` intact — those are what make the links
and codes work. Wording to use:

> Your FERN sign-in code is **{{ .Token }}**. It expires in 10 minutes. If you did not request it,
> ignore this email and tell your hospital administrator.

### 3.6 SMTP

**Project Settings → Auth → SMTP Settings.** Supabase's built-in sender is rate-limited and
intended for development only. For production, configure the client's own provider (Amazon SES,
Postmark, SendGrid, or the hospital network's own relay) with a sender address on the deployment's
own domain. Send a test invitation and confirm it arrives without landing in spam — SPF and DKIM on
the sending domain matter here.

---

## 4. Create the first super_admin

There is a deliberate chicken-and-egg: signup is disabled, and only a `super_admin` can invite
anyone. Break it once, by hand.

1. **Authentication → Users → Add user → Create new user.**
   - Email: the client's system administrator
   - Password: a strong temporary password, delivered out of band
   - **Auto Confirm User**: on
2. If `0001_schema.sql`'s trigger attached successfully, a `profiles` row already exists. Promote
   it in the **SQL editor**:

```sql
update public.profiles
set role       = 'super_admin',
    full_name  = 'Ama Boateng',
    is_active  = true,
    must_change_password = true          -- forces a rotation at first sign-in
where email = 'admin@yourdomain.org';
```

3. If that `update` reports `UPDATE 0`, the trigger did not run (see section 2, Option A). Insert
   the profile manually, taking the id from the Authentication → Users table:

```sql
insert into public.profiles (id, full_name, email, role, is_active, must_change_password)
values (
  '00000000-0000-0000-0000-000000000000',   -- the auth user's id
  'Ama Boateng',
  'admin@yourdomain.org',
  'super_admin',
  true,
  true
)
on conflict (id) do update
  set role = excluded.role,
      full_name = excluded.full_name,
      is_active = true;
```

4. Verify:

```sql
select id, email, role, hospital_id, is_active from public.profiles order by created_at;
```

A `super_admin` deliberately has no `hospital_id` — they operate across the network. Every other
user **must** have one, or hospital-scoped policies will return nothing for them.

### Adding the rest of the staff

From this point on, use the app. Sign in as the `super_admin`, create hospitals and departments in
**Admin**, then add users. For each user: **Authentication → Users → Add user** (or **Invite**, which
emails them a link), then set their role, hospital and department from the Admin → Staff screen.

To have the profile arrive already configured, invite through the **Admin API** so that role and
hospital travel in `app_metadata`:

```bash
curl -X POST "$SUPABASE_URL/auth/v1/admin/users"   -H "apikey: $SERVICE_ROLE_KEY"   -H "Authorization: Bearer $SERVICE_ROLE_KEY"   -H "Content-Type: application/json"   -d '{
    "email": "kwame@hospital.org",
    "email_confirm": true,
    "user_metadata": { "full_name": "Kwame Asante", "phone": "+233201234567" },
    "app_metadata":  { "role": "shift_in_charge", "hospital_id": "1f2e3d4c-..." }
  }'
```

> **Do not put `role` or `hospital_id` in `user_metadata`.** That field is writable by the account
> holder, so a role taken from it could be self-assigned at signup:
> `POST /auth/v1/signup {"data":{"role":"super_admin"}}` with nothing but the public anon key.
> `handle_new_auth_user` therefore reads privilege **only** from `app_metadata`, which GoTrue lets
> only the service role write. `full_name` and `phone` still come from `user_metadata` — they carry
> no privilege.

A user invited without `app_metadata` lands as a `viewer` with no hospital, which is safe but inert:
note that a `hospital_admin` **cannot** adopt an unattached user, because the profile guard requires
the row to already belong to their hospital. Either invite with `app_metadata` set, or have a
`super_admin` attach them.

The `StaffManager` screen in the app generates this exact command, pre-filled with the hospital id
and the chosen role. The service-role key must never be used from a browser.

---

## 5. Seed the data

`0004_seed.sql` loads the **emergency-type catalogue** and its weighted requirements. That
catalogue is what makes ranking meaningful, so it must be present in production; the demo hospitals
in the same file are for a pilot and should be reviewed before a live launch.

Check what landed:

```sql
select code, name, category, default_urgency from public.emergency_types order by sort_order, name;

select et.code, er.resource_key, er.weight, er.is_critical, er.min_quantity
from public.emergency_requirements er
join public.emergency_types et on et.id = er.emergency_type_id
order by et.code, er.weight desc;
```

Adjust weights to local clinical practice through **Admin → Emergency types** (`super_admin` only)
or in SQL. Weights are 0–10; `is_critical = true` means a hospital lacking that resource is excluded
outright rather than merely scored down, so use it sparingly and only for things without which the
case genuinely cannot be managed.

### Real hospitals

Add production hospitals through **Admin → Hospitals**, or in bulk:

```sql
insert into public.hospitals (name, code, level, city, region, latitude, longitude,
                              phone, emergency_phone, email, timezone)
values
  ('Korle Bu Teaching Hospital', 'KBTH', 'tertiary', 'Accra', 'Greater Accra',
   5.536000, -0.226000, '+233302739500', '+233302739501', 'referrals@kbth.example', 'Africa/Accra'),
  ('Ridge Hospital', 'RIDGE', 'secondary', 'Accra', 'Greater Accra',
   5.564000, -0.198000, '+233302228382', '+233302228383', 'referrals@ridge.example', 'Africa/Accra');
```

**Coordinates matter more than anything else on this screen.** They drive distance, ETA and 30% of
every score. Take them from the facility's actual location (drop a pin on a map and copy the decimal
pair), not from a town centroid. Latitude and longitude are stored to six decimal places, roughly
0.1 m of precision.

Then create each hospital's departments (Admin → Departments) and let each department's shift
in-charge file the first readiness update. Until a department reports, its light is **red** and the
hospital scores with the full staleness penalty — which is correct behaviour, not a bug.

---

## 6. Deploy to Vercel

1. Push the repository to GitHub (or GitLab/Bitbucket).
2. In Vercel: **Add New → Project → Import Git Repository**, and select it.
3. Vercel reads `vercel.json` and should detect the settings below. Confirm them:

| Setting | Value |
| --- | --- |
| Framework preset | **Vite** |
| Root directory | `./` |
| Build command | `npm run build` |
| Output directory | `dist` |
| Install command | `npm ci` |
| Node version | 20.x |

4. Add the environment variables under **Settings → Environment Variables**, ticking
   **Production**, **Preview** and **Development**:

| Name | Value |
| --- | --- |
| `VITE_SUPABASE_URL` | `https://<project-ref>.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | the anon/public key from section 1 |
| `VITE_APP_NAME` | optional; defaults to `FERN` |
| `VITE_DEFAULT_TIMEZONE` | optional; defaults to `Africa/Accra` |
| `VITE_SUPPORT_EMAIL` | optional; shown on error screens |

**Do not add the service-role key. Ever.** Anything with a `VITE_` prefix is compiled into
JavaScript that every visitor downloads.

5. **Deploy.** The first build takes 1–3 minutes.

### The build-time inlining rule

`VITE_*` variables are substituted into the bundle by Vite **during the build**. They are not read
at runtime. So:

- Changing a variable in the Vercel dashboard has **no effect** until you redeploy.
- After any change: **Deployments → ⋯ → Redeploy**, and **untick "Use existing Build Cache"**.
- Rotating the anon key is therefore a two-step operation: update the variable, then redeploy. Plan
  it for off-peak, because it invalidates existing sessions.

### What `vercel.json` already handles

- SPA rewrites: every non-`/api` path serves `index.html`, so a deep link like
  `/referrals/<id>` works on a hard refresh.
- Security headers on every response — `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`,
  `Permissions-Policy`, HSTS, `Cross-Origin-Opener-Policy` (see [SECURITY.md](SECURITY.md)).
- One-year immutable caching on `/assets/*`, which is safe because those filenames are
  content-hashed. `index.html` is never cached.

---

## 7. Custom domain and HSTS

1. **Vercel → Project → Settings → Domains → Add**, e.g. `fern.yourdomain.org`.
2. Create the DNS record Vercel shows — a `CNAME` to `cname.vercel-dns.com` for a subdomain, or the
   `A` record it specifies for an apex domain.
3. Wait for DNS propagation. Vercel issues and auto-renews a Let's Encrypt certificate; nothing to
   do manually.
4. Confirm the redirect from `http://` to `https://` happens, and that `www` (if used) redirects to
   the canonical host.
5. **Update Supabase** — this step is easy to forget and breaks password resets if missed:
   **Authentication → URL Configuration** → set Site URL to the new origin and add
   `https://fern.yourdomain.org/reset-password` and `https://fern.yourdomain.org/**` to the redirect
   allow-list. Remove any placeholder `*.vercel.app` entries from production.
6. Verify the headers:

```bash
curl -sI https://fern.yourdomain.org | grep -iE 'strict-transport|x-frame|x-content-type|referrer|permissions-policy'
```

Expect `strict-transport-security: max-age=63072000; includeSubDomains; preload`.

7. **Optional — HSTS preload.** Once you are certain every subdomain of the parent domain can serve
   HTTPS permanently, submit the domain at <https://hstspreload.org>. Preloading is effectively
   irreversible for months; do not submit a domain you may need to serve over plain HTTP.

---

## 8. Schedule the overdue-readiness job

`flag_overdue_readiness()` is what turns a yellow or red department into an actual alert. Without
it, the traffic light still works but nobody is told. Run it every 30 minutes.

### Option A — pg_cron inside Supabase (recommended)

Everything stays in the database; no external scheduler to fail silently.

```sql
-- once per project
create extension if not exists pg_cron with schema extensions;

-- schedule: every 30 minutes, on the hour and the half hour
select cron.schedule(
  'fern-flag-overdue-readiness',
  '*/30 * * * *',
  $$select public.flag_overdue_readiness()$$
);
```

Verify and monitor:

```sql
-- the job exists
select jobid, jobname, schedule, active, command from cron.job;

-- the last 20 runs, newest first
select j.jobname, r.status, r.return_message, r.start_time, r.end_time
from cron.job_run_details r
join cron.job j on j.jobid = r.jobid
order by r.start_time desc
limit 20;
```

To change the interval, re-run `cron.schedule` with the same job name — it replaces the existing
entry. To remove it: `select cron.unschedule('fern-flag-overdue-readiness');`

**Timezone note.** `pg_cron` schedules in the database's timezone (UTC on Supabase). That is fine
here: `*/30 * * * *` is timezone-independent, and `flag_overdue_readiness()` does its shift
arithmetic against each hospital's own timezone internally.

### Option B — Vercel Cron calling a Supabase Edge Function

Use this if `pg_cron` is unavailable on your plan, or if the client wants the schedule visible
outside the database.

1. Create an Edge Function:

```bash
supabase functions new flag-overdue
```

```ts
// supabase/functions/flag-overdue/index.ts
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

Deno.serve(async (req) => {
  // Only the scheduler may call this.
  if (req.headers.get('authorization') !== `Bearer ${Deno.env.get('CRON_SECRET')}`) {
    return new Response('Unauthorized', { status: 401 })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const { data, error } = await supabase.rpc('flag_overdue_readiness')
  if (error) return new Response(error.message, { status: 500 })
  return Response.json({ notifications_created: data })
})
```

2. Set its secrets and deploy:

```bash
supabase secrets set CRON_SECRET="$(openssl rand -hex 32)"
supabase functions deploy flag-overdue --no-verify-jwt
```

3. Add `api/cron/flag-overdue.ts` to the Vercel project, which forwards the call with the shared
   secret from a Vercel environment variable (`CRON_SECRET`, not `VITE_`-prefixed), and schedule it
   in `vercel.json`:

```json
{
  "crons": [{ "path": "/api/cron/flag-overdue", "schedule": "*/30 * * * *" }]
}
```

Note that Vercel's Hobby plan limits cron to once per day; a half-hourly schedule needs a paid plan.
This is the main reason Option A is preferred.

### Confirming it works

Deliberately let a department go stale (or backdate its last update), wait for the next run, then:

```sql
select type, severity, title, created_at
from public.notifications
where type = 'readiness_overdue'
order by created_at desc
limit 10;
```

Acceptance test AT-43 covers this end to end.

---

## 9. Backup procedure

### 9.1 Platform backups (automatic)

| Mechanism | Availability | Recovery point |
| --- | --- | --- |
| Daily physical backup | All paid plans | ≤ 24 hours |
| Point-in-time recovery | Pro and above, once enabled | ≤ 2 minutes |

Enable PITR at **Project Settings → Database → Point in Time Recovery** and set retention to at
least 14 days. Confirm the "Backups" tab lists recent restore points before go-live.

### 9.2 Off-platform weekly dump

Platform backups do not survive the loss of the Supabase account itself. Take an independent copy.

```bash
# Connection string: Supabase dashboard -> Project Settings -> Database -> Connection string -> URI
export FERN_DB_URL="postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres"

pg_dump "$FERN_DB_URL" \
  --format=custom \
  --no-owner --no-privileges \
  --schema=public --schema=auth \
  --file="fern-$(date +%Y%m%d).dump"

# encrypt before it leaves the machine
gpg --symmetric --cipher-algo AES256 "fern-$(date +%Y%m%d).dump"
```

Include `--schema=auth` — without it you restore the data but not the user accounts. Store the
encrypted dump in client-controlled storage with restricted access, and keep the last 8 weekly
copies. This file is a complete copy of the database: treat it with the same care as the
service-role key.

### 9.3 Code and configuration

Git is the backup for application code, and Vercel retains every previous deployment for instant
rollback. Environment variable *values* are not in git by design — keep them in the client's
password manager alongside the database password.

---

## 10. Restore procedure

**Restore to a scratch project first whenever the situation allows.** Restoring over a live project
is destructive and irreversible.

### 10.1 Point-in-time restore (data loss or a bad write)

1. Identify the exact moment immediately **before** the damage — `audit_logs` and
   `referral_events` are the fastest way to pin it down.
2. **Project Settings → Database → Point in Time Recovery → Restore**, choose the timestamp, and
   confirm. The project goes offline during the restore, typically 10–40 minutes depending on size.
3. When it returns, run the section 12 smoke tests, then re-verify:

```sql
select max(created_at) from public.referrals;
select max(created_at) from public.audit_logs;
select count(*) from public.profiles where is_active;
```

4. Announce the restore window to users. Anything written after the restore point is gone; a
   referral raised in that window has to be re-entered.

### 10.2 Restore from a `pg_dump` (account loss, or migrating projects)

```bash
gpg --decrypt fern-20260901.dump.gpg > fern-20260901.dump

# create a fresh Supabase project first, then:
export NEW_DB_URL="postgresql://postgres:<password>@db.<new-ref>.supabase.co:5432/postgres"

pg_restore --dbname="$NEW_DB_URL" \
  --no-owner --no-privileges \
  --clean --if-exists \
  fern-20260901.dump
```

Then, because the dump does not carry project-level configuration:

1. Re-apply section 3 (auth configuration) on the new project — none of it is in the database.
2. Update `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in Vercel, and **redeploy** (section 6).
3. Re-create the pg_cron job (section 8) — `cron.job` lives in the `cron` schema and is not in a
   `public`+`auth` dump.
4. Re-enable PITR on the new project.
5. Run the smoke tests.

### 10.3 Restore drill

Do this before go-live and every six months after. Restore the most recent dump into a throwaway
Supabase project, point a local `npm run dev` at it, sign in, and confirm the readiness board and a
referral render. Record the date and the elapsed time. Acceptance test **AT-56** covers the first
drill. A backup that has never been restored is a hypothesis, not a backup.

---

## 11. Rollback procedure

### 11.1 Rolling back the application (a bad frontend deploy)

Fast, safe and reversible — the database is untouched.

1. **Vercel → Deployments**, find the last known-good deployment.
2. **⋯ → Promote to Production** (older dashboards: *Rollback*).
3. It is live within seconds; no rebuild happens.
4. Then fix forward in git. Do not leave production pinned to an old deployment for long, because
   the next merge to `main` will deploy over it.

### 11.2 Rolling back a database migration

Migrations are forward-only. There are no `down` scripts, deliberately: a generated `down` that
drops a column is a data-loss weapon pointed at production.

- **A migration that only added things** (a table, a column, an index, a policy) is usually safe to
  leave in place. Fix forward with a new migration.
- **A migration that changed or removed data** requires a point-in-time restore to just before it
  ran (section 10.1). Take the timestamp from the deployment record before you start.
- **Always test a migration on a staging project first.** For anything touching existing rows, take
  a manual `pg_dump` immediately beforehand — five minutes then saves the restore window later.

Recording each migration's application time in the client's change log makes 10.1 quick when it is
needed.

### 11.3 Rolling back a configuration change

Auth settings, the scoring configuration and the cron schedule are all reversible in place. Note
that `scoring_config` changes take effect on the next ranking with no redeploy, and are recorded in
`audit_logs` under `config.update` — that log is where you find the previous values.

---

## 12. Post-deploy smoke test

Run this checklist after every production deployment and after every restore. Ten minutes, and it
catches the failures that matter. The full 64-case suite is in
[ACCEPTANCE_TESTS.md](ACCEPTANCE_TESTS.md).

| # | Check | Expected |
| --- | --- | --- |
| 1 | Load the production URL | The login page renders; no console errors |
| 2 | `curl -sI <url>` | 200, and HSTS + `X-Frame-Options: DENY` present |
| 3 | Deep-link to `/referrals` while signed out | Redirected to `/login`, not a 404 |
| 4 | Sign in as `super_admin` with a password | Dashboard loads with the correct name and role in the header |
| 5 | Request an email OTP for a test account | Code arrives within 60 seconds; signing in with it works |
| 6 | Request a password reset | Email arrives; the link opens `/reset-password` on the **production** origin |
| 7 | Open the readiness board | Departments listed with green/yellow/red lights and text labels |
| 8 | Submit a readiness update | Saves, toast confirms, the department turns green immediately |
| 9 | Confirm the resource snapshot moved | `select updated_at from hospital_resources where hospital_id = '<id>'` is seconds old |
| 10 | Start a new referral | Candidate hospitals rank with scores, distances, ETAs and a per-resource breakdown |
| 11 | Create the referral | It appears with a `FERN-YYYYMMDD-NNNN` reference and status `pending` |
| 12 | Sign in as the receiving hospital in a second browser | The referral appears in its inbox and the sidebar badge increments |
| 13 | Send a chat message from each side | Each message appears on the other side within about a second, without a refresh |
| 14 | Accept the referral | Status changes both sides; the timeline shows the transition and `response_seconds` is populated |
| 15 | Print the referral form | Opens outside the app chrome and paginates as A4 |
| 16 | Open Reports | Charts and tables render; CSV export downloads and opens cleanly |
| 17 | **RLS check** | Signed in as Hospital A, request Hospital B's referral by id — it must return empty, not merely be hidden (AT-45) |
| 18 | Check the cron job | `select * from cron.job_run_details order by start_time desc limit 5;` shows recent successes |
| 19 | Check the audit trail | `select action, created_at from audit_logs order by created_at desc limit 20;` shows the login, the readiness submission and the referral creation you just performed |
| 20 | Load on a phone | Everything is usable at 375 px wide with no horizontal page scroll |

---

## 13. Routine operations

| Task | Frequency | How |
| --- | --- | --- |
| Review overdue-readiness alerts | Daily, per hospital | Notification centre; Reports → Compliance |
| Review the audit log | Weekly | Admin → Audit log, filtered by action |
| Merge Dependabot PRs | Weekly | CI must be green before merge |
| Access review — who holds `super_admin`, who is still active | Quarterly | Admin → Staff; deactivate leavers, never delete them |
| Restore drill | Six-monthly | Section 10.3 |
| Review scoring configuration against observed transfer times | Six-monthly | Admin → Scoring; tune `roadDistanceFactor` and the speeds |
| Postgres major-version upgrade | When offered | Test on staging first, then apply in a maintenance window |

---

## 14. Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| "Supabase is not configured. Missing VITE_SUPABASE_URL…" | The environment variable was absent at **build** time | Add it in Vercel, then redeploy without the build cache |
| Sign-in works but the app says "No staff profile is linked to this account" | The `auth.users` trigger did not run, so no `profiles` row exists | Insert the profile manually (section 4, step 3), then re-run `0001_schema.sql` via the CLI so future invites work |
| Every list is empty for a real user | Their profile has no `hospital_id`; hospital-scoped policies return nothing | Set it in Admin → Staff |
| Password-reset link opens the wrong site, or errors | Site URL / redirect allow-list still points at a preview or localhost origin | Section 3.3, then request a fresh link |
| A referral cannot be created — "permission denied" | The user lacks `referral:create`, or their profile is inactive | Check their role in Admin → Staff |
| Chat messages do not appear live | The realtime publication does not include `messages`, or the referral is closed | Re-run the realtime block at the end of `0001_schema.sql`; messages are only writable while the referral is pending/accepted/in transit |
| Every hospital scores 0 on resources | The emergency type has no requirements configured | Seed or configure them (section 5). The fallback requirement set only applies when the list is completely empty |
| Every hospital shows red | No department has ever submitted, or the cron job is not the problem — the data is genuinely stale | Have each department file one update; check `readiness_updates` |
| No overdue alerts are arriving | The scheduled job is not running | Section 8, verification query |
| A deep link 404s on refresh | The SPA rewrite is missing | Confirm `vercel.json` is at the repository root and was picked up by the build |
