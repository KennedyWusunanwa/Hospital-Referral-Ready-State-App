-- =============================================================================
-- FERN -- 0006_platform_console.sql
--
-- Everything the national roll-out asked for on the database side:
--
--   1. hospitals.logo_url            -- each facility's own logo, shown on
--                                       cards, candidates, referrals and the
--                                       printed form.
--   2. app_settings.logo_dark_url    -- a second network logo for dark
--      app_settings.logo_mode           surfaces, and whether the app picks
--                                       one automatically per theme.
--   3. public.login_events           -- one row per sign-in: who, when, how
--                                       (password / email code), from which
--                                       browser and address. Feeds the system
--                                       console's "Sign-ins" view and stats.
--   4. record_login(method, agent)   -- replaces the no-argument version.
--      record_logout()
--   5. platform_stats()              -- the numbers on the system console
--                                       overview, computed in one round trip.
--   6. ensure_hospital_defaults()    -- a hospital created from the console
--                                       gets its resource snapshot and blood
--                                       stock rows straight away.
--   7. hospital-logos bucket         -- public read; written by a system
--                                       administrator or that hospital's own
--                                       administrator.
--
-- Idempotent: safe to re-apply.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Hospital logos
-- -----------------------------------------------------------------------------

alter table public.hospitals add column if not exists logo_url text;

comment on column public.hospitals.logo_url is
  'Public URL of the facility logo. Uploaded to the hospital-logos bucket or pasted as an https link.';

-- -----------------------------------------------------------------------------
-- 2. Network branding: dark-surface logo and the switching rule
-- -----------------------------------------------------------------------------

alter table public.app_settings add column if not exists logo_dark_url text;
alter table public.app_settings add column if not exists logo_mode text not null default 'auto';

alter table public.app_settings drop constraint if exists app_settings_logo_mode_check;
alter table public.app_settings
  add constraint app_settings_logo_mode_check check (logo_mode in ('auto', 'light', 'dark'));

comment on column public.app_settings.logo_url is
  'Logo for light surfaces (dark artwork). Blank falls back to the built-in FERN wordmark.';
comment on column public.app_settings.logo_dark_url is
  'Logo for dark surfaces (light artwork). Blank falls back to the built-in FERN wordmark.';
comment on column public.app_settings.logo_mode is
  'auto = follow the viewer''s theme; light / dark = always use that one logo.';

-- -----------------------------------------------------------------------------
-- 3. login_events
-- -----------------------------------------------------------------------------

create table if not exists public.login_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles (id) on delete cascade,
  email text,
  role text,
  hospital_id uuid references public.hospitals (id) on delete set null,
  method text not null default 'unknown'
    check (method in ('password', 'otp', 'recovery', 'unknown')),
  user_agent text,
  ip_address text,
  created_at timestamptz not null default now()
);

create index if not exists login_events_created_at_idx on public.login_events (created_at desc);
create index if not exists login_events_user_idx on public.login_events (user_id, created_at desc);
create index if not exists login_events_hospital_idx on public.login_events (hospital_id, created_at desc);

alter table public.login_events enable row level security;

-- A person sees their own sign-in history; a hospital administrator sees their
-- facility's; a system administrator sees the network's. Nobody inserts
-- directly -- record_login() is the only writer.
drop policy if exists login_events_select on public.login_events;
create policy login_events_select on public.login_events
for select to authenticated
using (
  user_id = auth.uid()
  or public.is_super_admin()
  or (
    public.has_capability('audit:view')
    and hospital_id is not null
    and hospital_id = public.current_user_hospital()
  )
);

revoke all on public.login_events from anon, authenticated;
grant select on public.login_events to authenticated;

comment on table public.login_events is
  'One row per successful sign-in, written by record_login(). Read by the system console and each hospital''s administrators.';

-- -----------------------------------------------------------------------------
-- 4. record_login / record_logout
-- -----------------------------------------------------------------------------
-- The signature changes, and `create or replace` cannot add parameters to an
-- existing function, so the 0003 version is dropped first. Both parameters
-- default, so any client still calling record_login() keeps working.

drop function if exists public.record_login();

