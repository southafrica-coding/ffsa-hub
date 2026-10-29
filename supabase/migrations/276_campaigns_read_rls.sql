-- Migration 254: campaigns / campaign_recipients reads limited to Communications
--
-- Migration 045 opened SELECT on both tables to any authenticated user
-- ("auth.uid() IS NOT NULL"), and 091 left those read policies alone. So any
-- signed-in student or staff member could read every campaign body and every
-- recipient row (email address + open/click/bounce history) straight from
-- PostgREST, whatever the /communications page gate says.
--
-- This narrows SELECT to the same people requireModuleAccess(…,
-- "communications") lets through: super_admin / admin, the comms_admin role,
-- and anyone holding any communications-module permission, directly or via a
-- role bundle (user_roles -> role_permissions).
--
-- Unaffected: sending, the Resend webhook, the scheduled-send cron and the
-- contact email-history card all use the service-role client (RLS bypassed).
-- v_campaign_stats is security_invoker (migration 174), so it narrows with
-- campaign_recipients, which is what we want.
--
-- Write (FOR ALL) policies from migration 091 are unchanged.

-- Direct or role-bundle grant of any permission in the given module.
-- Mirrors the non-bypass branches of requireModuleAccess (src/lib/require-permission.ts).
CREATE OR REPLACE FUNCTION public.has_module_permission(required_module text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_permissions up
    JOIN public.permissions p ON p.id = up.permission_id
    WHERE up.user_id = auth.uid()
      AND p.module = required_module
  )
  OR EXISTS (
    SELECT 1
    FROM public.user_roles ur
    JOIN public.role_permissions rp ON rp.role_id = ur.role_id
    JOIN public.permissions p ON p.id = rp.permission_id
    WHERE ur.user_id = auth.uid()
      AND p.module = required_module
  );
$$;

REVOKE ALL ON FUNCTION public.has_module_permission(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_module_permission(text) TO authenticated;

-- ============ campaigns ============
DROP POLICY IF EXISTS "Auth users can read campaigns" ON public.campaigns;
DROP POLICY IF EXISTS "Communications can read campaigns" ON public.campaigns;
CREATE POLICY "Communications can read campaigns"
  ON public.campaigns FOR SELECT
  TO authenticated
  USING (
    public.is_admin() OR public.has_role('comms_admin')
    OR public.has_module_permission('communications')
  );

-- ============ campaign_recipients ============
DROP POLICY IF EXISTS "Auth users can read campaign recipients" ON public.campaign_recipients;
DROP POLICY IF EXISTS "Communications can read campaign recipients" ON public.campaign_recipients;
CREATE POLICY "Communications can read campaign recipients"
  ON public.campaign_recipients FOR SELECT
  TO authenticated
  USING (
    public.is_admin() OR public.has_role('comms_admin')
    OR public.has_module_permission('communications')
  );

-- Verify (run as a student / non-comms user via the app, or with
-- SET request.jwt.claims): both should return 0 rows.
--   SELECT count(*) FROM public.campaigns;
--   SELECT count(*) FROM public.campaign_recipients;
-- And the policies in place:
--   SELECT tablename, policyname, cmd FROM pg_policies
--   WHERE tablename IN ('campaigns', 'campaign_recipients') ORDER BY 1, 2;
