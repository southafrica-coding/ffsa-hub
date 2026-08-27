-- ============================================================
-- FFSA Hub — Migration 197: OKR edit history
-- ============================================================
-- Progress updates already leave a trail: every check-in stores who moved a
-- key result, when, and why. Edits leave none. Rename an objective, move a
-- target from 150 to 180, rewrite a key result — none of it is recorded, so
-- "what changed since I last looked?" has no answer.
--
-- This adds okr_events: one row per meaningful change, written by a trigger
-- and readable by exactly the people who can already see the OKR itself. The
-- key-result drawer merges these with okr_checkins into a single timeline.
--
-- WHY NOT audit_logs. It exists, but its SELECT policy is USING (is_admin()),
-- so a ministry leader could never read a row — and they are precisely the
-- audience here. Loosening a security-audit table's read policy to serve an
-- OKR feature is the wrong trade. It also has no OKR writers and no viewer UI.
--
-- WHY A TRIGGER, not a call in each API route. Three write paths have to
-- agree: the route handlers, manual corrections in this SQL editor, and
-- whatever gets added later. A trigger sees OLD and NEW for free and cannot
-- be forgotten. auth.uid() resolves inside it because every OKR write goes
-- through the user's own client, never the service role.
--
-- WHAT IS DELIBERATELY NOT LOGGED. current_status, current_value,
-- last_checkin_at and last_checkin_id are maintained by
-- refresh_okr_key_result_state() on every check-in (migration 182). Logging
-- them would duplicate every check-in as a phantom "edit" sitting next to
-- itself in the same timeline. updated_at moves for the same reason, and
-- position changes are reordering, not history.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 0. OBJECTIVE NOTES
-- ────────────────────────────────────────────────────────────
-- Key results already have `notes` for standing context. Objectives had
-- nowhere equivalent: `description` is "why this matters" and `owner_note` is
-- who is carrying it, both of which are already surfaced and labelled as such.
-- Rather than overload one of them, objectives get their own column.

ALTER TABLE public.okr_objectives
  ADD COLUMN IF NOT EXISTS notes text;

COMMENT ON COLUMN public.okr_objectives.notes IS
  'Standing context for the objective as a whole. Progress updates belong on a '
  'key result''s check-ins; this is the background a reader needs first.';

