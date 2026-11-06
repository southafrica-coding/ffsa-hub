-- DRAFT ONLY. DO NOT APPLY to production.
-- Grants for the budget model (migration 299). Only the boolean, auth-bound
-- helpers that policies and RPCs call are executable by signed-in users.
-- finance_private stays unexposed. Depends on 295–298. Once-only.

REVOKE ALL ON SCHEMA finance_private FROM PUBLIC,anon;
GRANT USAGE ON SCHEMA finance_private TO authenticated,service_role;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA finance_private FROM PUBLIC,anon,authenticated,service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA finance_private REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
 finance_private.can_edit_all_budgets(),finance_private.can_view_all_budgets(),
 finance_private.can_manage_budget_codes(),finance_private.can_approve_budgets(),
 finance_private.is_budget_member(uuid,text),finance_private.budget_has_owner(uuid,text,uuid),
 finance_private.can_manage_budget(uuid),finance_private.can_edit_budget_lines(uuid),
 finance_private.can_edit_budget_sections(uuid),finance_private.can_create_budget_row(text,uuid,uuid,uuid,uuid,uuid,uuid,uuid),
 finance_private.can_see_budget_template(uuid),finance_private.can_manage_budget_template(uuid),
 finance_private.can_record_budget_expenses(uuid),
 finance_private.assert_south_africa_budget_org(uuid)
 TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.budget_owner_id(uuid,uuid,uuid,uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.budget_owner_id(uuid,uuid,uuid,uuid,uuid) TO authenticated,service_role;
REVOKE ALL ON public.fiscal_periods,public.budget_categories,public.budget_category_coding,
 public.budget_templates,public.budget_template_sections,public.budget_template_lines,
 public.budget_template_line_coding,public.budgets,public.budget_sections,public.budget_members,
 public.budget_lines,public.budget_line_coding,public.budget_expenses,public.finance_audit_log
 FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.fiscal_periods,public.budget_categories,public.budget_templates,
 public.budget_template_sections,public.budget_template_lines,public.budgets,public.budget_sections,
 public.budget_lines,public.budget_expenses TO authenticated,service_role;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.budget_category_coding,public.budget_template_line_coding,
 public.budget_members,public.budget_line_coding TO authenticated,service_role;
GRANT SELECT ON public.finance_audit_log TO authenticated,service_role;
REVOKE INSERT,UPDATE,DELETE,TRUNCATE ON public.finance_audit_log FROM service_role;
-- Cover budget-only readers/code-managers; pre-existing broader finance policies remain untouched.
CREATE POLICY budget_read_xero_accounts ON public.xero_accounts FOR SELECT TO authenticated
 USING(finance_private.can_view_all_budgets() OR finance_private.can_manage_budget_codes());
CREATE POLICY budget_read_xero_options ON public.xero_tracking_options FOR SELECT TO authenticated
 USING(finance_private.can_view_all_budgets() OR finance_private.can_manage_budget_codes());
CREATE POLICY budget_read_xero_categories ON public.xero_tracking_categories FOR SELECT TO authenticated
 USING(finance_private.can_view_all_budgets() OR finance_private.can_manage_budget_codes());
