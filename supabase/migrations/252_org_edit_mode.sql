-- ============================================================
-- FFSA Hub — Migration 252: Org chart edit mode (step J1, frame 43b)
-- ============================================================
-- An org admin (org.manage, or an admin) switches the chart into edit mode
-- and types facts straight onto it. This migration is the write side:
--
--   org_edit_field()   one whitelisted field on a ministry, a membership or an
--                      objective's direction — the "typed here, saves now"
--                      facts of 43b. Anything not on the list is refused.
--   org_set_shepherd() the OKR Shepherd for a ministry in the current cycle
--   org_set_layout()   where a table sits on the canvas (not logged: moving a
--                      box is not a change to the organisation)
--   org_undo()         put back any logged field edit, or a shepherd change
--   org_history()      what changed on one ministry, newest first
--   org_end_due_ministries()  the daily job: a ministry whose end date has
--                      arrived goes inactive and its objectives end with it
--
-- WHY FUNCTIONS, NOT RLS. The rows live in tables whose write policies belong
-- to other modules (staff_ministries: admins; rosters: that ministry's
-- leaders; objectives: leaders and the leadership team). Widening those for
-- org admins would widen them for every other screen too. Instead each
-- function checks has_org_chart_manage() and writes as SECURITY DEFINER, and
-- because it runs inside the caller's request, auth.uid() — and therefore the
-- edit log (250) — records who made the change.
--
-- Depends on 250 (org tables, log_org_edit, has_org_chart_manage) and 182.
-- Idempotent.
-- ============================================================


-- ────────────────────────────────────────────────────────────
-- 1. Undo bookkeeping on the edit log
-- ────────────────────────────────────────────────────────────

ALTER TABLE public.org_edit_log
  ADD COLUMN IF NOT EXISTS undone_at timestamptz,
  ADD COLUMN IF NOT EXISTS undone_by uuid,
  ADD COLUMN IF NOT EXISTS undo_of   uuid;

COMMENT ON COLUMN public.org_edit_log.undo_of IS
  'Set on the log rows an undo itself produced, pointing at the edit it reversed.';

-- An objective's direction is now typed on the chart, so objectives join the
-- structural log. okr_events (197) keeps logging wording; this one carries
-- the before/after an undo needs.
DROP TRIGGER IF EXISTS org_edit_log ON public.okr_objectives;
CREATE TRIGGER org_edit_log AFTER UPDATE OF direction ON public.okr_objectives
  FOR EACH ROW EXECUTE FUNCTION public.log_org_edit();


-- The end date is the team's LAST day ("Woven ends 31 Oct" = still running
-- on the 31st). 250's trigger switched a team off ON its end date; make it
-- the day after, the same rule the daily job below uses.
CREATE OR REPLACE FUNCTION public.staff_ministry_end_sync()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.ends_on IS NOT NULL AND NEW.ends_on < (now() AT TIME ZONE 'Africa/Johannesburg')::date THEN
    NEW.is_active := false;
  END IF;
  RETURN NEW;
END;
$$;


