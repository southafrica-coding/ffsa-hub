-- Undo migrations 318–321 in one transaction.
-- Run on prod only with Jack's explicit OK, and only after the export
-- below. It drops the new tables and restores only the rows 318 recorded
-- in migration_318_changes.
-- user_roles are left alone, including any ministry_leader grant.
-- org_edit_log and membership-history rows stay as the audit trail.
--
-- Deleting a be_free membership that 318 inserted fires
-- archive_staff_ministry_membership (250) and sync_no_ministry_membership
-- (266). be_free is part_time, so it does not count as a main ministry.
-- On prod the seeded department lead stays in Prayer & Worship, which is main, so
-- that user's main-ministry count stays above zero and the No Ministry add side
-- does not run.
--
-- Export before this runs. From psql, against the database you are
-- rolling back:
--
--   \copy (SELECT * FROM public.rocks) TO 'rocks.csv' CSV HEADER
--   \copy (SELECT * FROM public.department_budget_links) TO 'department_budget_links.csv' CSV HEADER
--   \copy (SELECT * FROM public.services) TO 'services.csv' CSV HEADER
--   \copy (SELECT * FROM public.service_owners) TO 'service_owners.csv' CSV HEADER
--
-- The same rows, as a query:
--   SELECT * FROM public.rocks;
--   SELECT * FROM public.department_budget_links;
--   SELECT * FROM public.services;
--   SELECT * FROM public.service_owners;

BEGIN;

-- Refuse to delete the be_free ministry 318 inserted while anything other
-- than that tracked membership still points at it through a cascading,
-- restricting, or NO ACTION foreign key. SET NULL links (the palette,
-- parent_id) are not data loss and are not checked. The membership loop
-- is separate: it runs over every membership 318 inserted, including when
-- be_free itself was already there and was not inserted. A subcategory on
-- one of those memberships (staff_ministry_member_subcategories, ON DELETE
-- CASCADE) refuses the rollback. Tables that do not exist on a throwaway
-- database are skipped because the catalog only lists what is there.
DO $guard$
DECLARE
  v_be uuid;
  v_inserted boolean := false;
  v_n int;
  r record;
