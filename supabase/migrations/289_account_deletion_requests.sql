-- ============================================================
-- FFSA Hub — Migration 289: "account deletion requests"
-- ============================================================
-- Safe to run twice: the table, indexes, function and trigger are
-- IF NOT EXISTS / CREATE OR REPLACE, and every policy is dropped first.
--
-- WHY: Apple (App Store guideline 5.1.1(v)) requires an app with accounts to
-- let people START deleting their account inside the app, and Google Play
-- requires both an in-app path and a web page for the same request. Hub
-- accounts are invite-only and are deleted by an admin from Users
-- (/api/admin/delete-user, which keeps applications and enrolments: 200, 207).
-- FFSA must also keep some records by law (receipts, payments, donor
-- statements, school records), so a person never deletes themselves: they
-- file a REQUEST, and an admin completes it with the existing tooling.
--
-- WHAT IT ADDS:
--   * public.account_deletion_requests: one row per request. At most ONE open
--     request per person (partial unique index), so asking twice returns the
--     first request instead of a duplicate.
--   * A trigger that stops a non-admin changing anything on their row except
--     cancelling it (status open -> cancelled, cancelled_at).
--
-- WHO CAN DO WHAT (RLS on, no anon access at all):
--   * A signed-in person: read their own rows, file a request for themselves
--     (status 'open' only), cancel their own open request.
--   * Admins (public.is_admin(): super_admin, admin — the same people who see
--     Users and can run delete-user): read and update every request.
--   * Nobody deletes rows through the API: the request is the record that the
--     deletion was asked for and done.
--
-- WHAT HAPPENS WHEN THE PERSON IS DELETED: user_id becomes NULL (ON DELETE
-- SET NULL) and the email / name snapshot stays, so there is proof the
-- request was honoured. Decide how long to keep these (see the PR).
--
-- ORDER: code and migration can ship in either order. Until this is applied
-- POST /api/account/deletion-request still emails the admins and the person
-- (answering 202 recorded:false), GET answers "no open request" and DELETE
-- asks the person to contact the office.
--
-- ROLLBACK (nothing else depends on it):
--   DROP TABLE IF EXISTS public.account_deletion_requests;
--   DROP FUNCTION IF EXISTS public.account_deletion_requests_guard();
-- ============================================================


-- ────────────────────────────────────────────────────────────
-- 1. Table
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.account_deletion_requests (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid        REFERENCES public.users (id) ON DELETE SET NULL,
  -- Snapshot at request time, so the row still says who asked after the
  -- account itself is gone.
  email        text,
  full_name    text,
  reason       text        CHECK (reason IS NULL OR char_length(reason) <= 1000),
  source       text        NOT NULL DEFAULT 'web' CHECK (source IN ('app', 'web')),
  status       text        NOT NULL DEFAULT 'open'
                           CHECK (status IN ('open', 'cancelled', 'completed', 'declined')),
  requested_at timestamptz NOT NULL DEFAULT now(),
  cancelled_at timestamptz,
  -- Filled in by the admin who handles it.
  handled_at   timestamptz,
  handled_by   uuid        REFERENCES public.users (id) ON DELETE SET NULL,
  admin_note   text
);

-- One open request per person: the API's idempotency rests on this.
CREATE UNIQUE INDEX IF NOT EXISTS account_deletion_requests_one_open
  ON public.account_deletion_requests (user_id)
  WHERE status = 'open';

-- The admin queue (open first, oldest first).
CREATE INDEX IF NOT EXISTS account_deletion_requests_status_idx
  ON public.account_deletion_requests (status, requested_at);


-- ────────────────────────────────────────────────────────────
-- 2. Guard: a person may only cancel their own open request
-- ────────────────────────────────────────────────────────────
-- RLS decides WHICH rows someone may update; it can't say which columns may
-- change. Admins may change anything; everyone else may only move
-- open -> cancelled and stamp cancelled_at.
CREATE OR REPLACE FUNCTION public.account_deletion_requests_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF public.is_admin() THEN
    RETURN NEW;
  END IF;
  IF OLD.status <> 'open'
     OR NEW.status <> 'cancelled'
     OR NEW.id IS DISTINCT FROM OLD.id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.email IS DISTINCT FROM OLD.email
     OR NEW.full_name IS DISTINCT FROM OLD.full_name
     OR NEW.reason IS DISTINCT FROM OLD.reason
     OR NEW.source IS DISTINCT FROM OLD.source
     OR NEW.requested_at IS DISTINCT FROM OLD.requested_at
     OR NEW.handled_at IS DISTINCT FROM OLD.handled_at
     OR NEW.handled_by IS DISTINCT FROM OLD.handled_by
     OR NEW.admin_note IS DISTINCT FROM OLD.admin_note THEN
    RAISE EXCEPTION 'You can only cancel your own open request.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS account_deletion_requests_guard ON public.account_deletion_requests;
CREATE TRIGGER account_deletion_requests_guard
  BEFORE UPDATE ON public.account_deletion_requests
  FOR EACH ROW EXECUTE FUNCTION public.account_deletion_requests_guard();


-- ────────────────────────────────────────────────────────────
-- 3. RLS
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.account_deletion_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "account_deletion_requests_select" ON public.account_deletion_requests;
CREATE POLICY "account_deletion_requests_select" ON public.account_deletion_requests
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS "account_deletion_requests_insert_own" ON public.account_deletion_requests;
CREATE POLICY "account_deletion_requests_insert_own" ON public.account_deletion_requests
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND status = 'open'
    AND cancelled_at IS NULL
    AND handled_at IS NULL
    AND handled_by IS NULL
    AND admin_note IS NULL
  );

DROP POLICY IF EXISTS "account_deletion_requests_cancel_own" ON public.account_deletion_requests;
CREATE POLICY "account_deletion_requests_cancel_own" ON public.account_deletion_requests
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid() AND status = 'open')
  WITH CHECK (user_id = auth.uid() AND status = 'cancelled');

DROP POLICY IF EXISTS "account_deletion_requests_admin_update" ON public.account_deletion_requests;
CREATE POLICY "account_deletion_requests_admin_update" ON public.account_deletion_requests
  FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- No DELETE policy: rows are never removed through the API.


-- ────────────────────────────────────────────────────────────
-- 4. Grants (minimal; anon gets nothing)
-- ────────────────────────────────────────────────────────────
REVOKE ALL ON TABLE public.account_deletion_requests FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.account_deletion_requests TO authenticated;
GRANT ALL ON TABLE public.account_deletion_requests TO service_role;
