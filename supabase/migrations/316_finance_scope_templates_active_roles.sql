-- ============================================================
-- FFSA Hub — Migration 316: program-scoped finance stays in its program,
-- template library writes need full schools access, and roles count only
-- for active accounts
-- ============================================================
-- Builds on 313 (#542): this file redefines public.has_permission with
-- 313's active-account check, so it must run after 313, and it refuses to
-- run (section 0) if 313 is missing. It does not depend on 314 (#543) or
-- 315 (#544) and can run before or after either. 314 redefines none of
-- the functions or policies changed here.
-- NEVER re-run 313 after 316: 313's CREATE OR REPLACE of has_permission
-- would drop the finance rule (C). 313 carries a guard that refuses to
-- run once 316 is in place.
--
-- Jack's decisions (10 Nov 2026):
--
-- C ("for now no") — A finance.* grant scoped to a program must not reach
--   the org-wide finance data: finance_orgs, finance_projects, the seven
--   xero_* mirror tables and outreach staff (is_outreach_staff_editor /
--   _viewer). Every one of those checks calls has_permission('finance.view'
--   | 'finance.edit'), which until now counted a grant of any scope. On prod
--   that let 08c957a0, 666e334c and c380c569 (finance.edit scoped to one
--   program only) add and edit finance projects and edit every outreach
--   team and group.
--   Fix, in one place: has_permission ignores scoped grants for finance.*
--   keys. Unscoped grants and the finance_admin / admin roles are
--   unchanged. has_permission_for('finance.x', program) still honours a
--   grant for that program, so a later program-level finance feature can
--   use it. The app asks the same has_permission RPC (canEditFinanceProjects,
--   canReadFinanceXero, getFinanceHubAccess, outreach viewer), so the API
--   and the database agree without an app change.
--   Done in has_permission rather than in 11 policies + 3 functions so
--   that no caller (policy, function or app RPC) can drift from the rule.
--
-- D (yes) — application_templates INSERT / UPDATE / DELETE and
--   application_template_questions INSERT / DELETE need admin, or an
--   UNSCOPED schools.manage grant, or an UNSCOPED grant of the new
--   schools.templates.manage key (Jack, round 2). One function,
--   can_manage_application_templates(), holds the rule for the policies
--   and the app. The library is shared by every program and has no
--   program column. Reading the library is unchanged (has_schools_access(),
--   any scope), so scoped managers can still import a template into their
--   own program.
--   has_permission_for(key, NULL) means "unscoped grant only" (313): the
--   program branch compares scope_id = NULL, which is never true.
--   schools.templates.manage is org-wide only: a trigger refuses scoped
--   grants of it, and has_permission ignores scoped copies (as for
--   finance.*), so a scoped copy can never count anywhere.
--
-- E (yes) — is_admin(), has_any_role() and has_role() count only active
--   accounts (users.is_active IS NOT FALSE), as 313 did for has_permission
--   and has_permission_for, and as middleware.ts does. service_role and
--   anon have no auth.uid() and were already false, so server paths are
--   unchanged. has_role is included because it is the same check for a
--   single role (finance_admin, events_admin, comms_admin, ...) and would
--   otherwise be the one role path a deactivated account keeps.
--
-- Also (Lead's suggestion, not a change to 315): blank or padded
--   department values are normalised on INSERT too. 315's guard does it
--   on UPDATE only; signup / invite / accept-application insert through
--   the service role.
--
-- Same names, signatures, owners, defaults and grants as live. Functions
-- move to search_path = ''. Idempotent: CREATE OR REPLACE, DROP POLICY IF
-- EXISTS + CREATE POLICY, DROP TRIGGER IF EXISTS + CREATE TRIGGER.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 0. Preflight: 313 must already be applied. 316 rewrites has_permission
--    on top of 313's active-account version and relies on 313's
--    has_permission_for (D uses has_permission_for(key, NULL) as
--    "unscoped grant, active account"). Without 313 it would ship a
--    half-done state, so refuse.
-- ────────────────────────────────────────────────────────────
DO $preflight$
DECLARE
  v_for text := (SELECT p.prosrc FROM pg_catalog.pg_proc p
                  WHERE p.oid = pg_catalog.to_regprocedure('public.has_permission_for(text, uuid)'));
BEGIN
  IF v_for IS NULL OR pg_catalog.strpos(v_for, 'is_active IS NOT FALSE') = 0 THEN
    RAISE EXCEPTION '316 requires migration 313 (has_permission_for must have the is_active check). Apply 313 first.'
      USING ERRCODE = 'P0001';
  END IF;
END
$preflight$;

-- ────────────────────────────────────────────────────────────
-- C. has_permission: scoped finance.* grants stay in their scope.
--    (313's body otherwise unchanged: active accounts, any scope for
--    every other module.)
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.has_permission(required_permission text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid() AND u.is_active IS NOT FALSE
  )
  AND (
    EXISTS (
      -- direct grant: any scope, except finance.* and schools.templates.manage,
      -- where only unscoped counts (316)
      SELECT 1
      FROM public.user_permissions up
      JOIN public.permissions p ON p.id = up.permission_id
      WHERE up.user_id = auth.uid()
        AND p.key = required_permission
        AND (up.scope_type IS NULL OR (p.key NOT LIKE 'finance.%' AND p.key <> 'schools.templates.manage'))
    )
    OR EXISTS (
      -- via an assigned role's bundle: same rule on the role's scope
      SELECT 1
      FROM public.user_roles ur
      JOIN public.role_permissions rp ON rp.role_id = ur.role_id
      JOIN public.permissions p ON p.id = rp.permission_id
      WHERE ur.user_id = auth.uid()
        AND p.key = required_permission
        AND (ur.scope_type IS NULL OR (p.key NOT LIKE 'finance.%' AND p.key <> 'schools.templates.manage'))
    )
  );
$$;

-- Live ACL: PUBLIC + anon + authenticated + service_role (anon-readable
-- policies call it). Re-asserted as-is.
GRANT EXECUTE ON FUNCTION public.has_permission(text) TO PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public.has_permission(text) IS
  'Active account holds the key directly or through a role bundle. Any scope counts, except finance.* keys and schools.templates.manage, where only unscoped grants count (316): program-scoped finance does not reach org-wide finance, Xero or outreach. Use has_permission_for for a program check.';

-- ────────────────────────────────────────────────────────────
-- E. Roles count only for active accounts.
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.has_any_role(required_roles text[])
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid() AND u.is_active IS NOT FALSE
  )
  AND EXISTS (
    SELECT 1
    FROM public.user_roles ur
    JOIN public.roles r ON r.id = ur.role_id
    WHERE ur.user_id = auth.uid()
      AND r.name = ANY (required_roles)
      AND ur.scope_type IS NULL
  );
$$;

CREATE OR REPLACE FUNCTION public.has_role(
  required_role text,
  check_scope_type text DEFAULT NULL::text,
  check_scope_id uuid DEFAULT NULL::uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid() AND u.is_active IS NOT FALSE
  )
  AND EXISTS (
    SELECT 1
    FROM public.user_roles ur
    JOIN public.roles r ON r.id = ur.role_id
    WHERE ur.user_id = auth.uid()
      AND r.name = required_role
      AND (
        ur.scope_type IS NULL
        OR (check_scope_type IS NOT NULL
            AND ur.scope_type = check_scope_type
            AND ur.scope_id = check_scope_id)
      )
  );
$$;

-- is_admin keeps delegating, so it inherits the active check.
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT public.has_any_role(ARRAY['super_admin', 'admin']);
$$;

GRANT EXECUTE ON FUNCTION public.has_any_role(text[]) TO PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_role(text, text, uuid) TO PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_admin() TO PUBLIC, anon, authenticated, service_role;

-- ────────────────────────────────────────────────────────────
-- D. Template library writes.
--    Allowed: admin, OR an active caller with UNSCOPED schools.manage,
--    OR an active caller with UNSCOPED schools.templates.manage (Jack,
--    10 Nov 2026: a dedicated, org-wide-only key).
--    has_permission_for(key, NULL) = unscoped grant only (direct or via
--    an unscoped role), active accounts only (313). A program-scoped grant
--    of either key never counts here.
-- ────────────────────────────────────────────────────────────
INSERT INTO public.permissions (module, key, display_name, sort_order) VALUES
  ('schools', 'schools.templates.manage', 'Manage Application Templates (org-wide only)', 6)
ON CONFLICT (key) DO NOTHING;

-- The key is org-wide only: refuse to store it with a scope at all.
CREATE OR REPLACE FUNCTION public.user_permissions_unscoped_only_keys()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.scope_type IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.permissions p
        WHERE p.id = NEW.permission_id AND p.key = 'schools.templates.manage') THEN
    RAISE EXCEPTION 'schools.templates.manage can only be granted org-wide (no scope)'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.user_permissions_unscoped_only_keys() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS user_permissions_unscoped_only_keys ON public.user_permissions;
CREATE TRIGGER user_permissions_unscoped_only_keys
  BEFORE INSERT OR UPDATE OF permission_id, scope_type, scope_id ON public.user_permissions
  FOR EACH ROW
  EXECUTE FUNCTION public.user_permissions_unscoped_only_keys();

-- The one rule. Policies below and the app (RPC) use the same function.
CREATE OR REPLACE FUNCTION public.can_manage_application_templates()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT public.is_admin()
      OR public.has_permission_for('schools.manage', NULL::uuid)
      OR public.has_permission_for('schools.templates.manage', NULL::uuid);
$$;

GRANT EXECUTE ON FUNCTION public.can_manage_application_templates() TO PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public.can_manage_application_templates() IS
  'Template library writes (316): is_admin(), or an active account with an UNSCOPED schools.manage or schools.templates.manage grant (direct or via an unscoped role). Program-scoped grants never count.';

DROP POLICY IF EXISTS "Schools access can insert templates" ON public.application_templates;
CREATE POLICY "Schools access can insert templates"
  ON public.application_templates FOR INSERT
  WITH CHECK ((SELECT public.can_manage_application_templates()));

DROP POLICY IF EXISTS "Schools access can update templates" ON public.application_templates;
CREATE POLICY "Schools access can update templates"
  ON public.application_templates FOR UPDATE
  USING ((SELECT public.can_manage_application_templates()))
  WITH CHECK ((SELECT public.can_manage_application_templates()));

DROP POLICY IF EXISTS "Schools access can delete templates" ON public.application_templates;
CREATE POLICY "Schools access can delete templates"
  ON public.application_templates FOR DELETE
  USING ((SELECT public.can_manage_application_templates()));

DROP POLICY IF EXISTS "Schools access can insert template questions" ON public.application_template_questions;
CREATE POLICY "Schools access can insert template questions"
  ON public.application_template_questions FOR INSERT
  WITH CHECK ((SELECT public.can_manage_application_templates()));

DROP POLICY IF EXISTS "Schools access can delete template questions" ON public.application_template_questions;
CREATE POLICY "Schools access can delete template questions"
  ON public.application_template_questions FOR DELETE
  USING ((SELECT public.can_manage_application_templates()));

-- Template managers must also see the library to update or delete in it
-- (UPDATE / DELETE only reach visible rows). A holder of only
-- schools.templates.manage is not covered by has_schools_access(), so add
-- a permissive read policy on the same rule. Existing read policies stay.
DROP POLICY IF EXISTS "Template managers can read templates" ON public.application_templates;
CREATE POLICY "Template managers can read templates"
  ON public.application_templates FOR SELECT
  USING ((SELECT public.can_manage_application_templates()));

DROP POLICY IF EXISTS "Template managers can read template questions" ON public.application_template_questions;
CREATE POLICY "Template managers can read template questions"
  ON public.application_template_questions FOR SELECT
  USING ((SELECT public.can_manage_application_templates()));

-- SELECT policies ("Schools access can read templates" / "... template
-- questions", has_schools_access()) are deliberately unchanged.

-- ────────────────────────────────────────────────────────────
-- Department on INSERT: same normalisation as 315's UPDATE guard.
-- Spaces, tabs, newlines, VT, FF and NBSP alone become NULL; real values
-- are trimmed. Runs for every caller (service role included). Named to
-- sort before any other BEFORE INSERT trigger on users; the AFTER INSERT
-- roster sync (trg_sync_staff_department_ministry) sees the clean value.
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.users_normalise_department_on_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.department := nullif(btrim(NEW.department, E' \t\n\r\f\x0B\u00a0'), '');
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.users_normalise_department_on_insert() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS users_a_normalise_department_on_insert ON public.users;
CREATE TRIGGER users_a_normalise_department_on_insert
  BEFORE INSERT ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.users_normalise_department_on_insert();
