-- ════════════════════════════════════════════════════════════
-- 248 — Finance Office role
-- ════════════════════════════════════════════════════════════
-- A ready-made role for the finance office (Ellen and team) to run year-end
-- donor statements: Finance → Donor Statements — settings, import, review,
-- preview, test send, send, resend, paper statements, send log.
--
-- Bundles only finance.donor_statements (migration 245). That permission
-- is in the finance module, so it also opens the Finance menu; it does NOT
-- grant outreach finance, school fees or Xero connection (those stay with
-- Finance Admin). Add more permissions to this role on the Roles page if
-- the office should do more.
--
-- is_system = false, so it can be edited and assigned on the Roles page.
-- Pattern copied from migration 157 (legal_admin).
--
-- Idempotent. Safe to re-run.
-- ────────────────────────────────────────────────────────────

INSERT INTO public.roles (name, display_name, description, is_system)
VALUES (
  'finance_office',
  'Finance Office',
  'Runs year-end donor statements for FF SA USA, INC: settings and wording, importing a tax year from Xero, reviewing donors, previewing, test sends, sending, resending and paper statements. Does not include outreach finance, school fees or the Xero connection.',
  false
)
ON CONFLICT (name) DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
JOIN public.permissions p ON p.key = 'finance.donor_statements'
WHERE r.name = 'finance_office'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ============================================================
-- Verify:
--   SELECT r.display_name, p.key
--   FROM public.roles r
--   JOIN public.role_permissions rp ON rp.role_id = r.id
--   JOIN public.permissions p ON p.id = rp.permission_id
--   WHERE r.name = 'finance_office';          -- Finance Office · finance.donor_statements
-- ============================================================
