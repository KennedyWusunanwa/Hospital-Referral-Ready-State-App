# FERN — Cybersecurity Measures

This document maps each security measure named in the FERN engagement contract onto what the
delivered build actually does, names the residual risks it does not remove, and explains the one
place where a user could put clinical detail into the system and how that is contained.

Companion reading: [SPECIFICATION.md](SPECIFICATION.md) section 2 for the capability matrix,
[DATA_MODEL.md](DATA_MODEL.md) for the schema, [DEPLOYMENT.md](DEPLOYMENT.md) for the operational
procedures referenced here.

---

## 1. Secure authentication

Authentication is delegated entirely to **Supabase Auth (GoTrue)**. FERN never sees, transports or
stores a password.

| Control | Implementation |
| --- | --- |
| Flow | **PKCE** (`flowType: 'pkce'` in `src/lib/supabase.ts`). The authorisation code is exchanged for tokens using a one-time verifier held only by the originating browser, so an intercepted code in a redirect URL or a server log is not usable |
| Methods | Email + password, and passwordless **email one-time code** for staff who cannot manage a password on a shared ward terminal |
| Signup | **Disabled**, and *not load-bearing*. `signInWithOtp` passes `shouldCreateUser: false`, and public signup is off in the dashboard — but neither is the real defence, because both are settings outside the repository. The database defence is that `handle_new_auth_user` reads role and hospital **only** from `app_metadata`, which GoTrue permits only the service role to write. If signups were ever re-enabled by accident, a self-registered account would land as a `viewer` with no hospital, not as whatever role it asked for |
| Session storage | Held under the dedicated key `fern.auth` in browser storage, scoped to the origin |
| Session refresh | `autoRefreshToken: true`. A `TOKEN_REFRESHED` event updates the session in place without re-fetching the profile, so an hourly refresh never blanks the screen |
| Expired session | PostgREST returns `PGRST301` / a JWT-expired message; `humanizeSupabaseError` turns both into "Your session has expired. Please sign in again." |
| Password reset | `resetPasswordForEmail` with an explicit `redirectTo` of `<origin>/reset-password`. The redirect must also be on the Supabase allow-list, so an attacker cannot redirect the recovery link elsewhere |
| Forced rotation | `profiles.must_change_password` is set when an administrator issues a credential; it is cleared only after the user sets their own password through `updatePassword` |
| Login recorded | On a successful password sign-in the client calls `record_login()`, which stamps `profiles.last_login_at` and writes an `auth.login` audit row. The call is best-effort — a failed audit write must never stop a clinician signing in at 3am |
| Sign-out | Clears the Supabase session and resets the in-memory auth state. A race guard (`requestIdRef`) prevents a slow in-flight profile fetch from resurrecting a signed-out identity |

### Race and staleness guards

Two subtle failures were designed out rather than left to chance:

- A profile fetch that resolves *after* the user signed out is discarded, because each fetch carries
  a monotonically increasing request id and only the newest one may write state.
- A user whose account is deactivated while signed in is signed out on the next profile load, and
  independently loses all database access immediately (section 2).

### Configuration the client must set

These are dashboard settings, not code, and are listed in DEPLOYMENT.md as required steps:

| Setting | Required value |
| --- | --- |
| Allow new users to sign up | **Off** (defence in depth; privilege is not taken from client-writable metadata regardless — see Authentication above) |
| Minimum password length | **12** characters |
| Leaked-password protection (HaveIBeenPwned) | **On** |
| Email OTP expiry | **600 seconds** (10 minutes) |
| Site URL | The production origin, exactly |
| Redirect allow-list | `<origin>/reset-password`, `<origin>/*` for the SPA, plus `http://localhost:5173/*` only in a non-production project |
| Multi-factor authentication | Available in Supabase Auth; **not enabled in this release**. Recommended for `super_admin` accounts as a first post-go-live hardening step |

---

## 2. Access controls

