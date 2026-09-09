-- =============================================================================
-- FERN -- 0004_seed.sql
-- Demo data: eight real Ghanaian facilities, their departments, a varied
-- resource picture and a full emergency catalogue.
--
-- Every statement is idempotent, so this file can be re-applied against a
-- database that already has data without duplicating or overwriting anything.
-- Nothing here touches hospitals it did not create: every insert is keyed on
-- the seed codes below.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Hospitals -- coordinates are the real facility locations
-- -----------------------------------------------------------------------------

insert into public.hospitals (
  id, name, code, level, address, city, region, country, latitude, longitude,
  phone, emergency_phone, email, timezone, is_active, accepts_referrals
)
values
  ('11111111-1111-4111-8111-111111111101', 'Korle-Bu Teaching Hospital', 'KBTH', 'tertiary',
   'Guggisberg Avenue, Korle-Bu', 'Accra', 'Greater Accra', 'Ghana', 5.536400, -0.226100,
   '+233302739500', '+233302739501', 'referrals@kbth.example.gh', 'Africa/Accra', true, true),

  ('11111111-1111-4111-8111-111111111102', '37 Military Hospital', 'MIL37', 'secondary',
   'Liberation Road, Neoplan', 'Accra', 'Greater Accra', 'Ghana', 5.589300, -0.186600,
   '+233302776111', '+233302776112', 'referrals@37mh.example.gh', 'Africa/Accra', true, true),

  ('11111111-1111-4111-8111-111111111103', 'Ridge Hospital (Greater Accra Regional)', 'RIDGE', 'secondary',
   'Castle Road, Ridge', 'Accra', 'Greater Accra', 'Ghana', 5.565100, -0.201000,
   '+233302228382', '+233302228383', 'referrals@ridge.example.gh', 'Africa/Accra', true, true),

  ('11111111-1111-4111-8111-111111111104', 'Tema General Hospital', 'TEMA', 'district',
   'Hospital Road, Community 9', 'Tema', 'Greater Accra', 'Ghana', 5.669800, -0.016600,
   '+233303202101', '+233303202102', 'referrals@temagh.example.gh', 'Africa/Accra', true, true),

  ('11111111-1111-4111-8111-111111111105', 'LEKMA Hospital', 'LEKMA', 'district',
   'Teshie-Nungua Estates', 'Accra', 'Greater Accra', 'Ghana', 5.583600, -0.100000,
   '+233302716354', '+233302716355', 'referrals@lekma.example.gh', 'Africa/Accra', true, true),

  ('11111111-1111-4111-8111-111111111106', 'Ga East Municipal Hospital', 'GAEAST', 'district',
   'Kwabenya', 'Accra', 'Greater Accra', 'Ghana', 5.680000, -0.220000,
   '+233302962345', '+233302962346', 'referrals@gaeast.example.gh', 'Africa/Accra', true, true),

  ('11111111-1111-4111-8111-111111111107', 'Komfo Anokye Teaching Hospital', 'KATH', 'tertiary',
   'Okomfo Anokye Road, Bantama', 'Kumasi', 'Ashanti', 'Ghana', 6.697600, -1.627000,
   '+233322022301', '+233322022302', 'referrals@kath.example.gh', 'Africa/Accra', true, true),

  ('11111111-1111-4111-8111-111111111108', 'Cape Coast Teaching Hospital', 'CCTH', 'tertiary',
   'Interberton Road, Cape Coast', 'Cape Coast', 'Central', 'Ghana', 5.106300, -1.280200,
   '+233332132440', '+233332132441', 'referrals@ccth.example.gh', 'Africa/Accra', true, true)
on conflict (id) do nothing;

-- -----------------------------------------------------------------------------
-- Departments -- drawn from DEPARTMENT_TEMPLATES
-- -----------------------------------------------------------------------------
-- Teaching hospitals run the full set; regional facilities drop the
-- sub-specialties; district hospitals keep the six units they actually staff.

