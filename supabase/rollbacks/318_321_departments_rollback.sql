-- Undo migrations 318–321 in one transaction.
-- Never run this on the live project. It drops the new tables and
-- restores only the rows 318 recorded in migration_318_changes.
-- user_roles are left alone, including any ministry_leader grant.
-- org_edit_log and membership-history rows stay as the audit trail.
--
-- Deleting a be_free membership that 318 inserted fires
-- archive_staff_ministry_membership (250) and sync_no_ministry_membership
-- (266). be_free is part_time, so it does not count as a main ministry.
-- On prod Philip van Staden stays in Prayer & Worship, which is main, so
-- his main-ministry count stays above zero and the No Ministry add side
-- does not run.

BEGIN;

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
DROP FUNCTION IF EXISTS public.user_can_moderate_service(text);

-- can_moderate_evangelism was last defined in 311. Restored word for word.
CREATE OR REPLACE FUNCTION public.can_moderate_evangelism()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT public.is_admin() OR public.has_permission('evangelism.moderate');
$$;

REVOKE ALL ON FUNCTION public.can_moderate_evangelism() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_moderate_evangelism() TO authenticated, service_role;

-- undo 318 data. Updates first, then inserts. A be_free row or a Philip
-- membership that already existed is not in migration_318_changes, so it
-- is not deleted. The palette timestamp is the value on prod before 318.
UPDATE public.ministries m
   SET staff_ministry_id = NULL,
       updated_at = '2026-10-19 08:33:36.68362+00'
  FROM public.migration_318_changes c
 WHERE c.kind = 'update'
   AND c.table_name = 'ministries'
   AND c.row_id = m.id
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
   SET parent_id = NULL
  FROM public.migration_318_changes c
 WHERE c.kind = 'update'
   AND c.table_name = 'staff_ministries'
   AND c.row_id = s.id
   AND c.prior ? 'parent_id'
   AND s.slug = 'donors_dev'
   AND s.parent_id = (SELECT id FROM public.staff_ministries WHERE slug = 'finances_legal');

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

COMMIT;
