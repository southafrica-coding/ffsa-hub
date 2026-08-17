-- ============================================================
-- FFSA Hub — Migration 166: make the CRM views respect RLS
-- ============================================================
-- Numbered 166 deliberately: 164 and 165 are in flight on the
-- editorial-light redesign branch. This migration is independent of
-- those and can be applied before or after them, in any order.
--
-- THE PROBLEM
-- ------------------------------------------------------------
-- A Postgres view runs with the privileges of the role that OWNS it,
-- not the role querying it. A view over an RLS-protected table
-- therefore reads straight through and the table's policies never
-- run. Migration 049's header states the opposite —
--   "Views inherit RLS from underlying tables, so no extra policy
--    work is needed"
-- — and both CRM views were created on that assumption.
--
-- Supabase publishes every view in the `public` schema as a REST
-- endpoint, and `authenticated` holds SELECT on them by default. So
-- any signed-in account — including one with no contacts permission
-- whatsoever — could read these endpoints directly and get rows the
-- `contacts` policies (migrations 005 / 087) would otherwise refuse.
--
-- What was reachable:
--   v_contact_summary   — every contact's first_name, last_name,
--                         email, phone, marketing_status, owner_id,
--                         label slugs and activity counts.
--   v_campaign_audience — the resolved recipient list for a campaign
--                         (contact_id, email, names), which also
--                         reflects unsubscribes and suppressions.
--
-- THE FIX
-- ------------------------------------------------------------
-- security_invoker = true (PG15+, which Supabase runs) makes each
-- view execute as the CALLER, so the existing RLS on contacts,
-- contact_labels, activity_events, unsubscribes and
-- email_suppressions decides what each user sees. No policy is
-- added, changed or removed here — this only stops the views
-- bypassing the policies that already exist.
--
-- EXPECTED BEHAVIOUR CHANGE
-- ------------------------------------------------------------
-- Deliberately NON-destructive: nothing is dropped, no definition is
-- rewritten, so this is safe to roll back (see the bottom).
--
--   v_contact_summary   — no application code reads this view; it is
--                         referenced only as relationship metadata in
--                         the generated types. Nothing in the app can
--                         change. See the note at the bottom about
--                         retiring it entirely.
--   v_campaign_audience — read in two places:
--                          * campaign SENDING (services/campaign-send.ts)
--                            runs on the service-role client, which is
--                            exempt from RLS, so sending is unaffected.
--                          * the "N recipients" count on the campaign
--                            composer runs as the signed-in user. That
--                            count now honours the caller's contacts
--                            access. Anyone who can open Communications
--                            already holds a staff role or
--                            contacts.view, so it should not move — but
--                            this is the one number to eyeball after
--                            applying.
-- ============================================================

ALTER VIEW public.v_contact_summary   SET (security_invoker = true);
ALTER VIEW public.v_campaign_audience SET (security_invoker = true);

COMMENT ON VIEW public.v_contact_summary IS
  'One row per contact with aggregated label slugs and counts. security_invoker: runs as the caller, so contacts RLS applies. Not read by any application code as of migration 166.';

COMMENT ON VIEW public.v_campaign_audience IS
  'Resolved recipient list per campaign, minus unsubscribes and suppressions. security_invoker: runs as the caller, so contacts RLS applies. The send path uses the service-role client and is unaffected.';

-- ============================================================
-- Validation
-- ------------------------------------------------------------
--   -- 1. Both views now carry the flag:
--   SELECT relname, reloptions FROM pg_class
--   WHERE relname IN ('v_contact_summary', 'v_campaign_audience');
--   -- expect reloptions to contain security_invoker=true for both
--
--   -- 2. Who can reach these endpoints at all:
--   SELECT table_name, grantee, privilege_type
--   FROM information_schema.role_table_grants
--   WHERE table_name IN ('v_contact_summary', 'v_campaign_audience');
--
--   -- 3. The real test — sign in as a low-privilege account (a
--   --    student, no contacts permission) and call
--   --    /rest/v1/v_contact_summary?select=email
--   --    Before: rows come back. After: none.
--
--   -- 4. Open any campaign in the composer and confirm the
--   --    "N recipients" figure is unchanged.
-- ============================================================

-- ------------------------------------------------------------
-- ROLLBACK, if the recipient count moves unexpectedly:
--   ALTER VIEW public.v_campaign_audience SET (security_invoker = false);
-- (Re-opens the bypass on that view — treat as temporary.)
-- ------------------------------------------------------------

-- ------------------------------------------------------------
-- FOLLOW-UP, not done here because it is destructive:
-- v_contact_summary has no readers. Once you are satisfied nothing
-- external depends on it, it can be retired outright, which removes
-- the endpoint rather than merely securing it:
--   DROP VIEW public.v_contact_summary;
-- Its definition is preserved in migration 049 if it is ever wanted
-- back.
-- ------------------------------------------------------------
