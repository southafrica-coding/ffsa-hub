-- ============================================================
-- FFSA Hub — Migration 279: budget reporting views
--                           (finance PR-2, part 3 of 3)
-- ============================================================
-- APPLY ORDER: 275 (PR #474), 277, 278, then this file.
--
-- Flat, read-only views over the budget tables, for the finance
-- screens, exports and (later) the AI assistant:
--
--   v_budget_lines_flat — one row per live (not archived) budget line, with
--                         its budget, owner name, period, section, friendly
--                         category, totals, coding status and, per
--                         organisation (za / us), the Xero account code/name
--                         and tracking option names.
--   v_budget_summary    — one row per budget × section × category: number
--                         of lines, total in cents, lines needing coding.
--   v_budget_yoy        — year-over-year: every budget that continues an
--                         earlier one (budgets.source_budget_id, set by
--                         copy_budget_to_period and by saved templates),
--                         per category: this budget's total, the earlier
--                         budget's total and the change.
--
-- All three are security_invoker = true (PG15+, precedent 174): they run with
-- the CALLER's rights, so RLS on the underlying tables decides what each
-- person sees. Finance sees every budget. A member sees only their own
-- budgets, and the Xero columns come back empty for them because the
-- coding and mirror tables are finance-only. Nothing here bypasses RLS.
-- The mirror's raw payloads and the audit log are not exposed.
--
-- Only adds three views; no table or row is touched.
--
-- Safe to re-run: each view is dropped and created again, so the
-- security_invoker option is always re-applied.
--
-- ROLLBACK: drop the three views (block at the end of this file).
-- ============================================================


-- ────────────────────────────────────────────────────────────
-- 1. v_budget_lines_flat
-- ────────────────────────────────────────────────────────────
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
WHERE l.archived_at IS NULL;


-- ────────────────────────────────────────────────────────────
-- 2. v_budget_summary
-- ────────────────────────────────────────────────────────────
CREATE VIEW public.v_budget_summary
WITH (security_invoker = true) AS
SELECT
  b.id                                     AS budget_id,
  b.name                                   AS budget_name,
  b.status                                 AS budget_status,
  b.currency,
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
WHERE l.archived_at IS NULL
GROUP BY b.id, b.name, b.status, b.currency, b.owner_kind,
         b.staff_ministry_id, b.subcategory_id, b.program_id, b.event_id, b.outreach_team_id,
         b.period_id, s.key, l.category_id, c.name;


-- ────────────────────────────────────────────────────────────
-- 3. v_budget_yoy
-- ────────────────────────────────────────────────────────────
-- A category that exists in only one of the pair shows 0 for the other.
-- A pair with no lines on either side still shows one row (category NULL).
-- Someone who can see the new budget but not the earlier one gets
-- source_* columns empty and source_total_cents 0 (RLS on the earlier one).
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
  coalesce(x.src_cents, 0)::bigint               AS source_total_cents,
  (coalesce(x.cur_cents, 0) - coalesce(x.src_cents, 0))::bigint
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


-- ────────────────────────────────────────────────────────────
-- 4. Grants + comments
-- ────────────────────────────────────────────────────────────
-- The views open only for signed-in users; rows are still filtered by RLS
-- on the underlying tables (security_invoker).
REVOKE ALL ON public.v_budget_lines_flat FROM PUBLIC, anon;
REVOKE ALL ON public.v_budget_summary    FROM PUBLIC, anon;
REVOKE ALL ON public.v_budget_yoy        FROM PUBLIC, anon;
GRANT SELECT ON public.v_budget_lines_flat TO authenticated, service_role;
GRANT SELECT ON public.v_budget_summary    TO authenticated, service_role;
GRANT SELECT ON public.v_budget_yoy        TO authenticated, service_role;

COMMENT ON VIEW public.v_budget_lines_flat IS
  'One row per live budget line with budget, owner, period, section, friendly category, cents and per-organisation Xero coding (za_* / us_*). security_invoker: the caller''s RLS applies, so members see only their budgets and get NULL Xero columns.';
COMMENT ON COLUMN public.v_budget_lines_flat.owner_name IS
  'Name of the owning staff ministry, sub-category, school (program), event or outreach team.';
COMMENT ON COLUMN public.v_budget_lines_flat.line_total_cents IS
  'Trigger-computed round(amount_cents × frequency × multiplier), in cents of the budget currency.';
COMMENT ON COLUMN public.v_budget_lines_flat.coding_status IS
  'inherited, overridden or needs_coding (finance''s queue).';
COMMENT ON COLUMN public.v_budget_lines_flat.za_account_code IS
  'Xero account code in the South Africa organisation. NULL when not coded, or when the caller is not finance.';
COMMENT ON COLUMN public.v_budget_lines_flat.us_account_code IS
  'Xero account code in the USA organisation. NULL when not coded, or when the caller is not finance.';

COMMENT ON VIEW public.v_budget_summary IS
  'Per budget × section × category: live line count, total cents and how many lines still need coding. Sum the rows for section or budget totals. security_invoker: the caller''s RLS applies.';
COMMENT ON COLUMN public.v_budget_summary.total_cents IS
  'Sum of line_total_cents of the live lines in this budget, section and category.';
COMMENT ON COLUMN public.v_budget_summary.needs_coding_count IS
  'Live lines in this group whose coding_status is needs_coding.';

COMMENT ON VIEW public.v_budget_yoy IS
  'Year-over-year: each budget that continues an earlier one (source_budget_id), per category, with this total, the earlier total and the change, in cents. Currencies are shown, never converted. security_invoker: the caller''s RLS applies to both budgets.';
COMMENT ON COLUMN public.v_budget_yoy.source_total_cents IS
  'The earlier budget''s live total for this category. 0 when the category is new, or when the caller cannot see the earlier budget.';
COMMENT ON COLUMN public.v_budget_yoy.change_cents IS
  'total_cents − source_total_cents. Only meaningful when currency = source_currency.';


-- ============================================================
-- Verify:
--   SELECT relname, reloptions FROM pg_class
--    WHERE relname IN ('v_budget_lines_flat', 'v_budget_summary', 'v_budget_yoy');
--                                         -- all {security_invoker=true}
--   SELECT * FROM public.v_budget_summary LIMIT 5;   -- empty until lines exist
-- ============================================================

-- ------------------------------------------------------------
-- ROLLBACK:
--   DROP VIEW IF EXISTS public.v_budget_yoy;
--   DROP VIEW IF EXISTS public.v_budget_summary;
--   DROP VIEW IF EXISTS public.v_budget_lines_flat;
-- ------------------------------------------------------------
