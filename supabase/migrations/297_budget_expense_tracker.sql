-- DRAFT ONLY. DO NOT APPLY to production.
-- Manual expense tracker for a budget (migration 297). Actuals in the parent
-- budget's record currency. Not an outreach import and not a Xero ledger.
-- Depends on 296. Once-only; not safe to re-run.

ALTER TABLE public.budget_lines ADD CONSTRAINT budget_lines_id_budget_unique UNIQUE(id,budget_id);
CREATE TABLE public.budget_expenses (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 budget_id uuid NOT NULL REFERENCES public.budgets(id) ON DELETE RESTRICT,
 line_id uuid,
 expense_date date NOT NULL,
 vendor text,
 description text NOT NULL CHECK(btrim(description)<>''),
 amount_cents bigint NOT NULL CHECK(amount_cents<>0),
 reference text,
 notes text,
 created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 archived_at timestamptz,
 CONSTRAINT budget_expenses_line_budget_fkey FOREIGN KEY(line_id,budget_id)
 REFERENCES public.budget_lines(id,budget_id) ON DELETE RESTRICT
);
COMMENT ON TABLE public.budget_expenses IS 'Sheet Expense Tracker only. Amounts are signed cents in the parent budget currency (no currency column on this table). Not a Xero ledger, not an outreach import, and not a posting table. Positive spend; negative refund. NULL line_id is unallocated. Later Xero actuals must reconcile with these rows rather than replace this shape.';
CREATE INDEX budget_expenses_budget_date_idx ON public.budget_expenses(budget_id,expense_date,id) WHERE archived_at IS NULL;
CREATE INDEX budget_expenses_line_idx ON public.budget_expenses(line_id,budget_id) WHERE line_id IS NOT NULL;
CREATE FUNCTION finance_private.can_record_budget_expenses(p_budget_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.budgets b WHERE b.id=p_budget_id AND b.archived_at IS NULL
 AND (finance_private.can_edit_all_budgets() OR finance_private.is_budget_member(b.id,'editor')));
$$;
CREATE FUNCTION finance_private.budget_expenses_before_write() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.fiscal_periods%ROWTYPE;
BEGIN
 IF TG_OP='UPDATE' AND ROW(NEW.budget_id,NEW.created_by,NEW.created_at) IS DISTINCT FROM ROW(OLD.budget_id,OLD.created_by,OLD.created_at) THEN
  RAISE EXCEPTION 'Expense budget/creator are immutable' USING ERRCODE='23514'; END IF;
 SELECT fp.* INTO p FROM public.budgets b JOIN public.fiscal_periods fp ON fp.id=b.period_id WHERE b.id=NEW.budget_id;
 IF NOT FOUND OR NEW.expense_date NOT BETWEEN p.start_date AND p.end_date THEN
  RAISE EXCEPTION 'Expense date must fall within the budget period' USING ERRCODE='23514'; END IF;
 IF NEW.line_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.budget_lines l WHERE l.id=NEW.line_id AND l.budget_id=NEW.budget_id AND l.archived_at IS NULL) THEN
  RAISE EXCEPTION 'Expense must reference a live line of this budget' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN NEW.created_by:=coalesce(auth.uid(),NEW.created_by); NEW.created_at:=now(); END IF;
 NEW.updated_at:=now(); RETURN NEW;
END $$;
CREATE TRIGGER budget_expenses_before_write BEFORE INSERT OR UPDATE ON public.budget_expenses FOR EACH ROW EXECUTE FUNCTION finance_private.budget_expenses_before_write();
CREATE TRIGGER budget_expenses_audit AFTER INSERT OR UPDATE OR DELETE ON public.budget_expenses FOR EACH ROW EXECUTE FUNCTION finance_private.finance_audit_row();
ALTER TABLE public.budget_expenses ENABLE ROW LEVEL SECURITY;
CREATE POLICY budget_expenses_read ON public.budget_expenses FOR SELECT TO authenticated
USING(finance_private.can_view_all_budgets() OR finance_private.is_budget_member(budget_id));
CREATE POLICY budget_expenses_insert ON public.budget_expenses FOR INSERT TO authenticated
WITH CHECK(finance_private.can_record_budget_expenses(budget_id));
CREATE POLICY budget_expenses_update ON public.budget_expenses FOR UPDATE TO authenticated
USING(finance_private.can_record_budget_expenses(budget_id)) WITH CHECK(finance_private.can_record_budget_expenses(budget_id));
