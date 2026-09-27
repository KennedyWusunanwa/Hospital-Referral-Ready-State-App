-- =============================================================================
-- FERN -- 0007_hospital_logo_seed.sql
--
-- Points the eight seeded facilities at the logos shipped with the app under
-- public/hospital-logos/ (see the README in that folder for sources). Paths are
-- relative to the site origin, so they keep working when the domain changes.
--
-- Idempotent and non-destructive: a facility that has already uploaded or
-- pasted its own logo is left alone.
-- =============================================================================

update public.hospitals h
set logo_url = v.path
from (values
  ('KBTH',   '/hospital-logos/kbth.png'),
  ('MIL37',  '/hospital-logos/mil37.png'),
  ('RIDGE',  '/hospital-logos/ridge.png'),
  ('TEMA',   '/hospital-logos/ghs.png'),
  ('LEKMA',  '/hospital-logos/ghs.png'),
  ('GAEAST', '/hospital-logos/gaeast.png'),
  ('KATH',   '/hospital-logos/kath.png'),
  ('CCTH',   '/hospital-logos/ccth.png')
) as v (code, path)
where h.code = v.code
  and nullif(btrim(coalesce(h.logo_url, '')), '') is null;
