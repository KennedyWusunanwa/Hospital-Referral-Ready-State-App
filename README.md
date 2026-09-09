# FERN — Hospital Emergency Readiness & Inter-Hospital Referral System

FERN ("Referral Ready State") is a web application for a network of hospitals that need to move
emergency patients between facilities quickly and defensibly.

It does two jobs that normally happen over the phone, badly:

1. **It keeps every facility's emergency readiness current.** Each department's shift in-charge
   files one readiness update per eight-hour shift — theatres, ICU/NICU cots, ventilators, oxygen,
   blood bank, imaging, ambulances. A traffic light shows at a glance whether that picture can be
   trusted: **green** = filed for the current shift, **yellow** = one or two shifts late,
   **red** = three or more shifts late (or never filed). Departments that fall behind raise an
   alert to their hospital administrator automatically.
2. **It ranks where a patient should go.** A referring coordinator enters the emergency type,
   urgency and a short clinical summary. FERN scores every hospital within the search radius on
   the resources that emergency actually needs plus travel time, deducts a penalty from facilities
   whose readiness data is stale, and returns a ranked list with a percentage score and a full
   per-resource breakdown of how that score was reached. The coordinator picks one, the receiving
   hospital accepts or declines, the two sites chat in real time, and the whole exchange is logged.

**No patient identifiers are ever stored.** A referral carries a generated reference code, an age
band, sex and a short clinical summary — no name, no date of birth, no national ID, no record
number. See [docs/SECURITY.md](docs/SECURITY.md).

---

## Features

| Area | What it does |
| --- | --- |
| Shift readiness | Per-department, per-shift submission form driven by department templates; green/yellow/red roll-up per department and per hospital; history and compliance tracking |
| Resource picture | 22 tracked resources across critical care, surgical, diagnostics, supplies and logistics; per-blood-group stock; hospital-wide ER open / on-diversion flag |
| Referral decision | Configurable emergency-type catalogue with weighted per-resource requirements; ranking = 70% resource fit + 30% proximity, minus a staleness penalty; critical-requirement and diversion exclusion gates; historical acceptance rate as tie-break |
| Confirmation | Contact details and one-tap call links for the chosen hospital; printable A4 referral request form; accept / decline / in-transit / complete / cancel workflow with an immutable timeline |
| Communication | Per-referral real-time chat between the two hospitals (Supabase Realtime), open only while the case is live |
| Alerts | In-app notification centre with unread badge; automatic overdue-readiness alerts to hospital administrators |
| Reports | Referral volume and outcomes, acceptance rate, average and median response time, per-hospital performance, per-department readiness compliance; CSV export |
| Administration | Hospitals, departments, staff and roles, scoring configuration, audit log viewer |
| Security | Supabase Auth with PKCE, five roles, a capability matrix in the UI and Postgres row-level security as the real boundary, append-only audit trail |

Explicitly **not** in this release: push/SMS notifications, biometric login, offline mode and
HIS/EMR integration. See [SPECIFICATION.md](docs/SPECIFICATION.md) section 8.

---

## Stack

| Layer | Choice |
| --- | --- |
| Build | Vite 6, TypeScript 5.7 (strict, `noUnusedLocals`, `noUnusedParameters`) |
| UI | React 18, React Router 6, Tailwind CSS 3, lucide-react, sonner, recharts |
| Data | TanStack Query v5 over `@supabase/supabase-js` v2 |
| Forms | react-hook-form + zod via `@hookform/resolvers` |
| Backend | Supabase — Postgres, GoTrue auth, PostgREST, Realtime, row-level security |
| Tests | Vitest (unit tests over `src/domain/**`) |
| Hosting | Vercel (static SPA) + Supabase (managed Postgres) |

There is no custom server. Every write that matters goes through a `SECURITY DEFINER` Postgres
function so that the state machine, the notifications and the audit trail cannot be skipped by a
client that talks to PostgREST directly.

---

## Quickstart

Requires **Node 20+** and a Supabase project (the free tier is enough for a pilot).

```bash
git clone <your-repo-url> fern
cd fern
npm install

cp .env.example .env
# edit .env: VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY come from
# Supabase dashboard -> Project Settings -> API
```

Apply the database migrations, in filename order, from `supabase/migrations/`. Either paste each
file into the Supabase SQL editor and run it, or use the CLI:

```bash
npx supabase link --project-ref <your-project-ref>
npx supabase db push
```

Then create your first user (Supabase dashboard → Authentication → Add user), promote them to
`super_admin` in the SQL editor, and start the dev server:

```sql
update public.profiles
set role = 'super_admin', full_name = 'Your Name', is_active = true
where email = 'you@example.org';
```