Authorisation has two layers, and only one of them is load-bearing.

**Layer 1 — the UI capability matrix.** `ROLE_CAPABILITIES` in `src/lib/constants.ts` maps each of
the five roles to a set of eleven capabilities; `can(role, capability)` and the `RequireCapability`
route guard use it to decide what to render. This is an *affordance* layer: it stops a viewer from
being shown a button they cannot use. It is client-side code and is assumed to be bypassable.

**Layer 2 — row-level security.** RLS is enabled on every table in `public`, and default privileges
are revoked from `anon` and `authenticated` before explicit grants are issued, so a table with a
missing policy fails closed rather than falling back to a lingering grant. This is the boundary that
actually holds, and it holds regardless of what the browser sends.

The two layers are written to say the same thing: `public.has_capability(text)` in `0002_rls.sql` is
a literal transcription of `ROLE_CAPABILITIES`. Keeping them in step is a maintenance obligation
noted in comments on both sides.

### 2.1 The SECURITY DEFINER helper pattern — why it is necessary

Every policy needs to know the caller's role and hospital, which means reading `profiles`. But some
of those policies are *on* `profiles`. Written as ordinary functions, evaluating the policy would
run a query that evaluates the policy: infinite recursion, and Postgres would refuse.

`SECURITY DEFINER` breaks the cycle. The function body executes as its (table-owning) definer, for
whom RLS is not applied, so the lookup completes without re-entering the policy.

```sql
create or replace function public.current_user_hospital()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp   -- pinned: a hostile search_path cannot swap the table
as $$
  select p.hospital_id
  from public.profiles p
  where p.id = auth.uid()          -- identity comes from the JWT, never from an argument
    and p.is_active                -- a deactivated account resolves to NULL and fails every scoped policy
$$;
```

Because these functions bypass RLS, they are deliberately minimal and follow three rules:

1. **They take no caller-supplied identity.** Every one derives the subject from `auth.uid()`. There
   is no `current_user_hospital(p_user_id uuid)` to abuse.
2. **`search_path` is pinned** to `public, pg_temp`, so a caller who has set a hostile `search_path`
   cannot substitute their own `profiles` table underneath the function.
3. **They return facts, not data.** `current_user_role()`, `current_user_hospital()`,
   `is_super_admin()`, `is_admin()`, `has_capability(text)` and `is_referral_participant(uuid)`
   return a role name, a UUID or a boolean — never rows a caller could not otherwise read.

The same pattern carries the write RPCs (`submit_readiness`, `create_referral`,
`update_referral_status`, `flag_overdue_readiness`, `log_audit_event`, `mark_notifications_read`).
Each one re-checks capability and hospital scope internally as its first act.

### 2.2 Writes go through functions, not through PostgREST

`referrals` and `referral_events` have **no INSERT or UPDATE policy at all**, and `notifications`
has none either. This is intentional. A referral is never just a row: it comes with a score
snapshot, a timeline event, a notification to the other hospital and an audit entry, and the status
change must respect a state machine. Letting a client `PATCH /referrals?id=eq.x` would silently skip
all four and make the state machine unenforceable. The RPCs are the only writers, so those
invariants cannot be routed around.

### 2.3 Privilege escalation is structurally prevented

A `WITH CHECK` expression cannot see the old row, so it cannot distinguish "this row is unchanged"
from "this user just promoted themselves". The guard is therefore a `BEFORE UPDATE` trigger,
`guard_profile_privileges()`, which compares old and new and raises SQLSTATE `42501` unless:

- nothing privileged changed (`role`, `hospital_id`, `is_active` all identical — `department_id` is
  intentionally self-editable, since it only steers which readiness form a user lands on); or
- the caller is a `super_admin`; or
- the caller is a `hospital_admin` and both the old and new `hospital_id` are their own hospital and
  the new role is not `super_admin`.

Profiles are never deleted, only deactivated, so the audit trail keeps pointing at a real person.

