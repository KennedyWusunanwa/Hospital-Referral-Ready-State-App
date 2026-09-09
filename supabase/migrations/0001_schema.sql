-- =============================================================================
-- FERN -- 0001_schema.sql
-- Tables, constraints, indexes, the department_readiness view and the
-- housekeeping triggers.
--
-- This file is the authority behind src/lib/database.types.ts. Every column
-- name, order and nullability below matches a Row type in that file; the text
-- CHECK constraints match the literal unions in src/lib/constants.ts.
-- =============================================================================

create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- Shared trigger helpers
-- -----------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- hospitals
-- -----------------------------------------------------------------------------

create table if not exists public.hospitals (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) > 0),
  code text not null unique check (length(btrim(code)) > 0),
  level text not null default 'district'
    check (level in ('health_centre', 'primary', 'district', 'secondary', 'tertiary', 'specialist')),
  address text,
  city text,
  region text,
  country text not null default 'Ghana',
  latitude numeric(9, 6) not null check (latitude between -90 and 90),
  longitude numeric(9, 6) not null check (longitude between -180 and 180),
  phone text,
  emergency_phone text,
  email text,
  timezone text not null default 'Africa/Accra',
  is_active boolean not null default true,
  accepts_referrals boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists hospitals_set_updated_at on public.hospitals;
create trigger hospitals_set_updated_at
before update on public.hospitals
for each row execute function public.set_updated_at();

create index if not exists hospitals_is_active_idx on public.hospitals (is_active);
create index if not exists hospitals_region_idx on public.hospitals (region);
-- Candidate search filters on a bounding box before the haversine expression
-- runs, so a plain composite btree on the coordinate pair earns its keep
-- without pulling in PostGIS.
create index if not exists hospitals_lat_lng_idx on public.hospitals (latitude, longitude);

-- -----------------------------------------------------------------------------
-- departments
-- -----------------------------------------------------------------------------

create table if not exists public.departments (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null references public.hospitals (id) on delete cascade,
  name text not null check (length(btrim(name)) > 0),
  template_key text not null check (
    template_key in (
      'emergency', 'theatre', 'icu', 'nicu', 'maternity', 'surgery',
      'radiology', 'blood_bank', 'renal', 'cardiology', 'burns', 'general'
    )
  ),
  contact_phone text,
  requires_shift_update boolean not null default true,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (hospital_id, name)
);

drop trigger if exists departments_set_updated_at on public.departments;
create trigger departments_set_updated_at
before update on public.departments
for each row execute function public.set_updated_at();

create index if not exists departments_hospital_id_idx on public.departments (hospital_id);
create index if not exists departments_template_key_idx on public.departments (template_key);

-- -----------------------------------------------------------------------------
-- profiles -- one row per auth.users row
-- -----------------------------------------------------------------------------

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '',
  email text not null default '',
  phone text,
  role text not null default 'viewer' check (
    role in ('super_admin', 'hospital_admin', 'shift_in_charge', 'referral_coordinator', 'viewer')
  ),
  hospital_id uuid references public.hospitals (id) on delete set null,
  department_id uuid references public.departments (id) on delete set null,
  is_active boolean not null default true,
  must_change_password boolean not null default false,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create index if not exists profiles_hospital_id_idx on public.profiles (hospital_id);
create index if not exists profiles_department_id_idx on public.profiles (department_id);
create index if not exists profiles_role_idx on public.profiles (role);

-- -----------------------------------------------------------------------------
-- hospital_resources -- one live snapshot per hospital
-- -----------------------------------------------------------------------------