create or replace function public.record_login(
  p_method text default 'unknown',
  p_user_agent text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_email text := nullif(auth.jwt() ->> 'email', '');
  v_method text := case
    when p_method in ('password', 'otp', 'recovery') then p_method else 'unknown'
  end;
  v_agent text := left(nullif(btrim(coalesce(p_user_agent, '')), ''), 512);
  v_headers jsonb := '{}'::jsonb;
  v_ip text;
begin
  if v_uid is null then
    return;
  end if;

  -- PostgREST exposes the request headers to the transaction. The client
  -- address is taken from there rather than from a parameter, so it cannot be
  -- forged by the caller. Any parsing problem degrades to "unknown address".
  begin
    v_headers := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb;
  exception when others then
    v_headers := '{}'::jsonb;
  end;

  v_ip := nullif(btrim(split_part(coalesce(
    v_headers ->> 'x-forwarded-for',
    v_headers ->> 'cf-connecting-ip',
    v_headers ->> 'x-real-ip',
    ''
  ), ',', 1)), '');

  update public.profiles set last_login_at = now() where id = v_uid;

  insert into public.login_events (user_id, email, role, hospital_id, method, user_agent, ip_address)
  select v_uid, coalesce(v_email, p.email), p.role, p.hospital_id, v_method, v_agent, v_ip
  from public.profiles p
  where p.id = v_uid;

  if not found then
    insert into public.login_events (user_id, email, method, user_agent, ip_address)
    values (v_uid, v_email, v_method, v_agent, v_ip);
  end if;

  perform public.log_audit_event_internal(
    'auth.login',
    'profile',
    v_uid,
    jsonb_strip_nulls(jsonb_build_object('method', v_method, 'user_agent', v_agent, 'ip', v_ip))
  );
end;
$$;

create or replace function public.record_logout()
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
  perform public.log_audit_event_internal('auth.logout', 'profile', v_uid, '{}'::jsonb);
end;
$$;

comment on function public.record_login(text, text) is
  'Stamps profiles.last_login_at, writes a login_events row (method, browser, address) and an auth.login audit row.';
comment on function public.record_logout() is
  'Writes an auth.logout audit row for the calling user. Best-effort; the client signs out regardless.';

-- -----------------------------------------------------------------------------
-- 5. platform_stats -- the system console overview in one call
-- -----------------------------------------------------------------------------

drop function if exists public.platform_stats();

create or replace function public.platform_stats()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  if not public.is_super_admin() then
    raise exception 'Only a system administrator can view platform statistics.' using errcode = '42501';
  end if;

  with
  readiness as (
    -- The same traffic light the app derives, evaluated in each hospital's own
    -- timezone, for every department that owes a shift update.
    select
      d.hospital_id,
      public.readiness_status(public.shifts_elapsed(lu.submitted_at, h.timezone)) as status
    from public.departments d
    join public.hospitals h on h.id = d.hospital_id
    left join lateral (
      select ru.submitted_at
      from public.readiness_updates ru
      where ru.department_id = d.id
      order by
        ru.shift_date desc,
        case ru.shift_type when 'night' then 2 when 'afternoon' then 1 else 0 end desc,
        ru.submitted_at desc
      limit 1
    ) lu on true
    where d.is_active and d.requires_shift_update and h.is_active
  ),
  hospital_status as (
    select
      hospital_id,
      case
        when bool_or(status = 'red') then 'red'
        when bool_or(status = 'yellow') then 'yellow'
        else 'green'
      end as status
    from readiness
    group by hospital_id
  )
  select jsonb_build_object(
    'generated_at', now(),

    'hospitals', jsonb_build_object(
      'total', (select count(*) from public.hospitals),
      'active', (select count(*) from public.hospitals where is_active),
      'accepting', (select count(*) from public.hospitals where is_active and accepts_referrals),
      'on_diversion', (
        select count(*)
        from public.hospitals h
        join public.hospital_resources r on r.hospital_id = h.id
        where h.is_active and not r.er_open
      ),
      'with_logo', (select count(*) from public.hospitals where is_active and nullif(btrim(coalesce(logo_url, '')), '') is not null),
      'by_region', (
        select coalesce(jsonb_agg(jsonb_build_object('region', t.region, 'count', t.n) order by t.n desc, t.region), '[]'::jsonb)
        from (
          select coalesce(nullif(btrim(region), ''), 'Unspecified') as region, count(*)::integer as n
          from public.hospitals where is_active group by 1
        ) t
      ),
      'by_level', (
        select coalesce(jsonb_object_agg(t.level, t.n), '{}'::jsonb)
        from (select level, count(*)::integer as n from public.hospitals where is_active group by level) t
      ),
      'readiness', jsonb_build_object(
        'green', (select count(*) from hospital_status where status = 'green'),
        'yellow', (select count(*) from hospital_status where status = 'yellow'),
        'red', (select count(*) from hospital_status where status = 'red'),
        'unconfigured', (
          select count(*) from public.hospitals h
          where h.is_active and not exists (select 1 from hospital_status s where s.hospital_id = h.id)
        )
      )
    ),

    'departments', jsonb_build_object(
      'total', (select count(*) from public.departments where is_active),
      'reporting', (select count(*) from readiness),
      'green', (select count(*) from readiness where status = 'green'),
      'yellow', (select count(*) from readiness where status = 'yellow'),
      'red', (select count(*) from readiness where status = 'red'),
      'updates_24h', (select count(*) from public.readiness_updates where submitted_at >= now() - interval '24 hours')
    ),

    'users', jsonb_build_object(
      'total', (select count(*) from public.profiles),
      'active', (select count(*) from public.profiles where is_active),
      'deactivated', (select count(*) from public.profiles where not is_active),
      'unattached', (select count(*) from public.profiles where is_active and hospital_id is null and role <> 'super_admin'),
      'never_signed_in', (select count(*) from public.profiles where is_active and last_login_at is null),
      'by_role', (
        select coalesce(jsonb_object_agg(t.role, t.n), '{}'::jsonb)
        from (select role, count(*)::integer as n from public.profiles where is_active group by role) t
      ),
      'signed_in_24h', (select count(distinct user_id) from public.login_events where created_at >= now() - interval '24 hours'),
      'signed_in_7d', (select count(distinct user_id) from public.login_events where created_at >= now() - interval '7 days'),
      'signed_in_30d', (select count(distinct user_id) from public.login_events where created_at >= now() - interval '30 days'),
      'pending_invites', (select count(*) from public.staff_invites where accepted_at is null and expires_at > now())
    ),

    'referrals', jsonb_build_object(
      'last_24h', (select count(*) from public.referrals where requested_at >= now() - interval '24 hours'),
      'last_7d', (select count(*) from public.referrals where requested_at >= now() - interval '7 days'),
      'last_30d', (select count(*) from public.referrals where requested_at >= now() - interval '30 days'),
      'all_time', (select count(*) from public.referrals),
      'pending', (select count(*) from public.referrals where status = 'pending'),
      'pending_overdue', (
        select count(*) from public.referrals
        where status = 'pending' and requested_at < now() - interval '15 minutes'
      ),
      'in_transit', (select count(*) from public.referrals where status = 'in_transit'),
      'accepted_7d', (select count(*) from public.referrals where accepted_at >= now() - interval '7 days'),
      'declined_7d', (select count(*) from public.referrals where status = 'declined' and responded_at >= now() - interval '7 days'),
      'completed_7d', (select count(*) from public.referrals where completed_at >= now() - interval '7 days'),
      'avg_response_seconds_7d', (
        select round(avg(response_seconds), 0) from public.referrals
        where response_seconds is not null and requested_at >= now() - interval '7 days'
      )
    ),

    'activity', jsonb_build_object(
      'audit_events_24h', (select count(*) from public.audit_logs where created_at >= now() - interval '24 hours'),
      'messages_24h', (select count(*) from public.messages where created_at >= now() - interval '24 hours'),
      'notifications_24h', (select count(*) from public.notifications where created_at >= now() - interval '24 hours'),
      'unread_notifications', (select count(*) from public.notifications where not is_read),
      'logins_24h', (select count(*) from public.login_events where created_at >= now() - interval '24 hours'),
      'failed_logins_24h', (select count(*) from public.audit_logs where action = 'auth.failed_login' and created_at >= now() - interval '24 hours')
    ),

    -- Fourteen days, gaps filled with zero so the chart never has a hole.
    'logins_daily', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'day', to_char(s.day, 'YYYY-MM-DD'),
        'logins', coalesce(l.n, 0),
        'unique_users', coalesce(l.u, 0)
      ) order by s.day), '[]'::jsonb)
      from generate_series(date_trunc('day', now()) - interval '13 days', date_trunc('day', now()), interval '1 day') as s(day)
      left join (
        select date_trunc('day', created_at) as day, count(*)::integer as n, count(distinct user_id)::integer as u
        from public.login_events
        where created_at >= date_trunc('day', now()) - interval '13 days'
        group by 1
      ) l on l.day = s.day
    ),

    'referrals_daily', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'day', to_char(s.day, 'YYYY-MM-DD'),
        'created', coalesce(r.n, 0),
        'completed', coalesce(r.c, 0)
      ) order by s.day), '[]'::jsonb)
      from generate_series(date_trunc('day', now()) - interval '13 days', date_trunc('day', now()), interval '1 day') as s(day)
      left join (
        select date_trunc('day', requested_at) as day,
               count(*)::integer as n,
               count(*) filter (where completed_at is not null)::integer as c
        from public.referrals
        where requested_at >= date_trunc('day', now()) - interval '13 days'
        group by 1
      ) r on r.day = s.day
    )
  )
  into v_result;

  return v_result;
