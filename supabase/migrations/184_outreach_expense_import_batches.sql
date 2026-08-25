-- ============================================================
-- FFSA Hub — Migration 184: outreach expense imports are repeatable
-- ------------------------------------------------------------
-- The expense importer posted one INSERT per spreadsheet row and
-- outreach_expenses has no natural key, so importing the same sheet
-- twice silently doubled every expense — and the second run looked
-- exactly as successful as the first. Budgets never had this problem:
-- they upsert onto UNIQUE (team_id, category_id) from migration 008.
--
-- Two additions:
--   1. A batch row per import, so an import can be undone as a unit
--      ("start again") instead of hand-deleting rows.
--   2. A content key per expense row, unique per team, so re-importing
--      the same sheet skips what is already there rather than
--      duplicating it.
--
-- The key is NULLable, and Postgres treats NULLs as DISTINCT in a unique
-- index, so every hand-entered expense (key NULL) coexists freely with
-- every other; only spreadsheet rows participate in deduplication.
-- The index is deliberately NOT partial: ON CONFLICT cannot infer a
-- partial index without repeating its predicate, which the Supabase
-- client cannot express. A plain index gives identical protection here.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.outreach_expense_imports (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id      uuid NOT NULL REFERENCES public.outreach_teams(id) ON DELETE CASCADE,
  filename     text,
  row_count    integer NOT NULL DEFAULT 0,  -- rows offered
  created_count integer NOT NULL DEFAULT 0, -- rows actually written
  skipped_count integer NOT NULL DEFAULT 0, -- rows already present
  imported_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_oei_team ON public.outreach_expense_imports(team_id);

ALTER TABLE public.outreach_expenses
  ADD COLUMN IF NOT EXISTS import_batch_id uuid
    REFERENCES public.outreach_expense_imports(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS import_row_key text;

-- NULL keys (hand-entered expenses) never collide: NULL is distinct here.
CREATE UNIQUE INDEX IF NOT EXISTS uq_outreach_expenses_import_row
  ON public.outreach_expenses(team_id, import_row_key);

CREATE INDEX IF NOT EXISTS idx_oe_import_batch
  ON public.outreach_expenses(import_batch_id)
  WHERE import_batch_id IS NOT NULL;

-- ── RLS: mirror outreach_expenses as rewritten by migration 017 ──
ALTER TABLE public.outreach_expense_imports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read expense imports" ON public.outreach_expense_imports;
CREATE POLICY "Read expense imports"
  ON public.outreach_expense_imports FOR SELECT
  USING (
    public.is_admin()
    OR public.has_role('finance_admin')
    OR public.has_permission('finance.view')
    OR public.has_permission('finance.edit')
    OR public.is_outreach_team_member(team_id)
  );

DROP POLICY IF EXISTS "Write expense imports" ON public.outreach_expense_imports;
CREATE POLICY "Write expense imports"
  ON public.outreach_expense_imports FOR INSERT
  WITH CHECK (
    public.is_admin()
    OR public.has_role('finance_admin')
    OR public.has_permission('finance.edit')
    OR public.is_outreach_team_member(team_id)
  );

DROP POLICY IF EXISTS "Delete expense imports" ON public.outreach_expense_imports;
CREATE POLICY "Delete expense imports"
  ON public.outreach_expense_imports FOR DELETE
  USING (
    public.is_admin()
    OR public.has_role('finance_admin')
    OR public.has_permission('finance.edit')
    OR public.is_outreach_team_member(team_id)
  );
