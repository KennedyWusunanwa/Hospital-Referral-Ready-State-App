-- =============================================================================
-- FERN -- 0005_settings_and_invites.sql
--
-- Two additions:
--
--   1. public.app_settings -- a single row holding the network's branding
--      (colour, logo, name). Readable by anyone, including anon, because the
--      sign-in screen has to paint the brand before anybody is authenticated.
--      Writable only by a system administrator.
--
--   2. public.staff_invites -- the supported way to add a person. Creating an
--      auth user directly needs the service_role key, which cannot live in a
--      browser-only app, so instead an administrator records the role a given
--      email should get and the signup trigger applies it on first sign-in.
--      Privilege therefore comes from a table only administrators can write,
--      never from anything the signing-up client controls.
--
-- Idempotent: safe to re-apply.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- app_settings
-- -----------------------------------------------------------------------------

create table if not exists public.app_settings (
  -- Single-row table. The check constraint is what keeps it single.
  id smallint primary key default 1 check (id = 1),
  brand_color text not null default '#1b5cf5'
    check (brand_color ~* '^#[0-9a-f]{6}$'),
  logo_url text,
  app_name text not null default 'FERN' check (length(btrim(app_name)) between 1 and 40),
  app_tagline text not null default 'Referral Ready State'
    check (length(btrim(app_tagline)) <= 60),
  support_email text,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null
);

insert into public.app_settings (id) values (1) on conflict (id) do nothing;

drop trigger if exists set_app_settings_updated_at on public.app_settings;
create trigger set_app_settings_updated_at
before update on public.app_settings
for each row execute function public.set_updated_at();

alter table public.app_settings enable row level security;

-- Branding is public by nature: it is painted on the sign-in screen, before
-- there is a session to check. Nothing sensitive belongs in this table.
drop policy if exists app_settings_read on public.app_settings;
create policy app_settings_read on public.app_settings
for select using (true);

drop policy if exists app_settings_write on public.app_settings;
create policy app_settings_write on public.app_settings
for update using (public.is_super_admin()) with check (public.is_super_admin());

grant select on public.app_settings to anon, authenticated;
grant update on public.app_settings to authenticated;

comment on table public.app_settings is
  'Single-row branding for the whole network. Readable by anon so the sign-in screen can paint it.';

-- -----------------------------------------------------------------------------
-- staff_invites
-- -----------------------------------------------------------------------------

create table if not exists public.staff_invites (
  id uuid primary key default gen_random_uuid(),
  email text not null check (position('@' in email) > 1),
  full_name text,
  role text not null default 'viewer'
    check (role in ('super_admin', 'hospital_admin', 'shift_in_charge', 'referral_coordinator', 'viewer')),
  hospital_id uuid references public.hospitals (id) on delete cascade,
  department_id uuid references public.departments (id) on delete set null,
  invited_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 days',
  accepted_at timestamptz,
  accepted_by uuid references public.profiles (id) on delete set null
);

-- One live invite per address. Case-insensitive, because people type their own
-- email inconsistently and GoTrue lower-cases it before we ever see it.
create unique index if not exists staff_invites_email_pending_idx
  on public.staff_invites (lower(email))
  where accepted_at is null;

create index if not exists staff_invites_hospital_idx
  on public.staff_invites (hospital_id) where accepted_at is null;

alter table public.staff_invites enable row level security;

-- A hospital admin manages invites for their own hospital; a system
-- administrator manages all of them.
drop policy if exists staff_invites_read on public.staff_invites;
create policy staff_invites_read on public.staff_invites
for select using (
  public.is_super_admin()
  or (public.current_user_role() = 'hospital_admin' and hospital_id = public.current_user_hospital())
);

drop policy if exists staff_invites_insert on public.staff_invites;
create policy staff_invites_insert on public.staff_invites
for insert with check (
  public.is_super_admin()
  or (
    public.current_user_role() = 'hospital_admin'
    and hospital_id = public.current_user_hospital()
    -- A hospital admin must not be able to mint a system administrator.
    and role <> 'super_admin'
  )
);

drop policy if exists staff_invites_update on public.staff_invites;
create policy staff_invites_update on public.staff_invites
for update using (
  public.is_super_admin()
  or (public.current_user_role() = 'hospital_admin' and hospital_id = public.current_user_hospital())
) with check (
  public.is_super_admin()
  or (
    public.current_user_role() = 'hospital_admin'
    and hospital_id = public.current_user_hospital()
    and role <> 'super_admin'
  )
);

drop policy if exists staff_invites_delete on public.staff_invites;
create policy staff_invites_delete on public.staff_invites
for delete using (
  public.is_super_admin()
  or (public.current_user_role() = 'hospital_admin' and hospital_id = public.current_user_hospital())
);

grant select, insert, update, delete on public.staff_invites to authenticated;