create table if not exists public.hospital_resources (
  hospital_id uuid primary key references public.hospitals (id) on delete cascade,
  er_open boolean not null default true,
  diversion_reason text,
  operating_rooms_total integer not null default 0 check (operating_rooms_total >= 0),
  operating_rooms_functional integer not null default 0 check (operating_rooms_functional >= 0),
  resident_surgeon_available boolean not null default false,
  anesthetist_available boolean not null default false,
  obstetric_theatre_available boolean not null default false,
  neurosurgery_available boolean not null default false,
  cath_lab_available boolean not null default false,
  icu_beds_total integer not null default 0 check (icu_beds_total >= 0),
  icu_beds_available integer not null default 0 check (icu_beds_available >= 0),
  nicu_beds_total integer not null default 0 check (nicu_beds_total >= 0),
  nicu_beds_available integer not null default 0 check (nicu_beds_available >= 0),
  neonatal_resuscitation_available boolean not null default false,
  ventilators_total integer not null default 0 check (ventilators_total >= 0),
  ventilators_available integer not null default 0 check (ventilators_available >= 0),
  oxygen_supply_percent numeric(5, 2) not null default 0
    check (oxygen_supply_percent between 0 and 100),
  isolation_beds_available integer not null default 0 check (isolation_beds_available >= 0),
  general_beds_total integer not null default 0 check (general_beds_total >= 0),
  general_beds_available integer not null default 0 check (general_beds_available >= 0),
  burn_unit_available boolean not null default false,
  dialysis_available boolean not null default false,
  blood_bank_functional boolean not null default false,
  ct_functional boolean not null default false,
  mri_functional boolean not null default false,
  xray_functional boolean not null default false,
  ultrasound_functional boolean not null default false,
  ambulances_available integer not null default 0 check (ambulances_available >= 0),
  power_backup_available boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null,
  constraint hospital_resources_or_within_capacity
    check (operating_rooms_functional <= operating_rooms_total),
  constraint hospital_resources_icu_within_capacity
    check (icu_beds_available <= icu_beds_total),
  constraint hospital_resources_nicu_within_capacity
    check (nicu_beds_available <= nicu_beds_total),
  constraint hospital_resources_vent_within_capacity
    check (ventilators_available <= ventilators_total),
  constraint hospital_resources_beds_within_capacity
    check (general_beds_available <= general_beds_total)
);

drop trigger if exists hospital_resources_set_updated_at on public.hospital_resources;
create trigger hospital_resources_set_updated_at
before update on public.hospital_resources
for each row execute function public.set_updated_at();

create index if not exists hospital_resources_updated_by_idx on public.hospital_resources (updated_by);

-- -----------------------------------------------------------------------------
-- blood_stock
-- -----------------------------------------------------------------------------

create table if not exists public.blood_stock (
  hospital_id uuid not null references public.hospitals (id) on delete cascade,
  blood_group text not null check (blood_group in ('O-', 'O+', 'A-', 'A+', 'B-', 'B+', 'AB-', 'AB+')),
  units integer not null default 0 check (units >= 0),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null,
  primary key (hospital_id, blood_group)
);

drop trigger if exists blood_stock_set_updated_at on public.blood_stock;
create trigger blood_stock_set_updated_at
before update on public.blood_stock
for each row execute function public.set_updated_at();

create index if not exists blood_stock_updated_by_idx on public.blood_stock (updated_by);

-- -----------------------------------------------------------------------------
-- readiness_updates -- one row per department per shift
-- -----------------------------------------------------------------------------

create table if not exists public.readiness_updates (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null references public.hospitals (id) on delete cascade,
  department_id uuid not null references public.departments (id) on delete cascade,
  shift_date date not null,
  shift_type text not null check (shift_type in ('morning', 'afternoon', 'night')),
  submitted_by uuid references public.profiles (id) on delete set null,
  submitted_at timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb,
  notes text,
  unique (department_id, shift_date, shift_type)
);

create index if not exists readiness_updates_hospital_id_idx on public.readiness_updates (hospital_id);
create index if not exists readiness_updates_department_shift_idx
  on public.readiness_updates (department_id, shift_date desc);
create index if not exists readiness_updates_submitted_by_idx on public.readiness_updates (submitted_by);
create index if not exists readiness_updates_submitted_at_idx on public.readiness_updates (submitted_at desc);