BEGIN
  IF to_regclass('public.migration_318_changes') IS NULL THEN
    RETURN;
  END IF;

  IF to_regclass('public.staff_ministries') IS NOT NULL THEN
    SELECT id INTO v_be FROM public.staff_ministries WHERE slug = 'be_free';
    v_inserted := v_be IS NOT NULL AND EXISTS (
      SELECT 1
        FROM public.migration_318_changes
       WHERE kind = 'insert'
         AND table_name = 'staff_ministries'
         AND row_id = v_be
    );
  END IF;

  IF v_inserted THEN
    FOR r IN
      SELECT c.conrelid::regclass AS rel,
             a.attname AS col
        FROM pg_constraint c
        JOIN pg_attribute a
          ON a.attrelid = c.conrelid
         AND a.attnum = c.conkey[1]
       WHERE c.confrelid = 'public.staff_ministries'::regclass
         AND c.contype = 'f'
         AND c.confdeltype IN ('c', 'r', 'a')
         AND cardinality(c.conkey) = 1
    LOOP
      IF r.rel = 'public.staff_ministry_members'::regclass
         AND r.col = 'staff_ministry_id' THEN
        EXECUTE
          'SELECT count(*) FROM public.staff_ministry_members mm
            WHERE mm.staff_ministry_id = $1
              AND NOT EXISTS (
                SELECT 1 FROM public.migration_318_changes ch
                 WHERE ch.kind = ''insert''
                   AND ch.table_name = ''staff_ministry_members''
                   AND ch.row_id = mm.id
              )'
          INTO v_n USING v_be;
      ELSIF r.rel = 'public.staff_ministry_aliases'::regclass THEN
        EXECUTE format(
          'SELECT count(*) FROM %s x
            WHERE x.%I = $1
              AND NOT EXISTS (
                SELECT 1 FROM public.migration_318_changes ch
                 WHERE ch.kind = ''insert''
                   AND ch.table_name = ''staff_ministry_aliases''
                   AND ch.row_id = x.id
              )',
          r.rel, r.col
        ) INTO v_n USING v_be;
      ELSE
        EXECUTE format('SELECT count(*) FROM %s WHERE %I = $1', r.rel, r.col)
          INTO v_n USING v_be;
      END IF;

      IF v_n > 0 THEN
        RAISE EXCEPTION
          'rollback refused: be_free (%) still has % row(s) in % (%)',
          v_be, v_n, r.rel, r.col;
      END IF;
    END LOOP;
  END IF;

  IF to_regclass('public.staff_ministry_members') IS NULL THEN
    RETURN;
  END IF;

  FOR r IN
    SELECT c.conrelid::regclass AS rel,
           a.attname AS col
      FROM pg_constraint c
      JOIN pg_attribute a
        ON a.attrelid = c.conrelid
       AND a.attnum = c.conkey[1]
     WHERE c.confrelid = 'public.staff_ministry_members'::regclass
       AND c.contype = 'f'
       AND c.confdeltype IN ('c', 'r', 'a')
       AND cardinality(c.conkey) = 1
  LOOP
    EXECUTE format(
      'SELECT count(*) FROM %s x
        WHERE x.%I IN (
          SELECT mm.id
            FROM public.staff_ministry_members mm
            JOIN public.migration_318_changes ch
              ON ch.kind = ''insert''
             AND ch.table_name = ''staff_ministry_members''
             AND ch.row_id = mm.id
        )',
      r.rel, r.col
    ) INTO v_n;

    IF v_n > 0 THEN
      RAISE EXCEPTION
        'rollback refused: a membership 318 inserted still has % row(s) in % (%)',
        v_n, r.rel, r.col;
    END IF;
  END LOOP;
END
$guard$;

-- undo 321: budgets. Drop the table before the functions its policies call.
DROP TABLE IF EXISTS public.department_budget_links;
DROP FUNCTION IF EXISTS public.dept_can_write_budget(uuid);
DROP FUNCTION IF EXISTS public.dept_can_read_budget(uuid);
DROP FUNCTION IF EXISTS public.dept_holds_unscoped_permission(text);

-- undo 320: rocks. View first, then the table, then the helpers.
DROP VIEW IF EXISTS public.leadership_ministry_rollup;
DROP TABLE IF EXISTS public.rocks;
DROP FUNCTION IF EXISTS public.dept_can_read_rock(uuid);
DROP FUNCTION IF EXISTS public.dept_can_write_rock(uuid);

-- undo 319: services.
DROP VIEW IF EXISTS public.ministry_service_access;
DROP TABLE IF EXISTS public.service_owners;
DROP TABLE IF EXISTS public.services;
DROP FUNCTION IF EXISTS public.user_can_use_service(text);

-- can_moderate_evangelism was last defined in 311. Restored word for word.
-- 311 set no comment.
CREATE OR REPLACE FUNCTION public.can_moderate_evangelism()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT public.is_admin() OR public.has_permission('evangelism.moderate');
$$;

COMMENT ON FUNCTION public.can_moderate_evangelism() IS NULL;

REVOKE ALL ON FUNCTION public.can_moderate_evangelism() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_moderate_evangelism() TO authenticated, service_role;

-- undo 318 data. Updates first, then inserts. A be_free row or a seeded-lead
-- membership that already existed is not in migration_318_changes, so it
-- is not deleted. The palette timestamp is the value recorded before 318
-- changed the row. The link is cleared only while it still points at the
-- be_free ministry 318 set.
UPDATE public.ministries m
   SET staff_ministry_id = NULLIF(c.prior->>'staff_ministry_id', '')::uuid,
       updated_at = (c.prior->>'updated_at')::timestamptz
  FROM public.migration_318_changes c
 WHERE c.kind = 'update'
   AND c.table_name = 'ministries'
   AND c.row_id = m.id
   AND c.prior ? 'updated_at'
   AND m.staff_ministry_id IS NOT DISTINCT FROM (
     SELECT id FROM public.staff_ministries WHERE slug = 'be_free'
   )
   AND NOT EXISTS (
     SELECT 1
       FROM public.migration_318_changes i
      WHERE i.kind = 'insert'
        AND i.table_name = 'ministries'
        AND i.row_id = m.id
   );

