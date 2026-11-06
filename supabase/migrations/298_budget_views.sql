-- DRAFT ONLY. DO NOT APPLY to production.
-- Replaces the unapplied #475 file 279_budget_views.sql and adds the empty-safe
-- overview, line actuals, expense tracker and live coding queue.
-- Every view is security_invoker. Depends on 296 and 297. Numbered 298.
-- Once-only; not safe to re-run.

DROP VIEW IF EXISTS public.v_budget_yoy;
DROP VIEW IF EXISTS public.v_budget_summary;
DROP VIEW IF EXISTS public.v_budget_lines_flat;

CREATE VIEW public.v_budget_lines_flat
WITH (security_invoker = true) AS
SELECT
  l.id                      AS line_id,
  b.id                      AS budget_id,
  b.name                    AS budget_name,
  b.status                  AS budget_status,
  b.currency,
  b.org_id,
  b.owner_kind,
  coalesce(b.staff_ministry_id, b.subcategory_id, b.program_id, b.event_id, b.outreach_team_id)
                            AS owner_id,
  coalesce(sm.name, sc.name, pr.name, ev.title, ot.team_name)
                            AS owner_name,
  b.period_id,
  fp.label                  AS period_label,
  fp.kind                   AS period_kind,
  fp.start_date             AS period_start,
  fp.end_date               AS period_end,
  s.key                     AS section_key,
  s.label                   AS section_label,
  l.kind,
  l.name                    AS line_name,
  l.category_id,
  c.name                    AS category_name,
  c.group_name              AS category_group,
  l.amount_cents,
  l.frequency,
  l.multiplier,
  l.uses_driver,
  l.line_total_cents,
  l.coding_status,
  l.sort,
  l.source_line_id,
  za.account_id             AS za_account_id,
  za_acc.code               AS za_account_code,
  za_acc.name               AS za_account_name,
  za_t1.name                AS za_tracking_1_name,
  za_t2.name                AS za_tracking_2_name,
  us.account_id             AS us_account_id,
  us_acc.code               AS us_account_code,
  us_acc.name               AS us_account_name,
  us_t1.name                AS us_tracking_1_name,
  us_t2.name                AS us_tracking_2_name,
  l.created_at,
  l.updated_at
FROM public.budget_lines l
JOIN public.budgets b               ON b.id = l.budget_id
JOIN public.budget_sections s       ON s.id = l.section_id
JOIN public.budget_categories c     ON c.id = l.category_id
LEFT JOIN public.fiscal_periods fp  ON fp.id = b.period_id
LEFT JOIN public.staff_ministries sm             ON sm.id = b.staff_ministry_id
LEFT JOIN public.staff_ministry_subcategories sc ON sc.id = b.subcategory_id
LEFT JOIN public.programs pr                     ON pr.id = b.program_id
LEFT JOIN public.events ev                       ON ev.id = b.event_id
LEFT JOIN public.outreach_teams ot               ON ot.id = b.outreach_team_id
LEFT JOIN public.budget_line_coding za     ON za.line_id = l.id AND za.org_region = 'za'
LEFT JOIN public.xero_accounts za_acc      ON za_acc.id = za.account_id
LEFT JOIN public.xero_tracking_options za_t1 ON za_t1.id = za.tracking_option_1_id
LEFT JOIN public.xero_tracking_options za_t2 ON za_t2.id = za.tracking_option_2_id
LEFT JOIN public.budget_line_coding us     ON us.line_id = l.id AND us.org_region = 'us'
LEFT JOIN public.xero_accounts us_acc      ON us_acc.id = us.account_id
LEFT JOIN public.xero_tracking_options us_t1 ON us_t1.id = us.tracking_option_1_id
LEFT JOIN public.xero_tracking_options us_t2 ON us_t2.id = us.tracking_option_2_id
WHERE l.archived_at IS NULL AND b.archived_at IS NULL;