```bash
npm run dev     # http://localhost:5173
```

Full, followable instructions — auth configuration, seeding, the scheduled job, Vercel, backups
and rollback — are in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

### Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | yes | Supabase project API URL |
| `VITE_SUPABASE_ANON_KEY` | yes | Publishable anon key. Safe in the browser; RLS is what protects the data |
| `VITE_APP_NAME` | no | Product name shown in the UI (default `FERN`) |
| `VITE_DEFAULT_TIMEZONE` | no | IANA zone used when a hospital has none (default `Africa/Accra`) |
| `VITE_SUPPORT_EMAIL` | no | Address shown on error and access-denied screens |

`VITE_*` variables are inlined into the bundle **at build time**. Changing one in Vercel requires a
redeploy, not just a restart. The service-role key must never be added here.

---

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Vite dev server on port 5173 with HMR |
| `npm run build` | `tsc -b` then a production build into `dist/` |
| `npm run preview` | Serve the built `dist/` locally |
| `npm run typecheck` | Type-check the whole project without emitting |
| `npm run test` | Run the Vitest suite once |
| `npm run test:watch` | Vitest in watch mode |
| `npm run test:coverage` | Vitest with v8 coverage over `src/domain/**` |
| `npm run db:types` | Regenerate `src/lib/database.types.ts` from the linked Supabase project |

---

## Directory layout

```
├── docs/                     Specification, security, deployment, tests, API, data model
├── public/                   Static assets served as-is
├── supabase/
│   └── migrations/           Ordered SQL migrations — schema, RLS, functions, seed data
├── tests/                    Vitest unit tests over the pure domain modules
└── src/
    ├── App.tsx               Route table (all pages lazy-loaded)
    ├── main.tsx              React root, QueryClient, AuthProvider, Toaster
    ├── index.css             Tailwind layers and design tokens
    ├── auth/                 AuthProvider (session + profile), RequireAuth / RequireCapability
    ├── components/
    │   ├── layout/           AppLayout shell, ErrorBoundary
    │   └── ui/               The whole design system in one module
    ├── domain/               Pure, dependency-free logic — the parts worth unit-testing
    │   ├── geo.ts            Haversine distance, road factor, ETA, proximity sub-score
    │   ├── shifts.ts         Timezone-aware shift arithmetic
    │   ├── readiness.ts      Green / yellow / red derivation and hospital roll-up
    │   └── scoring.ts        The ranking engine and its audit snapshots
    ├── features/
    │   ├── admin/            Hospitals, departments, staff, scoring config, audit log
    │   ├── auth/             Login and password reset screens
    │   ├── dashboard/        Landing dashboard
    │   ├── hospitals/        Directory, detail, resource and blood-stock panels
    │   ├── messaging/        Per-referral chat thread and its realtime subscription
    │   ├── notifications/    Notification centre and unread badge
    │   ├── readiness/        Readiness board and the shift submission form
    │   ├── referrals/        New referral wizard, candidate ranking, detail, print form
    │   └── reports/          Analytics, performance and compliance reporting
    └── lib/                  constants, database.types, types, supabase client, queryKeys, utils
```

Each feature folder owns a `use<Feature>.ts` module holding every TanStack Query hook for that
area. Components never call `supabase` directly except for one-line audit writes.

---

## Documentation

| Document | Contents |
| --- | --- |
| [docs/SPECIFICATION.md](docs/SPECIFICATION.md) | The 14 contract points: features, roles, workflows, the scoring formula with a worked example, database, security, reporting, integrations, web/mobile, hosting, backups, acceptance tests, performance, delivery |
| [docs/SECURITY.md](docs/SECURITY.md) | Authentication, access control and RLS, encryption, secure coding, backups, vulnerability management, logging, credential handling, threat model, PHI and data minimisation |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Supabase project setup, migrations, auth configuration, first admin, seeding, Vercel, custom domain, the scheduled overdue-readiness job, backup/restore, rollback, smoke tests |
| [docs/ACCEPTANCE_TESTS.md](docs/ACCEPTANCE_TESTS.md) | 64 numbered manual test cases with a client sign-off block |
| [docs/API.md](docs/API.md) | Every RPC — arguments, returns, callers, errors, examples — plus the PostgREST endpoints and realtime channels the client uses |
| [docs/DATA_MODEL.md](docs/DATA_MODEL.md) | Every table column by column, the ER diagram, indexes and why each exists, enumerations, retention guidance |

---

## Licence and support

Delivered to the client under the terms of the FERN engagement contract. Operational questions go
to the address configured in `VITE_SUPPORT_EMAIL`.
