-- ============================================================
-- FFSA Hub — Migration 402: Operations → Visiting teams (bit 1)
-- ============================================================
-- docs/operations-outreach-teams.md. Teams that come to FFSA to be
-- hosted (not our own outreach teams, which live in Finance → Outreach).
--
--   visiting_teams          one row per team: dates, size, leader, stage, host
--   visiting_team_private   team members, dietary needs, medical — lead + host only
--   visiting_team_steps     Mache's checklist, one row per step per team
--   visiting_team_changes   every change to the above, with who and when
--
-- Who: the Visiting teams LEAD (a permission, given on the Hub — Mache and
-- Michelle today; it moves when the role moves) sees and changes every
-- team. A team's HOST sees and works their own team. Admins pass.
-- Needs 400 (is_ops_team) first. Run 400, 401, then this.
--
-- ROLLBACK:
--   DROP TABLE IF EXISTS public.visiting_team_changes, public.visiting_team_steps,
--     public.visiting_team_private, public.visiting_teams;
--   DROP FUNCTION IF EXISTS public.is_visiting_teams_lead(),
--     public.can_see_visiting_team(uuid), public.visiting_teams_touch(),
--     public.visiting_teams_log(), public.visiting_team_steps_log(),
--     public.visiting_team_private_log();
--   DELETE FROM public.permissions WHERE key = 'operations.visiting_teams.lead';
-- ============================================================

-- ── 1. The lead role ────────────────────────────────────────
INSERT INTO public.permissions (module, key, display_name, sort_order) VALUES
  ('operations', 'operations.visiting_teams.lead',
   'Visiting teams lead: every team, the guide, approving messages, handing teams between hosts', 20)
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.is_visiting_teams_lead()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT public.is_admin() OR public.has_permission('operations.visiting_teams.lead');
$$;
REVOKE ALL ON FUNCTION public.is_visiting_teams_lead() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_visiting_teams_lead() TO authenticated;