CREATE VIEW public.v_budget_summary
WITH (security_invoker = true) AS
SELECT
  b.id                                     AS budget_id,
  b.name                                   AS budget_name,
  b.status                                 AS budget_status,
  b.currency,
  b.org_id,
  b.owner_kind,
  coalesce(b.staff_ministry_id, b.subcategory_id, b.program_id, b.event_id, b.outreach_team_id)
                                           AS owner_id,
  b.period_id,
  s.key                                    AS section_key,
  l.category_id,
  c.name                                   AS category_name,
  count(*)::int                            AS line_count,
  sum(l.line_total_cents)::bigint          AS total_cents,
  (count(*) FILTER (WHERE l.coding_status = 'needs_coding'))::int
                                           AS needs_coding_count
FROM public.budget_lines l
JOIN public.budgets b           ON b.id = l.budget_id
JOIN public.budget_sections s   ON s.id = l.section_id
JOIN public.budget_categories c ON c.id = l.category_id
WHERE l.archived_at IS NULL AND b.archived_at IS NULL
GROUP BY b.id, b.name, b.status, b.currency, b.org_id, b.owner_kind,
         b.staff_ministry_id, b.subcategory_id, b.program_id, b.event_id, b.outreach_team_id,
         b.period_id, s.key, l.category_id, c.name;


CREATE VIEW public.v_budget_yoy
WITH (security_invoker = true) AS
WITH totals AS (
  SELECT l.budget_id, l.category_id, sum(l.line_total_cents)::bigint AS total_cents
    FROM public.budget_lines l
   WHERE l.archived_at IS NULL
   GROUP BY l.budget_id, l.category_id
)
SELECT
  b.id                                           AS budget_id,
  b.name                                         AS budget_name,
  b.period_id,
  fp.label                                       AS period_label,
  b.currency,
  b.org_id,
  b.owner_kind,
  coalesce(b.staff_ministry_id, b.subcategory_id, b.program_id, b.event_id, b.outreach_team_id)
                                                 AS owner_id,
  b.source_budget_id,
  b.source_template_id,
  sb.name                                        AS source_budget_name,
  sb.period_id                                   AS source_period_id,
  sfp.label                                      AS source_period_label,
  sb.currency                                    AS source_currency,
  x.category_id,
  c.name                                         AS category_name,
  coalesce(x.cur_cents, 0)::bigint               AS total_cents,
  CASE WHEN sb.id IS NOT NULL THEN coalesce(x.src_cents,0)::bigint END               AS source_total_cents,
  CASE WHEN sb.id IS NOT NULL AND sb.org_id=b.org_id AND sb.currency=b.currency THEN (coalesce(x.cur_cents,0)-coalesce(x.src_cents,0))::bigint END
                                                 AS change_cents
FROM public.budgets b
LEFT JOIN public.fiscal_periods fp  ON fp.id = b.period_id
LEFT JOIN public.budgets sb         ON sb.id = b.source_budget_id
LEFT JOIN public.fiscal_periods sfp ON sfp.id = sb.period_id
LEFT JOIN LATERAL (
  SELECT category_id, cur.total_cents AS cur_cents, src.total_cents AS src_cents
    FROM (SELECT t.category_id, t.total_cents FROM totals t WHERE t.budget_id = b.id) cur
    FULL JOIN (SELECT t.category_id, t.total_cents FROM totals t WHERE t.budget_id = sb.id) src
   USING (category_id)
) x ON true
LEFT JOIN public.budget_categories c ON c.id = x.category_id
WHERE b.source_budget_id IS NOT NULL;


REVOKE ALL ON public.v_budget_lines_flat FROM PUBLIC, anon;
REVOKE ALL ON public.v_budget_summary    FROM PUBLIC, anon;
REVOKE ALL ON public.v_budget_yoy        FROM PUBLIC, anon;
GRANT SELECT ON public.v_budget_lines_flat TO authenticated, service_role;
GRANT SELECT ON public.v_budget_summary    TO authenticated, service_role;
GRANT SELECT ON public.v_budget_yoy        TO authenticated, service_role;

COMMENT ON VIEW public.v_budget_lines_flat IS
  'One row per live budget line with budget, owner, org, period, section, friendly category and cents. za_* and us_* are the line''s single coding row, so only the budget org''s side is filled. security_invoker: the caller''s RLS applies, so members see only their budgets and get NULL Xero columns.';
COMMENT ON COLUMN public.v_budget_lines_flat.owner_name IS
  'Name of the owning staff ministry, sub-category, school (program), event or outreach team.';