### 2.4 Visibility summary

| Data | Who can read it |
| --- | --- |
| Hospitals, departments, resources, blood stock, readiness updates | Every authenticated user. Ranking a referral is inherently a cross-hospital query, and readiness is the network-wide signal the product exists to publish |
| Referrals and their timelines | The requesting hospital, the receiving hospital, and `super_admin`. Nobody else, ever |
| Messages and read receipts | The two participating hospitals only, via `is_referral_participant()` |
| Notifications | The addressed user only (`user_id = auth.uid()`) |
| Profiles | Yourself, colleagues at your own hospital, and `super_admin` |
| Audit logs | `super_admin` across the network; `hospital_admin` for their own hospital's rows only |
| `referral_reference_counters` | Nobody. All privileges revoked from both client roles |

---

## 3. Password protection

- The application holds **no password material**. Verification, hashing (bcrypt) and storage are
  GoTrue's, inside Supabase's managed `auth` schema, which the `authenticated` role cannot read.
- Password inputs use `type="password"` with `autocomplete="current-password"` /
  `"new-password"`, and are never logged, never placed in a URL and never included in an audit
  payload.
- Strength is enforced by Supabase: minimum length 12 and leaked-password checking against
  HaveIBeenPwned, both configured at deployment.
- Reset is by emailed, single-use, time-limited link to a redirect URL that must be on the
  allow-list. Reset does not reveal whether an address is registered.
- `must_change_password` forces a rotation after an administrator-issued credential.
- Rate limiting on sign-in, OTP issue and password reset is applied by Supabase Auth; the client
  surfaces it as "Too many attempts. Please wait a moment and try again."

---

## 4. Encryption

| Where | Protection |
| --- | --- |
| Browser ⇄ Vercel | TLS 1.2+, certificate issued and rotated automatically by Vercel. `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload` — two years, subdomains included, eligible for the browser preload list, so a downgrade to plaintext is refused by the browser before a request is made |
| Browser ⇄ Supabase | TLS 1.2+ on the PostgREST, GoTrue and Realtime endpoints. The Supabase client has no plaintext fallback |
| Realtime websocket | `wss://` only |
| At rest — database | AES-256 on Supabase's managed storage volumes |
| At rest — backups | Encrypted at rest with the same platform-managed keys |
| At rest — browser | The session token lives in browser storage under `fern.auth`, protected by origin isolation. No patient data and no credentials are cached client-side; TanStack Query holds results in memory only, and they are gone when the tab closes |
| Secrets in transit to the build | Vercel environment variables, encrypted at rest by Vercel and injected at build time |

Application-level (column) encryption is deliberately **not** used. It would prevent the ranking
engine and every report from working in the database, and its value here is low: there is no
patient identifier to protect (section 8), and the threat it addresses — a compromised database
operator — is better covered by RLS, audit logging and platform key management.

---

## 5. Secure coding practices