-- ── 2. Teams ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.visiting_teams (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,                 -- the team as Mache names it
  sending_org     text,                          -- base, school or church
  stage           text NOT NULL DEFAULT 'enquiry'
                  CHECK (stage IN ('enquiry','confirmed','preparing','here','left',
                                   'said_no','postponed','cancelled')),
  -- Dates are rough at first ("April 2027"); the exact days come later.
  dates_text      text,
  arrival_on      date,
  arrival_time    text,                          -- "15:30, OR Tambo"
  departure_on    date,
  departure_time  text,
  size_text       text,                          -- "10–12"
  size_count      integer CHECK (size_count IS NULL OR size_count BETWEEN 1 AND 500),
  contact_name    text,                          -- the outreach leader(s)
  contact_role    text,
  contact_email   text,
  contact_phone   text,
  locations       text,                          -- "Potch, Dithakong & Durban"
  heart_vision    text,
  vehicles        text,                          -- base vehicles asked for
  rooms           text,                          -- room allocation on the Potch base
  notes           text,
  host_user_id    uuid REFERENCES public.users (id) ON DELETE SET NULL,
  created_by      uuid REFERENCES public.users (id) ON DELETE SET NULL DEFAULT auth.uid(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  ended_at        timestamptz,                   -- set when it leaves / ends; the keeping period runs from here
  CHECK (departure_on IS NULL OR arrival_on IS NULL OR departure_on >= arrival_on)
);

CREATE INDEX IF NOT EXISTS visiting_teams_arrival_idx ON public.visiting_teams (arrival_on);
CREATE INDEX IF NOT EXISTS visiting_teams_host_idx ON public.visiting_teams (host_user_id);

-- Lead or this team's host.
CREATE OR REPLACE FUNCTION public.can_see_visiting_team(team uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT public.is_visiting_teams_lead()
      OR EXISTS (SELECT 1 FROM public.visiting_teams t
                  WHERE t.id = team AND t.host_user_id = auth.uid());
$$;
REVOKE ALL ON FUNCTION public.can_see_visiting_team(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_see_visiting_team(uuid) TO authenticated;

-- ── 3. Private details (members, dietary, medical) ──────────
CREATE TABLE IF NOT EXISTS public.visiting_team_private (
  team_id     uuid PRIMARY KEY REFERENCES public.visiting_teams (id) ON DELETE CASCADE,
  members     text,       -- names, emails, couples and children
  dietary     text,       -- dietary needs and allergies
  medical     text,       -- medical conditions
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- ── 4. The checklist ────────────────────────────────────────
-- Steps come from the template in src/lib/operations/visiting-teams.ts.
-- due_on is worked out from arrival/departure and moves with them.
CREATE TABLE IF NOT EXISTS public.visiting_team_steps (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id     uuid NOT NULL REFERENCES public.visiting_teams (id) ON DELETE CASCADE,
  step_key    text NOT NULL,
  stage       text NOT NULL CHECK (stage IN ('enquiry','confirmed','preparing','here','left')),
  label       text NOT NULL,
  sort        integer NOT NULL DEFAULT 0,
  due_on      date,
  done_at     timestamptz,
  done_by     uuid REFERENCES public.users (id) ON DELETE SET NULL,
  note        text,
  UNIQUE (team_id, step_key)
);

CREATE INDEX IF NOT EXISTS visiting_team_steps_due_idx ON public.visiting_team_steps (due_on) WHERE done_at IS NULL;

-- ── 5. History ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.visiting_team_changes (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  team_id     uuid NOT NULL REFERENCES public.visiting_teams (id) ON DELETE CASCADE,
  field       text NOT NULL,             -- column name, 'step:<key>', or 'private:<column>'
  old_value   text,
  new_value   text,
  changed_by  uuid REFERENCES public.users (id) ON DELETE SET NULL,
  changed_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS visiting_team_changes_team_idx ON public.visiting_team_changes (team_id, changed_at DESC);

-- ── 6. Triggers ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.visiting_teams_touch()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  IF NEW.stage IN ('left','said_no','postponed','cancelled') THEN
    NEW.ended_at := COALESCE(NEW.ended_at, now());
  ELSE
    NEW.ended_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS visiting_teams_touch ON public.visiting_teams;
CREATE TRIGGER visiting_teams_touch BEFORE INSERT OR UPDATE ON public.visiting_teams
  FOR EACH ROW EXECUTE FUNCTION public.visiting_teams_touch();

-- One history row per changed column.
CREATE OR REPLACE FUNCTION public.visiting_teams_log()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  k text;
  o jsonb := to_jsonb(OLD);
  n jsonb := to_jsonb(NEW);
BEGIN
  FOR k IN SELECT jsonb_object_keys(n) LOOP
    CONTINUE WHEN k IN ('id', 'created_at', 'created_by', 'updated_at', 'ended_at');
    IF o -> k IS DISTINCT FROM n -> k THEN
      INSERT INTO public.visiting_team_changes (team_id, field, old_value, new_value, changed_by)
      VALUES (NEW.id, k, o ->> k, n ->> k, auth.uid());
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS visiting_teams_log ON public.visiting_teams;
CREATE TRIGGER visiting_teams_log AFTER UPDATE ON public.visiting_teams
  FOR EACH ROW EXECUTE FUNCTION public.visiting_teams_log();

CREATE OR REPLACE FUNCTION public.visiting_team_steps_log()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (OLD.done_at IS NULL) IS DISTINCT FROM (NEW.done_at IS NULL) THEN
    INSERT INTO public.visiting_team_changes (team_id, field, old_value, new_value, changed_by)
    VALUES (NEW.team_id, 'step:' || NEW.step_key,
            CASE WHEN OLD.done_at IS NULL THEN 'open' ELSE 'done' END,
            CASE WHEN NEW.done_at IS NULL THEN 'open' ELSE 'done' END, auth.uid());
  END IF;
  IF OLD.note IS DISTINCT FROM NEW.note THEN
    INSERT INTO public.visiting_team_changes (team_id, field, old_value, new_value, changed_by)
    VALUES (NEW.team_id, 'step:' || NEW.step_key || ':note', OLD.note, NEW.note, auth.uid());
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS visiting_team_steps_log ON public.visiting_team_steps;
CREATE TRIGGER visiting_team_steps_log AFTER UPDATE ON public.visiting_team_steps
  FOR EACH ROW EXECUTE FUNCTION public.visiting_team_steps_log();

CREATE OR REPLACE FUNCTION public.visiting_team_private_log()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  k text;
  o jsonb := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE '{}'::jsonb END;
  n jsonb := to_jsonb(NEW);
BEGIN
  NEW.updated_at := now();
  FOREACH k IN ARRAY ARRAY['members', 'dietary', 'medical'] LOOP
    IF o -> k IS DISTINCT FROM n -> k AND NOT (TG_OP = 'INSERT' AND n ->> k IS NULL) THEN
      INSERT INTO public.visiting_team_changes (team_id, field, old_value, new_value, changed_by)
      VALUES (NEW.team_id, 'private:' || k, o ->> k, n ->> k, auth.uid());
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS visiting_team_private_log ON public.visiting_team_private;
CREATE TRIGGER visiting_team_private_log BEFORE INSERT OR UPDATE ON public.visiting_team_private
  FOR EACH ROW EXECUTE FUNCTION public.visiting_team_private_log();

-- ── 7. RLS ──────────────────────────────────────────────────
ALTER TABLE public.visiting_teams         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.visiting_team_private  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.visiting_team_steps    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.visiting_team_changes  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.visiting_teams, public.visiting_team_private,
  public.visiting_team_steps, public.visiting_team_changes FROM anon;

-- Teams: lead sees all; a host sees theirs. Only the lead adds, removes
-- or hands a team to another host (guarded below).
DROP POLICY IF EXISTS visiting_teams_select ON public.visiting_teams;
CREATE POLICY visiting_teams_select ON public.visiting_teams
  FOR SELECT TO authenticated
  USING (public.is_visiting_teams_lead() OR host_user_id = auth.uid());

DROP POLICY IF EXISTS visiting_teams_insert ON public.visiting_teams;
CREATE POLICY visiting_teams_insert ON public.visiting_teams
  FOR INSERT TO authenticated WITH CHECK (public.is_visiting_teams_lead());

DROP POLICY IF EXISTS visiting_teams_update ON public.visiting_teams;
CREATE POLICY visiting_teams_update ON public.visiting_teams
  FOR UPDATE TO authenticated
  USING (public.is_visiting_teams_lead() OR host_user_id = auth.uid())
  WITH CHECK (public.is_visiting_teams_lead() OR host_user_id = auth.uid());

DROP POLICY IF EXISTS visiting_teams_delete ON public.visiting_teams;
CREATE POLICY visiting_teams_delete ON public.visiting_teams
  FOR DELETE TO authenticated USING (public.is_visiting_teams_lead());

CREATE OR REPLACE FUNCTION public.visiting_teams_host_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_visiting_teams_lead()
     AND NEW.host_user_id IS DISTINCT FROM OLD.host_user_id THEN
    RAISE EXCEPTION 'Only the Visiting teams lead can hand a team to another host';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS visiting_teams_host_guard ON public.visiting_teams;
CREATE TRIGGER visiting_teams_host_guard BEFORE UPDATE ON public.visiting_teams
  FOR EACH ROW EXECUTE FUNCTION public.visiting_teams_host_guard();

-- Private details, steps: whoever can see the team.
DROP POLICY IF EXISTS visiting_team_private_all ON public.visiting_team_private;
CREATE POLICY visiting_team_private_all ON public.visiting_team_private
  FOR ALL TO authenticated
  USING (public.can_see_visiting_team(team_id))
  WITH CHECK (public.can_see_visiting_team(team_id));

DROP POLICY IF EXISTS visiting_team_steps_select ON public.visiting_team_steps;
CREATE POLICY visiting_team_steps_select ON public.visiting_team_steps
  FOR SELECT TO authenticated USING (public.can_see_visiting_team(team_id));

DROP POLICY IF EXISTS visiting_team_steps_insert ON public.visiting_team_steps;
CREATE POLICY visiting_team_steps_insert ON public.visiting_team_steps
  FOR INSERT TO authenticated WITH CHECK (public.can_see_visiting_team(team_id));

DROP POLICY IF EXISTS visiting_team_steps_update ON public.visiting_team_steps;
CREATE POLICY visiting_team_steps_update ON public.visiting_team_steps
  FOR UPDATE TO authenticated
  USING (public.can_see_visiting_team(team_id))
  WITH CHECK (public.can_see_visiting_team(team_id));

DROP POLICY IF EXISTS visiting_team_steps_delete ON public.visiting_team_steps;
CREATE POLICY visiting_team_steps_delete ON public.visiting_team_steps
  FOR DELETE TO authenticated USING (public.is_visiting_teams_lead());

-- History: read-only for whoever can see the team; written by triggers.
DROP POLICY IF EXISTS visiting_team_changes_select ON public.visiting_team_changes;
CREATE POLICY visiting_team_changes_select ON public.visiting_team_changes
  FOR SELECT TO authenticated USING (public.can_see_visiting_team(team_id));
REVOKE INSERT, UPDATE, DELETE ON public.visiting_team_changes FROM authenticated;