end;
$$;

comment on function public.platform_stats() is
  'System console overview: hospitals, departments, users, sign-ins, referrals and activity, network-wide. Super administrators only.';

-- -----------------------------------------------------------------------------
-- 6. A new hospital arrives with its resource snapshot and blood stock rows
-- -----------------------------------------------------------------------------
-- submit_readiness() creates these lazily on the first submission, but a
-- facility added from the console should rank and display sensibly before
-- anyone has filed a shift update.

create or replace function public.ensure_hospital_defaults()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.hospital_resources (hospital_id)
  values (new.id)
  on conflict (hospital_id) do nothing;

  insert into public.blood_stock (hospital_id, blood_group, units)
  select new.id, g, 0
  from unnest(array['O-', 'O+', 'A-', 'A+', 'B-', 'B+', 'AB-', 'AB+']) as g
  on conflict (hospital_id, blood_group) do nothing;

  return new;
end;
$$;

drop trigger if exists hospitals_ensure_defaults on public.hospitals;
create trigger hospitals_ensure_defaults
after insert on public.hospitals
for each row execute function public.ensure_hospital_defaults();

-- Backfill any facility that predates the trigger.
insert into public.hospital_resources (hospital_id)
select h.id from public.hospitals h
where not exists (select 1 from public.hospital_resources r where r.hospital_id = h.id)
on conflict (hospital_id) do nothing;