comment on table public.staff_invites is
  'Role/hospital a given email should receive on first sign-in. The only privileged input the signup trigger trusts.';

-- -----------------------------------------------------------------------------
-- Signup trigger: apply a pending invite
-- -----------------------------------------------------------------------------
-- Replaces the 0001 version. Two changes:
--
--   * A pending invite for the signing-up email now takes precedence over
--     app_metadata. That also sidesteps a real ordering problem: GoTrue's Admin
--     API inserts the user first and applies app_metadata in a follow-up
--     update, so raw_app_meta_data is still bare when this trigger runs and
--     every admin-created account landed as 'viewer'. The invite row is present
--     before signup, so reading it here is reliable.
--
--   * app_metadata is still honoured when there is no invite, so the documented
--     service-role invite path keeps working.

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  -- user_metadata is writable by the signing-up client itself, so nothing
  -- privileged is ever read from it: a stranger could POST /auth/v1/signup with
  -- {"data":{"role":"super_admin"}} and own the network. Privilege comes from a
  -- staff_invites row or from app_metadata (service-role only).
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

  if v_role not in ('super_admin', 'hospital_admin', 'shift_in_charge', 'referral_coordinator', 'viewer') then
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
-- Before-user-created auth hook
-- -----------------------------------------------------------------------------
-- The sign-in screen has to pass shouldCreateUser:true for an invited person to
-- get an account on first OTP, and that flag is client-side -- anyone could set
-- it. This hook is the server-side half: no pending invite, no account.
--
-- Enable it in the dashboard under Authentication -> Hooks -> Before User
-- Created, pointing at public.before_user_created. Until it is enabled, an
-- uninvited address can still create a bare 'viewer' profile with no hospital,
-- which grants no access to anything but is untidy.

create or replace function public.before_user_created(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  -- The hook payload shape is owned by GoTrue, not by us, so the address is
  -- looked for in every place it has been known to appear.
  v_email text := lower(coalesce(
    event -> 'user' ->> 'email',
    event ->> 'email',
    event -> 'claims' ->> 'email',
    ''
  ));
  v_ok boolean;
begin
  -- Fail OPEN on a payload we do not recognise. A hook that cannot find the
  -- address would otherwise reject every signup, including invited staff,
  -- and lock the whole network out. The cost of allowing it is an uninvited
  -- address getting a 'viewer' profile with no hospital, which can see
  -- nothing; the cost of the alternative is nobody being able to sign in.
  if v_email = '' then
    return '{}'::jsonb;
  end if;

  -- An existing profile means this is a returning user, not a new signup.
  select exists (
    select 1 from public.profiles p where lower(p.email) = v_email
  ) or exists (
    select 1 from public.staff_invites i
    where lower(i.email) = v_email and i.accepted_at is null and i.expires_at > now()
  ) into v_ok;

  if not v_ok then
    return jsonb_build_object(
      'error', jsonb_build_object(
        'http_code', 403,
        'message', 'This email has not been invited. Ask an administrator to add you.'
      )
    );
  end if;

  return '{}'::jsonb;
end;
$$;

do $$
begin
  grant execute on function public.before_user_created(jsonb) to supabase_auth_admin;
  revoke execute on function public.before_user_created(jsonb) from anon, authenticated, public;
exception when undefined_object or insufficient_privilege then
  null;
end;
$$;

comment on function public.before_user_created(jsonb) is
  'Auth hook: rejects signups for addresses with no pending staff_invite. Enable under Authentication -> Hooks.';

-- -----------------------------------------------------------------------------
-- Branding asset storage
-- -----------------------------------------------------------------------------
-- Public-read bucket: the logo is shown on the sign-in screen. Writes are
-- restricted to system administrators. Wrapped because a restricted database
-- role cannot touch the storage schema, and that should not fail the migration.

do $$
begin
  insert into storage.buckets (id, name, public)
  values ('branding', 'branding', true)
  on conflict (id) do update set public = true;

  drop policy if exists branding_public_read on storage.objects;
  create policy branding_public_read on storage.objects
  for select using (bucket_id = 'branding');

  drop policy if exists branding_admin_write on storage.objects;
  create policy branding_admin_write on storage.objects
  for insert with check (bucket_id = 'branding' and public.is_super_admin());

  drop policy if exists branding_admin_update on storage.objects;
  create policy branding_admin_update on storage.objects
  for update using (bucket_id = 'branding' and public.is_super_admin());

  drop policy if exists branding_admin_delete on storage.objects;
  create policy branding_admin_delete on storage.objects
  for delete using (bucket_id = 'branding' and public.is_super_admin());
exception when insufficient_privilege or undefined_table then
  raise notice 'Skipped storage bucket setup: create the public "branding" bucket in the dashboard instead.';
end;
$$;