-- ────────────────────────────────────────────────────────────
-- 1. TABLE
-- ────────────────────────────────────────────────────────────
-- old_value / new_value are text rather than jsonb: every logged field is
-- text or a number, and the timeline renders them as prose ("changed the
-- target from 150 to 180"). jsonb would buy nothing and read worse here.

CREATE TABLE IF NOT EXISTS public.okr_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key_result_id uuid REFERENCES public.okr_key_results (id) ON DELETE CASCADE,
  objective_id  uuid REFERENCES public.okr_objectives (id) ON DELETE CASCADE,
  action        text NOT NULL,
  field         text,
  old_value     text,
  new_value     text,
  actor_id      uuid REFERENCES public.users (id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT okr_events_action_ck CHECK (action IN ('created', 'updated', 'deleted')),

  -- An event is about exactly one thing, so the timeline never has to guess
  -- which subject it belongs to.
  CONSTRAINT okr_events_subject_ck CHECK (
    (key_result_id IS NOT NULL AND objective_id IS NULL) OR
    (key_result_id IS NULL     AND objective_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_okr_events_key_result
  ON public.okr_events (key_result_id, created_at DESC) WHERE key_result_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_okr_events_objective
  ON public.okr_events (objective_id, created_at DESC) WHERE objective_id IS NOT NULL;

-- ────────────────────────────────────────────────────────────
-- 2. THE TRIGGER
-- ────────────────────────────────────────────────────────────
-- SECURITY DEFINER because okr_events has no INSERT policy for anyone — the
-- log is trigger-only, so nobody can forge or backdate an entry.

-- Renders a metric as the timeline says it: "150 → 180 people", or NULL when
-- there is no metric at all (the "no ratio, no bar" rule, in words).
CREATE OR REPLACE FUNCTION public.format_okr_metric(
  p_start numeric, p_target numeric, p_unit text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_start IS NULL AND p_target IS NULL THEN NULL
    ELSE trim(
      COALESCE(p_start::text, '?') || ' → ' || COALESCE(p_target::text, '?')
      || COALESCE(' ' || p_unit, '')
    )
  END;
$$;

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
    INSERT INTO public.okr_events (objective_id, action, field, old_value, actor_id)
      VALUES (OLD.objective_id, 'deleted', 'key_result', OLD.description, actor);
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

CREATE OR REPLACE FUNCTION public.log_okr_objective_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor uuid := auth.uid();
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.okr_events (objective_id, action, new_value, actor_id)
      VALUES (NEW.id, 'created', NEW.title, actor);
    RETURN NULL;
  END IF;

  IF TG_OP = 'DELETE' THEN
    -- Nothing survives to hang this on — the objective's own events cascade
    -- away with it — so there is deliberately no row written here.
    RETURN NULL;
  END IF;

  IF NEW.title IS DISTINCT FROM OLD.title THEN
    INSERT INTO public.okr_events (objective_id, action, field, old_value, new_value, actor_id)
      VALUES (NEW.id, 'updated', 'title', OLD.title, NEW.title, actor);
  END IF;

  IF NEW.description IS DISTINCT FROM OLD.description THEN
    INSERT INTO public.okr_events (objective_id, action, field, old_value, new_value, actor_id)
      VALUES (NEW.id, 'updated', 'description', OLD.description, NEW.description, actor);
  END IF;

  IF NEW.notes IS DISTINCT FROM OLD.notes THEN
    INSERT INTO public.okr_events (objective_id, action, field, old_value, new_value, actor_id)
      VALUES (NEW.id, 'updated', 'notes', OLD.notes, NEW.notes, actor);
  END IF;

  IF NEW.owner_note IS DISTINCT FROM OLD.owner_note THEN
    INSERT INTO public.okr_events (objective_id, action, field, old_value, new_value, actor_id)
      VALUES (NEW.id, 'updated', 'owner', OLD.owner_note, NEW.owner_note, actor);
  END IF;

  IF NEW.timeline IS DISTINCT FROM OLD.timeline THEN
    INSERT INTO public.okr_events (objective_id, action, field, old_value, new_value, actor_id)
      VALUES (NEW.id, 'updated', 'timeline', OLD.timeline, NEW.timeline, actor);
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS okr_key_results_log ON public.okr_key_results;
CREATE TRIGGER okr_key_results_log
  AFTER INSERT OR UPDATE OR DELETE ON public.okr_key_results
  FOR EACH ROW EXECUTE FUNCTION public.log_okr_key_result_change();

DROP TRIGGER IF EXISTS okr_objectives_log ON public.okr_objectives;
CREATE TRIGGER okr_objectives_log
  AFTER INSERT OR UPDATE OR DELETE ON public.okr_objectives
  FOR EACH ROW EXECUTE FUNCTION public.log_okr_objective_change();

-- ────────────────────────────────────────────────────────────
-- 3. RLS
-- ────────────────────────────────────────────────────────────
-- Reuses the visibility helpers from migration 182, so the history can never
-- drift from who may see the OKR it describes.

ALTER TABLE public.okr_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "OKR events are readable by audience" ON public.okr_events;
CREATE POLICY "OKR events are readable by audience"
  ON public.okr_events FOR SELECT TO authenticated
  USING (
    (key_result_id IS NOT NULL AND public.can_view_okr_key_result(key_result_id))
    OR (objective_id IS NOT NULL AND public.can_view_okr_objective(objective_id))
  );

-- No INSERT, UPDATE or DELETE policy, for anyone, admins included. Rows arrive
-- only through the SECURITY DEFINER triggers above. A history somebody can
-- quietly rewrite is not a history.

GRANT EXECUTE ON FUNCTION public.format_okr_metric(numeric, numeric, text) TO authenticated;

-- ============================================================
-- Validation (run after applying)
-- ------------------------------------------------------------
--   -- Pick a key result you own:
--   SELECT id, description FROM public.okr_key_results LIMIT 1;
--
--   -- An edit writes exactly ONE row, with both sides of the change:
--   UPDATE public.okr_key_results SET description = 'changed' WHERE id = '<kr>';
--   SELECT action, field, old_value, new_value, actor_id
--     FROM public.okr_events WHERE key_result_id = '<kr>' ORDER BY created_at DESC;
--
--   -- THE IMPORTANT ONE. A check-in must write ZERO events — its status and
--   -- value already appear in the timeline as a check-in, and the columns the
--   -- trigger rewrites must not be logged as edits:
--   SELECT count(*) FROM public.okr_events WHERE key_result_id = '<kr>';
--   INSERT INTO public.okr_checkins (key_result_id, status, author_id)
--     VALUES ('<kr>', 'moving_forward', auth.uid());
--   SELECT count(*) FROM public.okr_events WHERE key_result_id = '<kr>';
--     -- expect: unchanged
--
--   -- Two metric columns in one UPDATE is one event, not two:
--   UPDATE public.okr_key_results
--      SET metric_start = 0, metric_target = 180, metric_unit = 'people'
--    WHERE id = '<kr>';
--   SELECT field, old_value, new_value FROM public.okr_events
--    WHERE key_result_id = '<kr>' ORDER BY created_at DESC LIMIT 1;
--     -- expect: one 'metric' row, new_value '0 → 180 people'
--
--   -- A deleted key result records itself against its objective, which
--   -- survives, and its own events cascade away:
--   DELETE FROM public.okr_key_results WHERE id = '<kr>';
--   SELECT count(*) FROM public.okr_events WHERE key_result_id = '<kr>';   -- 0
--   SELECT action, field, old_value FROM public.okr_events
--    WHERE objective_id = '<objective>' ORDER BY created_at DESC LIMIT 1;
--     -- expect: deleted / key_result / the old description
--
--   -- The log is trigger-only, even for an admin:
--   INSERT INTO public.okr_events (key_result_id, action) VALUES ('<kr>', 'created');
--     -- expect: new row violates row-level security policy
-- ============================================================
