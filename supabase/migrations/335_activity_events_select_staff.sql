-- ============================================================
-- FFSA Hub — Migration 335: staff-only SELECT on activity_events
--
-- Migration 043 created "Auth users can read activity events" with
-- USING (auth.uid() IS NOT NULL). Every signed-in account — students,
-- applicants, portal users — can therefore read every contact's
-- timeline: notes (note_added), emails sent and opened, form
-- submissions, follow-up notes, ticket purchases. Later permission
-- work never narrowed it. Same class of bug 330 fixed for
-- contact_labels; found while building the Training check-ins (334).
--
-- SELECT now matches the live contacts SELECT policy from 087
-- ("Admins and staff can read all contacts"), as 330 did:
--   has_any_role(ARRAY['super_admin','admin','staff','events_admin'])
--   OR has_permission('contacts.view')
--   OR has_permission('contacts.read')
-- plus everyone the 043 INSERT policy lets write
--   (is_admin(), comms_admin, events_admin)
-- so logActivity()'s insert(...).select() keeps returning its row
-- for every caller who can insert today.
--
-- Who reads it, checked 18 Nov 2026:
--   * contacts/[id] page (user client) — staff with contacts access.
--   * person quick view, follow-up, scheduling, inbound mail, Resend
--     webhook, public subscribe/form, preferences — service role,
--     bypasses RLS.
--   * security_invoker views from 049/166 keep running as the caller;
--     a caller who can SELECT contacts can SELECT these rows.
--   * The phone app does not read activity_events.
--
-- Not changed: the INSERT policy, and no UPDATE/DELETE (append-only).
-- Idempotent. Not applied to any hosted database by the PR that adds
-- this file. Rollback: supabase/rollbacks/335_activity_events_select_staff.sql.
-- ============================================================

BEGIN;

DROP POLICY IF EXISTS "Auth users can read activity events" ON public.activity_events;
DROP POLICY IF EXISTS "Staff can read activity events" ON public.activity_events;

CREATE POLICY "Staff can read activity events"
  ON public.activity_events
  FOR SELECT
  TO authenticated
  USING (
    (SELECT auth.uid()) IS NOT NULL
    AND (
      public.has_any_role(ARRAY['super_admin','admin','staff','events_admin'])
      OR public.has_permission('contacts.view')
      OR public.has_permission('contacts.read')
      OR public.is_admin()
      OR public.has_role('comms_admin')
    )
  );

REVOKE ALL ON TABLE public.activity_events FROM anon;

COMMIT;