| Practice | How it appears in this build |
| --- | --- |
| Strict typing | TypeScript `strict` with `noUnusedLocals` and `noUnusedParameters`. No `any` anywhere in `src/`. Database rows are narrowed to string-literal unions in `src/lib/types.ts`, so a status or a role cannot be an arbitrary string |
| Input validation | Every form is react-hook-form + a zod schema. Length, range, enum membership and required fields are checked before submit, and again by Postgres `CHECK` constraints, which is the copy that actually matters |
| No string-built SQL | All reads go through PostgREST's parameterised query builder; all writes go through RPCs whose arguments are bound parameters (`p_status text`), never interpolated. There is no place in the codebase where user text is concatenated into SQL |
| No raw HTML | `dangerouslySetInnerHTML` appears **nowhere** in the codebase. Every clinical summary, message body and hospital name is rendered as a React text child and escaped by React |
| No `eval` family | No `eval`, `new Function`, or dynamic `import()` of user-controlled paths |
| CSV formula injection | `toCsv` prefixes any cell whose first character is `=`, `+`, `-` or `@` with an apostrophe, so a hospital named `=cmd|...` cannot execute when the export is opened in Excel or Sheets. Quoting and doubling of embedded quotes follow RFC 4180 |
| Safe outbound links | `tel:` links are built by `telHref`, which strips everything but digits and a leading `+`. There are no user-controlled `http` links rendered as anchors |
| Error handling | Raw Postgres errors are never shown to users: `humanizeSupabaseError` maps SQLSTATEs (`23505`, `23503`, `23514`, `42501`, `PGRST301`) and known GoTrue messages onto plain sentences, so schema details and constraint names do not leak into the UI |
| Fail loudly on misconfiguration | The Supabase client throws at module load if `VITE_SUPABASE_URL` or `VITE_SUPABASE_ANON_KEY` is missing, rather than producing a wall of "Failed to fetch" deep in the app |
| Error boundaries | `ErrorBoundary` wraps the app so a render fault shows a recovery screen rather than a blank page |
| Dependency surface | 14 runtime dependencies, all mainstream and actively maintained. No dependency is added without a reason recorded in review |
| Source maps | Disabled in the production build (`sourcemap: false`), so internal module structure is not published |

### Security headers (`vercel.json`)

