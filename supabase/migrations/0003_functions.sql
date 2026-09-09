-- =============================================================================
-- FERN -- 0003_functions.sql
-- The RPC surface the client calls, plus the shift/resource helpers it is
-- built on.
--
-- Everything here is SECURITY DEFINER, which means RLS does not apply inside
-- the body. That is the point -- these functions have to touch the other
-- hospital's notifications, the audit log and the referral timeline -- but it
-- also means each one re-checks authorisation itself and never trusts a
-- caller-supplied identity. `set search_path` is pinned on every function so
-- the tables cannot be swapped out from under a definer-rights body.
-- =============================================================================

-- Signatures change over the life of a project and `create or replace` refuses
-- to change a return type, so drop first. (The 0002 helpers are referenced by
-- policies and are replaced in place instead.)
drop function if exists public.shift_for(timestamptz, text);
drop function if exists public.shift_index(date, text);
drop function if exists public.shift_start_at(date, text, text);
drop function if exists public.shifts_elapsed(timestamptz, text);
drop function if exists public.readiness_status(integer);
drop function if exists public.resource_column(text);
drop function if exists public.resource_total_column(text);
drop function if exists public.resource_kind(text);
drop function if exists public.template_resources(text);
drop function if exists public.template_collects_blood_stock(text);
drop function if exists public.template_controls_er_status(text);
drop function if exists public.log_audit_event(text, text, uuid, jsonb);
drop function if exists public.log_audit_event_internal(text, text, uuid, jsonb);
drop function if exists public.notify_on_message() cascade;
drop function if exists public.record_login();
drop function if exists public.mark_notifications_read(uuid[]);
drop function if exists public.submit_readiness(uuid, jsonb, jsonb, text);
drop function if exists public.get_referral_candidates(uuid, uuid, numeric);
drop function if exists public.create_referral(uuid, uuid, text, text, text, text, text, text[], jsonb, jsonb, numeric, numeric);
drop function if exists public.update_referral_status(uuid, text, text, text);
drop function if exists public.flag_overdue_readiness();
drop function if exists public.hospital_performance(uuid, timestamptz, timestamptz);
drop function if exists public.referral_analytics(uuid, timestamptz, timestamptz);
drop function if exists public.compliance_report(uuid, integer);

-- =============================================================================
-- Resource catalogue helpers -- the SQL mirror of RESOURCES / DEPARTMENT_TEMPLATES
-- =============================================================================

create function public.resource_column(p_key text)
returns text
language sql
immutable
parallel safe
as $$
  select case p_key
    when 'operating_room' then 'operating_rooms_functional'
    when 'resident_surgeon' then 'resident_surgeon_available'
    when 'anesthetist' then 'anesthetist_available'
    when 'obstetric_theatre' then 'obstetric_theatre_available'
    when 'neurosurgery' then 'neurosurgery_available'
    when 'cath_lab' then 'cath_lab_available'
    when 'icu_bed' then 'icu_beds_available'
    when 'nicu_bed' then 'nicu_beds_available'
    when 'neonatal_resuscitation' then 'neonatal_resuscitation_available'
    when 'ventilator' then 'ventilators_available'
    when 'oxygen' then 'oxygen_supply_percent'
    when 'isolation_bed' then 'isolation_beds_available'
    when 'general_bed' then 'general_beds_available'
    when 'burn_unit' then 'burn_unit_available'
    when 'dialysis' then 'dialysis_available'
    when 'blood_bank' then 'blood_bank_functional'
    when 'ct_scan' then 'ct_functional'
    when 'mri' then 'mri_functional'
    when 'xray' then 'xray_functional'
    when 'ultrasound' then 'ultrasound_functional'
    when 'ambulance' then 'ambulances_available'
    when 'power_backup' then 'power_backup_available'
    else null
  end
$$;

create function public.resource_total_column(p_key text)
returns text
language sql
immutable
parallel safe
as $$
  select case p_key
    when 'operating_room' then 'operating_rooms_total'
    when 'icu_bed' then 'icu_beds_total'
    when 'nicu_bed' then 'nicu_beds_total'
    when 'ventilator' then 'ventilators_total'
    when 'general_bed' then 'general_beds_total'
    else null
  end
$$;

create function public.resource_kind(p_key text)
returns text
language sql
immutable
parallel safe
as $$
  select case p_key
    when 'operating_room' then 'count'
    when 'icu_bed' then 'count'
    when 'nicu_bed' then 'count'
    when 'ventilator' then 'count'
    when 'isolation_bed' then 'count'
    when 'general_bed' then 'count'
    when 'ambulance' then 'count'
    when 'oxygen' then 'percent'
    else 'boolean'
  end
$$;

create function public.template_resources(p_template_key text)
returns text[]
language sql
immutable
parallel safe
as $$
  select case p_template_key
    when 'emergency' then array['general_bed', 'isolation_bed', 'ambulance', 'power_backup', 'oxygen']
    when 'theatre' then array['operating_room', 'resident_surgeon', 'anesthetist']
    when 'icu' then array['icu_bed', 'ventilator', 'oxygen', 'dialysis']
    when 'nicu' then array['nicu_bed', 'neonatal_resuscitation', 'oxygen']
    when 'maternity' then array['obstetric_theatre', 'neonatal_resuscitation', 'anesthetist']
    when 'surgery' then array['resident_surgeon', 'neurosurgery', 'operating_room']
    when 'radiology' then array['ct_scan', 'mri', 'xray', 'ultrasound']
    when 'blood_bank' then array['blood_bank']
    when 'renal' then array['dialysis']
    when 'cardiology' then array['cath_lab']
    when 'burns' then array['burn_unit', 'isolation_bed']
    when 'general' then array['general_bed', 'oxygen']
    else array[]::text[]
  end
