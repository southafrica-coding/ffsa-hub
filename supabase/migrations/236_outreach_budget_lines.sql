-- ────────────────────────────────────────────────────────────
-- 236 — Outreach budget LINES
--
-- Until now an outreach budget was one number per category
-- (outreach_team_budgets). The finance team plans in lines:
--
--     Destination A – Food   R190 × 15 × 8 people = R22 800
--
-- so a budget is now a list of lines, each with amount × frequency ×
-- people. People either follows the team size (change the team from 8
-- to 9 and every such line moves) or is a fixed number (2 leaders).
--
-- outreach_team_budgets stays — expenses, the dashboard, reports and the
-- closeout all read it — but it is now DERIVED: a trigger keeps one row
-- per category equal to the sum of that category's lines, and keeps
-- outreach_teams.total_budget_zar equal to the sum of all lines.
-- Nothing should write outreach_team_budgets directly any more.
--
-- Existing per-category budgets are carried over as one line each, so
-- every current team keeps exactly the totals it has today.
-- ────────────────────────────────────────────────────────────

-- ── Who may edit a team's budget ────────────────────────────
-- Finance staff, plus the team's own leaders / finance students, so a
-- team can run its budget without someone from finance directing it.
CREATE OR REPLACE FUNCTION public.can_edit_outreach_budget(check_team_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_admin()
    OR public.has_role('finance_admin')
    OR public.has_permission('finance.edit')
    OR EXISTS (
      SELECT 1 FROM public.outreach_team_members
      WHERE team_id = check_team_id
        AND user_id = auth.uid()
        AND role IN ('finance_admin', 'school_leader', 'outreach_leader', 'finance_student')
    );
$$;

-- Anyone who can edit some team's budget may add a category.
CREATE OR REPLACE FUNCTION public.can_add_outreach_category()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_admin()
    OR public.has_role('finance_admin')
    OR public.has_permission('finance.edit')
    OR EXISTS (
      SELECT 1 FROM public.outreach_team_members
      WHERE user_id = auth.uid()
        AND role IN ('finance_admin', 'school_leader', 'outreach_leader', 'finance_student')
    );
$$;

-- ── Custom categories ───────────────────────────────────────
ALTER TABLE public.outreach_budget_categories
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

DROP POLICY IF EXISTS "Admins can manage budget categories" ON public.outreach_budget_categories;
DROP POLICY IF EXISTS "Budget editors can add categories" ON public.outreach_budget_categories;
CREATE POLICY "Budget editors can add categories"
  ON public.outreach_budget_categories FOR INSERT
  WITH CHECK (public.can_add_outreach_category());

-- ── Import batches ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.outreach_budget_imports (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id      uuid NOT NULL REFERENCES public.outreach_teams(id) ON DELETE CASCADE,
  filename     text,
  line_count   integer NOT NULL DEFAULT 0,
  replaced_count integer NOT NULL DEFAULT 0, -- imported lines this batch replaced
  imported_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_obi_team ON public.outreach_budget_imports(team_id);

-- ── Lines ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.outreach_budget_lines (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id         uuid NOT NULL REFERENCES public.outreach_teams(id) ON DELETE CASCADE,
  category_id     uuid NOT NULL REFERENCES public.outreach_budget_categories(id),
  description     text NOT NULL,
  amount_zar      numeric(12,2) NOT NULL DEFAULT 0 CHECK (amount_zar >= 0),
  -- A bare number: no days / nights / meals unit. The description
  -- carries the context.
  frequency       numeric(10,2) NOT NULL DEFAULT 1 CHECK (frequency >= 0),
  uses_team_size  boolean NOT NULL DEFAULT true,
  fixed_people    integer NOT NULL DEFAULT 1 CHECK (fixed_people >= 0),
  -- amount × frequency × people. Always computed by the trigger below,
  -- never accepted from a client.
  total_zar       numeric(14,2) NOT NULL DEFAULT 0,
  -- What the imported sheet claimed the total was, kept so a mismatch
  -- with our own arithmetic stays visible.
  sheet_total_zar numeric(14,2),
  sort_order      integer NOT NULL DEFAULT 0,
  source          text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'import')),
  import_batch_id uuid REFERENCES public.outreach_budget_imports(id) ON DELETE SET NULL,
  created_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_obl_team ON public.outreach_budget_lines(team_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_obl_category ON public.outreach_budget_lines(category_id);

-- ── Carry existing category budgets over as one line each ───
-- Runs before the triggers exist, so it does not rewrite any team's
-- total_budget_zar: past teams keep the figure they were given.
INSERT INTO public.outreach_budget_lines
  (team_id, category_id, description, amount_zar, frequency,
   uses_team_size, fixed_people, total_zar, sort_order, source)
SELECT b.team_id, b.category_id, c.name, b.budget_amount_zar, 1,
       false, 1, b.budget_amount_zar, c.sort_order, 'manual'
FROM public.outreach_team_budgets b
JOIN public.outreach_budget_categories c ON c.id = b.category_id
WHERE NOT EXISTS (
  SELECT 1 FROM public.outreach_budget_lines l
  WHERE l.team_id = b.team_id AND l.category_id = b.category_id
);

-- ── Arithmetic ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.outreach_budget_line_total()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_size integer;
BEGIN
  SELECT people_count INTO v_size FROM public.outreach_teams WHERE id = NEW.team_id;
  NEW.total_zar := round(
    NEW.amount_zar * NEW.frequency
      * (CASE WHEN NEW.uses_team_size THEN coalesce(v_size, 0) ELSE NEW.fixed_people END),
    2);
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_obl_total ON public.outreach_budget_lines;
CREATE TRIGGER trg_obl_total
  BEFORE INSERT OR UPDATE ON public.outreach_budget_lines
  FOR EACH ROW EXECUTE FUNCTION public.outreach_budget_line_total();

-- Rebuild the derived per-category rows and the team total from lines.
-- SECURITY DEFINER: a finance student may edit lines but not
-- outreach_team_budgets / outreach_teams directly.
CREATE OR REPLACE FUNCTION public.sync_outreach_team_budget(p_team uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.outreach_team_budgets b
  WHERE b.team_id = p_team
    AND NOT EXISTS (
      SELECT 1 FROM public.outreach_budget_lines l
      WHERE l.team_id = p_team AND l.category_id = b.category_id
    );

  INSERT INTO public.outreach_team_budgets (team_id, category_id, budget_amount_zar)
  SELECT p_team, l.category_id, sum(l.total_zar)
  FROM public.outreach_budget_lines l
  WHERE l.team_id = p_team
  GROUP BY l.category_id
  ON CONFLICT (team_id, category_id)
  DO UPDATE SET budget_amount_zar = EXCLUDED.budget_amount_zar, updated_at = now();

  UPDATE public.outreach_teams
  SET total_budget_zar = coalesce(
        (SELECT sum(total_zar) FROM public.outreach_budget_lines WHERE team_id = p_team), 0),
      updated_at = now()
  WHERE id = p_team;
END;
$$;

CREATE OR REPLACE FUNCTION public.outreach_budget_lines_changed()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.sync_outreach_team_budget(OLD.team_id);
    RETURN OLD;
  END IF;
  PERFORM public.sync_outreach_team_budget(NEW.team_id);
  IF TG_OP = 'UPDATE' AND OLD.team_id <> NEW.team_id THEN
    PERFORM public.sync_outreach_team_budget(OLD.team_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_obl_sync ON public.outreach_budget_lines;
CREATE TRIGGER trg_obl_sync
  AFTER INSERT OR UPDATE OR DELETE ON public.outreach_budget_lines
  FOR EACH ROW EXECUTE FUNCTION public.outreach_budget_lines_changed();

-- Team size changed → every line that follows it moves.
CREATE OR REPLACE FUNCTION public.outreach_team_size_changed()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Touching the rows re-runs trg_obl_total (new total) and
  -- trg_obl_sync (new category + team totals).
  UPDATE public.outreach_budget_lines
  SET updated_at = now()
  WHERE team_id = NEW.id AND uses_team_size;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_outreach_team_size ON public.outreach_teams;
CREATE TRIGGER trg_outreach_team_size
  AFTER UPDATE OF people_count ON public.outreach_teams
  FOR EACH ROW
  WHEN (OLD.people_count IS DISTINCT FROM NEW.people_count)
  EXECUTE FUNCTION public.outreach_team_size_changed();

-- Team leaders / finance students may change the team size without
-- being allowed to edit the rest of the team record.
CREATE OR REPLACE FUNCTION public.set_outreach_team_size(p_team uuid, p_size integer)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.can_edit_outreach_budget(p_team) THEN
    RAISE EXCEPTION 'Not allowed to edit this team''s budget' USING ERRCODE = '42501';
  END IF;
  IF p_size IS NULL OR p_size < 0 OR p_size > 1000 THEN
    RAISE EXCEPTION 'Team size must be between 0 and 1000' USING ERRCODE = '22023';
  END IF;
  UPDATE public.outreach_teams SET people_count = p_size, updated_at = now() WHERE id = p_team;
END;
$$;

-- Importing a sheet: replace the previous IMPORTED lines (hand-added
-- lines stay) in one transaction, so running the same sheet twice never
-- doubles the budget and a failed insert never leaves it half-deleted.
-- SECURITY INVOKER: RLS on lines still decides who may do this.
CREATE OR REPLACE FUNCTION public.import_outreach_budget(
  p_team uuid,
  p_filename text,
  p_lines jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_batch uuid;
  v_replaced integer;
  v_count integer;
BEGIN
  IF NOT public.can_edit_outreach_budget(p_team) THEN
    RAISE EXCEPTION 'Not allowed to edit this team''s budget' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.outreach_budget_lines WHERE team_id = p_team AND source = 'import';
  GET DIAGNOSTICS v_replaced = ROW_COUNT;

  INSERT INTO public.outreach_budget_imports
    (team_id, filename, line_count, replaced_count, imported_by)
  VALUES (p_team, p_filename, jsonb_array_length(p_lines), v_replaced, auth.uid())
  RETURNING id INTO v_batch;

  INSERT INTO public.outreach_budget_lines
    (team_id, category_id, description, amount_zar, frequency,
     uses_team_size, fixed_people, sheet_total_zar, sort_order,
     source, import_batch_id, created_by)
  SELECT p_team,
         (l->>'category_id')::uuid,
         l->>'description',
         coalesce((l->>'amount_zar')::numeric, 0),
         coalesce((l->>'frequency')::numeric, 1),
         coalesce((l->>'uses_team_size')::boolean, true),
         coalesce((l->>'fixed_people')::integer, 1),
         (l->>'sheet_total_zar')::numeric,
         coalesce((l->>'sort_order')::integer, 0),
         'import', v_batch, auth.uid()
  FROM jsonb_array_elements(p_lines) l;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN jsonb_build_object('batch_id', v_batch, 'line_count', v_count, 'replaced_count', v_replaced);
END;
$$;

-- ── RLS ─────────────────────────────────────────────────────
ALTER TABLE public.outreach_budget_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outreach_budget_imports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read budget lines" ON public.outreach_budget_lines;
CREATE POLICY "Read budget lines"
  ON public.outreach_budget_lines FOR SELECT
  USING (
    public.is_admin()
    OR public.has_role('finance_admin')
    OR public.has_permission('finance.view')
    OR public.has_permission('finance.edit')
    OR public.is_outreach_team_member(team_id)
  );

DROP POLICY IF EXISTS "Insert budget lines" ON public.outreach_budget_lines;
CREATE POLICY "Insert budget lines"
  ON public.outreach_budget_lines FOR INSERT
  WITH CHECK (public.can_edit_outreach_budget(team_id));

DROP POLICY IF EXISTS "Update budget lines" ON public.outreach_budget_lines;
CREATE POLICY "Update budget lines"
  ON public.outreach_budget_lines FOR UPDATE
  USING (public.can_edit_outreach_budget(team_id))
  WITH CHECK (public.can_edit_outreach_budget(team_id));

DROP POLICY IF EXISTS "Delete budget lines" ON public.outreach_budget_lines;
CREATE POLICY "Delete budget lines"
  ON public.outreach_budget_lines FOR DELETE
  USING (public.can_edit_outreach_budget(team_id));

DROP POLICY IF EXISTS "Read budget imports" ON public.outreach_budget_imports;
CREATE POLICY "Read budget imports"
  ON public.outreach_budget_imports FOR SELECT
  USING (
    public.is_admin()
    OR public.has_role('finance_admin')
    OR public.has_permission('finance.view')
    OR public.has_permission('finance.edit')
    OR public.is_outreach_team_member(team_id)
  );

DROP POLICY IF EXISTS "Write budget imports" ON public.outreach_budget_imports;
CREATE POLICY "Write budget imports"
  ON public.outreach_budget_imports FOR INSERT
  WITH CHECK (public.can_edit_outreach_budget(team_id));

GRANT EXECUTE ON FUNCTION public.set_outreach_team_size(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.import_outreach_budget(uuid, text, jsonb) TO authenticated;