COMMENT ON COLUMN public.v_budget_lines_flat.line_total_cents IS
  'Trigger-computed round(amount_cents × frequency × multiplier), in cents of the budget currency.';
COMMENT ON COLUMN public.v_budget_lines_flat.coding_status IS
  'inherited, overridden or needs_coding (finance''s queue).';
COMMENT ON COLUMN public.v_budget_lines_flat.za_account_code IS
  'Xero account code in the South Africa organisation. NULL when not coded, or when the caller is not finance.';
COMMENT ON COLUMN public.v_budget_lines_flat.us_account_code IS
  'Unused on Hub budgets, which are South Africa only. NULL.';

COMMENT ON VIEW public.v_budget_summary IS
  'Per budget × section × category: live line count, total cents and how many lines still need coding. Sum the rows for section or budget totals. security_invoker: the caller''s RLS applies.';
COMMENT ON COLUMN public.v_budget_summary.total_cents IS
  'Sum of line_total_cents of the live lines in this budget, section and category.';
COMMENT ON COLUMN public.v_budget_summary.needs_coding_count IS
  'Live lines in this group whose coding_status is needs_coding.';

COMMENT ON VIEW public.v_budget_yoy IS
  'Period-to-source comparison for Hub budgets (FFSA NPC, ZAR): each budget that continues an earlier one, per category, with this total, the earlier total and the change, in cents. security_invoker: the caller''s RLS applies to both budgets.';
COMMENT ON COLUMN public.v_budget_yoy.source_total_cents IS
  'The earlier budget''s live total for this category when the caller can see that budget. 0 when the category is new on a visible source. NULL when row-level security hides the source budget (a hidden source is not treated as zero).';
COMMENT ON COLUMN public.v_budget_yoy.change_cents IS
  'total_cents minus source_total_cents. NULL when the source is hidden. Hub budgets are FFSA NPC in ZAR, so there is no cross-currency conversion.';




-- One row even for a brand-new empty budget. Separate aggregates avoid line x expense fan-out.
CREATE VIEW public.v_budget_overview WITH(security_invoker=true) AS
WITH plan AS (
 SELECT budget_id,sum(line_total_cents) AS planned_cents,
 coalesce(sum(line_total_cents) FILTER(WHERE kind='fixed'),0) AS fixed_cents,
 coalesce(sum(line_total_cents) FILTER(WHERE kind='variable'),0) AS variable_cents,
 count(*) AS line_count FROM public.budget_lines WHERE archived_at IS NULL GROUP BY budget_id
), spend AS (
 SELECT budget_id,sum(amount_cents) AS spent_cents,
 coalesce(sum(amount_cents) FILTER(WHERE line_id IS NULL),0) AS unallocated_cents
 FROM public.budget_expenses WHERE archived_at IS NULL GROUP BY budget_id
)
SELECT b.id AS budget_id,b.name,b.org_id,b.currency,b.period_id,b.owner_kind,
 public.budget_owner_id(b.staff_ministry_id,b.subcategory_id,b.program_id,b.event_id,b.outreach_team_id) AS owner_id,
 b.status,fp.label AS period_label,fp.start_date,fp.end_date,
 b.funding_goal_cents,b.funds_in_hand_cents,b.income_goal_cents,b.fundraising_goal_cents,b.notes,
 coalesce(p.planned_cents,0) AS planned_cents,coalesce(p.fixed_cents,0) AS fixed_cents,
 coalesce(p.variable_cents,0) AS variable_cents,coalesce(p.line_count,0) AS line_count,
 coalesce(s.spent_cents,0) AS spent_cents,coalesce(s.unallocated_cents,0) AS unallocated_cents,
 coalesce(p.planned_cents,0)-coalesce(s.spent_cents,0) AS remaining_cents
