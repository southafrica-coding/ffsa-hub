-- ============================================================
-- FFSA Hub — Migration 291: keep finance in step with Xero
-- ============================================================
-- APPLY ORDER: after 275 (Xero code mirror, PR #474) and 290 (finance orgs
-- and projects, PR #496). It references tables from both.
--
-- Xero is the source of truth for both organisations. The Hub keeps a
-- read-only mirror of each Xero file (chart of accounts, tracking categories
-- and options, items — migration 275) and keeps the Hub's projects
-- (finance_projects, migration 290) in step with each org's "Ministries"
-- tracking category. The sync runs server-side with the service role:
-- automatically every day (cron), whenever a finance person opens a page
-- that shows this data and the copy is more than a few minutes old, and
-- right after a Xero organisation is (re)connected. It only ever READS
-- from Xero.
--
-- Names and status come from Xero. The CSV seed in 290 is only a bootstrap
-- for before Xero is connected: the first sync links each seeded project to
-- its Xero option (matched by name within the same org) and, from then on,
-- the sync owns the project's name and active/archived state. Hub-owned
-- fields (project_type, notes, linked_project_id; friendly_name and
-- is_hidden on the mirror) are never touched by the sync.
--
-- What this adds:
--
--   1. xero_tracking_roles 'ministries' for za and us (category "Ministries"),
--      beside the 'schools' rows from 275. The sync fills category_id.
--
--   2. finance_projects.xero_tracking_option_id — the mirrored Xero option a
--      project is. Nullable (NULL = not linked to Xero yet). Unique when set,
--      so two Hub projects can never claim the same Xero option.
--
--   3. xero_sync_runs: trigger may also be 'view' (a finance page asked for a
--      refresh) or 'reconnect' (right after a Xero connection); status may
--      also be 'skipped' (organisation not connected / authorisation lapsed —
--      nothing was read). At most one 'running' run per region at a time, so
--      two open tabs never hit Xero twice for the same organisation.
--
--   4. public.finance_org_choices() — the two org names for the event form's
--      "Finance organisation" select. Returns only id, key, name,
--      record_currency and is_active; never accounts, projects or Xero data.
--      Open to people who can edit events (admin, events_admin, events.create,
--      or anyone who created an event) and to finance readers. Everyone else
--      gets no rows.
--
-- No account-code column is added anywhere: using the chart of accounts on
-- budgets or transactions stays on hold.
--
-- Only adds objects (one nullable column, rows in xero_tracking_roles, two
-- widened CHECK constraints, one index, one function). No existing row is
-- changed.
--
-- Safe to re-run: the column and indexes are IF NOT EXISTS, the seed is
-- ON CONFLICT DO NOTHING (an admin's later edit is never overwritten), the
-- two CHECK constraints are dropped by name and added again, the function is
-- CREATE OR REPLACE.
--
-- ROLLBACK (summary): drop the function, the index and the column, put the
-- two CHECK constraints back as 275 had them, delete the 'ministries' roles.
-- Full block at the end of this file.
-- ============================================================


-- ────────────────────────────────────────────────────────────
-- 1. Seed: the "ministries" tracking role in both organisations
-- ────────────────────────────────────────────────────────────
-- Already there → left alone, so re-running never overrides an admin's edit.
INSERT INTO public.xero_tracking_roles (role_key, org_region, category_name)
VALUES
  ('ministries', 'za', 'Ministries'),
  ('ministries', 'us', 'Ministries')
ON CONFLICT (role_key, org_region) DO NOTHING;


-- ────────────────────────────────────────────────────────────
-- 2. Projects point at their Xero option
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.finance_projects
  ADD COLUMN IF NOT EXISTS xero_tracking_option_id uuid
    REFERENCES public.xero_tracking_options(id) ON DELETE SET NULL;

-- Two Hub projects can never claim the same Xero option.
CREATE UNIQUE INDEX IF NOT EXISTS finance_projects_xero_option_key
  ON public.finance_projects (xero_tracking_option_id)
  WHERE xero_tracking_option_id IS NOT NULL;


-- ────────────────────────────────────────────────────────────
-- 3. Sync runs: automatic triggers, 'skipped', one run at a time
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.xero_sync_runs DROP CONSTRAINT IF EXISTS xero_sync_runs_trigger_check;
ALTER TABLE public.xero_sync_runs
  ADD CONSTRAINT xero_sync_runs_trigger_check
  CHECK (trigger IN ('cron', 'manual', 'view', 'reconnect'));

ALTER TABLE public.xero_sync_runs DROP CONSTRAINT IF EXISTS xero_sync_runs_status_check;
ALTER TABLE public.xero_sync_runs
  ADD CONSTRAINT xero_sync_runs_status_check
  CHECK (status IN ('running', 'succeeded', 'partial', 'failed', 'skipped'));

-- The lock: a second sync for the same region while one is running fails
-- its insert and backs off. The sync closes runs that died mid-way
-- (running for over 10 minutes) as 'failed' before it tries.
CREATE UNIQUE INDEX IF NOT EXISTS xero_sync_runs_one_running_per_region
  ON public.xero_sync_runs (org_region)
  WHERE status = 'running';


-- ────────────────────────────────────────────────────────────
-- 4. The org names for the event form
-- ────────────────────────────────────────────────────────────
-- finance_orgs is readable by finance only (290). People who edit events
-- need just the two names to choose one, so this hands out exactly that and
-- nothing else. SECURITY DEFINER to read past RLS; the WHERE clause is the
-- gate.
CREATE OR REPLACE FUNCTION public.finance_org_choices()
RETURNS TABLE (id uuid, key text, name text, record_currency text, is_active boolean)
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public AS $$
  SELECT o.id, o.key, o.name, o.record_currency, o.is_active
    FROM public.finance_orgs o
   WHERE auth.uid() IS NOT NULL
     AND (
          public.is_admin()
       OR public.has_role('events_admin')
       OR public.has_permission('events.create')
       OR EXISTS (SELECT 1 FROM public.events e WHERE e.created_by = auth.uid())
       OR public.has_role('finance_admin')
       OR public.has_permission('finance.view')
       OR public.has_permission('finance.edit')
     )
   ORDER BY o.key;
$$;

REVOKE ALL ON FUNCTION public.finance_org_choices() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finance_org_choices() TO authenticated, service_role;


-- ────────────────────────────────────────────────────────────
-- 5. Comments
-- ────────────────────────────────────────────────────────────
COMMENT ON COLUMN public.finance_projects.xero_tracking_option_id IS
  'The mirrored Xero "Ministries" option this project is (xero_tracking_options). NULL = not linked to Xero yet (seeded from the CSV before Xero was connected). Once set, the Xero sync owns name and active/archived state; Xero is the source of truth. Unique: one project per Xero option.';
COMMENT ON COLUMN public.finance_projects.name IS
  'The Xero option name, spelled as in Xero. Updated by the Xero sync (service role) whenever Xero renames it. Not editable in the Hub.';
COMMENT ON COLUMN public.finance_projects.source IS
  'Where the row first came from: xero_csv_2026-11-05 (the 290 bootstrap seed) or xero_sync (added by the sync because Xero has it). Informational.';
COMMENT ON FUNCTION public.finance_org_choices() IS
  'The two finance orgs (id, key, name, record_currency, is_active) for the event form''s "Finance organisation" select. For event editors and finance readers only; no accounts, projects or Xero data.';
COMMENT ON INDEX public.xero_sync_runs_one_running_per_region IS
  'At most one running Xero sync per region, so concurrent triggers (two tabs, cron + page) never double-call Xero.';


-- ============================================================
-- Verify:
--   SELECT role_key, org_region, category_name, category_id
--     FROM public.xero_tracking_roles ORDER BY 1, 2;
--                       -- ministries/schools × us/za; category_id NULL until the first sync
--
--   SELECT column_name, is_nullable FROM information_schema.columns
--    WHERE table_name = 'finance_projects' AND column_name = 'xero_tracking_option_id';
--                       -- one row, YES
--
--   SELECT indexname FROM pg_indexes
--    WHERE indexname IN ('finance_projects_xero_option_key',
--                        'xero_sync_runs_one_running_per_region');   -- two rows
--
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint
--    WHERE conname IN ('xero_sync_runs_trigger_check', 'xero_sync_runs_status_check');
--                       -- includes 'view', 'reconnect' and 'skipped'
--
--   SELECT * FROM public.finance_org_choices();
--                       -- as an events admin: the two orgs. As a user who can't
--                       -- edit events and has no finance access: no rows.
-- ============================================================

-- ------------------------------------------------------------
-- ROLLBACK:
--   Unlinks every project from Xero (names stay as last synced) and drops
--   the event form's org list. Projects and the mirror are kept.
--
--   DROP FUNCTION IF EXISTS public.finance_org_choices();
--   DROP INDEX IF EXISTS public.xero_sync_runs_one_running_per_region;
--   -- Close any run still marked running/skipped first, or the old CHECK fails:
--   UPDATE public.xero_sync_runs SET status = 'failed' WHERE status IN ('running', 'skipped');
--   UPDATE public.xero_sync_runs SET trigger = 'manual' WHERE trigger IN ('view', 'reconnect');
--   ALTER TABLE public.xero_sync_runs DROP CONSTRAINT IF EXISTS xero_sync_runs_status_check;
--   ALTER TABLE public.xero_sync_runs ADD CONSTRAINT xero_sync_runs_status_check
--     CHECK (status IN ('running', 'succeeded', 'partial', 'failed'));
--   ALTER TABLE public.xero_sync_runs DROP CONSTRAINT IF EXISTS xero_sync_runs_trigger_check;
--   ALTER TABLE public.xero_sync_runs ADD CONSTRAINT xero_sync_runs_trigger_check
--     CHECK (trigger IN ('cron', 'manual'));
--   DROP INDEX IF EXISTS public.finance_projects_xero_option_key;
--   ALTER TABLE public.finance_projects DROP COLUMN IF EXISTS xero_tracking_option_id;
--   DELETE FROM public.xero_tracking_roles WHERE role_key = 'ministries';
-- ------------------------------------------------------------
