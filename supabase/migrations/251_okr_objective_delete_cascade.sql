-- ============================================================
-- FFSA Hub — Migration 251: Deleting an objective with key results
-- ============================================================
-- Deleting any objective that still had key results failed with
--   23503: insert or update on table "okr_events" violates foreign key
--   constraint "okr_events_objective_id_fkey"
-- and the whole delete rolled back. The Delete objective button on /okrs
-- (and on /profile) has been broken for every objective with a key result.
--
-- Cause: log_okr_key_result_change() (migration 197) records a deleted key
-- result against its parent objective, which normally survives. When the
-- OBJECTIVE is deleted, ON DELETE CASCADE removes its key results, the
-- trigger fires for each one, and it tries to insert an event pointing at
-- the objective that is mid-deletion.
--
-- Fix: the DELETE branch only writes the event when the objective still
-- exists. Deleting a single key result is logged exactly as before. Nothing
-- else in the function changes, and the trigger itself is untouched.
--
-- Idempotent: CREATE OR REPLACE only.
-- ============================================================

CREATE OR REPLACE FUNCTION public.log_okr_key_result_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor uuid := auth.uid();
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.okr_events (key_result_id, action, new_value, actor_id)
      VALUES (NEW.id, 'created', NEW.description, actor);
    RETURN NULL;
  END IF;

  IF TG_OP = 'DELETE' THEN
    -- The row is going, and ON DELETE CASCADE will take its events with it.
    -- Record the deletion against the OBJECTIVE, which survives, or the entry
    -- would vanish in the same breath as the thing it describes.
    --
    -- Unless the objective is the thing being deleted. Then this row is going
    -- by ON DELETE CASCADE, the objective is already gone, and an event
    -- pointing at it fails okr_events_objective_id_fkey and rolls back the
    -- whole delete. Its history cascades away with it anyway, so there is
    -- nothing to record.
    IF EXISTS (SELECT 1 FROM public.okr_objectives WHERE id = OLD.objective_id) THEN
      INSERT INTO public.okr_events (objective_id, action, field, old_value, actor_id)
        VALUES (OLD.objective_id, 'deleted', 'key_result', OLD.description, actor);
    END IF;
    RETURN NULL;
  END IF;

  -- IS DISTINCT FROM throughout, so NULL -> value counts as a change.
  IF NEW.description IS DISTINCT FROM OLD.description THEN
    INSERT INTO public.okr_events (key_result_id, action, field, old_value, new_value, actor_id)
      VALUES (NEW.id, 'updated', 'description', OLD.description, NEW.description, actor);
  END IF;

  IF NEW.label IS DISTINCT FROM OLD.label THEN
    INSERT INTO public.okr_events (key_result_id, action, field, old_value, new_value, actor_id)
      VALUES (NEW.id, 'updated', 'label', OLD.label, NEW.label, actor);
  END IF;

  IF NEW.notes IS DISTINCT FROM OLD.notes THEN
    INSERT INTO public.okr_events (key_result_id, action, field, old_value, new_value, actor_id)
      VALUES (NEW.id, 'updated', 'notes', OLD.notes, NEW.notes, actor);
  END IF;

  IF NEW.timeline IS DISTINCT FROM OLD.timeline THEN
    INSERT INTO public.okr_events (key_result_id, action, field, old_value, new_value, actor_id)
      VALUES (NEW.id, 'updated', 'timeline', OLD.timeline, NEW.timeline, actor);
  END IF;

  -- The three metric columns collapse into ONE event: changing a target and
  -- its unit together is one decision, and reads as one line.
  IF NEW.metric_start  IS DISTINCT FROM OLD.metric_start
  OR NEW.metric_target IS DISTINCT FROM OLD.metric_target
  OR NEW.metric_unit   IS DISTINCT FROM OLD.metric_unit THEN
    INSERT INTO public.okr_events (key_result_id, action, field, old_value, new_value, actor_id)
      VALUES (
        NEW.id, 'updated', 'metric',
        public.format_okr_metric(OLD.metric_start, OLD.metric_target, OLD.metric_unit),
        public.format_okr_metric(NEW.metric_start, NEW.metric_target, NEW.metric_unit),
        actor
      );
  END IF;

  RETURN NULL;
END;
$$;

-- ============================================================
-- Validation (run after applying)
-- ------------------------------------------------------------
--   -- The DELETE branch now has the guard:
--   SELECT prosrc LIKE '%IF EXISTS (SELECT 1 FROM public.okr_objectives%'
--     FROM pg_proc WHERE proname = 'log_okr_key_result_change';   -- true
--
--   -- Deleting an objective with key results now succeeds, inside a
--   -- transaction so nothing is kept:
--   BEGIN;
--   SELECT o.id, count(k.id) FROM public.okr_objectives o
--     JOIN public.okr_key_results k ON k.objective_id = o.id
--    GROUP BY o.id LIMIT 1;
--   DELETE FROM public.okr_objectives WHERE id = '<objective>';   -- DELETE 1
--   SELECT count(*) FROM public.okr_key_results WHERE objective_id = '<objective>';  -- 0
--   SELECT count(*) FROM public.okr_events      WHERE objective_id = '<objective>';  -- 0
--   ROLLBACK;
--
--   -- Deleting one key result still logs against its objective:
--   BEGIN;
--   DELETE FROM public.okr_key_results WHERE id = '<kr>';
--   SELECT action, field, old_value FROM public.okr_events
--    WHERE objective_id = '<its objective>' ORDER BY created_at DESC LIMIT 1;
--     -- expect: deleted / key_result / the old description
--   ROLLBACK;
-- ============================================================