-- ────────────────────────────────────────────────────────────
-- 2. Editing one field
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.org_edit_field(
  p_table text,
  p_id    uuid,
  p_field text,
  p_value jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_text text := CASE WHEN p_value IS NULL OR jsonb_typeof(p_value) = 'null' THEN NULL
                      WHEN jsonb_typeof(p_value) = 'string' THEN NULLIF(trim(p_value #>> '{}'), '')
                      ELSE p_value #>> '{}' END;
BEGIN
  IF NOT COALESCE(public.has_org_chart_manage(), false) THEN
    RAISE EXCEPTION 'Not authorised to edit the org chart';
  END IF;

  IF p_table = 'staff_ministries' THEN
    IF p_field = 'name' THEN
      IF v_text IS NULL THEN RAISE EXCEPTION 'A team needs a name'; END IF;
      UPDATE public.staff_ministries SET name = v_text, updated_at = now() WHERE id = p_id;
    ELSIF p_field = 'cluster' THEN
      UPDATE public.staff_ministries SET cluster = v_text, updated_at = now() WHERE id = p_id;
    ELSIF p_field = 'purpose' THEN
      UPDATE public.staff_ministries SET purpose = v_text, updated_at = now() WHERE id = p_id;
    ELSE
      RAISE EXCEPTION 'The % of a team is not edited on the chart', p_field;
    END IF;

  ELSIF p_table = 'staff_ministry_members' THEN
    IF p_field = 'role_title' THEN
      UPDATE public.staff_ministry_members SET role_title = v_text WHERE id = p_id;
    ELSIF p_field = 'responsibilities' THEN
      UPDATE public.staff_ministry_members
         SET responsibilities = COALESCE(
               (SELECT array_agg(trim(x)) FROM jsonb_array_elements_text(COALESCE(p_value, '[]'::jsonb)) x
                 WHERE trim(x) <> ''), '{}')
       WHERE id = p_id;
    ELSIF p_field = 'share_pct' THEN
      UPDATE public.staff_ministry_members SET share_pct = v_text::smallint WHERE id = p_id;
    ELSIF p_field = 'staff_kind' THEN
      UPDATE public.staff_ministry_members SET staff_kind = COALESCE(v_text, 'staff') WHERE id = p_id;
    ELSE
      RAISE EXCEPTION 'The % of a membership is not edited on the chart', p_field;
    END IF;

  ELSIF p_table = 'okr_objectives' THEN
    IF p_field = 'direction' THEN
      UPDATE public.okr_objectives SET direction = v_text WHERE id = p_id;
    ELSE
      -- Wording, KRs and progress stay on the OKRs page, with their own history.
      RAISE EXCEPTION 'The % of an objective is edited on the OKRs page', p_field;
    END IF;

  ELSE
    RAISE EXCEPTION 'The chart does not edit %', p_table;
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Nothing to change — that row no longer exists';
  END IF;
END;
$$;


-- ────────────────────────────────────────────────────────────
-- 3. Shepherd and layout
-- ────────────────────────────────────────────────────────────

-- p_user NULL clears the shepherd. The person must be on the ministry's
-- roster: a shepherd sends the team's update, so they have to be on it.
CREATE OR REPLACE FUNCTION public.org_set_shepherd(p_ministry uuid, p_user uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cycle uuid;
BEGIN
  IF NOT COALESCE(public.has_org_chart_manage(), false) THEN
    RAISE EXCEPTION 'Not authorised to edit the org chart';
  END IF;
  SELECT id INTO v_cycle FROM public.okr_cycles WHERE is_current;
  IF v_cycle IS NULL THEN RAISE EXCEPTION 'There is no current OKR cycle'; END IF;

  IF p_user IS NULL THEN
    DELETE FROM public.okr_shepherds WHERE cycle_id = v_cycle AND staff_ministry_id = p_ministry;
    RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.staff_ministry_members
                  WHERE staff_ministry_id = p_ministry AND user_id = p_user AND status = 'active') THEN
    RAISE EXCEPTION 'The OKR Shepherd has to be someone on the team';
  END IF;

  INSERT INTO public.okr_shepherds (cycle_id, staff_ministry_id, user_id)
  VALUES (v_cycle, p_ministry, p_user)
  ON CONFLICT (cycle_id, staff_ministry_id) DO UPDATE SET user_id = EXCLUDED.user_id
  WHERE okr_shepherds.user_id IS DISTINCT FROM EXCLUDED.user_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.org_set_layout(p_ministry uuid, p_x numeric, p_y numeric)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT COALESCE(public.has_org_chart_manage(), false) THEN
    RAISE EXCEPTION 'Not authorised to edit the org chart';
  END IF;
  IF p_x IS NULL OR p_y IS NULL THEN
    DELETE FROM public.org_layout WHERE staff_ministry_id = p_ministry;  -- back to automatic
    RETURN;
  END IF;
  INSERT INTO public.org_layout (staff_ministry_id, x, y, updated_by, updated_at)
  VALUES (p_ministry, round(p_x), round(p_y), auth.uid(), now())
  ON CONFLICT (staff_ministry_id) DO UPDATE
    SET x = EXCLUDED.x, y = EXCLUDED.y, updated_by = EXCLUDED.updated_by, updated_at = now();
END;
$$;


-- ────────────────────────────────────────────────────────────
-- 4. Undo
-- ────────────────────────────────────────────────────────────
-- Puts the BEFORE value back through the same whitelist, so an undo can
-- never write something an edit could not. Refuses when the value has moved
-- on since (someone edited it again): undo the newer edit first.

CREATE OR REPLACE FUNCTION public.org_undo(p_log_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  e        public.org_edit_log%ROWTYPE;
  v_now    jsonb;
  v_newest uuid;
BEGIN
  IF NOT COALESCE(public.has_org_chart_manage(), false) THEN
    RAISE EXCEPTION 'Not authorised to edit the org chart';
  END IF;

  SELECT * INTO e FROM public.org_edit_log WHERE id = p_log_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No such edit'; END IF;
  IF e.undone_at IS NOT NULL THEN RAISE EXCEPTION 'That edit has already been undone'; END IF;

  IF e.table_name = 'okr_shepherds' THEN
    IF e.action = 'created' THEN
      DELETE FROM public.okr_shepherds WHERE id = e.row_id;
    ELSIF e.action = 'deleted' THEN
      INSERT INTO public.okr_shepherds (id, cycle_id, staff_ministry_id, user_id)
      VALUES ((e.before->>'id')::uuid, (e.before->>'cycle_id')::uuid,
              (e.before->>'staff_ministry_id')::uuid, (e.before->>'user_id')::uuid)
      ON CONFLICT (cycle_id, staff_ministry_id) DO UPDATE SET user_id = EXCLUDED.user_id;
    ELSIF e.action = 'updated' AND e.field = 'user_id' THEN
      UPDATE public.okr_shepherds SET user_id = (e.before #>> '{}')::uuid WHERE id = e.row_id;
    ELSE
      RAISE EXCEPTION 'That change cannot be undone here';
    END IF;

  ELSIF e.action = 'updated' THEN
    -- The newest logged edit of this field must be this one.
    SELECT id INTO v_newest FROM public.org_edit_log
     WHERE table_name = e.table_name AND row_id = e.row_id AND field = e.field
       AND action = 'updated' AND undone_at IS NULL
     ORDER BY created_at DESC LIMIT 1;
    IF v_newest IS DISTINCT FROM e.id THEN
      RAISE EXCEPTION 'This was changed again afterwards. Undo the newer change first.';
    END IF;
    EXECUTE format('SELECT to_jsonb(t) -> %L FROM public.%I t WHERE id = $1', e.field, e.table_name)
       INTO v_now USING e.row_id;
    IF v_now IS DISTINCT FROM e.after THEN
      RAISE EXCEPTION 'This was changed again afterwards. Undo the newer change first.';
    END IF;
    PERFORM public.org_edit_field(e.table_name, e.row_id, e.field, COALESCE(e.before, 'null'::jsonb));

  ELSE
    -- Created or removed teams and memberships are roster actions (Ministry
    -- tab) or change sets (step J3), not single-field undos.
    RAISE EXCEPTION 'That change cannot be undone here';
  END IF;

  UPDATE public.org_edit_log SET undone_at = now(), undone_by = auth.uid() WHERE id = e.id;
  -- Tag what the undo itself just wrote, so History can say "undid".
  UPDATE public.org_edit_log SET undo_of = e.id
   WHERE undo_of IS NULL AND table_name = e.table_name AND row_id = e.row_id
     AND created_at = now() AND id <> e.id;
END;
$$;


-- ────────────────────────────────────────────────────────────
-- 5. History for one ministry
-- ────────────────────────────────────────────────────────────
-- An updated row only carries the one field, so which ministry it belongs to
-- comes from the live row (or, for a removed membership, its history row).

CREATE OR REPLACE FUNCTION public.org_history(p_ministry uuid, p_limit integer DEFAULT 100)
RETURNS TABLE (
  id uuid, table_name text, row_id uuid, action text, field text,
  before jsonb, after jsonb, actor_id uuid, created_at timestamptz,
  undone_at timestamptz, undo_of uuid, subject_user_id uuid
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT l.id, l.table_name, l.row_id, l.action, l.field, l.before, l.after,
         l.actor_id, l.created_at, l.undone_at, l.undo_of,
         COALESCE(m.user_id, h.user_id,
                  (COALESCE(l.after, l.before) ->> 'user_id')::uuid) AS subject_user_id
    FROM public.org_edit_log l
    LEFT JOIN public.staff_ministry_members m
           ON l.table_name = 'staff_ministry_members' AND m.id = l.row_id
    LEFT JOIN LATERAL (
           SELECT hh.user_id, hh.staff_ministry_id FROM public.staff_ministry_membership_history hh
            WHERE l.table_name = 'staff_ministry_members' AND hh.membership_id = l.row_id
            LIMIT 1) h ON true
    LEFT JOIN public.okr_shepherds s ON l.table_name = 'okr_shepherds' AND s.id = l.row_id
    LEFT JOIN public.okr_objectives o ON l.table_name = 'okr_objectives' AND o.id = l.row_id
   WHERE COALESCE(public.has_org_chart_manage(), false)
     AND (
          (l.table_name = 'staff_ministries' AND l.row_id = p_ministry)
       OR (l.table_name = 'staff_ministry_members'
           AND COALESCE(m.staff_ministry_id, h.staff_ministry_id,
                        (COALESCE(l.after, l.before) ->> 'staff_ministry_id')::uuid) = p_ministry)
       OR (l.table_name = 'okr_shepherds'
           AND COALESCE(s.staff_ministry_id, (COALESCE(l.after, l.before) ->> 'staff_ministry_id')::uuid) = p_ministry)
       OR (l.table_name = 'okr_objectives' AND o.staff_ministry_id = p_ministry)
       OR (l.table_name = 'reporting_lines'
           AND (COALESCE(l.after, l.before) ->> 'staff_ministry_id')::uuid = p_ministry)
     )
   ORDER BY l.created_at DESC
   LIMIT LEAST(GREATEST(p_limit, 1), 500);
$$;


-- ────────────────────────────────────────────────────────────
-- 6. The daily job: end what is due
-- ────────────────────────────────────────────────────────────
-- 250's trigger only catches an end date that is already past when it is
-- typed. A FUTURE end date (Woven, 31 Oct) needs this, run once a day by
-- /api/cron/org-daily just after midnight in South Africa. Its objectives
-- are marked ended, not failed or deleted.

CREATE OR REPLACE FUNCTION public.org_end_due_ministries()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Africa/Johannesburg')::date;
  n integer;
BEGIN
  WITH ended AS (
    UPDATE public.staff_ministries
       SET is_active = false, updated_at = now()
     WHERE is_active AND ends_on IS NOT NULL AND ends_on < v_today
    RETURNING id, ends_on
  ), objs AS (
    UPDATE public.okr_objectives o
       SET ended_on = e.ends_on
      FROM ended e
     WHERE o.staff_ministry_id = e.id AND o.ended_on IS NULL
    RETURNING o.id
  )
  SELECT count(*) INTO n FROM ended;
  RETURN n;
END;
$$;


REVOKE ALL ON FUNCTION public.org_end_due_ministries() FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public.org_edit_field(text, uuid, text, jsonb)  TO authenticated;
GRANT EXECUTE ON FUNCTION public.org_set_shepherd(uuid, uuid)             TO authenticated;
GRANT EXECUTE ON FUNCTION public.org_set_layout(uuid, numeric, numeric)   TO authenticated;
GRANT EXECUTE ON FUNCTION public.org_undo(uuid)                           TO authenticated;
GRANT EXECUTE ON FUNCTION public.org_history(uuid, integer)               TO authenticated;

-- ============================================================
-- Validation (run after applying)
-- ------------------------------------------------------------
--   -- As an org admin in the app, edit a team's purpose, then:
--   SELECT field, before, after, actor_id FROM public.org_edit_log
--    ORDER BY created_at DESC LIMIT 3;        -- actor_id is you, not NULL
--
--   -- Woven is due to end; on 1 Nov the job should return 1:
--   SELECT name, ends_on, is_active FROM public.staff_ministries WHERE slug = 'woven';
--   SELECT public.org_end_due_ministries();   -- 0 before 1 Nov (SAST)
-- ============================================================