$$;

create function public.template_collects_blood_stock(p_template_key text)
returns boolean
language sql
immutable
parallel safe
as $$
  select p_template_key = 'blood_bank'
$$;

create function public.template_controls_er_status(p_template_key text)
returns boolean
language sql
immutable
parallel safe
as $$
  select p_template_key = 'emergency'
$$;

-- =============================================================================
-- Shift arithmetic -- the SQL twin of src/domain/shifts.ts
-- =============================================================================

create function public.shift_for(
  p_at timestamptz,
  p_timezone text default 'Africa/Accra',
  out shift_date date,
  out shift_type text
)
language plpgsql
stable
as $$
declare
  v_local timestamp;
  v_hour integer;
begin
  begin
    v_local := p_at at time zone coalesce(nullif(btrim(p_timezone), ''), 'Africa/Accra');
  exception when others then
    -- An unknown IANA zone degrades to UTC rather than failing a shift update.
    v_local := p_at at time zone 'UTC';
  end;

  v_hour := extract(hour from v_local)::integer;

  if v_hour >= 7 and v_hour < 15 then
    shift_date := v_local::date;
    shift_type := 'morning';
  elsif v_hour >= 15 and v_hour < 23 then
    shift_date := v_local::date;
    shift_type := 'afternoon';
  else
    shift_type := 'night';
    -- The night shift runs 23:00-07:00 and is filed under the date it STARTED,
    -- so 02:00 on the 5th belongs to the night shift of the 4th.
    shift_date := case when v_hour < 7 then v_local::date - 1 else v_local::date end;
  end if;
end;
$$;

create function public.shift_index(p_shift_date date, p_shift_type text)
returns bigint
language sql
immutable
parallel safe
as $$
  -- Consecutive shifts differ by exactly one, which is what makes staleness a
  -- subtraction. Matches ShiftRef.index in src/domain/shifts.ts.
  select (p_shift_date - date '1970-01-01')::bigint * 3
       + case p_shift_type when 'morning' then 0 when 'afternoon' then 1 when 'night' then 2 else 0 end
$$;

create function public.shift_start_at(
  p_shift_date date,
  p_shift_type text,
  p_timezone text default 'Africa/Accra'
)
returns timestamptz
language plpgsql
stable
as $$
declare
  v_time time := case p_shift_type
    when 'morning' then time '07:00'
    when 'afternoon' then time '15:00'
    else time '23:00'
  end;
begin
  return (p_shift_date + v_time) at time zone coalesce(nullif(btrim(p_timezone), ''), 'Africa/Accra');
exception when others then
  return (p_shift_date + v_time) at time zone 'UTC';
end;
$$;

create function public.shifts_elapsed(p_since timestamptz, p_timezone text default 'Africa/Accra')
returns integer
language plpgsql
stable
as $$
declare
  v_now_date date;
  v_now_type text;
  v_then_date date;
  v_then_type text;
begin
  -- Null means "never reported": the caller (readiness_status) reads that as
  -- maximally stale, not as freshly compliant.
  if p_since is null then
    return null;
  end if;

  select s.shift_date, s.shift_type into v_now_date, v_now_type
  from public.shift_for(now(), p_timezone) s;

  select s.shift_date, s.shift_type into v_then_date, v_then_type
  from public.shift_for(p_since, p_timezone) s;

  return greatest(
    0,
    (public.shift_index(v_now_date, v_now_type) - public.shift_index(v_then_date, v_then_type))::integer
  );
end;
$$;

create function public.readiness_status(p_shifts_elapsed integer)
returns text
language sql
immutable
parallel safe
as $$
  -- Green: updated this shift. Yellow: missed the last shift.
  -- Red: three or more shifts stale, or never reported at all.
  select case
    when p_shifts_elapsed is null then 'red'
    when p_shifts_elapsed >= 3 then 'red'
    when p_shifts_elapsed >= 1 then 'yellow'
    else 'green'
  end
$$;

-- =============================================================================
-- Audit + session bookkeeping
-- =============================================================================

