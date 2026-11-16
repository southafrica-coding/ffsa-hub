-- ============================================================
-- FFSA Hub — Migration 328: hide reference_requests.token
--
-- "Users can read own reference requests" (021) lets an applicant SELECT
-- their own rows. Supabase also grants table-wide SELECT to authenticated
-- (and sometimes anon). RLS chooses rows, not columns, so that pair returns
-- the `token` column. /api/public/references submits any pending reference
-- whose token is in the URL, so the applicant can file their own reference.
--
-- This revokes table-wide SELECT from authenticated, anon, and PUBLIC, then
-- grants authenticated every column except token. service_role is not
-- touched and still reads token for the referee form, invite mail, and
-- reminders. Those reads run on the admin client.
--
-- INSERT and UPDATE grants are left as they are. They do not reveal token.
-- RETURNING token — PostgREST `.select()` / `.select('*')` after an insert
-- or update — needs SELECT on token, which authenticated no longer has, so
-- the statement errors with permission denied instead of returning the
-- secret. Applicants have no INSERT or UPDATE policy on this table anyway.
-- A schools manager who already passes the UPDATE policy could still set
-- token to a value they chose; they cannot read the existing one back
-- through the user client.
--
-- No view, RPC, or SECURITY INVOKER function in this repo selects
-- reference_requests.token or reference_requests.*. A column added later
-- is invisible to authenticated until it is added to the GRANT below.
--
-- Idempotent. Not applied to production by the PR that adds this file.
-- ============================================================

BEGIN;

REVOKE SELECT ON TABLE public.reference_requests FROM PUBLIC;
REVOKE SELECT ON TABLE public.reference_requests FROM anon;
REVOKE SELECT ON TABLE public.reference_requests FROM authenticated;

GRANT SELECT (
  id,
  application_id,
  slot_id,
  referee_name,
  referee_email,
  status,
  relationship,
  known_duration,
  reference_text,
  form_data,
  submitted_at,
  email_sent_at,
  reminder_sent_at,
  created_at,
  updated_at
) ON TABLE public.reference_requests TO authenticated;

COMMIT;
