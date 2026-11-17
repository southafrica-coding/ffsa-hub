-- ============================================================
-- FFSA Hub — Migration 330: staff-only SELECT on contact_labels
--
-- Migration 042 created "Auth users can read contact labels" with
-- USING (auth.uid() IS NOT NULL). Every signed-in account, including
-- portal users and applicants, can therefore read every contact_labels
-- row (contact_id and added_via, including 'application:<id>').
-- Later permission work (087 on contacts, 142 on labels) never
-- narrowed this policy.
--
-- SELECT now matches the live contacts SELECT policy from 087
-- ("Admins and staff can read all contacts"):
--   has_any_role(ARRAY['super_admin','admin','staff','events_admin'])
--   OR has_permission('contacts.view')
--   OR has_permission('contacts.read')
-- auth.uid() is wrapped in (SELECT ...) so the planner evaluates it
-- once per statement.
--
-- Not changed:
--   * "Admins and comms can manage contact labels" (042) stays. It is
--     FOR ALL, so it still grants SELECT to is_admin(), comms_admin
--     and events_admin, and it is the only INSERT/UPDATE/DELETE
--     policy. Those writes are not open to every authenticated user.
--     They also do not honor contacts.create / contacts.edit /
--     contacts.write / contacts.delete. Left as-is on purpose.
--   * public.labels. "Auth users can read labels" stays. Public
--     subscribe, the public form page, and the preferences page read
--     labels (via the service role). Not every reader is staff.
--
-- security_invoker views v_contact_summary and v_campaign_audience
-- (166, rebuilt in 187 and 234) keep running as the caller. A caller
-- who can SELECT contacts under 087 can SELECT contact_labels under
-- this policy, so the label join still returns rows for them. The
-- campaign send path uses the service role and bypasses RLS.
--
-- public.sync_org_people_contact_label (329) is SECURITY DEFINER and
-- does not depend on the caller's SELECT policy.
--
-- Idempotent: DROP POLICY IF EXISTS, then CREATE POLICY.
-- Not applied to any hosted database by the PR that adds this file.
-- ============================================================

BEGIN;

DROP POLICY IF EXISTS "Auth users can read contact labels" ON public.contact_labels;
DROP POLICY IF EXISTS "Staff can read contact labels" ON public.contact_labels;

CREATE POLICY "Staff can read contact labels"
  ON public.contact_labels
  FOR SELECT
  TO authenticated
  USING (
    (SELECT auth.uid()) IS NOT NULL
    AND (
      public.has_any_role(ARRAY['super_admin','admin','staff','events_admin'])
      OR public.has_permission('contacts.view')
      OR public.has_permission('contacts.read')
    )
  );

COMMIT;