-- -----------------------------------------------------------------------------
-- 7. hospital-logos bucket
-- -----------------------------------------------------------------------------
-- Objects are stored under `<hospital_id>/<file>`, and the first path segment
-- is what the policy checks: a hospital administrator can only write inside
-- their own facility's folder.

do $$
begin
  insert into storage.buckets (id, name, public)
  values ('hospital-logos', 'hospital-logos', true)
  on conflict (id) do update set public = true;

  drop policy if exists hospital_logos_public_read on storage.objects;
  create policy hospital_logos_public_read on storage.objects
  for select using (bucket_id = 'hospital-logos');

  drop policy if exists hospital_logos_write on storage.objects;
  create policy hospital_logos_write on storage.objects
  for insert with check (
    bucket_id = 'hospital-logos'
    and (
      public.is_super_admin()
      or (
        public.current_user_role() = 'hospital_admin'
        and (storage.foldername(name))[1] = public.current_user_hospital()::text
      )
    )
  );

  drop policy if exists hospital_logos_update on storage.objects;
  create policy hospital_logos_update on storage.objects
  for update using (
    bucket_id = 'hospital-logos'
    and (
      public.is_super_admin()
      or (
        public.current_user_role() = 'hospital_admin'
        and (storage.foldername(name))[1] = public.current_user_hospital()::text
      )
    )
  );

  drop policy if exists hospital_logos_delete on storage.objects;
  create policy hospital_logos_delete on storage.objects
  for delete using (
    bucket_id = 'hospital-logos'
    and (
      public.is_super_admin()
      or (
        public.current_user_role() = 'hospital_admin'
        and (storage.foldername(name))[1] = public.current_user_hospital()::text
      )
    )
  );
exception when insufficient_privilege or undefined_table then
  raise notice 'Skipped storage bucket setup: create the public "hospital-logos" bucket in the dashboard instead.';
end;
$$;

-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------

revoke execute on function public.record_login(text, text) from public;
revoke execute on function public.record_logout() from public;
revoke execute on function public.platform_stats() from public;

grant execute on function public.record_login(text, text) to authenticated;
grant execute on function public.record_logout() to authenticated;
grant execute on function public.platform_stats() to authenticated;

notify pgrst, 'reload schema';
