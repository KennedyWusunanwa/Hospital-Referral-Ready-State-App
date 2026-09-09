-- =============================================================================
-- FERN -- 0002_rls.sql
-- Row level security: authorisation helpers, policies and table grants.
--
-- Read this alongside ROLE_CAPABILITIES in src/lib/constants.ts -- the two are
-- meant to say the same thing, one for the UI and one for the database.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Authorisation helpers
-- -----------------------------------------------------------------------------
-- Every one of these reads `profiles`, and several are used *inside* the
-- policies on `profiles`. Written as ordinary functions that would be an
-- infinite recursion: evaluating the policy would run a query that evaluates
-- the policy. SECURITY DEFINER breaks the cycle -- the function body runs as
-- the (table-owning) definer, for whom RLS is not applied, so the lookup
-- completes without re-entering the policy.
--
-- Because they bypass RLS, they are deliberately minimal: they take no
-- caller-supplied identity, only auth.uid(), and `set search_path` pins the
-- schema so a hostile search_path cannot swap the tables underneath them.

create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.role
  from public.profiles p
  where p.id = auth.uid()
    and p.is_active
$$;

comment on function public.current_user_role() is
  'Role of the calling user, or null when unauthenticated or deactivated.';

create or replace function public.current_user_hospital()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.hospital_id
  from public.profiles p
  where p.id = auth.uid()
    and p.is_active
$$;

comment on function public.current_user_hospital() is
  'Hospital the calling user belongs to, or null.';

create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.is_active and p.role = 'super_admin'
  )
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.is_active and p.role in ('super_admin', 'hospital_admin')
  )
$$;

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
      when 'referral_coordinator' then array[
        'readiness:view', 'referral:create', 'referral:respond', 'referral:view',
        'messaging:use', 'reports:view'
      ]
      when 'viewer' then array['readiness:view', 'referral:view', 'reports:view']
      else array[]::text[]
    end
  )
$$;

-- True when the caller's hospital is one of the two parties on a referral.
create or replace function public.is_referral_participant(p_referral_id uuid)
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
        or r.requesting_hospital_id = public.current_user_hospital()
        or r.receiving_hospital_id = public.current_user_hospital()
      )
  )
$$;