with template_labels (key, label) as (
  values
    ('emergency', 'Emergency / Casualty'),
    ('theatre', 'Main Theatre'),
    ('icu', 'Intensive Care Unit'),
    ('nicu', 'Neonatal Intensive Care'),
    ('maternity', 'Maternity / Obstetrics'),
    ('surgery', 'Surgery'),
    ('radiology', 'Radiology / Imaging'),
    ('blood_bank', 'Blood Bank'),
    ('renal', 'Renal / Dialysis'),
    ('cardiology', 'Cardiology'),
    ('burns', 'Burns Unit'),
    ('general', 'General Ward')
)
insert into public.departments (hospital_id, name, template_key, contact_phone, requires_shift_update)
select h.id, tl.label, tl.key, h.emergency_phone, true
from public.hospitals h
join lateral unnest(
  case h.level
    when 'tertiary' then array[
      'emergency', 'theatre', 'icu', 'nicu', 'maternity', 'surgery',
      'radiology', 'blood_bank', 'renal', 'cardiology', 'burns', 'general'
    ]
    when 'secondary' then array[
      'emergency', 'theatre', 'icu', 'nicu', 'maternity', 'surgery',
      'radiology', 'blood_bank', 'general'
    ]
    else array['emergency', 'theatre', 'maternity', 'radiology', 'blood_bank', 'general']
  end
) as t (key) on true
join template_labels tl on tl.key = t.key
where h.code in ('KBTH', 'MIL37', 'RIDGE', 'TEMA', 'LEKMA', 'GAEAST', 'KATH', 'CCTH')
on conflict (hospital_id, name) do nothing;

-- -----------------------------------------------------------------------------
-- Resource snapshots
-- -----------------------------------------------------------------------------
-- Deliberately uneven, so the ranking demo has something to say: LEKMA is on
-- diversion with its oxygen plant down, Tema and the district hospitals have no
-- CT, and Ga East has no ICU capacity at all.

insert into public.hospital_resources (
  hospital_id, er_open, diversion_reason,
  operating_rooms_total, operating_rooms_functional,
  resident_surgeon_available, anesthetist_available, obstetric_theatre_available,
  neurosurgery_available, cath_lab_available,
  icu_beds_total, icu_beds_available, nicu_beds_total, nicu_beds_available,
  neonatal_resuscitation_available,
  ventilators_total, ventilators_available, oxygen_supply_percent,
  isolation_beds_available, general_beds_total, general_beds_available,
  burn_unit_available, dialysis_available, blood_bank_functional,
  ct_functional, mri_functional, xray_functional, ultrasound_functional,
  ambulances_available, power_backup_available
)
select
  h.id, s.er_open, s.diversion_reason,
  s.or_total, s.or_functional,
  s.surgeon, s.anesthetist, s.obstetric_theatre, s.neurosurgery, s.cath_lab,
  s.icu_total, s.icu_free, s.nicu_total, s.nicu_free, s.neonatal_resus,
  s.vent_total, s.vent_free, s.oxygen,
  s.isolation_free, s.beds_total, s.beds_free,
  s.burns, s.dialysis, s.blood_bank,
  s.ct, s.mri, s.xray, s.ultrasound,
  s.ambulances, s.power
from (values
  ('KBTH',   true,  null::text, 14, 12, true,  true,  true,  true,  true,  24, 4, 30, 6, true,  40, 9, 85.0, 6, 600, 40, true,  true,  true,  true,  true,  true, true, 4, true),
  ('MIL37',  true,  null,        8,  6, true,  true,  true,  true,  false, 12, 3, 10, 2, true,  14, 5, 78.0, 4, 300, 25, false, true,  true,  true,  false, true, true, 3, true),
  ('RIDGE',  true,  null,        6,  5, true,  true,  true,  false, false, 10, 2, 16, 4, true,  10, 4, 92.0, 3, 250, 30, false, false, true,  true,  false, true, true, 2, true),
  ('TEMA',   true,  null,        4,  3, true,  true,  true,  false, false,  6, 1,  8, 2, true,   6, 2, 64.0, 2, 180, 18, false, true,  true,  false, false, true, true, 2, true),
  ('LEKMA',  false, 'Oxygen plant under repair - diverting all emergencies until further notice',
                                 2,  1, false, true,  true,  false, false,  4, 0,  6, 1, true,   4, 1, 22.0, 1, 120,  6, false, false, true,  false, false, true, true, 1, false),
  ('GAEAST', true,  null,        2,  2, false, false, true,  false, false,  0, 0,  4, 0, false,  2, 0, 55.0, 0,  90, 12, false, false, false, false, false, true, true, 1, true),
  ('KATH',   true,  null,       12,  9, true,  true,  true,  true,  true,  18, 3, 24, 5, true,  26, 7, 88.0, 5, 450, 35, true,  true,  true,  true,  true,  true, true, 3, true),
  ('CCTH',   true,  null,        6,  4, true,  true,  true,  false, false,  8, 2, 12, 3, true,   8, 3, 71.0, 2, 300, 22, false, true,  true,  true,  false, true, true, 2, true)
) as s (
  code, er_open, diversion_reason, or_total, or_functional, surgeon, anesthetist,
  obstetric_theatre, neurosurgery, cath_lab, icu_total, icu_free, nicu_total, nicu_free,
  neonatal_resus, vent_total, vent_free, oxygen, isolation_free, beds_total, beds_free,
  burns, dialysis, blood_bank, ct, mri, xray, ultrasound, ambulances, power
)
join public.hospitals h on h.code = s.code
on conflict (hospital_id) do nothing;

