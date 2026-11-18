-- ============================================================
-- One-off backfill: Missio-labelled contacts -> org_people
-- ============================================================
-- Not a migration. Nothing in this repo runs it. Run it by hand,
-- as the service role, only after Jack's own OK, and only right
-- before the house-church import.
--
-- It looks up the Missio org by slug 'missio' and the Missio
-- label by slug 'missio', then by name. No environment id is
-- hardcoded. For each contact holding that label it inserts
-- org_people (campus potch, status active). org_people has no
-- source column. created_by is auth.uid(), which is null when
-- the service role runs this. ON CONFLICT (org_id, contact_id)
-- DO NOTHING, so a second run inserts nothing.
--
-- The insert fires the org_people label-mirror trigger from
-- migration 329. Migration 331's triggers do not write org_people.
--
-- Dry run is the default. It counts and then raises DRY_RUN,
-- which rolls the transaction back, so a prod check writes
-- nothing.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f supabase/scripts/missio_org_people_backfill.sql
--
-- Real run, still only after Jack's OK:
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v dry_run=0 \
--     -f supabase/scripts/missio_org_people_backfill.sql
--
-- SQL editor: do not paste the backslash lines. Run this in the
-- same session first (use '0' only for the real run):
--
--   SELECT set_config('missio.backfill_dry_run', '1', false);
--
-- Then run from BEGIN to COMMIT. A dry run ends on the DRY_RUN
-- error. That error is the success signal for a dry run.
--
-- One audit_logs row is written per real run when that table
-- exists. Otherwise the counts are a NOTICE. Counts are
-- candidates, inserted, already_present, and skipped (with why).

\if :{?dry_run}
\else
\set dry_run 1
\endif

BEGIN;

SELECT set_config('missio.backfill_dry_run', :'dry_run', true);

DO $backfill$
DECLARE
  v_flag text;
  v_dry boolean;
  v_org uuid;
  v_label uuid;
  v_candidates int := 0;
  v_already int := 0;
  v_inserted int := 0;
  v_skipped int := 0;
  v_reasons text := 'none';
  v_summary text;
BEGIN
  v_flag := coalesce(
    nullif(current_setting('missio.backfill_dry_run', true), ''),
    '1'
  );
  v_dry := v_flag NOT IN ('0', 'off', 'false', 'no');

  SELECT o.id
    INTO v_org
  FROM public.organisations o
  WHERE o.slug = 'missio';

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'missio_org_missing';
  END IF;

  SELECT l.id
    INTO v_label
  FROM public.labels l
  WHERE l.slug = 'missio'
  ORDER BY l.id
  LIMIT 1;

  IF v_label IS NULL THEN
    SELECT l.id
      INTO v_label
    FROM public.labels l
    WHERE lower(btrim(l.name)) = 'missio'
    ORDER BY l.id
    LIMIT 1;
  END IF;

  IF v_label IS NULL THEN
    RAISE EXCEPTION 'missio_label_missing';
  END IF;

  CREATE TEMP TABLE missio_backfill_candidates (
    contact_id uuid PRIMARY KEY,
    skip_reason text
  ) ON COMMIT DROP;

  INSERT INTO missio_backfill_candidates (contact_id, skip_reason)
  SELECT DISTINCT cl.contact_id,
         CASE
           WHEN c.id IS NULL THEN 'contact missing'
           ELSE NULL
         END
  FROM public.contact_labels cl
  LEFT JOIN public.contacts c ON c.id = cl.contact_id
  WHERE cl.label_id = v_label
    AND cl.contact_id IS NOT NULL;

  SELECT count(*) INTO v_candidates FROM missio_backfill_candidates;

  SELECT count(*)
    INTO v_already
  FROM missio_backfill_candidates cand
  JOIN public.org_people op
    ON op.org_id = v_org
   AND op.contact_id = cand.contact_id
  WHERE cand.skip_reason IS NULL;

  SELECT count(*),
         coalesce(string_agg(DISTINCT cand.skip_reason, ', ' ORDER BY cand.skip_reason), 'none')
    INTO v_skipped, v_reasons
  FROM missio_backfill_candidates cand
  WHERE cand.skip_reason IS NOT NULL;

  IF v_dry THEN
    v_summary := format(
      'DRY_RUN candidates=%s would_insert=%s already_present=%s skipped=%s skipped_reasons=%s',
      v_candidates,
      v_candidates - v_already - v_skipped,
      v_already,
      v_skipped,
      v_reasons
    );
    RAISE NOTICE '%', v_summary;
    RAISE EXCEPTION '%', v_summary;
  END IF;

  INSERT INTO public.org_people (org_id, contact_id, campus, status, created_by)
  SELECT v_org, cand.contact_id, 'potch', 'active', (SELECT auth.uid())
  FROM missio_backfill_candidates cand
  WHERE cand.skip_reason IS NULL
  ON CONFLICT (org_id, contact_id) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  -- A conflict is "already present", not a skip. Anything left over
  -- did not insert and was not counted above.
  IF v_inserted + v_already + v_skipped <> v_candidates THEN
    v_skipped := v_candidates - v_inserted - v_already;
    IF v_reasons = 'none' THEN
      v_reasons := 'insert did not return a row';
    ELSE
      v_reasons := v_reasons || ', insert did not return a row';
    END IF;
  END IF;

  v_summary := format(
    'missio_org_people_backfill candidates=%s inserted=%s already_present=%s skipped=%s skipped_reasons=%s',
    v_candidates, v_inserted, v_already, v_skipped, v_reasons
  );
  RAISE NOTICE '%', v_summary;

  IF to_regclass('public.audit_logs') IS NOT NULL THEN
    INSERT INTO public.audit_logs (user_id, action, resource_type, resource_id, changes)
    VALUES (
      (SELECT auth.uid()),
      'missio_org_people_backfill',
      'org_people',
      v_org,
      jsonb_build_object(
        'candidates', v_candidates,
        'inserted', v_inserted,
        'already_present', v_already,
        'skipped', v_skipped,
        'skipped_reasons', v_reasons
      )
    );
  END IF;
END
$backfill$;

COMMIT;