grant execute on function public.current_user_role() to authenticated;
grant execute on function public.current_user_hospital() to authenticated;
grant execute on function public.is_super_admin() to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.has_capability(text) to authenticated;
grant execute on function public.is_referral_participant(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Enable RLS everywhere
-- -----------------------------------------------------------------------------

alter table public.hospitals enable row level security;
alter table public.departments enable row level security;
alter table public.profiles enable row level security;
alter table public.hospital_resources enable row level security;
alter table public.blood_stock enable row level security;
alter table public.readiness_updates enable row level security;
alter table public.emergency_types enable row level security;
alter table public.emergency_requirements enable row level security;
alter table public.referrals enable row level security;
alter table public.referral_events enable row level security;
alter table public.messages enable row level security;
alter table public.message_receipts enable row level security;
alter table public.notifications enable row level security;
alter table public.audit_logs enable row level security;
alter table public.scoring_config enable row level security;
alter table public.referral_reference_counters enable row level security;

-- -----------------------------------------------------------------------------
-- profiles
-- -----------------------------------------------------------------------------

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
for select to authenticated
using (
  id = auth.uid()
  or public.is_super_admin()
  or (hospital_id is not null and hospital_id = public.current_user_hospital())
);

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
for update to authenticated
using (
  id = auth.uid()
  or public.is_super_admin()
  or (
    public.current_user_role() = 'hospital_admin'
    and hospital_id is not null
    and hospital_id = public.current_user_hospital()
  )
)
with check (
  id = auth.uid()
  or public.is_super_admin()
  or (
    public.current_user_role() = 'hospital_admin'
    and hospital_id is not null
    and hospital_id = public.current_user_hospital()
  )
);

-- A WITH CHECK expression cannot see OLD, so it cannot tell "this row is
-- unchanged" from "this user just promoted themselves". The real guard on the
-- privileged columns is therefore a BEFORE UPDATE trigger, which can compare
-- the two versions.
create or replace function public.guard_profile_privileges()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text;
  v_hospital uuid;
begin
  -- No JWT: a SECURITY DEFINER RPC, the service role or cron. Trusted.
  if auth.uid() is null then
    return new;
  end if;

  if new.role is not distinct from old.role
     and new.hospital_id is not distinct from old.hospital_id
     and new.is_active is not distinct from old.is_active
     -- email is auth.users' to set; letting it drift breaks every join an
     -- investigator would make, and it decorates the audit log.
     and new.email is not distinct from old.email then
    -- department_id is intentionally self-editable: it only steers which
    -- readiness form the user lands on, never what they are allowed to do.
    return new;
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
    'Changing a role, hospital or account status needs an administrator with rights over that hospital.'
    using errcode = '42501';
end;
$$;

drop trigger if exists profiles_guard_privileges on public.profiles;
create trigger profiles_guard_privileges
before update on public.profiles
for each row execute function public.guard_profile_privileges();

-- No INSERT policy: profiles are created by the auth.users trigger only.
-- No DELETE policy: deactivate (is_active = false), never delete, so the audit
-- trail keeps pointing at a real person.

-- -----------------------------------------------------------------------------
-- hospitals
-- -----------------------------------------------------------------------------
-- Every authenticated user reads every hospital: ranking a referral is
-- inherently a cross-hospital query.

drop policy if exists hospitals_select on public.hospitals;
create policy hospitals_select on public.hospitals
for select to authenticated
using (true);

drop policy if exists hospitals_insert on public.hospitals;
create policy hospitals_insert on public.hospitals
for insert to authenticated
with check (public.is_super_admin());

drop policy if exists hospitals_update on public.hospitals;
create policy hospitals_update on public.hospitals
for update to authenticated
using (public.is_super_admin() or (public.current_user_role() = 'hospital_admin' and id = public.current_user_hospital()))
with check (public.is_super_admin() or (public.current_user_role() = 'hospital_admin' and id = public.current_user_hospital()));

drop policy if exists hospitals_delete on public.hospitals;
create policy hospitals_delete on public.hospitals
for delete to authenticated
using (public.is_super_admin());

-- -----------------------------------------------------------------------------
-- departments
-- -----------------------------------------------------------------------------

drop policy if exists departments_select on public.departments;
create policy departments_select on public.departments
for select to authenticated
using (true);

drop policy if exists departments_write on public.departments;
create policy departments_write on public.departments
for all to authenticated
using (public.is_super_admin() or (public.has_capability('admin:hospital') and hospital_id = public.current_user_hospital()))
with check (public.is_super_admin() or (public.has_capability('admin:hospital') and hospital_id = public.current_user_hospital()));

-- -----------------------------------------------------------------------------
-- hospital_resources / blood_stock
-- -----------------------------------------------------------------------------
-- Shift in-charges never touch these tables directly -- submit_readiness() owns
-- that path so the readiness_updates row and the snapshot stay in step.

drop policy if exists hospital_resources_select on public.hospital_resources;
create policy hospital_resources_select on public.hospital_resources
for select to authenticated
using (true);

drop policy if exists hospital_resources_write on public.hospital_resources;
create policy hospital_resources_write on public.hospital_resources
for all to authenticated
using (public.is_super_admin() or (public.has_capability('admin:hospital') and hospital_id = public.current_user_hospital()))
with check (public.is_super_admin() or (public.has_capability('admin:hospital') and hospital_id = public.current_user_hospital()));

drop policy if exists blood_stock_select on public.blood_stock;
create policy blood_stock_select on public.blood_stock
for select to authenticated
using (true);

drop policy if exists blood_stock_write on public.blood_stock;
create policy blood_stock_write on public.blood_stock
for all to authenticated
using (public.is_super_admin() or (public.has_capability('admin:hospital') and hospital_id = public.current_user_hospital()))
with check (public.is_super_admin() or (public.has_capability('admin:hospital') and hospital_id = public.current_user_hospital()));

-- -----------------------------------------------------------------------------
-- readiness_updates
-- -----------------------------------------------------------------------------

drop policy if exists readiness_updates_select on public.readiness_updates;
create policy readiness_updates_select on public.readiness_updates
for select to authenticated
using (true);

-- No client INSERT / UPDATE / DELETE. submit_readiness() is SECURITY DEFINER so
-- it does not need the caller to hold INSERT, and routing every write through it
-- is what makes the traffic light trustworthy: a direct insert could name its own
-- shift_date, submitted_at and submitted_by, pinning a department green forever,
-- forging attribution to a colleague, and reporting fresh readiness to the whole
-- network while the resource snapshot behind it was never confirmed.
drop policy if exists readiness_updates_insert on public.readiness_updates;

-- -----------------------------------------------------------------------------
-- emergency catalogue + scoring config -- readable by all, owned by super_admin
-- -----------------------------------------------------------------------------

drop policy if exists emergency_types_select on public.emergency_types;
create policy emergency_types_select on public.emergency_types
for select to authenticated
using (true);

drop policy if exists emergency_types_write on public.emergency_types;
create policy emergency_types_write on public.emergency_types
for all to authenticated
using (public.is_super_admin())
with check (public.is_super_admin());

drop policy if exists emergency_requirements_select on public.emergency_requirements;
create policy emergency_requirements_select on public.emergency_requirements
for select to authenticated
using (true);

drop policy if exists emergency_requirements_write on public.emergency_requirements;
create policy emergency_requirements_write on public.emergency_requirements
for all to authenticated
using (public.is_super_admin())
with check (public.is_super_admin());

drop policy if exists scoring_config_select on public.scoring_config;
create policy scoring_config_select on public.scoring_config
for select to authenticated
using (true);

drop policy if exists scoring_config_update on public.scoring_config;
create policy scoring_config_update on public.scoring_config
for update to authenticated
using (public.is_super_admin())
with check (public.is_super_admin());

-- -----------------------------------------------------------------------------
-- referrals + referral_events -- read here, write through the RPCs
-- -----------------------------------------------------------------------------
-- There is deliberately no INSERT/UPDATE policy. create_referral() and
-- update_referral_status() are the only writers because a referral is never
-- just a row: it comes with a score snapshot, a timeline event, notifications
-- for the other hospital and an audit entry. Letting the client PATCH the row
-- directly would silently skip all four and make the state machine
-- unenforceable.

drop policy if exists referrals_select on public.referrals;
create policy referrals_select on public.referrals
for select to authenticated
using (
  public.is_super_admin()
  or requesting_hospital_id = public.current_user_hospital()
  or receiving_hospital_id = public.current_user_hospital()
);

drop policy if exists referral_events_select on public.referral_events;
create policy referral_events_select on public.referral_events
for select to authenticated
using (public.is_referral_participant(referral_id));

-- -----------------------------------------------------------------------------
-- messages
-- -----------------------------------------------------------------------------

drop policy if exists messages_select on public.messages;
create policy messages_select on public.messages
for select to authenticated
using (public.is_referral_participant(referral_id));

-- Sender identity is stamped server-side rather than trusted from the payload,
-- which also means the client can post `{ referral_id, body }` and nothing else.
create or replace function public.stamp_message_sender()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  new.sender_id := coalesce(auth.uid(), new.sender_id);
  new.sender_hospital_id := coalesce(public.current_user_hospital(), new.sender_hospital_id);
  return new;
end;
$$;

drop trigger if exists messages_stamp_sender on public.messages;
create trigger messages_stamp_sender
before insert on public.messages
for each row execute function public.stamp_message_sender();

drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages
for insert to authenticated
with check (
  public.has_capability('messaging:use')
  and sender_id = auth.uid()
  and (sender_hospital_id is null or sender_hospital_id = public.current_user_hospital())
  and exists (
    select 1
    from public.referrals r
    where r.id = referral_id
      -- Only while the case is live: a closed referral is a record, not a chat.
      and r.status in ('pending', 'accepted', 'in_transit')
      and (
        r.requesting_hospital_id = public.current_user_hospital()
        or r.receiving_hospital_id = public.current_user_hospital()
      )
  )
);

drop policy if exists message_receipts_select on public.message_receipts;
create policy message_receipts_select on public.message_receipts
for select to authenticated
using (user_id = auth.uid());

drop policy if exists message_receipts_insert on public.message_receipts;
create policy message_receipts_insert on public.message_receipts
for insert to authenticated
with check (user_id = auth.uid() and public.is_referral_participant(
  (select m.referral_id from public.messages m where m.id = message_id)
));

drop policy if exists message_receipts_update on public.message_receipts;
create policy message_receipts_update on public.message_receipts
for update to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

-- -----------------------------------------------------------------------------
-- notifications
-- -----------------------------------------------------------------------------
-- Written only by the RPCs (referral fan-out, flag_overdue_readiness).

drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications
for select to authenticated
using (user_id = auth.uid());

-- No client UPDATE: the policy could only be scoped by row, not by column, so
-- it also allowed a user to rewrite the title, body, link and severity of their
-- own alerts. mark_notifications_read() is the supported path and is all the
-- client actually uses.
drop policy if exists notifications_update on public.notifications;

-- -----------------------------------------------------------------------------
-- audit_logs -- append-only, and only ever appended by log_audit_event()
-- -----------------------------------------------------------------------------

drop policy if exists audit_logs_select on public.audit_logs;
create policy audit_logs_select on public.audit_logs
for select to authenticated
using (
  public.is_super_admin()
  or (
    public.has_capability('audit:view')
    and hospital_id is not null
    and hospital_id = public.current_user_hospital()
  )
);

-- -----------------------------------------------------------------------------
-- referral_reference_counters -- internal, no policies at all
-- -----------------------------------------------------------------------------

-- -----------------------------------------------------------------------------
-- Table grants
-- -----------------------------------------------------------------------------
-- RLS narrows what a role may touch; grants decide whether the verb exists at
-- all. Both are set, so a missing policy can never be papered over by a
-- lingering default privilege.

revoke all on all tables in schema public from anon;
revoke all on all tables in schema public from authenticated;

grant select                         on public.hospitals             to authenticated;
grant insert, update, delete         on public.hospitals             to authenticated;
grant select, insert, update, delete on public.departments           to authenticated;
grant select, update                 on public.profiles              to authenticated;
grant select, insert, update         on public.hospital_resources    to authenticated;
grant select, insert, update, delete on public.blood_stock           to authenticated;
grant select                         on public.readiness_updates     to authenticated;
grant select, insert, update, delete on public.emergency_types       to authenticated;
grant select, insert, update, delete on public.emergency_requirements to authenticated;
grant select, update                 on public.scoring_config        to authenticated;
grant select                         on public.referrals             to authenticated;
grant select                         on public.referral_events       to authenticated;
grant select, insert                 on public.messages              to authenticated;
grant select, insert, update         on public.message_receipts      to authenticated;
grant select                         on public.notifications         to authenticated;
grant select                         on public.audit_logs            to authenticated;
grant select                         on public.department_readiness  to authenticated;

-- The counters table stays invisible to every client role.
revoke all on public.referral_reference_counters from anon, authenticated;