FROM public.budgets b JOIN public.fiscal_periods fp ON fp.id=b.period_id
LEFT JOIN plan p ON p.budget_id=b.id LEFT JOIN spend s ON s.budget_id=b.id
WHERE b.archived_at IS NULL;
CREATE VIEW public.v_budget_line_actuals WITH(security_invoker=true) AS
WITH spent AS (
 SELECT budget_id,line_id,sum(amount_cents) AS spent_cents FROM public.budget_expenses
 WHERE archived_at IS NULL AND line_id IS NOT NULL GROUP BY budget_id,line_id
)
SELECT l.id AS line_id,l.budget_id,b.org_id,b.currency,l.kind,l.category_id,l.name,l.archived_at,
 CASE WHEN l.archived_at IS NULL THEN l.line_total_cents ELSE 0 END AS planned_cents,coalesce(s.spent_cents,0) AS spent_cents,
 (CASE WHEN l.archived_at IS NULL THEN l.line_total_cents ELSE 0 END)-coalesce(s.spent_cents,0) AS remaining_cents
FROM public.budget_lines l JOIN public.budgets b ON b.id=l.budget_id
LEFT JOIN spent s ON s.line_id=l.id AND s.budget_id=l.budget_id
WHERE b.archived_at IS NULL AND (l.archived_at IS NULL OR s.line_id IS NOT NULL);
CREATE VIEW public.v_budget_expense_tracker WITH(security_invoker=true) AS
SELECT e.id AS expense_id,e.budget_id,b.org_id,b.currency,e.line_id,l.name AS line_name,
 l.kind,l.category_id,e.expense_date,e.vendor,e.description,e.amount_cents,e.reference,
 e.notes,e.created_by,e.created_at,e.updated_at
FROM public.budget_expenses e JOIN public.budgets b ON b.id=e.budget_id
LEFT JOIN public.budget_lines l ON l.id=e.line_id AND l.budget_id=e.budget_id
WHERE e.archived_at IS NULL AND b.archived_at IS NULL;
-- This diagnostic is finance code-managers only. RLS still applies to every joined mirror table.
CREATE VIEW public.v_budget_coding_queue WITH(security_invoker=true) AS
SELECT l.id AS line_id,l.budget_id,b.org_id,b.currency,c.org_region,l.name,l.coding_status,
 (c.account_id IS NULL) AS missing_account,
 (c.account_id IS NOT NULL AND (a.id IS NULL OR a.status<>'active' OR a.missing_since IS NOT NULL)) AS invalid_account,
 ((c.tracking_option_1_id IS NOT NULL AND (o1.id IS NULL OR o1.status<>'active' OR o1.missing_since IS NOT NULL OR t1.status<>'active' OR t1.missing_since IS NOT NULL))
 OR (c.tracking_option_2_id IS NOT NULL AND (o2.id IS NULL OR o2.status<>'active' OR o2.missing_since IS NOT NULL OR t2.status<>'active' OR t2.missing_since IS NOT NULL))) AS invalid_tracking
FROM public.budget_lines l JOIN public.budgets b ON b.id=l.budget_id
LEFT JOIN public.budget_line_coding c ON c.line_id=l.id
LEFT JOIN public.xero_accounts a ON a.id=c.account_id
LEFT JOIN public.xero_tracking_options o1 ON o1.id=c.tracking_option_1_id
LEFT JOIN public.xero_tracking_options o2 ON o2.id=c.tracking_option_2_id
LEFT JOIN public.xero_tracking_categories t1 ON t1.id=o1.category_id
LEFT JOIN public.xero_tracking_categories t2 ON t2.id=o2.category_id
WHERE l.archived_at IS NULL AND b.archived_at IS NULL AND finance_private.can_manage_budget_codes()
AND (l.coding_status='needs_coding' OR c.account_id IS NULL OR a.status<>'active' OR a.missing_since IS NOT NULL
OR (o1.id IS NOT NULL AND (o1.status<>'active' OR o1.missing_since IS NOT NULL OR t1.status<>'active' OR t1.missing_since IS NOT NULL))
OR (o2.id IS NOT NULL AND (o2.status<>'active' OR o2.missing_since IS NOT NULL OR t2.status<>'active' OR t2.missing_since IS NOT NULL)));
REVOKE ALL ON public.v_budget_overview,public.v_budget_line_actuals,public.v_budget_expense_tracker,public.v_budget_coding_queue FROM PUBLIC,anon;
GRANT SELECT ON public.v_budget_overview,public.v_budget_line_actuals,public.v_budget_expense_tracker,public.v_budget_coding_queue TO authenticated,service_role;