-- Internal writer. NOT granted to `authenticated`: the DEFINER RPCs call it to
-- record events the user did not ask for directly (referral.create, auth.login,
-- readiness.submit), so it accepts any action in the catalogue.
create function public.log_audit_event_internal(
  p_action text,
  p_entity_type text default null,
  p_entity_id uuid default null,
  p_details jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  -- Identity comes from the signed JWT, never from profiles.email, which the
  -- user can edit: the audit log is the only account of what happened during an
  -- incident, so its actor column must not be self-service.
  v_email text := nullif(auth.jwt() ->> 'email', '');
begin
  insert into public.audit_logs (
    actor_id, actor_email, actor_role, hospital_id, action, entity_type, entity_id, details
  )
  select v_uid, coalesce(v_email, p.email), p.role, p.hospital_id, p_action, p_entity_type,
         p_entity_id, coalesce(p_details, '{}'::jsonb)
  from public.profiles p
  where p.id = v_uid;

  if not found then
    -- Service role, cron or a user whose profile has not landed yet: the event
    -- still gets recorded, just without the actor decoration.
    insert into public.audit_logs (actor_id, actor_email, action, entity_type, entity_id, details)
    values (v_uid, v_email, p_action, p_entity_type, p_entity_id, coalesce(p_details, '{}'::jsonb));
  end if;
end;
$$;

-- Client-callable wrapper. The security-relevant events are all emitted
-- server-side by the DEFINER RPCs above, so this surface only needs to cover
-- administrative CRUD -- and it refuses anything else, because an audit log an
-- ordinary user can write arbitrary rows into is not an audit log.
create function public.log_audit_event(
  p_action text,
  p_entity_type text default null,
  p_entity_id uuid default null,
  p_details jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is not null then
    if not public.has_capability('admin:hospital') then
      raise exception 'Your role cannot write audit events.' using errcode = '42501';
    end if;
    if p_action not in (
      'hospital.create', 'hospital.update',
      'department.create', 'department.update',
      'user.invite', 'user.update_role', 'user.deactivate',
      'config.update', 'report.export'
    ) then
      raise exception 'Unknown audit action: %', p_action using errcode = '22023';
    end if;
  end if;

  perform public.log_audit_event_internal(p_action, p_entity_type, p_entity_id, p_details);
end;
$$;

create function public.record_login()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return;
  end if;

  update public.profiles set last_login_at = now() where id = v_uid;
  perform public.log_audit_event_internal('auth.login', 'profile', v_uid, '{}'::jsonb);
end;
$$;

create function public.mark_notifications_read(p_ids uuid[] default null)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_count integer;
begin
  if v_uid is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;

  update public.notifications n
  set is_read = true, read_at = now()
  where n.user_id = v_uid
    and n.is_read = false
    and (p_ids is null or n.id = any (p_ids));

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- =============================================================================
-- submit_readiness
-- =============================================================================

create function public.submit_readiness(
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

  if not public.is_super_admin()
     and v_dept.hospital_id is distinct from public.current_user_hospital() then
    raise exception 'You can only submit readiness for your own hospital.' using errcode = '42501';
  end if;

  select h.timezone into v_timezone from public.hospitals h where h.id = v_dept.hospital_id;

  select s.shift_date, s.shift_type into v_shift_date, v_shift_type
  from public.shift_for(now(), coalesce(v_timezone, 'Africa/Accra')) s;

  v_payload := coalesce(p_payload, '{}'::jsonb);
  if jsonb_typeof(v_payload) <> 'object' then
    raise exception 'The readiness payload must be a JSON object.' using errcode = '22023';
  end if;

  -- The client sends a ReadinessPayload ({ resources, blood_stock, er_open,
  -- diversion_reason }). A flat map of resource keys is accepted too.
  if v_payload ? 'resources' and jsonb_typeof(v_payload -> 'resources') = 'object' then
    v_resources := v_payload -> 'resources';
  else
    v_resources := v_payload - 'resources' - 'blood_stock' - 'er_open' - 'diversion_reason';
  end if;

  -- Capacity denominators ride alongside the readings: the form collects
  -- "8 of 12 ICU beds free", and the confirmation modal shows the user a change
  -- to the 12. Dropping them here would make that confirmation a lie, and would
  -- leave a total that can only ever ratchet upwards.
  if v_payload ? 'totals' and jsonb_typeof(v_payload -> 'totals') = 'object' then
    v_totals := v_payload -> 'totals';
  else
    v_totals := '{}'::jsonb;
  end if;

  v_blood := coalesce(p_blood_stock, v_payload -> 'blood_stock');
  v_allowed := public.template_resources(v_dept.template_key);

  -- Guarantee a snapshot row exists before the dynamic UPDATE below.
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
            -- The in-charge restated the capacity: take it, but never below the
            -- number they just reported free, or the available <= total CHECK
            -- would reject the whole shift update.
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
            -- No capacity reported. A ward can still legitimately report more
            -- free beds than the capacity an admin last recorded, so raise the
            -- denominator rather than failing the update.
            v_sets := v_sets
              || format('%I = greatest(%I, %L)', v_total_column, v_total_column, v_num::integer);
          end if;
        end if;
      end if;
    end if;
  end loop;

  -- ER open / diversion is hospital-wide state, owned by the emergency form.
  if public.template_controls_er_status(v_dept.template_key) and v_payload ? 'er_open' then
    v_bool := coalesce(lower(v_payload ->> 'er_open') in ('true', 't', 'yes', 'y', '1'), true);
    v_sets := v_sets || format('er_open = %L', v_bool);
    v_sets := v_sets || format(
      'diversion_reason = %L',
      case when v_bool then null else nullif(btrim(coalesce(v_payload ->> 'diversion_reason', '')), '') end
    );
  end if;

  v_sets := v_sets || format('updated_by = %L', v_uid);
  v_sets := v_sets || 'updated_at = now()';

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

-- =============================================================================
-- get_referral_candidates
-- =============================================================================

create function public.get_referral_candidates(
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
  -- Half-width of a bounding box that is guaranteed to contain every hospital
  -- within v_max_km. Used only to pre-filter on the (latitude, longitude)
  -- index; the exact haversine below still decides who is actually in range.
  v_deg_lat double precision;
  v_deg_lng double precision;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  if public.current_user_hospital() is null and not public.is_super_admin() then
    raise exception 'Your account is not attached to a hospital yet.' using errcode = '42501';
  end if;
  -- This function is SECURITY DEFINER and reports per-hospital referral volume
  -- and response times, which referrals' own RLS would not disclose. Restrict it
  -- to the people who actually raise referrals, and make them ask about their
  -- own hospital -- otherwise any signed-in viewer could enumerate the network's
  -- referral statistics by walking hospital ids.
  if not public.has_capability('referral:create') then
    raise exception 'Your role cannot raise referrals.' using errcode = '42501';
  end if;
  if not public.is_super_admin()
     and p_origin_hospital_id is distinct from public.current_user_hospital() then
    raise exception 'You can only search from your own hospital.' using errcode = '42501';
  end if;

  -- An uncapped radius turns a ranking query into a network-wide export.
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
  -- A degree of longitude shrinks towards the poles, so size it at the box edge
  -- furthest from the equator -- that keeps the box a superset, never a filter
  -- that quietly drops a hospital that was actually in range.
  v_deg_lng := v_max_km
    / (111.045 * greatest(0.02, cos(radians(least(89.0, abs(v_origin_lat) + v_deg_lat)))));

  -- p_emergency_type_id is not used to filter candidates: requirement weighting
  -- happens in src/domain/scoring.ts so the coordinator can see *why* a nearby
  -- hospital scored badly. It is validated so a stale id fails loudly here
  -- rather than producing a silently unweighted ranking.
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
  -- Haversine, matching haversineKm() in src/domain/geo.ts down to the mean
  -- Earth radius. least(1, ...) guards asin() against a sqrt that floating
  -- point nudged just past 1 for two nearly identical coordinates.
  cross join lateral (
    select 2 * 6371.0088 * asin(least(1, sqrt(
      power(sin(radians(h.latitude::double precision - v_origin_lat) / 2), 2)
      + cos(radians(v_origin_lat)) * cos(radians(h.latitude::double precision))
      * power(sin(radians(h.longitude::double precision - v_origin_lng) / 2), 2)
    ))) as km
  ) dist
  -- LEFT JOIN, so a hospital that has never filed a snapshot still appears in
  -- the ranking (scored on zeros) instead of vanishing from the list.
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
    -- Bounds are cast to numeric so the comparison stays numeric-to-numeric and
    -- the (latitude, longitude) index remains usable. Both clauses fall away
    -- entirely for a radius big enough to wrap the globe.
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

-- =============================================================================
-- create_referral
-- =============================================================================

create function public.create_referral(
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

  -- Drop anything that is not a live resource key rather than failing the
  -- referral over a stale checkbox in an old client build.
  select coalesce(array_agg(k order by k), '{}'::text[])
  into v_resources
  from unnest(coalesce(p_required_resources, '{}'::text[])) as k
  where public.resource_column(k) is not null;

  insert into public.referrals (
    requesting_hospital_id, receiving_hospital_id, emergency_type_id, urgency, status,
    patient_ref, patient_age_band, patient_sex, clinical_summary, required_resources,
    score_snapshot, candidate_snapshot, distance_km, eta_minutes, requested_by, requested_at
  )
  values (
    v_hospital,
    p_receiving_hospital_id,
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
      'emergency_type', v_type.code,
      'urgency', v_urgency
    )
  );

  select to_jsonb(r) into v_result from public.referrals r where r.id = v_id;
  return v_result;
end;
$$;

-- =============================================================================
-- update_referral_status
-- =============================================================================

create function public.update_referral_status(
  p_referral_id uuid,
  p_status text,
  p_notes text default null,
  p_outcome text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_hospital uuid := public.current_user_hospital();
  v_referral public.referrals%rowtype;
  v_is_requester boolean;
  v_is_receiver boolean;
  v_super boolean := public.is_super_admin();
  v_allowed text[];
  v_first_response boolean;
  v_target_hospital uuid;
  v_type text;
  v_title text;
  v_severity text := 'info';
  v_result jsonb;
begin
  if v_uid is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;

  select * into v_referral from public.referrals r where r.id = p_referral_id for update;
  if not found then
    raise exception 'Referral not found.' using errcode = 'P0002';
  end if;

  v_is_requester := v_referral.requesting_hospital_id = v_hospital;
  v_is_receiver := v_referral.receiving_hospital_id is not distinct from v_hospital
                   and v_hospital is not null;

  if not (v_is_requester or v_is_receiver or v_super) then
    raise exception 'This referral does not involve your hospital.' using errcode = '42501';
  end if;
  if not public.has_capability('referral:respond') then
    raise exception 'Your role cannot act on referrals.' using errcode = '42501';
  end if;

  -- State machine. Anything not listed here is terminal.
  v_allowed := case v_referral.status
    when 'pending' then array['accepted', 'declined', 'cancelled', 'expired']
    when 'accepted' then array['in_transit', 'cancelled']
    when 'in_transit' then array['completed', 'cancelled']
    else array[]::text[]
  end;

  if not (p_status = any (v_allowed)) then
    raise exception 'A % referral cannot move to %.', v_referral.status, p_status
      using errcode = '22023';
  end if;

  -- Who may drive which transition.
  if p_status in ('accepted', 'declined') and not (v_is_receiver or v_super) then
    raise exception 'Only the receiving hospital can accept or decline a referral.'
      using errcode = '42501';
  end if;
  if p_status = 'cancelled' and not (v_is_requester or v_super) then
    raise exception 'Only the referring hospital can cancel a referral.' using errcode = '42501';
  end if;
  if p_status = 'expired' and not (v_is_requester or v_super) then
    raise exception 'Only the referring hospital can expire a referral.' using errcode = '42501';
  end if;

  if p_status = 'completed'
     and p_outcome is not null
     and p_outcome not in (
       'transferred', 'stabilised_on_site', 'referred_elsewhere',
       'died_before_transfer', 'declined_by_patient', 'other'
     ) then
    raise exception 'Unknown outcome: %', p_outcome using errcode = '22023';
  end if;

  v_first_response := v_referral.responded_at is null and p_status in ('accepted', 'declined');

  update public.referrals r
  set status = p_status,
      responded_by = case when v_first_response then v_uid else r.responded_by end,
      responded_at = case when v_first_response then now() else r.responded_at end,
      response_seconds = case
        when v_first_response then greatest(0, extract(epoch from (now() - r.requested_at))::integer)
        else r.response_seconds
      end,
      accepted_at = case when p_status = 'accepted' then now() else r.accepted_at end,
      in_transit_at = case when p_status = 'in_transit' then now() else r.in_transit_at end,
      completed_at = case when p_status = 'completed' then now() else r.completed_at end,
      cancelled_at = case when p_status in ('cancelled', 'expired') then now() else r.cancelled_at end,
      decline_reason = case
        when p_status = 'declined' then nullif(btrim(coalesce(p_notes, '')), '')
        else r.decline_reason
      end,
      outcome = case
        when p_status = 'completed' then coalesce(p_outcome, 'transferred')
        else r.outcome
      end,
      outcome_notes = case
        when p_status = 'completed' then nullif(btrim(coalesce(p_notes, '')), '')
        else r.outcome_notes
      end
  where r.id = p_referral_id;

  insert into public.referral_events (
    referral_id, event_type, from_status, to_status, actor_id, actor_hospital_id, notes
  )
  values (
    p_referral_id,
    'referral.' || p_status,
    v_referral.status,
    p_status,
    v_uid,
    v_hospital,
    nullif(btrim(coalesce(p_notes, '')), '')
  );

  -- Tell the other side. The acting hospital already knows.
  v_target_hospital := case
    when v_hospital = v_referral.requesting_hospital_id then v_referral.receiving_hospital_id
    else v_referral.requesting_hospital_id
  end;

  v_type := case p_status
    when 'accepted' then 'referral_accepted'
    when 'declined' then 'referral_declined'
    when 'in_transit' then 'referral_in_transit'
    when 'completed' then 'referral_completed'
    when 'cancelled' then 'referral_cancelled'
    else 'system'
  end;

  v_title := case p_status
    when 'accepted' then 'Referral ' || v_referral.reference_number || ' accepted'
    when 'declined' then 'Referral ' || v_referral.reference_number || ' declined'
    when 'in_transit' then 'Referral ' || v_referral.reference_number || ' is in transit'
    when 'completed' then 'Referral ' || v_referral.reference_number || ' completed'
    when 'cancelled' then 'Referral ' || v_referral.reference_number || ' cancelled'
    else 'Referral ' || v_referral.reference_number || ' expired'
  end;

  if p_status in ('declined', 'cancelled', 'expired') then
    v_severity := 'warning';
  elsif v_referral.urgency = 'critical' and p_status = 'in_transit' then
    v_severity := 'critical';
  end if;

  insert into public.notifications (user_id, hospital_id, type, title, body, link, severity)
  select distinct
    p.id,
    v_target_hospital,
    v_type,
    v_title,
    nullif(btrim(coalesce(p_notes, '')), ''),
    '/referrals/' || p_referral_id::text,
    v_severity
  from public.profiles p
  where p.is_active
    and p.id <> v_uid
    and (
      (p.hospital_id = v_target_hospital and p.role in ('referral_coordinator', 'hospital_admin'))
      -- The coordinator who raised it hears about it whatever their role.
      or p.id = v_referral.requested_by
    );

  perform public.log_audit_event_internal(
    -- Verbs come from AUDIT_ACTIONS in constants.ts so the admin log filter
    -- can enumerate them; an expiry is recorded as the cancellation it is,
    -- with the real status kept in `details`.
    'referral.' || case p_status
      when 'accepted' then 'accept'
      when 'declined' then 'decline'
      when 'in_transit' then 'in_transit'
      when 'completed' then 'complete'
      else 'cancel'
    end,
    'referral',
    p_referral_id,
    jsonb_build_object(
      'reference_number', v_referral.reference_number,
      'from_status', v_referral.status,
      'to_status', p_status,
      'outcome', p_outcome
    )
  );

  select to_jsonb(r) into v_result from public.referrals r where r.id = p_referral_id;
  return v_result;
end;
$$;

-- =============================================================================
-- flag_overdue_readiness -- scheduled by pg_cron, see supabase/README.md
-- =============================================================================

-- =============================================================================
-- messages -> notifications
-- =============================================================================
-- Without this, a reply only reaches someone already sitting on the referral
-- page with the realtime subscription mounted. The bell is how a coordinator
-- who has navigated away learns the other hospital answered.

-- Feature C ("automatic alerts when a department fails to update") depends on
-- flag_overdue_readiness() actually running. Schedule it here so a fresh deploy
-- has working alerting rather than a correct function nobody calls. Guarded:
-- pg_cron may not be enabled, and the migration must not fail if it is not.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.unschedule('fern-readiness-sweep')
    where exists (select 1 from cron.job where jobname = 'fern-readiness-sweep');
    perform cron.schedule(
      'fern-readiness-sweep',
      '*/30 * * * *',
      $cron$select public.flag_overdue_readiness()$cron$
    );
  end if;
exception when others then
  raise notice 'pg_cron not scheduled (%). Schedule flag_overdue_readiness() manually - see docs/DEPLOYMENT.md.', sqlerrm;
end;
$$;

create function public.notify_on_message()
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
  select r.id, r.reference_number, r.requesting_hospital_id, r.receiving_hospital_id
  into v_referral
  from public.referrals r
  where r.id = new.referral_id;

  if not found then
    return new;
  end if;

  -- Notify the side that did not write the message.
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

  -- One unread bell per thread, not one per message: if the recipient has not
  -- yet read the last alert for this referral, they already know to look.
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
    and pr.role in ('referral_coordinator', 'hospital_admin', 'shift_in_charge')
    and not exists (
      select 1 from public.notifications n
      where n.user_id = pr.id
        and n.type = 'message_received'
        and n.link = '/referrals/' || v_referral.id::text
        and not n.is_read
    );

  return new;
exception when others then
  -- A failed bell must never cost the clinician their message.
  return new;
end;
$$;

drop trigger if exists on_message_created on public.messages;
create trigger on_message_created
after insert on public.messages
for each row execute function public.notify_on_message();

create function public.flag_overdue_readiness()
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
  -- auth.uid() is null when pg_cron or the service role runs this.
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
      and p.role = 'hospital_admin'
      -- One alert per department per shift, however often the sweep runs.
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

-- =============================================================================
-- Reporting
-- =============================================================================

create function public.hospital_performance(
  p_hospital_id uuid default null,
  p_from timestamptz default null,
  p_to timestamptz default null
)
returns table (
  hospital_id uuid,
  hospital_name text,
  referrals_sent integer,
  referrals_received integer,
  referrals_accepted integer,
  referrals_declined integer,
  referrals_completed integer,
  acceptance_rate numeric,
  avg_response_seconds numeric,
  avg_completion_minutes numeric,
  compliance_rate numeric
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_from timestamptz := coalesce(p_from, now() - interval '30 days');
  v_to timestamptz := coalesce(p_to, now());
  v_scope uuid;
  v_shifts integer;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  if not public.has_capability('reports:view') then
    raise exception 'Your role cannot view reports.' using errcode = '42501';
  end if;
  -- Without this, an unattached account would fall through to v_scope = null,
  -- which means "every hospital".
  if not public.has_capability('reports:view_all') and public.current_user_hospital() is null then
    raise exception 'Your account is not attached to a hospital yet.' using errcode = '42501';
  end if;

  -- Anyone without reports:view_all is pinned to their own hospital, whatever
  -- they asked for.
  v_scope := case
    when public.has_capability('reports:view_all') then p_hospital_id
    else public.current_user_hospital()
  end;

  v_shifts := greatest(1, ceil(extract(epoch from (v_to - v_from)) / 28800.0)::integer);

  return query
  select
    h.id,
    h.name,
    coalesce(sent.n, 0),
    coalesce(recv.n, 0),
    coalesce(recv.accepted, 0),
    coalesce(recv.declined, 0),
    coalesce(recv.completed, 0),
    case when coalesce(recv.n, 0) = 0 then 0::numeric
         else round(coalesce(recv.accepted, 0)::numeric * 100 / recv.n, 1) end,
    recv.avg_response,
    recv.avg_completion,
    case when coalesce(comp.expected, 0) = 0 then 0::numeric
         else round(least(100, coalesce(comp.actual, 0)::numeric * 100 / comp.expected), 1) end
  from public.hospitals h
  left join lateral (
    select count(*)::integer as n
    from public.referrals r
    where r.requesting_hospital_id = h.id
      and r.requested_at between v_from and v_to
  ) sent on true
  left join lateral (
    select
      count(*)::integer as n,
      count(*) filter (where r.accepted_at is not null)::integer as accepted,
      count(*) filter (where r.status = 'declined')::integer as declined,
      count(*) filter (where r.status = 'completed')::integer as completed,
      round(avg(r.response_seconds) filter (where r.response_seconds is not null), 0) as avg_response,
      round(
        avg(extract(epoch from (r.completed_at - r.requested_at)) / 60.0)
          filter (where r.completed_at is not null),
        1
      ) as avg_completion
    from public.referrals r
    where r.receiving_hospital_id = h.id
      and r.requested_at between v_from and v_to
  ) recv on true
  left join lateral (
    select
      (count(distinct d.id) * v_shifts)::integer as expected,
      count(ru.id)::integer as actual
    from public.departments d
    left join public.readiness_updates ru
      on ru.department_id = d.id
     and ru.submitted_at between v_from and v_to
    where d.hospital_id = h.id
      and d.is_active
      and d.requires_shift_update
  ) comp on true
  where h.is_active
    and (v_scope is null or h.id = v_scope)
  order by h.name;
end;
$$;

create function public.referral_analytics(
  p_hospital_id uuid default null,
  p_from timestamptz default null,
  p_to timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_from timestamptz := coalesce(p_from, now() - interval '30 days');
  v_to timestamptz := coalesce(p_to, now());
  v_scope uuid;
  v_result jsonb;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  if not public.has_capability('reports:view') then
    raise exception 'Your role cannot view reports.' using errcode = '42501';
  end if;
  -- Without this, an unattached account would fall through to v_scope = null,
  -- which means "every hospital".
  if not public.has_capability('reports:view_all') and public.current_user_hospital() is null then
    raise exception 'Your account is not attached to a hospital yet.' using errcode = '42501';
  end if;

  v_scope := case
    when public.has_capability('reports:view_all') then p_hospital_id
    else public.current_user_hospital()
  end;

  with base as (
    select r.*
    from public.referrals r
    where r.requested_at between v_from and v_to
      and (
        v_scope is null
        or r.requesting_hospital_id = v_scope
        or r.receiving_hospital_id = v_scope
      )
  )
  select jsonb_build_object(
    'total', (select count(*) from base),

    -- Every status and urgency is present, zeroed, so the UI can render a
    -- complete legend without patching gaps.
    'by_status', (
      select jsonb_object_agg(s.status, coalesce(c.n, 0))
      from unnest(array[
        'pending', 'accepted', 'declined', 'in_transit', 'completed', 'cancelled', 'expired'
      ]) as s(status)
      left join (select b.status, count(*) as n from base b group by b.status) c
        on c.status = s.status
    ),
    'by_urgency', (
      select jsonb_object_agg(u.urgency, coalesce(c.n, 0))
      from unnest(array['critical', 'urgent', 'routine']) as u(urgency)
      left join (select b.urgency, count(*) as n from base b group by b.urgency) c
        on c.urgency = u.urgency
    ),
    'by_emergency_type', (
      select coalesce(
        jsonb_agg(jsonb_build_object('code', t.code, 'name', t.name, 'count', t.n) order by t.n desc, t.name),
        '[]'::jsonb
      )
      from (
        select e.code, e.name, count(*)::integer as n
        from base b
        join public.emergency_types e on e.id = b.emergency_type_id
        group by e.code, e.name
      ) t
    ),
    'acceptance_rate', (
      select case
        when count(*) filter (where b.receiving_hospital_id is not null) = 0 then 0::numeric
        else round(
          count(*) filter (where b.accepted_at is not null)::numeric * 100
          / count(*) filter (where b.receiving_hospital_id is not null),
          1
        )
      end
      from base b
    ),
    'avg_response_seconds', (
      select round(avg(b.response_seconds), 0) from base b where b.response_seconds is not null
    ),
    'median_response_seconds', (
      select round(percentile_cont(0.5) within group (order by b.response_seconds)::numeric, 0)
      from base b where b.response_seconds is not null
    ),
    'avg_completion_minutes', (
      select round(avg(extract(epoch from (b.completed_at - b.requested_at)) / 60.0), 1)
      from base b where b.completed_at is not null
    ),
    'daily', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'day', to_char(series.day, 'YYYY-MM-DD'),
            'created', coalesce(d.created, 0),
            'accepted', coalesce(d.accepted, 0),
            'completed', coalesce(d.completed, 0)
          )
          order by series.day
        ),
        '[]'::jsonb
      )
      -- Series first, so a quiet day is a zero in the chart rather than a gap.
      from generate_series(date_trunc('day', v_from), date_trunc('day', v_to), interval '1 day') as series(day)
      left join (
        select
          date_trunc('day', b.requested_at) as day,
          count(*)::integer as created,
          count(*) filter (where b.accepted_at is not null)::integer as accepted,
          count(*) filter (where b.completed_at is not null)::integer as completed
        from base b
        group by 1
      ) d on d.day = series.day
    ),
    'top_receiving', (
      select coalesce(
        jsonb_agg(jsonb_build_object('hospital_id', t.id, 'name', t.name, 'count', t.n) order by t.n desc, t.name),
        '[]'::jsonb
      )
      from (
        select h.id, h.name, count(*)::integer as n
        from base b
        join public.hospitals h on h.id = b.receiving_hospital_id
        group by h.id, h.name
        order by count(*) desc, h.name
        limit 10
      ) t
    ),
    'top_referring', (
      select coalesce(
        jsonb_agg(jsonb_build_object('hospital_id', t.id, 'name', t.name, 'count', t.n) order by t.n desc, t.name),
        '[]'::jsonb
      )
      from (
        select h.id, h.name, count(*)::integer as n
        from base b
        join public.hospitals h on h.id = b.requesting_hospital_id
        group by h.id, h.name
        order by count(*) desc, h.name
        limit 10
      ) t
    )
  )
  into v_result;

  return v_result;
end;
$$;

create function public.compliance_report(
  p_hospital_id uuid default null,
  p_days integer default 7
)
returns table (
  hospital_id uuid,
  hospital_name text,
  department_id uuid,
  department_name text,
  expected_updates integer,
  actual_updates integer,
  compliance_rate numeric,
  missed_shifts integer,
  last_submitted_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_days integer := greatest(1, least(365, coalesce(p_days, 7)));
  v_expected integer;
  v_scope uuid;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  if not public.has_capability('reports:view') then
    raise exception 'Your role cannot view reports.' using errcode = '42501';
  end if;
  -- Without this, an unattached account would fall through to v_scope = null,
  -- which means "every hospital".
  if not public.has_capability('reports:view_all') and public.current_user_hospital() is null then
    raise exception 'Your account is not attached to a hospital yet.' using errcode = '42501';
  end if;

  v_scope := case
    when public.has_capability('reports:view_all') then p_hospital_id
    else public.current_user_hospital()
  end;

  -- Three shifts a day, every day, is the whole obligation.
  v_expected := v_days * 3;

  return query
  select
    h.id,
    h.name,
    d.id,
    d.name,
    v_expected,
    coalesce(stats.actual, 0),
    round(least(100, coalesce(stats.actual, 0)::numeric * 100 / v_expected), 1),
    greatest(0, v_expected - coalesce(stats.actual, 0)),
    stats.last_at
  from public.departments d
  join public.hospitals h on h.id = d.hospital_id
  left join lateral (
    select
      count(*)::integer as actual,
      max(ru.submitted_at) as last_at
    from public.readiness_updates ru
    where ru.department_id = d.id
      and ru.shift_date > (current_date - v_days)
  ) stats on true
  where d.is_active
    and d.requires_shift_update
    and h.is_active
    and (v_scope is null or d.hospital_id = v_scope)
  order by h.name, d.name;
end;
$$;

-- =============================================================================
-- Grants
-- =============================================================================
-- SECURITY DEFINER functions are granted to PUBLIC by default; narrow them to
-- signed-in users so an anonymous key cannot even reach the body's own checks.

revoke execute on function public.shift_for(timestamptz, text) from public;
revoke execute on function public.shift_index(date, text) from public;
revoke execute on function public.shift_start_at(date, text, text) from public;
revoke execute on function public.shifts_elapsed(timestamptz, text) from public;
revoke execute on function public.readiness_status(integer) from public;
revoke execute on function public.resource_column(text) from public;
revoke execute on function public.resource_total_column(text) from public;
revoke execute on function public.resource_kind(text) from public;
revoke execute on function public.template_resources(text) from public;
revoke execute on function public.template_collects_blood_stock(text) from public;
revoke execute on function public.template_controls_er_status(text) from public;
revoke execute on function public.log_audit_event(text, text, uuid, jsonb) from public;
revoke execute on function public.log_audit_event_internal(text, text, uuid, jsonb) from public;
revoke execute on function public.record_login() from public;
revoke execute on function public.mark_notifications_read(uuid[]) from public;
revoke execute on function public.submit_readiness(uuid, jsonb, jsonb, text) from public;
revoke execute on function public.get_referral_candidates(uuid, uuid, numeric) from public;
revoke execute on function public.create_referral(uuid, uuid, text, text, text, text, text, text[], jsonb, jsonb, numeric, numeric) from public;
revoke execute on function public.update_referral_status(uuid, text, text, text) from public;
revoke execute on function public.flag_overdue_readiness() from public;
revoke execute on function public.hospital_performance(uuid, timestamptz, timestamptz) from public;
revoke execute on function public.referral_analytics(uuid, timestamptz, timestamptz) from public;
revoke execute on function public.compliance_report(uuid, integer) from public;

grant execute on function public.shift_for(timestamptz, text) to authenticated;
grant execute on function public.shift_index(date, text) to authenticated;
grant execute on function public.shift_start_at(date, text, text) to authenticated;
grant execute on function public.shifts_elapsed(timestamptz, text) to authenticated;
grant execute on function public.readiness_status(integer) to authenticated;
grant execute on function public.resource_column(text) to authenticated;
grant execute on function public.resource_total_column(text) to authenticated;
grant execute on function public.resource_kind(text) to authenticated;
grant execute on function public.template_resources(text) to authenticated;
grant execute on function public.template_collects_blood_stock(text) to authenticated;
grant execute on function public.template_controls_er_status(text) to authenticated;
grant execute on function public.log_audit_event(text, text, uuid, jsonb) to authenticated;
grant execute on function public.record_login() to authenticated;
grant execute on function public.mark_notifications_read(uuid[]) to authenticated;
grant execute on function public.submit_readiness(uuid, jsonb, jsonb, text) to authenticated;
grant execute on function public.get_referral_candidates(uuid, uuid, numeric) to authenticated;
grant execute on function public.create_referral(uuid, uuid, text, text, text, text, text, text[], jsonb, jsonb, numeric, numeric) to authenticated;
grant execute on function public.update_referral_status(uuid, text, text, text) to authenticated;
grant execute on function public.flag_overdue_readiness() to authenticated;
grant execute on function public.hospital_performance(uuid, timestamptz, timestamptz) to authenticated;
grant execute on function public.referral_analytics(uuid, timestamptz, timestamptz) to authenticated;
grant execute on function public.compliance_report(uuid, integer) to authenticated;

grant execute on function public.flag_overdue_readiness() to service_role;

-- PostgREST caches the schema; tell it to pick up the new RPCs immediately
-- instead of waiting for its next reload.
notify pgrst, 'reload schema';