UPDATE public.staff_ministries s
   SET cluster = c.prior->>'cluster'
  FROM public.migration_318_changes c
 WHERE c.kind = 'update'
   AND c.table_name = 'staff_ministries'
   AND c.row_id = s.id
   AND c.prior ? 'cluster';

UPDATE public.staff_ministries s
   SET parent_id = NULLIF(c.prior->>'parent_id', '')::uuid
  FROM public.migration_318_changes c
 WHERE c.kind = 'update'
   AND c.table_name = 'staff_ministries'
   AND c.row_id = s.id
   AND c.prior ? 'parent_id'
   AND s.slug = 'donors_dev'
   AND s.parent_id IS NOT DISTINCT FROM (
     SELECT id FROM public.staff_ministries WHERE slug = 'finances_legal'
   );

DELETE FROM public.staff_ministry_members mm
 USING public.migration_318_changes c
 WHERE c.kind = 'insert'
   AND c.table_name = 'staff_ministry_members'
   AND c.row_id = mm.id;

DELETE FROM public.staff_ministry_aliases a
 USING public.migration_318_changes c
 WHERE c.kind = 'insert'
   AND c.table_name = 'staff_ministry_aliases'
   AND c.row_id = a.id;

DELETE FROM public.ministries m
 USING public.migration_318_changes c
 WHERE c.kind = 'insert'
   AND c.table_name = 'ministries'
   AND c.row_id = m.id;

DELETE FROM public.staff_ministries s
 USING public.migration_318_changes c
 WHERE c.kind = 'insert'
   AND c.table_name = 'staff_ministries'
   AND c.row_id = s.id
   AND s.slug = 'be_free';

-- undo 318 structure. View before its tables. The member function's
-- real signature is (uuid, boolean); there is no (uuid) overload.
DROP VIEW IF EXISTS public.staff_ministry_resolution;
DROP TABLE IF EXISTS public.staff_ministry_aliases;
DROP FUNCTION IF EXISTS public.staff_ministry_aliases_no_chain();
DROP FUNCTION IF EXISTS public.staff_ministry_home_id(uuid);
DROP FUNCTION IF EXISTS public.dept_is_leadership_reader();
DROP FUNCTION IF EXISTS public.dept_is_ministry_leader(uuid);
DROP FUNCTION IF EXISTS public.dept_is_ministry_member(uuid, boolean);
DROP FUNCTION IF EXISTS public.dept_can_write_org_structure();
DROP FUNCTION IF EXISTS public.dept_caller_is_active();
DROP TABLE IF EXISTS public.migration_318_changes;

-- Prod stores the apply timestamp in version and the file stem in name
-- (311 is version 20261110094706, name 311_evangelism_open_publish_and_moderate).
-- A short version is removed only when its name is null or one of these
-- stems, so version 318 with some other name is left alone. A throwaway
-- database has no supabase_migrations schema; leave it alone.
DO $mig$
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NULL THEN
    RETURN;
  END IF;
  DELETE FROM supabase_migrations.schema_migrations
   WHERE name IN (
     '318_department_homes',
     '319_department_services',
     '320_ministry_rocks',
     '321_department_budgets'
   )
      OR (
        version IN ('318', '319', '320', '321')
        AND (
          name IS NULL
          OR name IN (
            '318_department_homes',
            '319_department_services',
            '320_ministry_rocks',
            '321_department_budgets'
          )
        )
      );
END
$mig$;

COMMIT;