-- -----------------------------------------------------------------------------
-- Blood stock
-- -----------------------------------------------------------------------------
-- Group shares follow the usual Ghanaian distribution (O+ dominant); the
-- per-hospital factor scales it to the size of the facility.

with groups (blood_group, share) as (
  values ('O-', 6), ('O+', 40), ('A-', 4), ('A+', 20), ('B-', 3), ('B+', 16), ('AB-', 1), ('AB+', 5)
),
scale (code, factor) as (
  values ('KBTH', 1.6), ('MIL37', 1.0), ('RIDGE', 0.9), ('TEMA', 0.5),
         ('LEKMA', 0.25), ('GAEAST', 0.15), ('KATH', 1.4), ('CCTH', 0.8)
)
insert into public.blood_stock (hospital_id, blood_group, units)
select h.id, g.blood_group, floor(g.share * s.factor)::integer
from scale s
join public.hospitals h on h.code = s.code
cross join groups g
on conflict (hospital_id, blood_group) do nothing;

-- -----------------------------------------------------------------------------
-- Emergency catalogue
-- -----------------------------------------------------------------------------

insert into public.emergency_types (code, name, category, description, default_urgency, sort_order)
values
  ('obstetric_haemorrhage', 'Obstetric haemorrhage', 'Obstetric',
   'Antepartum or postpartum bleeding needing theatre and transfusion.', 'critical', 10),
  ('eclampsia', 'Eclampsia / severe pre-eclampsia', 'Obstetric',
   'Seizures or severe hypertension in pregnancy needing critical care.', 'critical', 20),
  ('obstructed_labour', 'Obstructed labour', 'Obstetric',
   'Failure to progress requiring emergency caesarean section.', 'critical', 30),
  ('neonatal_sepsis', 'Neonatal sepsis', 'Neonatal',
   'Septic newborn needing NICU support.', 'critical', 40),
  ('paed_respiratory', 'Paediatric respiratory distress', 'Paediatric',
   'Severe pneumonia, bronchiolitis or asthma in a child.', 'critical', 50),
  ('polytrauma', 'Polytrauma / road traffic accident', 'Trauma',
   'Multi-system injury needing surgery, imaging and blood.', 'critical', 60),
  ('head_injury', 'Severe head injury', 'Trauma',
   'Reduced consciousness after trauma; needs CT and neurosurgical cover.', 'critical', 70),
  ('severe_burns', 'Severe burns', 'Trauma',
   'Large surface area or airway burns needing a burns unit.', 'critical', 80),
  ('acute_abdomen', 'Acute abdomen', 'Surgical',
   'Peritonitis, perforation or obstruction needing laparotomy.', 'urgent', 90),
  ('stroke', 'Acute stroke', 'Medical',
   'Sudden neurological deficit needing urgent imaging.', 'critical', 100),
  ('stemi', 'STEMI / acute coronary syndrome', 'Cardiac',
   'Chest pain with ischaemic ECG changes; needs cardiac care.', 'critical', 110),
  ('snakebite', 'Snakebite envenomation', 'Medical',
   'Systemic envenomation needing antivenom and organ support.', 'urgent', 120)
on conflict (code) do nothing;

