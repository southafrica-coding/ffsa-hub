-- ============================================================
-- FFSA Hub — Migration 401: Operations RLS
-- ============================================================
-- The operations team (is_ops_team(): the Operations department's
-- members, operations.team helpers, admins) sees and changes
-- everything. Anyone a task was given to sees and updates THAT item and
-- adds to its log, even without the team key. Slack intake, the morning
-- message and reminders run with the service role.
--
-- ROLLBACK: DROP POLICY … on each table below (or drop the tables, 400).
-- ============================================================

ALTER TABLE public.ops_settings      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ops_items         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ops_item_updates  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ops_digest_log    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ops_reminder_log  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.ops_settings, public.ops_items, public.ops_item_updates,
  public.ops_digest_log, public.ops_reminder_log FROM anon;
REVOKE ALL ON public.ops_digest_log, public.ops_reminder_log FROM authenticated;

-- ── Settings: team reads, admins change ─────────────────────
DROP POLICY IF EXISTS ops_settings_select ON public.ops_settings;
CREATE POLICY ops_settings_select ON public.ops_settings
  FOR SELECT TO authenticated USING (public.is_ops_team());

DROP POLICY IF EXISTS ops_settings_update ON public.ops_settings;
CREATE POLICY ops_settings_update ON public.ops_settings
  FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ── Items ───────────────────────────────────────────────────
DROP POLICY IF EXISTS ops_items_select ON public.ops_items;
CREATE POLICY ops_items_select ON public.ops_items
  FOR SELECT TO authenticated
  USING (public.is_ops_team() OR owner_user_id = auth.uid());

DROP POLICY IF EXISTS ops_items_insert ON public.ops_items;
CREATE POLICY ops_items_insert ON public.ops_items
  FOR INSERT TO authenticated
  WITH CHECK (public.is_ops_team() AND source IN ('hub', 'meeting'));

DROP POLICY IF EXISTS ops_items_update ON public.ops_items;
CREATE POLICY ops_items_update ON public.ops_items
  FOR UPDATE TO authenticated
  USING (public.is_ops_team() OR owner_user_id = auth.uid())
  WITH CHECK (public.is_ops_team() OR owner_user_id = auth.uid());

DROP POLICY IF EXISTS ops_items_delete ON public.ops_items;
CREATE POLICY ops_items_delete ON public.ops_items
  FOR DELETE TO authenticated USING (public.is_admin());

-- An owner without the team key may move status and add notes, but not
-- hand the item on, change its date, or rewrite what was asked.
CREATE OR REPLACE FUNCTION public.ops_items_owner_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR public.is_ops_team() THEN
    RETURN NEW;
  END IF;
  IF NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id
     OR NEW.due_on IS DISTINCT FROM OLD.due_on
     OR NEW.area IS DISTINCT FROM OLD.area
     OR NEW.title IS DISTINCT FROM OLD.title
     OR NEW.details IS DISTINCT FROM OLD.details
     OR NEW.location IS DISTINCT FROM OLD.location THEN
    RAISE EXCEPTION 'Only the operations team can change this';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ops_items_owner_guard ON public.ops_items;
CREATE TRIGGER ops_items_owner_guard BEFORE UPDATE ON public.ops_items
  FOR EACH ROW EXECUTE FUNCTION public.ops_items_owner_guard();

-- ── Updates (append-only log) ───────────────────────────────
DROP POLICY IF EXISTS ops_item_updates_select ON public.ops_item_updates;
CREATE POLICY ops_item_updates_select ON public.ops_item_updates
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.ops_items i WHERE i.id = item_id
                 AND (public.is_ops_team() OR i.owner_user_id = auth.uid())));

DROP POLICY IF EXISTS ops_item_updates_insert ON public.ops_item_updates;
CREATE POLICY ops_item_updates_insert ON public.ops_item_updates
  FOR INSERT TO authenticated
  WITH CHECK (
    author_user_id = auth.uid()
    AND EXISTS (SELECT 1 FROM public.ops_items i WHERE i.id = item_id
                AND (public.is_ops_team() OR i.owner_user_id = auth.uid())));