-- -----------------------------------------------------------------------------
-- emergency catalogue
-- -----------------------------------------------------------------------------

create table if not exists public.emergency_types (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (length(btrim(code)) > 0),
  name text not null,
  category text not null,
  description text,
  default_urgency text not null default 'urgent'
    check (default_urgency in ('critical', 'urgent', 'routine')),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists emergency_types_sort_order_idx on public.emergency_types (sort_order, name);

create table if not exists public.emergency_requirements (
  id uuid primary key default gen_random_uuid(),
  emergency_type_id uuid not null references public.emergency_types (id) on delete cascade,
  resource_key text not null check (
    resource_key in (
      'operating_room', 'resident_surgeon', 'anesthetist', 'obstetric_theatre', 'neurosurgery',
      'cath_lab', 'icu_bed', 'nicu_bed', 'neonatal_resuscitation', 'ventilator', 'oxygen',
      'isolation_bed', 'general_bed', 'burn_unit', 'dialysis', 'blood_bank', 'ct_scan', 'mri',
      'xray', 'ultrasound', 'ambulance', 'power_backup'
    )
  ),
  weight integer not null default 1 check (weight between 0 and 10),
  is_critical boolean not null default false,
  min_quantity integer not null default 0 check (min_quantity >= 0),
  unique (emergency_type_id, resource_key)
);

create index if not exists emergency_requirements_type_idx
  on public.emergency_requirements (emergency_type_id);

-- -----------------------------------------------------------------------------
-- referrals
-- -----------------------------------------------------------------------------

create table if not exists public.referrals (
  id uuid primary key default gen_random_uuid(),
  reference_number text not null unique,
  requesting_hospital_id uuid not null references public.hospitals (id) on delete restrict,
  receiving_hospital_id uuid references public.hospitals (id) on delete set null,
  emergency_type_id uuid not null references public.emergency_types (id) on delete restrict,
  urgency text not null default 'urgent' check (urgency in ('critical', 'urgent', 'routine')),
  status text not null default 'pending' check (
    status in ('pending', 'accepted', 'declined', 'in_transit', 'completed', 'cancelled', 'expired')
  ),
  -- Privacy: patient_ref is a generated code. No name, DOB or national ID is
  -- ever stored -- see docs/SPECIFICATION.md section 9.
  patient_ref text not null check (length(btrim(patient_ref)) > 0),
  patient_age_band text not null check (
    patient_age_band in ('neonate', 'infant', 'child', 'adolescent', 'adult', 'older_adult')
  ),
  patient_sex text not null default 'undisclosed'
    check (patient_sex in ('female', 'male', 'other', 'undisclosed')),
  clinical_summary text not null check (length(clinical_summary) <= 1000),
  required_resources text[] not null default '{}'::text[] check (
    required_resources <@ array[
      'operating_room', 'resident_surgeon', 'anesthetist', 'obstetric_theatre', 'neurosurgery',
      'cath_lab', 'icu_bed', 'nicu_bed', 'neonatal_resuscitation', 'ventilator', 'oxygen',
      'isolation_bed', 'general_bed', 'burn_unit', 'dialysis', 'blood_bank', 'ct_scan', 'mri',
      'xray', 'ultrasound', 'ambulance', 'power_backup'
    ]::text[]
  ),
  score_snapshot jsonb not null default '{}'::jsonb,
  candidate_snapshot jsonb not null default '{}'::jsonb,
  distance_km numeric(8, 2),
  eta_minutes numeric(8, 2),
  requested_by uuid references public.profiles (id) on delete set null,
  requested_at timestamptz not null default now(),
  responded_by uuid references public.profiles (id) on delete set null,
  responded_at timestamptz,
  response_seconds integer check (response_seconds >= 0),
  accepted_at timestamptz,
  in_transit_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  decline_reason text,
  outcome text check (
    outcome in (
      'transferred', 'stabilised_on_site', 'referred_elsewhere',
      'died_before_transfer', 'declined_by_patient', 'other'
    )
  ),
  outcome_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint referrals_not_self
    check (receiving_hospital_id is null or receiving_hospital_id <> requesting_hospital_id)
);

drop trigger if exists referrals_set_updated_at on public.referrals;
create trigger referrals_set_updated_at
before update on public.referrals
for each row execute function public.set_updated_at();

create index if not exists referrals_receiving_status_idx
  on public.referrals (receiving_hospital_id, status);
create index if not exists referrals_requesting_status_idx
  on public.referrals (requesting_hospital_id, status);
create index if not exists referrals_requested_at_idx on public.referrals (requested_at desc);
create index if not exists referrals_emergency_type_idx on public.referrals (emergency_type_id);
create index if not exists referrals_requested_by_idx on public.referrals (requested_by);
create index if not exists referrals_responded_by_idx on public.referrals (responded_by);

-- Reference numbers -----------------------------------------------------------
--
-- `FERN-YYYYMMDD-NNNN`, where NNNN restarts each day. Deriving NNNN from
-- `count(*)` would race under concurrent inserts, so the counter lives in its
-- own row: the `on conflict do update ... returning` below takes a row lock,
-- which serialises concurrent referrals for the same day and hands each one a
-- distinct value. This table is internal plumbing -- no client ever reads it.

create table if not exists public.referral_reference_counters (
  counter_date date primary key,
  last_value integer not null default 0
);

create or replace function public.assign_referral_reference()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_timezone text;
  v_date date;
  v_next integer;
begin
  if new.reference_number is not null and btrim(new.reference_number) <> '' then
    return new;
  end if;

  select h.timezone into v_timezone
  from public.hospitals h
  where h.id = new.requesting_hospital_id;

  begin
    v_date := (coalesce(new.requested_at, now()) at time zone coalesce(v_timezone, 'Africa/Accra'))::date;
  exception when others then
    v_date := (coalesce(new.requested_at, now()) at time zone 'UTC')::date;
  end;

  insert into public.referral_reference_counters as c (counter_date, last_value)
  values (v_date, 1)
  on conflict (counter_date) do update set last_value = c.last_value + 1
  returning c.last_value into v_next;

  new.reference_number := 'FERN-' || to_char(v_date, 'YYYYMMDD') || '-' || lpad(v_next::text, 4, '0');
  return new;
end;
$$;

drop trigger if exists referrals_assign_reference on public.referrals;
create trigger referrals_assign_reference
before insert on public.referrals
for each row execute function public.assign_referral_reference();

-- -----------------------------------------------------------------------------
-- referral_events -- the immutable timeline behind every referral
-- -----------------------------------------------------------------------------

create table if not exists public.referral_events (
  id uuid primary key default gen_random_uuid(),
  referral_id uuid not null references public.referrals (id) on delete cascade,
  event_type text not null,
  from_status text check (
    from_status in ('pending', 'accepted', 'declined', 'in_transit', 'completed', 'cancelled', 'expired')
  ),
  to_status text check (
    to_status in ('pending', 'accepted', 'declined', 'in_transit', 'completed', 'cancelled', 'expired')
  ),
  actor_id uuid references public.profiles (id) on delete set null,
  actor_hospital_id uuid references public.hospitals (id) on delete set null,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists referral_events_referral_idx
  on public.referral_events (referral_id, created_at);
create index if not exists referral_events_actor_idx on public.referral_events (actor_id);

-- -----------------------------------------------------------------------------
-- messages
-- -----------------------------------------------------------------------------

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  referral_id uuid not null references public.referrals (id) on delete cascade,
  sender_id uuid references public.profiles (id) on delete set null,
  sender_hospital_id uuid references public.hospitals (id) on delete set null,
  body text not null check (length(btrim(body)) > 0 and length(body) <= 4000),
  created_at timestamptz not null default now()
);

create index if not exists messages_referral_created_idx on public.messages (referral_id, created_at);
create index if not exists messages_sender_idx on public.messages (sender_id);

create table if not exists public.message_receipts (
  message_id uuid not null references public.messages (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (message_id, user_id)
);

create index if not exists message_receipts_user_idx on public.message_receipts (user_id);

-- -----------------------------------------------------------------------------
-- notifications
-- -----------------------------------------------------------------------------

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  hospital_id uuid references public.hospitals (id) on delete cascade,
  type text not null check (
    type in (
      'readiness_overdue', 'referral_incoming', 'referral_accepted', 'referral_declined',
      'referral_in_transit', 'referral_completed', 'referral_cancelled', 'message_received', 'system'
    )
  ),
  title text not null,
  body text,
  link text,
  severity text not null default 'info' check (severity in ('info', 'warning', 'critical')),
  is_read boolean not null default false,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists notifications_user_unread_idx on public.notifications (user_id, is_read);
create index if not exists notifications_created_at_idx on public.notifications (created_at desc);
create index if not exists notifications_hospital_idx on public.notifications (hospital_id);

-- -----------------------------------------------------------------------------
-- audit_logs
-- -----------------------------------------------------------------------------
-- `action` is deliberately unconstrained: the catalogue in constants.ts will
-- grow, and an audit row must never be the thing that fails a transaction.

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles (id) on delete set null,
  actor_email text,
  actor_role text,
  hospital_id uuid references public.hospitals (id) on delete set null,
  action text not null,
  entity_type text,
  entity_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_logs_created_at_idx on public.audit_logs (created_at desc);
create index if not exists audit_logs_actor_idx on public.audit_logs (actor_id);
create index if not exists audit_logs_hospital_idx on public.audit_logs (hospital_id);
create index if not exists audit_logs_action_idx on public.audit_logs (action);

-- -----------------------------------------------------------------------------
-- scoring_config -- exactly one row, mirroring DEFAULT_SCORING_CONFIG
-- -----------------------------------------------------------------------------

create table if not exists public.scoring_config (
  id integer primary key default 1 check (id = 1),
  resource_weight numeric(4, 3) not null default 0.700 check (resource_weight between 0 and 1),
  proximity_weight numeric(4, 3) not null default 0.300 check (proximity_weight between 0 and 1),
  yellow_penalty numeric(4, 3) not null default 0.150 check (yellow_penalty between 0 and 1),
  red_penalty numeric(4, 3) not null default 0.350 check (red_penalty between 0 and 1),
  max_eta_minutes integer not null default 180 check (max_eta_minutes > 0),
  max_distance_km numeric(8, 2) not null default 250 check (max_distance_km > 0),
  road_distance_factor numeric(4, 2) not null default 1.30 check (road_distance_factor >= 1),
  fixed_transport_overhead_minutes integer not null default 10
    check (fixed_transport_overhead_minutes >= 0),
  tie_break_epsilon numeric(5, 2) not null default 0.50 check (tie_break_epsilon >= 0),
  exclude_red_hospitals boolean not null default false,
  exclude_hospitals_on_diversion boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null
);

drop trigger if exists scoring_config_set_updated_at on public.scoring_config;
create trigger scoring_config_set_updated_at
before update on public.scoring_config
for each row execute function public.set_updated_at();

insert into public.scoring_config (
  id, resource_weight, proximity_weight, yellow_penalty, red_penalty, max_eta_minutes,
  max_distance_km, road_distance_factor, fixed_transport_overhead_minutes, tie_break_epsilon,
  exclude_red_hospitals, exclude_hospitals_on_diversion
)
values (1, 0.7, 0.3, 0.15, 0.35, 180, 250, 1.3, 10, 0.5, false, true)
on conflict (id) do nothing;

-- -----------------------------------------------------------------------------
-- department_readiness view
-- -----------------------------------------------------------------------------
-- The freshest submission per department. `security_invoker` keeps the view
-- honest: it is filtered by the caller's own RLS policies rather than the
-- view owner's, so a hospital cannot read a colleague's name out of another
-- facility through it.

drop view if exists public.department_readiness;
create view public.department_readiness
with (security_invoker = true)
as
select
  d.id as department_id,
  d.hospital_id,
  d.name as department_name,
  d.template_key,
  d.requires_shift_update,
  last_update.submitted_at as last_submitted_at,
  last_update.shift_date as last_shift_date,
  last_update.shift_type as last_shift_type,
  last_update.submitted_by as last_submitted_by,
  submitter.full_name as last_submitted_by_name
from public.departments d
left join lateral (
  select ru.submitted_at, ru.shift_date, ru.shift_type, ru.submitted_by
  from public.readiness_updates ru
  where ru.department_id = d.id
  -- Order by the shift the row describes, not by when it was typed in: a late
  -- correction for an old shift must not masquerade as the current state.
  order by
    ru.shift_date desc,
    case ru.shift_type when 'night' then 2 when 'afternoon' then 1 else 0 end desc,
    ru.submitted_at desc
  limit 1
) last_update on true
left join public.profiles submitter on submitter.id = last_update.submitted_by
where d.is_active;

-- -----------------------------------------------------------------------------
-- auth.users -> profiles bridge
-- -----------------------------------------------------------------------------
-- An invited user must land in the app with a usable profile. This runs inside
-- GoTrue's signup transaction, so it swallows every error: a broken metadata
-- payload must never make account creation fail.

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  -- app_metadata is writable ONLY by the service role / Admin API, which is
  -- exactly the invite path an administrator uses. user_metadata is writable by
  -- the signing-up client itself, so anything privileged read from there would
  -- let a stranger POST /auth/v1/signup with {"data":{"role":"super_admin"}}
  -- and own the network. Privilege comes from app_metadata or not at all.
  v_app jsonb := coalesce(new.raw_app_meta_data, '{}'::jsonb);
  v_role text;
  v_hospital uuid;
  v_department uuid;
begin
  v_role := coalesce(v_app ->> 'role', 'viewer');
  if v_role not in ('super_admin', 'hospital_admin', 'shift_in_charge', 'referral_coordinator', 'viewer') then
    v_role := 'viewer';
  end if;

  begin
    v_hospital := nullif(btrim(coalesce(v_app ->> 'hospital_id', '')), '')::uuid;
  exception when others then
    v_hospital := null;
  end;

  begin
    v_department := nullif(btrim(coalesce(v_app ->> 'department_id', '')), '')::uuid;
  exception when others then
    v_department := null;
  end;

  insert into public.profiles (id, full_name, email, phone, role, hospital_id, department_id)
  values (
    new.id,
    coalesce(nullif(btrim(coalesce(v_meta ->> 'full_name', '')), ''), split_part(coalesce(new.email, ''), '@', 1)),
    coalesce(new.email, ''),
    nullif(btrim(coalesce(v_meta ->> 'phone', '')), ''),
    v_role,
    v_hospital,
    v_department
  )
  on conflict (id) do nothing;

  return new;
exception when others then
  -- Signup wins over bookkeeping; an admin can repair the profile afterwards.
  return new;
end;
$$;

do $$
begin
  drop trigger if exists on_auth_user_created on auth.users;
  create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();
exception when insufficient_privilege then
  raise notice 'Skipped auth.users trigger: run this migration as the postgres role to enable auto-profile creation.';
end;
$$;

do $$
begin
  grant execute on function public.handle_new_auth_user() to supabase_auth_admin;
exception when undefined_object or insufficient_privilege then
  null;
end;
$$;

-- -----------------------------------------------------------------------------
-- Realtime
-- -----------------------------------------------------------------------------
-- The chat pane and the notification bell both subscribe to postgres_changes.

do $$
declare
  v_table text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    return;
  end if;

  foreach v_table in array array['messages', 'notifications', 'referrals'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = v_table
    ) then
      execute format('alter publication supabase_realtime add table public.%I', v_table);
    end if;
  end loop;
exception when insufficient_privilege then
  raise notice 'Skipped realtime publication changes (insufficient privilege).';
end;
$$;