insert into public.emergency_requirements (emergency_type_id, resource_key, weight, is_critical, min_quantity)
select t.id, r.resource_key, r.weight, r.is_critical, r.min_quantity
from (values
  ('obstetric_haemorrhage', 'obstetric_theatre', 5, true,  1),
  ('obstetric_haemorrhage', 'blood_bank',        5, true,  1),
  ('obstetric_haemorrhage', 'anesthetist',       4, true,  1),
  ('obstetric_haemorrhage', 'operating_room',    4, false, 1),
  ('obstetric_haemorrhage', 'icu_bed',           3, false, 1),
  ('obstetric_haemorrhage', 'oxygen',            2, false, 30),

  ('eclampsia', 'obstetric_theatre',      4, true,  1),
  ('eclampsia', 'icu_bed',                4, false, 1),
  ('eclampsia', 'anesthetist',            3, true,  1),
  ('eclampsia', 'oxygen',                 3, false, 30),
  ('eclampsia', 'neonatal_resuscitation', 2, false, 1),

  ('obstructed_labour', 'obstetric_theatre',      5, true,  1),
  ('obstructed_labour', 'anesthetist',            4, true,  1),
  ('obstructed_labour', 'operating_room',         4, false, 1),
  ('obstructed_labour', 'blood_bank',             3, false, 1),
  ('obstructed_labour', 'neonatal_resuscitation', 3, false, 1),

  ('neonatal_sepsis', 'nicu_bed',               5, true,  1),
  ('neonatal_sepsis', 'neonatal_resuscitation', 4, true,  1),
  ('neonatal_sepsis', 'oxygen',                 4, false, 40),
  ('neonatal_sepsis', 'ventilator',             3, false, 1),
  ('neonatal_sepsis', 'blood_bank',             2, false, 1),

  ('paed_respiratory', 'oxygen',      5, true,  40),
  ('paed_respiratory', 'ventilator',  4, false, 1),
  ('paed_respiratory', 'icu_bed',     3, false, 1),
  ('paed_respiratory', 'general_bed', 2, false, 1),
  ('paed_respiratory', 'xray',        2, false, 1),

  ('polytrauma', 'operating_room',   5, true,  1),
  ('polytrauma', 'resident_surgeon', 5, true,  1),
  ('polytrauma', 'blood_bank',       5, true,  1),
  ('polytrauma', 'anesthetist',      4, true,  1),
  ('polytrauma', 'ct_scan',          4, false, 1),
  ('polytrauma', 'icu_bed',          4, false, 1),

  ('head_injury', 'ct_scan',        5, true,  1),
  ('head_injury', 'neurosurgery',   5, true,  1),
  ('head_injury', 'icu_bed',        4, true,  1),
  ('head_injury', 'ventilator',     4, false, 1),
  ('head_injury', 'operating_room', 3, false, 1),
  ('head_injury', 'anesthetist',    3, false, 1),

  ('severe_burns', 'burn_unit',     5, true,  1),
  ('severe_burns', 'isolation_bed', 4, false, 1),
  ('severe_burns', 'oxygen',        3, false, 40),
  ('severe_burns', 'icu_bed',       3, false, 1),
  ('severe_burns', 'blood_bank',    2, false, 1),

  ('acute_abdomen', 'operating_room',   5, true,  1),
  ('acute_abdomen', 'resident_surgeon', 5, true,  1),
  ('acute_abdomen', 'anesthetist',      4, true,  1),
  ('acute_abdomen', 'ultrasound',       3, false, 1),
  ('acute_abdomen', 'blood_bank',       3, false, 1),
  ('acute_abdomen', 'general_bed',      2, false, 1),

  ('stroke', 'ct_scan',     5, true,  1),
  ('stroke', 'icu_bed',     4, false, 1),
  ('stroke', 'oxygen',      3, false, 30),
  ('stroke', 'general_bed', 2, false, 1),
  ('stroke', 'mri',         2, false, 1),

  ('stemi', 'cath_lab',    5, true,  1),
  ('stemi', 'icu_bed',     4, false, 1),
  ('stemi', 'oxygen',      3, false, 30),
  ('stemi', 'ventilator',  2, false, 1),
  ('stemi', 'general_bed', 1, false, 1),

  ('snakebite', 'icu_bed',     4, false, 1),
  ('snakebite', 'ventilator',  3, false, 1),
  ('snakebite', 'blood_bank',  3, false, 1),
  ('snakebite', 'general_bed', 3, false, 1),
  ('snakebite', 'dialysis',    2, false, 1),
  ('snakebite', 'oxygen',      2, false, 30)
) as r (code, resource_key, weight, is_critical, min_quantity)
join public.emergency_types t on t.code = r.code
on conflict (emergency_type_id, resource_key) do nothing;

-- -----------------------------------------------------------------------------
-- Readiness history -- a genuine green / yellow / red spread
-- -----------------------------------------------------------------------------
-- Each department gets five consecutive shift submissions ending `offset`
-- shifts ago, which is what decides its traffic light:
--   0 shifts  -> green      1 shift  -> yellow      3+ shifts -> red
-- Cape Coast reports nothing at all, so every one of its departments is red.
-- Africa/Accra has no DST, so stepping back 8 hours steps back exactly one shift.