| Header | Value | Purpose |
| --- | --- | --- |
| `X-Content-Type-Options` | `nosniff` | Stops MIME-type confusion attacks |
| `X-Frame-Options` | `DENY` | The app cannot be framed, so it cannot be clickjacked |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Referral IDs in a path are never leaked to a third-party origin |
| `Permissions-Policy` | `geolocation=(self), camera=(), microphone=(), payment=()` | Removes powerful APIs the app does not use |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload` | Enforces HTTPS |
| `Cross-Origin-Opener-Policy` | `same-origin` | Isolates the browsing context from cross-origin openers |
| `Cache-Control` on `/assets/*` | `public, max-age=31536000, immutable` | Safe because asset filenames are content-hashed; `index.html` is never cached |
| `Content-Security-Policy` | see below | Confines what the page may load or connect to |

### The Content-Security-Policy

```
default-src 'self'; script-src 'self';
connect-src 'self' https://*.supabase.co wss://*.supabase.co;
style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
font-src 'self' https://fonts.gstatic.com;
img-src 'self' data: blob:;
frame-ancestors 'none'; base-uri 'none'; object-src 'none'; form-action 'self'
```

Two clauses deserve justification:

- **`script-src 'self'`** carries the real weight. No inline script, no `eval`, no third-party
  origin can execute. Combined with the XSS review in section 4, this is the clause that would
  contain an injection if one were ever introduced.
- **`'unsafe-inline'` appears in `style-src` only, never `script-src`.** React sets inline
  `style` attributes and Google Fonts serves an inline-styled stylesheet, so a strict `style-src`
  would break the UI. Inline *styles* cannot execute code; the risk they carry is limited to
  presentational defacement, which is a materially different exposure from inline scripts.
- **`connect-src`** is deliberately narrowed to the Supabase origins, including `wss:` for the
  realtime messaging channel. A script that somehow did execute could not exfiltrate to an
  arbitrary host.

`frame-ancestors 'none'` duplicates `X-Frame-Options: DENY` on purpose: the former is the modern
directive, the latter is honoured by older browsers.

Note that `vercel.json` is JSON and therefore cannot carry comments — an explanatory `comment` key
inside a header object is rejected by Vercel's schema at import time. This section is where that
reasoning lives.

---

## 6. Backups

Detail and exact commands are in [DEPLOYMENT.md](DEPLOYMENT.md); the security-relevant summary:

| Aspect | Position |
| --- | --- |
| Scope | The whole Postgres database, including the `auth` schema that holds user accounts |
| Mechanism | Supabase automated daily backups on all paid plans, plus **point-in-time recovery** on Pro and above |
| RPO / RTO | ≤ 2 minutes / ≤ 1 hour with PITR enabled |
| Retention | Set to at least 14 days |
| Encryption | Backups are encrypted at rest by the platform |
| Off-platform copy | A weekly `pg_dump --no-owner --no-privileges` to client-controlled storage, so recovery is possible even if the Supabase account itself is lost. That dump contains the full database and must be stored encrypted, with access limited to the client's administrators |
| Restore rights | Restoring requires Supabase project ownership — a right the client holds, not the developer |
| Testing | Restore into a scratch project is drilled before go-live (acceptance test AT-56) and at least six-monthly thereafter. A backup that has never been restored is a hypothesis |

---

## 7. Vulnerability management

| Control | Cadence |
| --- | --- |
| `npm audit --audit-level=high` | Every push and pull request, in the CI `audit` job. It is advisory (`continue-on-error`) so a new moderate advisory cannot block an emergency clinical fix from shipping — but it is always visible in the run |
| Dependabot — npm | Weekly. Minor and patch bumps are grouped into one reviewable PR; majors stay separate so a breaking change is never hidden inside a routine update. Limit of 5 open PRs |
| Dependabot — GitHub Actions | Monthly |
| Typecheck, unit tests, production build | Every push and pull request. A dependency bump that breaks the build cannot merge |
| Platform patching | Postgres, PostgREST, GoTrue and the Vercel edge runtime are patched by the platform vendors. The client should keep the Supabase project on a supported Postgres major and apply offered upgrades within one maintenance window |
| Response targets | Critical advisory with a known exploit: patch within 48 hours. High: within 7 days. Moderate and low: the next routine Dependabot batch |
| Ownership | After handover, the client (or their maintainer) owns the merge decision. Dependabot and CI keep running whether or not anyone is looking, so the backlog is always visible |

---

## 8. Data minimisation and PHI

**The design position: FERN stores no patient identifiers.** This is the single largest reduction in
risk in the system, because data that was never collected cannot be breached.

A referral carries exactly four patient-related fields:

| Field | Content | Why it is not identifying |
| --- | --- | --- |
| `patient_ref` | A generated code such as `PT-7K3QF2`, from `generatePatientRef()` | Random. It is a label for this referral, not a key into any medical record, and it is not derived from anything about the patient |
| `patient_age_band` | One of six bands (neonate, infant, child, adolescent, adult, older adult) | A band, never a date of birth or an exact age |
| `patient_sex` | female / male / other / undisclosed | Clinically necessary for triage; not identifying on its own |
| `clinical_summary` | Free text, capped at 1000 characters | Intended to be a presentation and stability summary — see below |

There is no `name`, `date_of_birth`, `national_id`, `hospital_number`, `address` or `next_of_kin`
column anywhere in the schema, and there is no column into which one could be smuggled. **New
patient-identifier fields must never be added.** The `referrals` table carries a comment saying so,
and this constraint is what makes HIS/EMR integration out of scope (SPECIFICATION.md section 8) —
there is no identifier with which to correlate records.

### The one exposure: the clinical summary

`clinical_summary` is free text, so a coordinator in a hurry *could* type "Mr Kofi Mensah, DOB
14/03/1978, folder 88213, RTA with open femur fracture". The system cannot prevent a human from
typing a name into a text box. What it does instead:

| Mitigation | Detail |
| --- | --- |
| Instruction at the point of entry | The field's label and hint state plainly: describe the presentation and stability, **no names, dates of birth or record numbers** |
| A hard 1000-character cap | Enforced in zod and again by a Postgres `CHECK`. A short field invites a summary, not a copied chart |
| Structured fields carry the load | Because age band, sex, urgency, emergency type and required resources are all captured as structured data, the summary does not need to carry identity to be useful |
| Narrow readership | RLS limits the summary to the two hospitals on the referral and `super_admin`. It is not network-visible, not in any report, and not in any CSV export |
| Never rendered as HTML | It is escaped by React on every surface, including the printable form |
| Audit trail | Who created the referral and every subsequent access-granting transition is recorded in `referral_events` and `audit_logs` |
| Correctable | If PHI is pasted in error, a `super_admin` can redact the field directly in the database; the referral, its timeline and its analytics are unaffected because none of them depend on the summary's contents |

**Residual risk, stated plainly.** Free-text PHI entered by a user remains possible. The
countermeasures above reduce likelihood and blast radius; they do not eliminate it. Two things
close the gap further and are recommended to the client: a line in staff induction, and — if a
regulator requires it — a post-go-live enhancement that pattern-matches the summary for probable
names, dates and long digit strings at submit time and asks the user to confirm.

### Other minimisation choices

- Staff contact details are limited to a name, work email and work phone.
- Analytics functions return aggregates, never patient-level rows.
- CSV exports contain hospital and department aggregates, never clinical summaries.
- No third-party analytics, advertising, session-replay or error-reporting SDK is loaded. Nothing
  about a user's behaviour leaves the Supabase and Vercel boundary.
- No cookies are set beyond what Supabase Auth requires for the session.

---

## 9. Logging and monitoring

### What is recorded

`audit_logs` is append-only. There is a `SELECT` policy and no `INSERT`, `UPDATE` or `DELETE` policy
at all — the only writer is `log_audit_event()`, a `SECURITY DEFINER` function. Each row holds the
actor's id, email and role captured at the time, their hospital, the action, the entity type and id,
a JSON detail object and a timestamp. Actor email and role are denormalised deliberately: an audit
row must still make sense after a person changes role or leaves.

| Category | Actions recorded |
| --- | --- |
| Authentication | `auth.login`, `auth.logout`, `auth.failed_login` |
| Readiness | `readiness.submit` |
| Referrals | `referral.create`, `referral.accept`, `referral.decline`, `referral.in_transit`, `referral.complete`, `referral.cancel` |
| Messaging | `message.send` |
| Administration | `hospital.create`, `hospital.update`, `department.create`, `department.update`, `user.invite`, `user.update_role`, `user.deactivate`, `config.update` |
| Reporting | `report.export` |

The `action` column is deliberately unconstrained by a `CHECK`: the catalogue in `constants.ts` will
grow, and an audit row must never be the thing that fails a clinical transaction.

**Never logged:** passwords, tokens, session identifiers, or the clinical summary text.

In addition, `referral_events` is a per-referral immutable timeline (who, when, from status, to
status, notes) that a coordinator can read in the UI without holding `audit:view`.

### Who can read the log

`super_admin` sees the network; `hospital_admin` sees rows scoped to their own hospital. Nobody can
edit or delete a row through the API, and the Admin area's audit viewer supports filtering by
action, actor and date range.

### Platform monitoring

| Signal | Where |
| --- | --- |
| Auth events, rate limiting, failed sign-ins | Supabase dashboard → Logs → Auth |
| API request logs, error rates, slow queries | Supabase dashboard → Logs → API / Postgres |
| Database size, connections, CPU | Supabase dashboard → Reports |
| Deployment and edge request logs | Vercel dashboard |
| CI failures and dependency advisories | GitHub Actions and Dependabot |

Supabase log retention depends on plan (1 day on Free, 7 days on Pro, longer above). `audit_logs`,
by contrast, lives in the database and is retained under the client's own policy — see
[DATA_MODEL.md](DATA_MODEL.md) for the recommended retention windows. The two are complementary:
the platform logs tell you about the transport, `audit_logs` tells you what a person did.

### Recommended alerting

Not configured by default; each is a dashboard setting the client can enable at go-live:
a Supabase alert on sustained failed-login spikes, an alert on database size approaching the plan
limit, and a weekly review of `readiness_overdue` notification volume as an operational health
signal.

---

## 10. Secure credential handling

| Credential | Where it lives | Who has it |
| --- | --- | --- |
| Supabase **anon** key | `VITE_SUPABASE_ANON_KEY`, compiled into the browser bundle | Everyone. This is by design — it is a publishable key that identifies the project, not a secret. It grants exactly the `anon`/`authenticated` role, which RLS constrains to nothing a user should not see. Its exposure is not a finding |
| Supabase **service-role** key | Nowhere in this repository | Client administrators only, in the Supabase dashboard. It bypasses RLS entirely. It must **never** be given a `VITE_` prefix (that would publish it to every visitor), never committed, and never used by the browser. FERN's client code has no code path that would accept one |
| Database password | Supabase dashboard | Client administrators, for `psql`, `pg_dump` and restores |
| Vercel environment variables | Vercel project settings, encrypted at rest | Client administrators |
| `.env` | Developer machines only | `.gitignore` excludes `.env` and `.env.*`; only `.env.example`, which contains placeholders, is committed |

Rules that hold across the build:

- No secret appears in the repository, in CI logs, or in an error message. The CI workflow builds
  with obvious placeholder values (`https://placeholder.supabase.co`) precisely so that no real
  credential is needed to verify a pull request.
- `VITE_*` variables are **inlined at build time**. Rotating one requires a redeploy, not a restart.
  This is documented in the README and in DEPLOYMENT.md so it is not discovered during an incident.
- Rotation procedure: rotate in the Supabase dashboard, update the Vercel environment variable,
  redeploy, verify sign-in, then revoke the old key. Anon-key rotation invalidates existing sessions
  and should be scheduled off-peak.
- If the service-role key is ever suspected of exposure, rotate it immediately and review
  `audit_logs` alongside the Supabase API logs for the affected window.

---

## 11. Protection against unauthorised access

Layered, so that no single failure is sufficient:

1. **Network.** HTTPS only, HSTS with preload, security headers on every response, no plaintext
   endpoint to downgrade to.
2. **Identity.** No public signup, and privilege is never read from client-writable user metadata,
   so the dashboard toggle is defence in depth rather than the only barrier. Accounts exist by
   administrator invitation through the Admin API. PKCE, rate limiting, leaked-password blocking,
   minimum length 12.
3. **Session.** Short-lived JWTs with automatic refresh, dedicated storage key, immediate sign-out
   on deactivation, race-guarded profile loading.
4. **Route.** `RequireAuth` and `RequireCapability` keep a signed-out or under-privileged user off a
   page — a convenience, not a control.
5. **Row.** RLS on every table, hospital scoping on every scoped policy, `security_invoker` on the
   `department_readiness` view so a hospital cannot read a colleague's name out of another facility
   through it, and all privileges revoked from the internal counter table.
6. **Verb.** Grants are issued explicitly per table after a blanket revoke; `referrals`,
   `referral_events` and `audit_logs` carry `SELECT` only for clients. The `DELETE` verb is granted
   on almost nothing.
7. **Operation.** Writes that carry invariants are only reachable through `SECURITY DEFINER` RPCs
   that re-check capability and scope before doing anything.
8. **Escalation.** A trigger prevents self-promotion; a `hospital_admin` cannot mint a `super_admin`
   or move a user to another hospital.
9. **Evidence.** Every consequential action is recorded in an append-only audit log that no client
   role can modify.

---

## 12. Threat model

| # | Threat | Mitigation in this build | Residual risk |
| --- | --- | --- | --- |
| T1 | Attacker with the public anon key reads other hospitals' referrals | RLS on `referrals` requires the caller's hospital to be a party; the anon key grants only the `authenticated` role after a real sign-in | None material, provided RLS is never disabled. Acceptance test AT-45 verifies this directly against the API |
| T2 | Authenticated user at Hospital A enumerates Hospital B's referrals through the API | Same policy; there is no query shape that returns another hospital's rows | Low. A `super_admin` can see everything — that account set must be kept small and, ideally, MFA-protected |
| T3 | User edits their own role to `super_admin` | `guard_profile_privileges` trigger rejects the update with SQLSTATE `42501` | None via the API. A holder of the service-role key can do anything; see T9 |
| T4 | Client bypasses the referral state machine by PATCHing the row | No INSERT/UPDATE policy and no grant on `referrals`; `update_referral_status()` is the only writer and validates every transition | None via the API |
| T5 | Credential stuffing / brute force | Supabase rate limiting, leaked-password blocking, 12-character minimum, failed logins recorded | Moderate. **MFA is not enabled in this release** — the strongest remaining control and the top recommendation |
| T6 | Stolen session token from a shared ward terminal | Short-lived JWTs, dedicated storage key, explicit sign-out, deactivation takes effect immediately | Moderate. A shared, unlocked terminal is an operational control the software cannot supply. Recommend device auto-lock and OTP sign-in on shared machines |
| T7 | XSS through a hospital name, chat message or clinical summary | React escapes all output; `dangerouslySetInnerHTML` is absent; no `eval`; no user-controlled URLs rendered as anchors | Low. Would be lower still with a CSP (section 5) |
| T8 | SQL injection | No dynamic SQL anywhere; PostgREST parameterisation and bound RPC arguments; `search_path` pinned on every `SECURITY DEFINER` function | Very low |
| T9 | Service-role key leaks | Never present in the repository, the bundle or CI; documented as dashboard-only | Depends entirely on client key hygiene. This is the highest-impact single credential in the system |
| T10 | CSV export weaponised as a spreadsheet formula | `toCsv` prefixes `= + - @` with an apostrophe | Very low |
| T11 | Clickjacking / framing | `X-Frame-Options: DENY`, `Cross-Origin-Opener-Policy: same-origin` | Very low |
| T12 | PHI entered into the clinical summary | No identifier fields exist; explicit instruction, 1000-character cap, narrow readership, redaction path (section 8) | Moderate and human-driven. Reduced by induction; a submit-time pattern check is the recommended enhancement |
| T13 | Referrals sent to a hospital that cannot receive them because its data is stale | Staleness penalty, red/yellow marking on every candidate card, automatic overdue alerts, optional hard exclusion of red hospitals | Moderate. FERN measures data freshness, not truth: a hospital can file a green update that is wrong. Compliance reporting makes chronic offenders visible |
| T14 | Denial of service against the public origin | Vercel edge protection and Supabase per-project rate limits | Low for a private-audience application; no additional WAF is provisioned |
| T15 | Data loss from operator error or a bad migration | PITR to a two-minute RPO, daily backups, off-platform weekly dump, documented restore and rollback | Low, conditional on the restore drill actually being run |
| T16 | Malicious or compromised npm dependency | 14 runtime dependencies; `npm audit` in CI; Dependabot; pinned lockfile; CI build required before merge | Moderate — an industry-wide risk no small project fully removes |
| T17 | A departed staff member retains access | Deactivation is immediate and total: `current_user_role()` and `current_user_hospital()` filter on `is_active`, so a live JWT resolves to no role and every scoped policy fails closed | Low, conditional on the client's offboarding process actually deactivating accounts |

---

## 13. Recommended hardening after go-live

In priority order, and none of these is required for the contracted scope:

1. Enable **MFA** in Supabase Auth for `super_admin` and `hospital_admin` accounts (closes T5).
2. Tighten `style-src` by removing `'unsafe-inline'`, which needs either self-hosted fonts or a
   nonce/hash strategy for React's inline style attributes (further reduces T7).
3. Configure a **dedicated SMTP provider** for auth email, replacing the rate-limited default sender.
4. Turn on **Supabase alerting** for failed-login spikes and database growth.
5. Add a **submit-time PHI pattern check** on the clinical summary if a regulator requires it
   (reduces T12).
6. Schedule the **six-monthly restore drill** and the **quarterly access review** (who holds
   `super_admin`, who is still active) as recurring calendar items with a named owner.
