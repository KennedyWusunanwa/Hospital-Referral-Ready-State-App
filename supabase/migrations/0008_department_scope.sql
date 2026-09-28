-- =============================================================================
-- FERN -- 0008_department_scope.sql
--
-- Makes the System -> Hospital -> Department hierarchy real at the data layer.
-- Until now every check asked "does this role have the capability?" and
-- "is this the caller's hospital?". A Shift In-Charge in Cardiology therefore
-- saw, and could submit, every department in the building. This migration adds
-- the third question -- "is this the caller's department?" -- and asks it in
-- the same place every time: a small set of SECURITY DEFINER helpers used by
-- the policies and the RPCs alike.
--
--   1. A sixth role, department_coordinator: a department-level account that
--      may also raise referrals from its department (subject to 3).
--   2. hospitals.referral_policy: which levels may initiate a referral.
--      Default 'hospital_only', which is exactly how every hospital behaved
--      before the setting existed.
--   3. referrals.origin_department_id: the department a referral was raised
--      from, so department-level visibility has something to key on.
--   4. Scope helpers: current_user_level(), accessible_department_ids(),
--      can_view_department(), can_manage_department(), can_view_referral(),
--      referral_policy_allows(), can_create_referral().
--   5. Row-level security re-scoped: departments, readiness_updates,
--      referrals, referral_events, messages, receipts, profiles, invitations.
--   6. RPCs re-scoped: submit_readiness (also fixes the "malformed array
--      literal" failure that broke every submission), create_referral,
--      get_referral_candidates. Notification fan-out re-scoped in
--      notify_on_message and flag_overdue_readiness.
--   7. A department guard on profiles: department-level accounts must have a
--      department, and it must belong to their hospital.
--   8. referral_attachments: X-rays, scans and results on a live referral,
--      in a private bucket, visible to exactly the people who see the referral.
--
-- Idempotent: safe to re-apply.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Roles
-- -----------------------------------------------------------------------------

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (
  role in ('super_admin', 'hospital_admin', 'shift_in_charge', 'department_coordinator',
           'referral_coordinator', 'viewer')
);

alter table public.staff_invites drop constraint if exists staff_invites_role_check;
alter table public.staff_invites add constraint staff_invites_role_check check (
  role in ('super_admin', 'hospital_admin', 'shift_in_charge', 'department_coordinator',
           'referral_coordinator', 'viewer')
);

-- Mirrors ROLE_CAPABILITIES in src/lib/constants.ts. Keep the two in step.
create or replace function public.has_capability(p_capability text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_capability = any (
    case (select p.role from public.profiles p where p.id = auth.uid() and p.is_active)
      when 'super_admin' then array[
        'readiness:submit', 'readiness:view', 'referral:create', 'referral:respond',
        'referral:view', 'messaging:use', 'reports:view', 'reports:view_all',
        'admin:hospital', 'admin:system', 'audit:view'
      ]
      when 'hospital_admin' then array[
        'readiness:submit', 'readiness:view', 'referral:create', 'referral:respond',
        'referral:view', 'messaging:use', 'reports:view', 'admin:hospital', 'audit:view'
      ]
      when 'shift_in_charge' then array[
        'readiness:submit', 'readiness:view', 'referral:view', 'messaging:use'
      ]
      when 'department_coordinator' then array[
        'readiness:submit', 'readiness:view', 'referral:create', 'referral:view', 'messaging:use'
      ]
      when 'referral_coordinator' then array[
        'readiness:view', 'referral:create', 'referral:respond', 'referral:view',
        'messaging:use', 'reports:view'
      ]
      when 'viewer' then array['readiness:view', 'referral:view', 'reports:view']
      else array[]::text[]
    end
  )
$$;

-- -----------------------------------------------------------------------------
-- 2. Referral initiation policy
-- -----------------------------------------------------------------------------
-- Added before the helpers in section 4, which read this column.

alter table public.hospitals
  add column if not exists referral_policy text not null default 'hospital_only';

alter table public.hospitals drop constraint if exists hospitals_referral_policy_check;
alter table public.hospitals add constraint hospitals_referral_policy_check check (
  referral_policy in ('hospital_only', 'department_only', 'hospital_and_department')
);

comment on column public.hospitals.referral_policy is
  'Which levels may initiate a referral from this hospital. hospital_only is the historical behaviour.';

-- -----------------------------------------------------------------------------
-- 3. Department context on a referral
-- -----------------------------------------------------------------------------

alter table public.referrals
  add column if not exists origin_department_id uuid references public.departments (id) on delete set null;

create index if not exists referrals_origin_department_idx
  on public.referrals (origin_department_id);

comment on column public.referrals.origin_department_id is
  'The requester''s department when the referral was raised. Keys department-level visibility.';

-- -----------------------------------------------------------------------------
-- 4. Scope helpers
-- -----------------------------------------------------------------------------
-- All SECURITY DEFINER, all keyed on auth.uid() only, all pinned to the public
-- schema -- the same discipline as the 0002 helpers they sit beside.
--
-- These come AFTER the new columns on purpose: a `language sql` function body is
-- checked against the catalog when it is created, so referral_policy_allows()
-- and can_view_referral() need hospitals.referral_policy and
-- referrals.origin_department_id to exist already.

create or replace function public.current_user_level()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case p.role
    when 'super_admin' then 'system'
    when 'hospital_admin' then 'hospital'
    when 'referral_coordinator' then 'hospital'
    when 'viewer' then 'hospital'
    when 'shift_in_charge' then 'department'
    when 'department_coordinator' then 'department'
  end
  from public.profiles p
  where p.id = auth.uid()
    and p.is_active
$$;

comment on function public.current_user_level() is
  'system, hospital or department for the calling account; null when unauthenticated or deactivated.';

-- Null means "not restricted by department" (system and hospital levels). An
-- empty array means "nothing at all" -- the fail-closed answer for an account
-- that is missing, deactivated, or department-level without a department.
-- A many-to-many profile_departments table would be unioned in here, and
-- nowhere else.
create or replace function public.accessible_department_ids()
returns uuid[]
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text;
  v_department uuid;
begin
  select p.role, p.department_id into v_role, v_department
  from public.profiles p
  where p.id = auth.uid()
    and p.is_active;

  if not found then
    return '{}'::uuid[];
  end if;

  if v_role in ('super_admin', 'hospital_admin', 'referral_coordinator', 'viewer') then
    return null;
  end if;

  if v_department is null then
    return '{}'::uuid[];
  end if;

  return array[v_department];
end;
$$;

comment on function public.accessible_department_ids() is
  'Departments a department-level account may act on. NULL = unrestricted (system and hospital levels); empty = none.';

-- May the caller see this department's rows (readiness board, history)?
-- Hospital-level accounts see every hospital's departments, because a referral
-- decision is inherently a cross-hospital question; department-level accounts
-- see only their own.
create or replace function public.can_view_department(p_department_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_ids uuid[];
begin
  if auth.uid() is null or p_department_id is null then
    return false;
  end if;
  v_ids := public.accessible_department_ids();
  if v_ids is null then
    return true;
  end if;
  return p_department_id = any (v_ids);
end;
$$;

-- May the caller file a shift update for this department? Capability, then
-- hospital, then department.
create or replace function public.can_manage_department(p_department_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_hospital uuid;
  v_ids uuid[];
begin
  if auth.uid() is null or p_department_id is null then
    return false;
  end if;
  if not public.has_capability('readiness:submit') then
    return false;
  end if;
  if public.is_super_admin() then
    return true;
  end if;

  select d.hospital_id into v_hospital from public.departments d where d.id = p_department_id;
  if not found or v_hospital is distinct from public.current_user_hospital() then
    return false;
  end if;

  v_ids := public.accessible_department_ids();
  return v_ids is null or p_department_id = any (v_ids);
end;
$$;

-- Which levels a hospital lets initiate referrals. Unknown or missing policy
-- reads as hospital_only, the historical behaviour.
create or replace function public.referral_policy_allows(p_level text, p_hospital_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case coalesce((select h.referral_policy from public.hospitals h where h.id = p_hospital_id), 'hospital_only')
    when 'department_only' then p_level in ('system', 'department')
    when 'hospital_and_department' then p_level in ('system', 'hospital', 'department')
    else p_level in ('system', 'hospital')
  end
$$;

-- Role permission AND the home hospital's policy.
create or replace function public.can_create_referral()
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_hospital uuid;
begin
  if auth.uid() is null then
    return false;
  end if;
  if not public.has_capability('referral:create') then
    return false;
  end if;
  if public.is_super_admin() then
    return true;
  end if;
  v_hospital := public.current_user_hospital();
  if v_hospital is null then
    return false;
  end if;
  return public.referral_policy_allows(public.current_user_level(), v_hospital);
end;
$$;

-- Referral visibility. Hospital level: either side of the transfer.
-- Department level: referrals raised from one of the caller's departments, or
-- by the caller. A department at the RECEIVING hospital sees nothing until an
-- operational rule for that exists -- the referral records no destination
-- department yet.
create or replace function public.can_view_referral(p_referral_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.referrals r
    where r.id = p_referral_id
      and (
        public.is_super_admin()
        or (
          public.current_user_level() = 'hospital'
          and (
            r.requesting_hospital_id = public.current_user_hospital()
            or r.receiving_hospital_id = public.current_user_hospital()
          )
        )
        or (
          public.current_user_level() = 'department'
          and (
            r.requested_by = auth.uid()
            or (
              r.origin_department_id is not null
              and r.origin_department_id = any (coalesce(public.accessible_department_ids(), '{}'::uuid[]))
            )
          )
        )
      )
  )
$$;

-- Older policies (referral_events, message_receipts) call this name; it now
-- means exactly what can_view_referral means.
create or replace function public.is_referral_participant(p_referral_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.can_view_referral(p_referral_id)
$$;

grant execute on function public.current_user_level() to authenticated;
grant execute on function public.accessible_department_ids() to authenticated;
grant execute on function public.can_view_department(uuid) to authenticated;
grant execute on function public.can_manage_department(uuid) to authenticated;
grant execute on function public.referral_policy_allows(text, uuid) to authenticated;
grant execute on function public.can_create_referral() to authenticated;
grant execute on function public.can_view_referral(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 5. Row-level security
-- -----------------------------------------------------------------------------

drop policy if exists departments_select on public.departments;
create policy departments_select on public.departments
for select to authenticated
using (public.can_view_department(id));

drop policy if exists readiness_updates_select on public.readiness_updates;
create policy readiness_updates_select on public.readiness_updates
for select to authenticated
using (public.can_view_department(department_id));

drop policy if exists referrals_select on public.referrals;
create policy referrals_select on public.referrals
for select to authenticated
using (
  public.is_super_admin()
  or (
    public.current_user_level() = 'hospital'
    and (
      requesting_hospital_id = public.current_user_hospital()
      or receiving_hospital_id = public.current_user_hospital()
    )
  )
  or (
    public.current_user_level() = 'department'
    and (
      requested_by = auth.uid()
      or (
        origin_department_id is not null
        and origin_department_id = any (coalesce(public.accessible_department_ids(), '{}'::uuid[]))
      )
    )
  )
);

drop policy if exists referral_events_select on public.referral_events;
create policy referral_events_select on public.referral_events
for select to authenticated
using (public.can_view_referral(referral_id));

drop policy if exists messages_select on public.messages;
create policy messages_select on public.messages
for select to authenticated
using (public.can_view_referral(referral_id));

drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages
for insert to authenticated
with check (
  public.has_capability('messaging:use')
  and sender_id = auth.uid()
  and (sender_hospital_id is null or sender_hospital_id = public.current_user_hospital())
  and public.can_view_referral(referral_id)
  and exists (
    select 1
    from public.referrals r
    where r.id = referral_id
      -- Only while the case is live: a closed referral is a record, not a chat.
      and r.status in ('pending', 'accepted', 'in_transit')
  )
);

-- Profiles: a department-level account sees itself, its own department's
-- colleagues and the hospital-level staff it deals with -- not the whole
-- staff list of the building.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
for select to authenticated
using (
  id = auth.uid()
  or public.is_super_admin()
  or (
    hospital_id is not null
    and hospital_id = public.current_user_hospital()
    and (
      public.current_user_level() <> 'department'
      or role in ('hospital_admin', 'referral_coordinator')
      or (
        department_id is not null
        and department_id = any (coalesce(public.accessible_department_ids(), '{}'::uuid[]))
      )
    )
  )
);

-- Invitations for a department-level role must name the department.
drop policy if exists staff_invites_insert on public.staff_invites;
create policy staff_invites_insert on public.staff_invites
for insert with check (
  (
    public.is_super_admin()
    or (
      public.current_user_role() = 'hospital_admin'
      and hospital_id = public.current_user_hospital()
      and role <> 'super_admin'
    )
  )
  and (role not in ('shift_in_charge', 'department_coordinator') or department_id is not null)
);

drop policy if exists staff_invites_update on public.staff_invites;
create policy staff_invites_update on public.staff_invites
for update using (
  public.is_super_admin()
  or (public.current_user_role() = 'hospital_admin' and hospital_id = public.current_user_hospital())
) with check (
  (
    public.is_super_admin()
    or (
      public.current_user_role() = 'hospital_admin'
      and hospital_id = public.current_user_hospital()
      and role <> 'super_admin'
    )
  )
  and (role not in ('shift_in_charge', 'department_coordinator') or department_id is not null)
);

-- -----------------------------------------------------------------------------
-- 6. Department guard on profiles
-- -----------------------------------------------------------------------------
-- department_id used to be self-editable because it only chose which form a
-- person landed on. It now decides what a department-level account can see
-- and submit, so for those accounts it is a privileged column like role.

create or replace function public.guard_profile_privileges()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text;
  v_hospital uuid;
  v_department_privileged boolean;
begin
  -- A department must belong to the account's own hospital, whoever sets it.
  if new.department_id is not null and not exists (
    select 1 from public.departments d
    where d.id = new.department_id and d.hospital_id is not distinct from new.hospital_id
  ) then
    raise exception 'The department must belong to the account''s hospital.' using errcode = '23514';
  end if;

  -- No JWT: a SECURITY DEFINER RPC, the service role or cron. Trusted.
  if auth.uid() is null then
    return new;
  end if;

  v_department_privileged :=
    new.department_id is distinct from old.department_id
    and (old.role in ('shift_in_charge', 'department_coordinator')
         or new.role in ('shift_in_charge', 'department_coordinator'));

  if new.role is not distinct from old.role
     and new.hospital_id is not distinct from old.hospital_id
     and new.is_active is not distinct from old.is_active
     -- email is auth.users' to set; letting it drift breaks every join an
     -- investigator would make, and it decorates the audit log.
     and new.email is not distinct from old.email
     and not v_department_privileged then
    return new;
  end if;

  -- A department-level account without a department has no scope at all.
  if new.role in ('shift_in_charge', 'department_coordinator') and new.department_id is null then
    raise exception 'A department-level account needs a department.' using errcode = '23514';
  end if;

  v_role := public.current_user_role();
  v_hospital := public.current_user_hospital();

  if v_role = 'super_admin' then
    return new;
  end if;

  if v_role = 'hospital_admin'
     and old.hospital_id is not distinct from v_hospital
     and new.hospital_id is not distinct from v_hospital
     and new.role <> 'super_admin' then
    return new;
  end if;

  raise exception
    'Changing a role, hospital, department or account status needs an administrator with rights over that hospital.'
    using errcode = '42501';
end;
$$;

-- On insert (the signup trigger) an inconsistent department is dropped rather
-- than refused: refusing would leave the person with no profile at all.
create or replace function public.guard_profile_department_on_insert()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.department_id is not null and not exists (
    select 1 from public.departments d
    where d.id = new.department_id and d.hospital_id is not distinct from new.hospital_id
  ) then
    raise notice 'Dropping department % for new profile %: it is not in hospital %',
      new.department_id, new.id, new.hospital_id;
    new.department_id := null;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_guard_department_insert on public.profiles;
create trigger profiles_guard_department_insert
before insert on public.profiles
for each row execute function public.guard_profile_department_on_insert();

-- The signup trigger's role whitelist has to know the new role, or an invited
-- Department Coordinator lands as a viewer.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_app jsonb := coalesce(new.raw_app_meta_data, '{}'::jsonb);
  v_role text;
  v_hospital uuid;
  v_department uuid;
  v_full_name text;
  v_invite public.staff_invites%rowtype;
begin
  select * into v_invite
  from public.staff_invites i
  where lower(i.email) = lower(coalesce(new.email, ''))
    and i.accepted_at is null
    and i.expires_at > now()
  order by i.created_at desc
  limit 1;

  if v_invite.id is not null then
    v_role := v_invite.role;
    v_hospital := v_invite.hospital_id;
    v_department := v_invite.department_id;
    v_full_name := nullif(btrim(coalesce(v_invite.full_name, '')), '');
  else
    v_role := coalesce(v_app ->> 'role', 'viewer');

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
  end if;

  if v_role not in ('super_admin', 'hospital_admin', 'shift_in_charge', 'department_coordinator',
                    'referral_coordinator', 'viewer') then
    v_role := 'viewer';
  end if;

  insert into public.profiles (id, full_name, email, phone, role, hospital_id, department_id)
  values (
    new.id,
    coalesce(
      v_full_name,
      nullif(btrim(coalesce(v_meta ->> 'full_name', '')), ''),
      split_part(coalesce(new.email, ''), '@', 1)
    ),
    coalesce(new.email, ''),
    nullif(btrim(coalesce(v_meta ->> 'phone', '')), ''),
    v_role,
    v_hospital,
    v_department
  )
  on conflict (id) do nothing;

  if v_invite.id is not null then
    update public.staff_invites
    set accepted_at = now(), accepted_by = new.id
    where id = v_invite.id;
  end if;

  return new;
exception when others then
  -- Signup wins over bookkeeping; an admin can repair the profile afterwards.
  return new;
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
-- 7. submit_readiness -- department scope, and the array-literal fix
-- -----------------------------------------------------------------------------
-- The 0003 version ended its SET list with `v_sets || 'updated_at = now()'`.
-- With an untyped literal on the right, Postgres resolves `||` as
-- array-with-array and tries to parse the string as an array literal, so
-- every submission failed with "malformed array literal". The literal is now
-- typed.

create or replace function public.submit_readiness(
  p_department_id uuid,
  p_payload jsonb,
  p_blood_stock jsonb default null,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_dept public.departments%rowtype;
  v_timezone text;
  v_shift_date date;
  v_shift_type text;
  v_payload jsonb;
  v_resources jsonb;
  v_totals jsonb;
  v_total_num numeric;
  v_blood jsonb;
  v_allowed text[];
  v_key text;
  v_value jsonb;
  v_column text;
  v_total_column text;
  v_kind text;
  v_num numeric;
  v_bool boolean;
  v_sets text[] := array[]::text[];
  v_units integer;
  v_result jsonb;
begin
  if v_uid is null then
    raise exception 'You must be signed in to submit a readiness update.' using errcode = '42501';
  end if;

  select * into v_dept from public.departments d where d.id = p_department_id;
  if not found then
    raise exception 'Department not found.' using errcode = 'P0002';
  end if;
  if not v_dept.is_active then
    raise exception 'That department is no longer active.' using errcode = '22023';
  end if;

  if not public.has_capability('readiness:submit') then
    raise exception 'Your role cannot submit readiness updates.' using errcode = '42501';
  end if;

  -- Capability says what; scope says where. A department-level account may
  -- only file for its own department, a hospital-level one for its own
  -- hospital, a system administrator anywhere.
  if not public.can_manage_department(p_department_id) then
    raise exception 'You can only submit readiness for your own department.' using errcode = '42501';
  end if;

  select h.timezone into v_timezone from public.hospitals h where h.id = v_dept.hospital_id;

  select s.shift_date, s.shift_type into v_shift_date, v_shift_type
  from public.shift_for(now(), coalesce(v_timezone, 'Africa/Accra')) s;

  v_payload := coalesce(p_payload, '{}'::jsonb);
  if jsonb_typeof(v_payload) <> 'object' then
    raise exception 'The readiness payload must be a JSON object.' using errcode = '22023';
  end if;

  if v_payload ? 'resources' and jsonb_typeof(v_payload -> 'resources') = 'object' then
    v_resources := v_payload -> 'resources';
  else
    v_resources := v_payload - 'resources' - 'blood_stock' - 'er_open' - 'diversion_reason';
  end if;

  if v_payload ? 'totals' and jsonb_typeof(v_payload -> 'totals') = 'object' then
    v_totals := v_payload -> 'totals';
  else
    v_totals := '{}'::jsonb;
  end if;

  v_blood := coalesce(p_blood_stock, v_payload -> 'blood_stock');
  v_allowed := public.template_resources(v_dept.template_key);

  insert into public.hospital_resources (hospital_id)
  values (v_dept.hospital_id)
  on conflict (hospital_id) do nothing;

  for v_key, v_value in select key, value from jsonb_each(v_resources) loop
    v_column := public.resource_column(v_key);
    if v_column is null then
      raise exception 'Unknown resource key: %', v_key using errcode = '22023';
    end if;

    -- A department owns only the fields its template lists. Anything else in
    -- the payload belongs to somebody else's form and is ignored, never
    -- written -- otherwise the last form submitted would win the whole row.
    continue when not (v_key = any (v_allowed));

    v_kind := public.resource_kind(v_key);
    v_total_column := public.resource_total_column(v_key);

    if v_kind = 'boolean' then
      v_bool := case jsonb_typeof(v_value)
        when 'boolean' then (v_value #>> '{}') = 'true'
        when 'number' then (v_value #>> '{}')::numeric <> 0
        when 'string' then lower(v_value #>> '{}') in ('true', 't', 'yes', 'y', '1')
        else false
      end;
      v_sets := v_sets || format('%I = %L', v_column, v_bool);
    else
      begin
        v_num := coalesce((v_value #>> '{}')::numeric, 0);
      exception when others then
        v_num := 0;
      end;

      if v_kind = 'percent' then
        v_sets := v_sets || format('%I = %L', v_column, least(100, greatest(0, round(v_num, 2))));
      else
        v_num := greatest(0, floor(v_num));
        v_sets := v_sets || format('%I = %L', v_column, v_num::integer);

        if v_total_column is not null then
          if v_totals ? v_key then
            begin
              v_total_num := coalesce((v_totals -> v_key #>> '{}')::numeric, 0);
            exception when others then
              v_total_num := 0;
            end;
            v_sets := v_sets || format(
              '%I = %L',
              v_total_column,
              greatest(v_num, greatest(0, floor(v_total_num)))::integer
            );
          else
            v_sets := v_sets
              || format('%I = greatest(%I, %L)', v_total_column, v_total_column, v_num::integer);
          end if;
        end if;
      end if;
    end if;
  end loop;

  if public.template_controls_er_status(v_dept.template_key) and v_payload ? 'er_open' then
    v_bool := coalesce(lower(v_payload ->> 'er_open') in ('true', 't', 'yes', 'y', '1'), true);
    v_sets := v_sets || format('er_open = %L', v_bool);
    v_sets := v_sets || format(
      'diversion_reason = %L',
      case when v_bool then null else nullif(btrim(coalesce(v_payload ->> 'diversion_reason', '')), '') end
    );
  end if;

  v_sets := v_sets || format('updated_by = %L', v_uid);
  v_sets := v_sets || 'updated_at = now()'::text;

  execute format(
    'update public.hospital_resources set %s where hospital_id = %L',
    array_to_string(v_sets, ', '),
    v_dept.hospital_id
  );

  if v_blood is not null
     and jsonb_typeof(v_blood) = 'object'
     and public.template_collects_blood_stock(v_dept.template_key) then
    for v_key, v_value in select key, value from jsonb_each(v_blood) loop
      if v_key not in ('O-', 'O+', 'A-', 'A+', 'B-', 'B+', 'AB-', 'AB+') then
        raise exception 'Unknown blood group: %', v_key using errcode = '22023';
      end if;

      begin
        v_units := greatest(0, floor(coalesce((v_value #>> '{}')::numeric, 0)))::integer;
      exception when others then
        v_units := 0;
      end;

      insert into public.blood_stock (hospital_id, blood_group, units, updated_by)
      values (v_dept.hospital_id, v_key, v_units, v_uid)
      on conflict (hospital_id, blood_group) do update
        set units = excluded.units,
            updated_by = excluded.updated_by,
            updated_at = now();
    end loop;
  end if;

  insert into public.readiness_updates (
    hospital_id, department_id, shift_date, shift_type, submitted_by, submitted_at, payload, notes
  )
  values (
    v_dept.hospital_id,
    p_department_id,
    v_shift_date,
    v_shift_type,
    v_uid,
    now(),
    jsonb_build_object('resources', v_resources)
      || case when v_blood is null then '{}'::jsonb else jsonb_build_object('blood_stock', v_blood) end
      || case
           when v_payload ? 'er_open'
           then jsonb_build_object(
             'er_open', v_payload -> 'er_open',
             'diversion_reason', coalesce(v_payload -> 'diversion_reason', 'null'::jsonb)
           )
           else '{}'::jsonb
         end,
    nullif(btrim(coalesce(p_notes, '')), '')
  )
  on conflict (department_id, shift_date, shift_type) do update
    set submitted_by = excluded.submitted_by,
        submitted_at = excluded.submitted_at,
        payload = excluded.payload,
        notes = excluded.notes;

  perform public.log_audit_event_internal(
    'readiness.submit',
    'department',
    p_department_id,
    jsonb_build_object(
      'hospital_id', v_dept.hospital_id,
      'department', v_dept.name,
      'shift_date', v_shift_date,
      'shift_type', v_shift_type
    )
  );

  select to_jsonb(hr) into v_result
  from public.hospital_resources hr
  where hr.hospital_id = v_dept.hospital_id;

  return coalesce(v_result, '{}'::jsonb);
end;
$$;

-- -----------------------------------------------------------------------------
-- 8. create_referral -- policy check and department context
-- -----------------------------------------------------------------------------

create or replace function public.create_referral(
  p_receiving_hospital_id uuid,
  p_emergency_type_id uuid,
  p_urgency text,
  p_patient_ref text,
  p_patient_age_band text,
  p_patient_sex text,
  p_clinical_summary text,
  p_required_resources text[] default '{}'::text[],
  p_score_snapshot jsonb default '{}'::jsonb,
  p_candidate_snapshot jsonb default '{}'::jsonb,
  p_distance_km numeric default null,
  p_eta_minutes numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_hospital uuid := public.current_user_hospital();
  v_department uuid;
  v_receiving public.hospitals%rowtype;
  v_type public.emergency_types%rowtype;
  v_urgency text := coalesce(nullif(btrim(p_urgency), ''), 'urgent');
  v_resources text[];
  v_id uuid;
  v_reference text;
  v_severity text;
  v_result jsonb;
begin
  if v_uid is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  if not public.has_capability('referral:create') then
    raise exception 'Your role cannot raise referrals.' using errcode = '42501';
  end if;
  if v_hospital is null then
    raise exception 'Your account is not attached to a hospital yet.' using errcode = '42501';
  end if;
  if not public.can_create_referral() then
    raise exception
      'Referral initiation from your level is switched off at your hospital. Ask the referral desk to raise it.'
      using errcode = '42501';
  end if;

  select * into v_receiving from public.hospitals h where h.id = p_receiving_hospital_id;
  if not found then
    raise exception 'Receiving hospital not found.' using errcode = 'P0002';
  end if;
  if not v_receiving.is_active then
    raise exception 'That hospital is not active.' using errcode = '22023';
  end if;
  if v_receiving.id = v_hospital then
    raise exception 'You cannot refer a patient to your own hospital.' using errcode = '22023';
  end if;

  select * into v_type from public.emergency_types t where t.id = p_emergency_type_id;
  if not found then
    raise exception 'Emergency type not found.' using errcode = 'P0002';
  end if;

  if v_urgency not in ('critical', 'urgent', 'routine') then
    raise exception 'Unknown urgency: %', p_urgency using errcode = '22023';
  end if;
  if coalesce(p_patient_age_band, '') not in
     ('neonate', 'infant', 'child', 'adolescent', 'adult', 'older_adult') then
    raise exception 'Unknown age band: %', p_patient_age_band using errcode = '22023';
  end if;
  if coalesce(nullif(btrim(p_clinical_summary), ''), '') = '' then
    raise exception 'A clinical summary is required.' using errcode = '22023';
  end if;

  select coalesce(array_agg(k order by k), '{}'::text[])
  into v_resources
  from unnest(coalesce(p_required_resources, '{}'::text[])) as k
  where public.resource_column(k) is not null;

  -- The requester's department is the referral's origin. Hospital-level staff
  -- may have none, and that is fine: their referrals are hospital referrals.
  select p.department_id into v_department from public.profiles p where p.id = v_uid;

  insert into public.referrals (
    requesting_hospital_id, receiving_hospital_id, origin_department_id, emergency_type_id,
    urgency, status, patient_ref, patient_age_band, patient_sex, clinical_summary,
    required_resources, score_snapshot, candidate_snapshot, distance_km, eta_minutes,
    requested_by, requested_at
  )
  values (
    v_hospital,
    p_receiving_hospital_id,
    v_department,
    p_emergency_type_id,
    v_urgency,
    'pending',
    p_patient_ref,
    p_patient_age_band,
    coalesce(nullif(btrim(p_patient_sex), ''), 'undisclosed'),
    left(btrim(p_clinical_summary), 1000),
    v_resources,
    coalesce(p_score_snapshot, '{}'::jsonb),
    coalesce(p_candidate_snapshot, '{}'::jsonb),
    p_distance_km,
    p_eta_minutes,
    v_uid,
    now()
  )
  returning id, reference_number into v_id, v_reference;

  insert into public.referral_events (
    referral_id, event_type, from_status, to_status, actor_id, actor_hospital_id, notes
  )
  values (v_id, 'referral.create', null, 'pending', v_uid, v_hospital, null);

  v_severity := case v_urgency
    when 'critical' then 'critical'
    when 'urgent' then 'warning'
    else 'info'
  end;

  -- The receiving hospital's referral desk: hospital-level roles only.
  insert into public.notifications (user_id, hospital_id, type, title, body, link, severity)
  select
    p.id,
    v_receiving.id,
    'referral_incoming',
    'Incoming referral ' || v_reference,
    v_type.name || ' from ' || (select h.name from public.hospitals h where h.id = v_hospital),
    '/referrals/' || v_id::text,
    v_severity
  from public.profiles p
  where p.hospital_id = v_receiving.id
    and p.is_active
    and p.role in ('referral_coordinator', 'hospital_admin');

  perform public.log_audit_event_internal(
    'referral.create',
    'referral',
    v_id,
    jsonb_build_object(
      'reference_number', v_reference,
      'receiving_hospital_id', p_receiving_hospital_id,
      'origin_department_id', v_department,
      'emergency_type', v_type.code,
      'urgency', v_urgency
    )
  );

  select to_jsonb(r) into v_result from public.referrals r where r.id = v_id;
  return v_result;
end;
$$;

-- -----------------------------------------------------------------------------
-- 9. get_referral_candidates -- the ranking is for people who may refer
-- -----------------------------------------------------------------------------
-- Unchanged apart from the policy check: the function reports per-hospital
-- referral volume that referrals' own RLS would not disclose.

create or replace function public.get_referral_candidates(
  p_origin_hospital_id uuid,
  p_emergency_type_id uuid,
  p_max_km numeric default 250
)
returns table (
  hospital_id uuid,
  name text,
  code text,
  level text,
  city text,
  region text,
  phone text,
  emergency_phone text,
  email text,
  latitude numeric,
  longitude numeric,
  timezone text,
  distance_km numeric,
  accepts_referrals boolean,
  er_open boolean,
  diversion_reason text,
  operating_rooms_total integer,
  operating_rooms_functional integer,
  resident_surgeon_available boolean,
  anesthetist_available boolean,
  obstetric_theatre_available boolean,
  neurosurgery_available boolean,
  cath_lab_available boolean,
  icu_beds_total integer,
  icu_beds_available integer,
  nicu_beds_total integer,
  nicu_beds_available integer,
  neonatal_resuscitation_available boolean,
  ventilators_total integer,
  ventilators_available integer,
  oxygen_supply_percent numeric,
  isolation_beds_available integer,
  general_beds_total integer,
  general_beds_available integer,
  burn_unit_available boolean,
  dialysis_available boolean,
  blood_bank_functional boolean,
  ct_functional boolean,
  mri_functional boolean,
  xray_functional boolean,
  ultrasound_functional boolean,
  ambulances_available integer,
  power_backup_available boolean,
  resources_updated_at timestamptz,
  oldest_department_update_at timestamptz,
  departments_total integer,
  departments_reporting integer,
  blood_units_total integer,
  blood_stock jsonb,
  referrals_received integer,
  referrals_accepted integer,
  avg_response_seconds numeric
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_max_km numeric := greatest(1, coalesce(p_max_km, 250));
  v_origin_lat double precision;
  v_origin_lng double precision;
  v_deg_lat double precision;
  v_deg_lng double precision;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  if public.current_user_hospital() is null and not public.is_super_admin() then
    raise exception 'Your account is not attached to a hospital yet.' using errcode = '42501';
  end if;
  if not public.has_capability('referral:create') then
    raise exception 'Your role cannot raise referrals.' using errcode = '42501';
  end if;
  if not public.can_create_referral() then
    raise exception
      'Referral initiation from your level is switched off at your hospital.'
      using errcode = '42501';
  end if;
  if not public.is_super_admin()
     and p_origin_hospital_id is distinct from public.current_user_hospital() then
    raise exception 'You can only search from your own hospital.' using errcode = '42501';
  end if;

  select least(v_max_km, greatest(1, sc.max_distance_km))
  into v_max_km
  from public.scoring_config sc
  where sc.id = 1;
  v_max_km := coalesce(v_max_km, 250);

  select o.latitude::double precision, o.longitude::double precision
  into v_origin_lat, v_origin_lng
  from public.hospitals o
  where o.id = p_origin_hospital_id;

  if v_origin_lat is null then
    raise exception 'Origin hospital not found.' using errcode = 'P0002';
  end if;

  v_deg_lat := v_max_km / 111.045;
  v_deg_lng := v_max_km
    / (111.045 * greatest(0.02, cos(radians(least(89.0, abs(v_origin_lat) + v_deg_lat)))));

  if p_emergency_type_id is not null
     and not exists (select 1 from public.emergency_types t where t.id = p_emergency_type_id) then
    raise exception 'Emergency type not found.' using errcode = 'P0002';
  end if;

  return query
  select
    h.id,
    h.name,
    h.code,
    h.level,
    h.city,
    h.region,
    h.phone,
    h.emergency_phone,
    h.email,
    h.latitude,
    h.longitude,
    h.timezone,
    round(dist.km::numeric, 2),
    h.accepts_referrals,
    coalesce(hr.er_open, false),
    hr.diversion_reason,
    coalesce(hr.operating_rooms_total, 0),
    coalesce(hr.operating_rooms_functional, 0),
    coalesce(hr.resident_surgeon_available, false),
    coalesce(hr.anesthetist_available, false),
    coalesce(hr.obstetric_theatre_available, false),
    coalesce(hr.neurosurgery_available, false),
    coalesce(hr.cath_lab_available, false),
    coalesce(hr.icu_beds_total, 0),
    coalesce(hr.icu_beds_available, 0),
    coalesce(hr.nicu_beds_total, 0),
    coalesce(hr.nicu_beds_available, 0),
    coalesce(hr.neonatal_resuscitation_available, false),
    coalesce(hr.ventilators_total, 0),
    coalesce(hr.ventilators_available, 0),
    coalesce(hr.oxygen_supply_percent, 0),
    coalesce(hr.isolation_beds_available, 0),
    coalesce(hr.general_beds_total, 0),
    coalesce(hr.general_beds_available, 0),
    coalesce(hr.burn_unit_available, false),
    coalesce(hr.dialysis_available, false),
    coalesce(hr.blood_bank_functional, false),
    coalesce(hr.ct_functional, false),
    coalesce(hr.mri_functional, false),
    coalesce(hr.xray_functional, false),
    coalesce(hr.ultrasound_functional, false),
    coalesce(hr.ambulances_available, 0),
    coalesce(hr.power_backup_available, false),
    hr.updated_at,
    dep.oldest_update_at,
    coalesce(dep.total, 0),
    coalesce(dep.reporting, 0),
    coalesce(bl.units_total, 0),
    coalesce(bl.stock, '{}'::jsonb),
    coalesce(rf.received, 0),
    coalesce(rf.accepted, 0),
    rf.avg_response
  from public.hospitals h
  cross join lateral (
    select 2 * 6371.0088 * asin(least(1, sqrt(
      power(sin(radians(h.latitude::double precision - v_origin_lat) / 2), 2)
      + cos(radians(v_origin_lat)) * cos(radians(h.latitude::double precision))
      * power(sin(radians(h.longitude::double precision - v_origin_lng) / 2), 2)
    ))) as km
  ) dist
  left join public.hospital_resources hr on hr.hospital_id = h.id
  left join lateral (
    select
      count(*)::integer as total,
      count(lu.last_at)::integer as reporting,
      min(lu.last_at) as oldest_update_at
    from public.departments d
    left join lateral (
      select max(ru.submitted_at) as last_at
      from public.readiness_updates ru
      where ru.department_id = d.id
    ) lu on true
    where d.hospital_id = h.id
      and d.is_active
      and d.requires_shift_update
  ) dep on true
  left join lateral (
    select
      coalesce(sum(b.units), 0)::integer as units_total,
      coalesce(jsonb_object_agg(b.blood_group, b.units), '{}'::jsonb) as stock
    from public.blood_stock b
    where b.hospital_id = h.id
  ) bl on true
  left join lateral (
    select
      count(*)::integer as received,
      count(*) filter (where r.status in ('accepted', 'in_transit', 'completed'))::integer as accepted,
      round(avg(r.response_seconds) filter (where r.response_seconds is not null), 0) as avg_response
    from public.referrals r
    where r.receiving_hospital_id = h.id
      and r.requested_at >= now() - interval '180 days'
  ) rf on true
  where h.is_active
    and h.id <> p_origin_hospital_id
    and (
      v_deg_lat >= 90
      or h.latitude between (v_origin_lat - v_deg_lat)::numeric and (v_origin_lat + v_deg_lat)::numeric
    )
    and (
      v_deg_lng >= 180
      or v_origin_lng - v_deg_lng < -180
      or v_origin_lng + v_deg_lng > 180
      or h.longitude between (v_origin_lng - v_deg_lng)::numeric and (v_origin_lng + v_deg_lng)::numeric
    )
    and dist.km <= v_max_km
  order by dist.km asc;
end;
$$;

-- -----------------------------------------------------------------------------
-- 10. Notification fan-out follows scope
-- -----------------------------------------------------------------------------

-- A message reaches the other side's referral desk, plus -- on the requesting
-- side -- the person who raised the referral and the department it came from.
-- No longer every shift in-charge in the building.
create or replace function public.notify_on_message()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_referral record;
  v_target uuid;
  v_sender text;
begin
  select r.id, r.reference_number, r.requesting_hospital_id, r.receiving_hospital_id,
         r.requested_by, r.origin_department_id
  into v_referral
  from public.referrals r
  where r.id = new.referral_id;

  if not found then
    return new;
  end if;

  v_target := case
    when new.sender_hospital_id = v_referral.requesting_hospital_id
      then v_referral.receiving_hospital_id
    else v_referral.requesting_hospital_id
  end;

  if v_target is null then
    return new;
  end if;

  select h.name into v_sender
  from public.hospitals h
  where h.id = new.sender_hospital_id;

  insert into public.notifications (user_id, hospital_id, type, title, body, link, severity)
  select
    pr.id,
    v_target,
    'message_received',
    'New message on ' || v_referral.reference_number,
    coalesce(v_sender, 'The other facility') || ': ' || left(new.body, 140),
    '/referrals/' || v_referral.id::text,
    'info'
  from public.profiles pr
  where pr.hospital_id = v_target
    and pr.is_active
    and pr.id is distinct from new.sender_id
    and (
      pr.role in ('referral_coordinator', 'hospital_admin')
      or (
        v_target = v_referral.requesting_hospital_id
        and (
          pr.id = v_referral.requested_by
          or (
            v_referral.origin_department_id is not null
            and pr.department_id = v_referral.origin_department_id
            and pr.role in ('shift_in_charge', 'department_coordinator')
          )
        )
      )
    )
    and not exists (
      select 1 from public.notifications n
      where n.user_id = pr.id
        and n.type = 'message_received'
        and n.link = '/referrals/' || v_referral.id::text
        and not n.is_read
    );

  return new;
exception when others then
  return new;
end;
$$;

-- Overdue readiness reaches the hospital's administrators, as before, and now
-- also the department's own accounts -- their department, nobody else's.
create or replace function public.flag_overdue_readiness()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r record;
  v_elapsed integer;
  v_status text;
  v_shift_date date;
  v_shift_type text;
  v_shift_start timestamptz;
  v_link text;
  v_inserted integer;
  v_count integer := 0;
begin
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'Only an administrator can run the readiness sweep.' using errcode = '42501';
  end if;

  for r in
    select
      d.id as department_id,
      d.name as department_name,
      d.hospital_id,
      coalesce(h.timezone, 'Africa/Accra') as timezone,
      lu.last_at
    from public.departments d
    join public.hospitals h on h.id = d.hospital_id
    left join lateral (
      select max(ru.submitted_at) as last_at
      from public.readiness_updates ru
      where ru.department_id = d.id
    ) lu on true
    where d.is_active
      and d.requires_shift_update
      and h.is_active
  loop
    v_elapsed := public.shifts_elapsed(r.last_at, r.timezone);
    v_status := public.readiness_status(v_elapsed);
    continue when v_status = 'green';

    select s.shift_date, s.shift_type into v_shift_date, v_shift_type
    from public.shift_for(now(), r.timezone) s;

    v_shift_start := public.shift_start_at(v_shift_date, v_shift_type, r.timezone);
    v_link := '/readiness/' || r.department_id::text;

    insert into public.notifications (user_id, hospital_id, type, title, body, link, severity)
    select
      p.id,
      r.hospital_id,
      'readiness_overdue',
      r.department_name || ' readiness is ' ||
        case when v_status = 'red' then 'stale' else 'overdue' end,
      case
        when v_status = 'red'
        then r.department_name || ' has not reported for three or more shifts.'
        else r.department_name || ' missed the last shift update.'
      end,
      v_link,
      case when v_status = 'red' then 'critical' else 'warning' end
    from public.profiles p
    where p.hospital_id = r.hospital_id
      and p.is_active
      and (
        p.role = 'hospital_admin'
        or (p.role in ('shift_in_charge', 'department_coordinator') and p.department_id = r.department_id)
      )
      and not exists (
        select 1
        from public.notifications n
        where n.user_id = p.id
          and n.type = 'readiness_overdue'
          and n.link = v_link
          and n.created_at >= v_shift_start
      );

    get diagnostics v_inserted = row_count;
    v_count := v_count + v_inserted;
  end loop;

  return v_count;
end;
$$;

-- -----------------------------------------------------------------------------
-- 11. Referral attachments
-- -----------------------------------------------------------------------------
-- X-rays, scans and results travel with the referral while it is live. The
-- rows follow the referral's visibility exactly, and the files sit in a
-- private bucket under <referral_id>/, read only through signed URLs.

create table if not exists public.referral_attachments (
  id uuid primary key default gen_random_uuid(),
  referral_id uuid not null references public.referrals (id) on delete cascade,
  hospital_id uuid references public.hospitals (id) on delete set null,
  uploaded_by uuid references public.profiles (id) on delete set null,
  file_name text not null check (length(btrim(file_name)) between 1 and 200),
  content_type text not null,
  size_bytes integer not null check (size_bytes between 1 and 20971520),
  storage_path text not null unique,
  caption text check (caption is null or length(caption) <= 200),
  created_at timestamptz not null default now()
);

create index if not exists referral_attachments_referral_idx
  on public.referral_attachments (referral_id, created_at);

alter table public.referral_attachments enable row level security;

-- Uploader and hospital are stamped server-side, like a message's sender.
create or replace function public.stamp_attachment_owner()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  new.uploaded_by := coalesce(auth.uid(), new.uploaded_by);
  new.hospital_id := coalesce(public.current_user_hospital(), new.hospital_id);
  return new;
end;
$$;

drop trigger if exists referral_attachments_stamp_owner on public.referral_attachments;
create trigger referral_attachments_stamp_owner
before insert on public.referral_attachments
for each row execute function public.stamp_attachment_owner();

create or replace function public.audit_attachment()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.log_audit_event_internal(
    'referral.attach',
    'referral',
    new.referral_id,
    jsonb_build_object(
      'attachment_id', new.id,
      'file_name', new.file_name,
      'content_type', new.content_type,
      'size_bytes', new.size_bytes
    )
  );
  return new;
exception when others then
  return new;
end;
$$;

drop trigger if exists referral_attachments_audit on public.referral_attachments;
create trigger referral_attachments_audit
after insert on public.referral_attachments
for each row execute function public.audit_attachment();

drop policy if exists referral_attachments_select on public.referral_attachments;
create policy referral_attachments_select on public.referral_attachments
for select to authenticated
using (public.can_view_referral(referral_id));

drop policy if exists referral_attachments_insert on public.referral_attachments;
create policy referral_attachments_insert on public.referral_attachments
for insert to authenticated
with check (
  public.has_capability('messaging:use')
  and uploaded_by = auth.uid()
  and public.can_view_referral(referral_id)
  and exists (
    select 1 from public.referrals r
    where r.id = referral_id and r.status in ('pending', 'accepted', 'in_transit')
  )
);

drop policy if exists referral_attachments_delete on public.referral_attachments;
create policy referral_attachments_delete on public.referral_attachments
for delete to authenticated
using (
  public.is_super_admin()
  or (
    uploaded_by = auth.uid()
    and exists (
      select 1 from public.referrals r
      where r.id = referral_id and r.status in ('pending', 'accepted', 'in_transit')
    )
  )
);

grant select, insert, delete on public.referral_attachments to authenticated;

comment on table public.referral_attachments is
  'Files attached to a live referral. Visibility follows can_view_referral(); objects live in the private referral-attachments bucket under <referral_id>/.';

-- The bucket path is <referral_id>/<file>; this reads the referral back out of
-- it without letting a malformed name raise.
create or replace function public.attachment_referral_id(p_name text)
returns uuid
language plpgsql
immutable
as $$
begin
  return split_part(p_name, '/', 1)::uuid;
exception when others then
  return null;
end;
$$;

do $$
begin
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values (
    'referral-attachments', 'referral-attachments', false, 20971520,
    array['image/png', 'image/jpeg', 'image/webp', 'application/pdf']
  )
  on conflict (id) do update
    set public = false,
        file_size_limit = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types;

  drop policy if exists referral_attachments_read on storage.objects;
  create policy referral_attachments_read on storage.objects
  for select using (
    bucket_id = 'referral-attachments'
    and public.can_view_referral(public.attachment_referral_id(name))
  );

  drop policy if exists referral_attachments_write on storage.objects;
  create policy referral_attachments_write on storage.objects
  for insert with check (
    bucket_id = 'referral-attachments'
    and public.has_capability('messaging:use')
    and public.can_view_referral(public.attachment_referral_id(name))
  );

  drop policy if exists referral_attachments_remove on storage.objects;
  create policy referral_attachments_remove on storage.objects
  for delete using (
    bucket_id = 'referral-attachments'
    and (public.is_super_admin() or owner = auth.uid())
  );
exception when insufficient_privilege or undefined_table then
  raise notice 'Skipped storage bucket setup: create the private "referral-attachments" bucket in the dashboard instead.';
end;
$$;

-- -----------------------------------------------------------------------------
-- Grants and schema reload
-- -----------------------------------------------------------------------------

revoke execute on function public.current_user_level() from public;
revoke execute on function public.accessible_department_ids() from public;
revoke execute on function public.can_view_department(uuid) from public;
revoke execute on function public.can_manage_department(uuid) from public;
revoke execute on function public.referral_policy_allows(text, uuid) from public;
revoke execute on function public.can_create_referral() from public;
revoke execute on function public.can_view_referral(uuid) from public;

notify pgrst, 'reload schema';