do $$
declare
  d record;
  v_offset integer;
  v_i integer;
  v_at timestamptz;
  v_shift_date date;
  v_shift_type text;
  v_payload jsonb;
begin
  for d in
    select dep.id, dep.hospital_id, dep.template_key, h.code, h.timezone
    from public.departments dep
    join public.hospitals h on h.id = dep.hospital_id
    where h.code in ('KBTH', 'MIL37', 'RIDGE', 'TEMA', 'LEKMA', 'GAEAST', 'KATH', 'CCTH')
    order by h.code, dep.name
  loop
    v_offset := case d.code
      when 'KBTH' then 0
      when 'KATH' then 0
      when 'RIDGE' then 0
      -- Imaging and the blood bank slipped two shifts: the hospital rolls up
      -- yellow even though most of its departments are current.
      when 'MIL37' then case when d.template_key in ('radiology', 'blood_bank') then 2 else 0 end
      when 'TEMA' then 1
      when 'LEKMA' then 1
      when 'GAEAST' then 4
      else null
    end;

    continue when v_offset is null;

    -- Mirror the live snapshot into the payload so the shift history shows the
    -- same numbers the resource page does.
    select jsonb_build_object(
      'resources',
      coalesce((
        select jsonb_object_agg(k, to_jsonb(hr) -> public.resource_column(k))
        from unnest(public.template_resources(d.template_key)) as k
      ), '{}'::jsonb)
    )
    into v_payload
    from public.hospital_resources hr
    where hr.hospital_id = d.hospital_id;

    for v_i in v_offset .. (v_offset + 4) loop
      v_at := now() - (v_i * interval '8 hours');

      select s.shift_date, s.shift_type into v_shift_date, v_shift_type
      from public.shift_for(v_at, d.timezone) s;

      insert into public.readiness_updates (
        hospital_id, department_id, shift_date, shift_type, submitted_at, payload, notes
      )
      values (
        d.hospital_id,
        d.id,
        v_shift_date,
        v_shift_type,
        v_at,
        coalesce(v_payload, '{}'::jsonb),
        case when v_i = v_offset then 'Seeded demo data.' else null end
      )
      on conflict (department_id, shift_date, shift_type) do nothing;
    end loop;
  end loop;
end;
$$;

-- =============================================================================
-- Attaching the first real user
-- =============================================================================
-- Accounts are created through Supabase Auth, never here: inserting into
-- auth.users by hand skips password hashing and identity rows. Create the user
-- in the dashboard (Authentication -> Users -> Add user), which fires the
-- handle_new_auth_user() trigger and leaves a `viewer` profile behind, then run
-- ONE of the statements below in the SQL editor to give it a role and a home.
--
--   -- Make yourself the system administrator:
--   update public.profiles
--   set role = 'super_admin', full_name = 'Your Name', is_active = true
--   where email = 'you@example.org';
--
--   -- Attach a hospital administrator to Korle-Bu:
--   update public.profiles
--   set role = 'hospital_admin',
--       hospital_id = (select id from public.hospitals where code = 'KBTH')
--   where email = 'admin.kbth@example.org';
--
--   -- Attach a shift in-charge to Korle-Bu's Emergency department:
--   update public.profiles
--   set role = 'shift_in_charge',
--       hospital_id = (select id from public.hospitals where code = 'KBTH'),
--       department_id = (
--         select d.id from public.departments d
--         join public.hospitals h on h.id = d.hospital_id
--         where h.code = 'KBTH' and d.template_key = 'emergency'
--       )
--   where email = 'incharge.kbth@example.org';
--
--   -- Attach a referral coordinator to Tema General:
--   update public.profiles
--   set role = 'referral_coordinator',
--       hospital_id = (select id from public.hospitals where code = 'TEMA')
--   where email = 'coordinator.tema@example.org';
--
-- Invited users can also arrive pre-configured, but the role and hospital must
-- travel in app_metadata (service-role writable only), NOT user_metadata, which
-- the account holder controls at signup:
--
--   curl -X POST "$SUPABASE_URL/auth/v1/admin/users" --     -H "apikey: $SERVICE_ROLE_KEY" --     -H "Authorization: Bearer $SERVICE_ROLE_KEY" --     -H "Content-Type: application/json" --     -d '{"email":"ama@hospital.org","email_confirm":true,
--          "user_metadata":{"full_name":"Ama Mensah"},
--          "app_metadata":{"role":"shift_in_charge",
--                          "hospital_id":"11111111-1111-4111-8111-111111111101"}}'
