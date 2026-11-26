-- ============================================================
-- FFSA Hub — Migration 421: People Manager (staff leave / time off)
-- ============================================================
-- Depends on 318 (dept_* helpers, staff_ministries,
-- staff_ministry_members) and 365 (public.sa_public_holiday). Applied by
-- hand, on prod only with Jack's explicit OK.
--
-- Department-agnostic: every row is keyed on department_id =
-- staff_ministries.id, like L10 (416). No department is named anywhere.
--
-- Jack's decisions (26 Nov 2026), built in:
--   * Leave types with yearly guideline days: annual 15, sick 5,
--     family 3, study 5; ministry_travel and unpaid uncapped (null).
--     Seeded once as base defaults (department_id NULL), which apply to
--     every department, including ones created later. A department
--     overrides a type by adding its own row with the same slug, or adds
--     its own type with a new slug.
--   * The leave year is the calendar year (starts 1 January).
--   * Only weekdays count. SA public holidays inside a range do not
--     count: public.sa_public_holiday (365, by rule) plus
--     leave_declared_holidays (one-off declared days, e.g. election days).
--   * Half days: the first day may be 'pm' (from the afternoon) and the
--     last day 'am' (until lunch); a one-day request may be 'am' or 'pm'.
--     A counted half day is 0.5. days_count is numeric(4,1).
--   * Block-outs: a person's unavailable whole days. No approval, never
--     use leave. Their own table, leave_blockouts.
--   * Approval: any active leader of the request's department, or an
--     unscoped admin. Nobody decides their own request, so a leader's
--     leave goes to another leader of that department, or to an admin
--     when they are the sole leader. The first decision settles it:
--     pending -> approved | declined happens once, stamps decided_by /
--     decided_at, and is then locked. The requester may cancel while
--     pending, or an approved request before its first day.
--
-- Guidelines are guidance only. Nothing here blocks a request for being
-- over the guideline.
--
-- Tables
--   leave_types              base defaults + department overrides
--   leave_declared_holidays  one-off public holidays (admin-managed)
--   leave_requests           one request = one department, one type, a
--                            date range; days frozen at insert
--   leave_blockouts          personal unavailable days
-- View
--   leave_balances           used / pending / remaining / over per
--                            person, department, leave year and type
--                            (security_invoker)
-- Error codes (RAISE message = code)
--   42501 leave_request_not_signed_in      no auth.uid() and not the server
--   42501 leave_request_not_requester      requester_id is not the caller
--   42501 leave_request_not_member         requester not an active member
--   42501 leave_request_must_start_pending insert with a decision/cancel set
--   42501 leave_request_immutable          a frozen column changed
--   42501 leave_request_server_only        slack_notify written by a user
--   42501 leave_request_self_decision      decider = requester
--   42501 leave_request_not_approver       decider not eligible
--   42501 leave_request_already_decided    second decision / un-decide
--   42501 leave_request_locked             declined/cancelled, or approved
--                                          leave already started
--   42501 leave_request_cancel_not_allowed cancel by anyone but requester
--   42501 leave_blockout_immutable         user_id / created_at changed
--   23514 leave_request_type_not_available type inactive, overridden or
--                                          another department's
--   23514 leave_request_bad_range          dates/parts do not fit together
--   23514 leave_request_no_working_days    the range counts 0 days
--   23514 leave_request_decline_note_required
--   22023 leave_days_bad_range             helper called with bad args
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 0. Dependencies
-- ────────────────────────────────────────────────────────────
DO $dep$
BEGIN
  IF to_regprocedure('public.sa_public_holiday(date)') IS NULL THEN
    RAISE EXCEPTION '421 needs public.sa_public_holiday(date) from migration 365';
  END IF;
  IF to_regprocedure('public.dept_is_ministry_member(uuid, boolean)') IS NULL
     OR to_regprocedure('public.dept_caller_is_active()') IS NULL THEN
    RAISE EXCEPTION '421 needs the dept_* helpers from migration 318';
  END IF;
END
$dep$;

-- ────────────────────────────────────────────────────────────
-- 1. Tables
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.leave_types (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id          uuid REFERENCES public.staff_ministries (id) ON DELETE CASCADE,
  slug                   text NOT NULL CHECK (slug ~ '^[a-z][a-z0-9_]{1,39}$'),
  label                  text NOT NULL CHECK (char_length(btrim(label)) BETWEEN 1 AND 60),
  sort_order             integer NOT NULL DEFAULT 0,
  is_active              boolean NOT NULL DEFAULT true,
  annual_allowance_days  numeric(4,1) CHECK (annual_allowance_days >= 0 AND annual_allowance_days <= 366
                                             AND annual_allowance_days * 2 = trunc(annual_allowance_days * 2)),
  updated_by             uuid REFERENCES public.users (id) ON DELETE SET NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS leave_types_default_slug_key
  ON public.leave_types (slug) WHERE department_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS leave_types_department_slug_key
  ON public.leave_types (department_id, slug) WHERE department_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS leave_types_updated_by_idx ON public.leave_types (updated_by);

COMMENT ON TABLE public.leave_types IS
  'Leave types. department_id NULL = base default for every department; a department row with the same slug overrides it for that department.';
COMMENT ON COLUMN public.leave_types.annual_allowance_days IS
  'Yearly guideline days. NULL = uncapped (still counted and shown). Guidance only; nothing blocks a request.';

CREATE TABLE IF NOT EXISTS public.leave_declared_holidays (
  day         date PRIMARY KEY,
  name        text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 100),
  created_by  uuid REFERENCES public.users (id) ON DELETE SET NULL DEFAULT auth.uid(),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS leave_declared_holidays_created_by_idx ON public.leave_declared_holidays (created_by);

COMMENT ON TABLE public.leave_declared_holidays IS
  'One-off SA public holidays (for example election days) on top of the rule-based public.sa_public_holiday. They do not count as leave days.';

CREATE TABLE IF NOT EXISTS public.leave_requests (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id     uuid NOT NULL REFERENCES public.staff_ministries (id) ON DELETE RESTRICT,
  requester_id      uuid NOT NULL DEFAULT auth.uid() REFERENCES public.users (id) ON DELETE CASCADE,
  leave_type_id     uuid NOT NULL REFERENCES public.leave_types (id) ON DELETE RESTRICT,
  start_date        date NOT NULL,
  end_date          date NOT NULL,
  start_part        text NOT NULL DEFAULT 'full' CHECK (start_part IN ('full', 'am', 'pm')),
  end_part          text NOT NULL DEFAULT 'full' CHECK (end_part IN ('full', 'am', 'pm')),
  days_count        numeric(4,1) NOT NULL DEFAULT 0 CHECK (days_count >= 0),
  days_by_year      jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(days_by_year) = 'object'),
  notes             text CHECK (char_length(notes) <= 2000),
  covering_user_id  uuid REFERENCES public.users (id) ON DELETE SET NULL,
  covering_note     text CHECK (char_length(covering_note) <= 500),
  status            text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'approved', 'declined', 'cancelled')),
  decided_by        uuid REFERENCES public.users (id) ON DELETE SET NULL,
  decided_at        timestamptz,
  decision_note     text CHECK (char_length(decision_note) <= 1000),
  cancelled_by      uuid REFERENCES public.users (id) ON DELETE SET NULL,
  cancelled_at      timestamptz,
  slack_notify      jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(slack_notify) = 'array'),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT leave_requests_dates_check CHECK (end_date >= start_date AND end_date - start_date <= 730),
  CONSTRAINT leave_requests_parts_check CHECK (
    (start_date = end_date AND start_part = end_part)
    OR (start_date < end_date AND start_part IN ('full', 'pm') AND end_part IN ('full', 'am'))
  ),
  CONSTRAINT leave_requests_cover_check CHECK (covering_user_id IS DISTINCT FROM requester_id),
  CONSTRAINT leave_requests_decision_check CHECK (
    (status = 'pending' AND decided_at IS NULL AND cancelled_at IS NULL)
    OR (status IN ('approved', 'declined') AND decided_at IS NOT NULL AND cancelled_at IS NULL)
    OR (status = 'cancelled' AND cancelled_at IS NOT NULL)
  ),
  CONSTRAINT leave_requests_decline_note_check CHECK (
    status <> 'declined' OR char_length(btrim(decision_note)) > 0
  )
);

CREATE INDEX IF NOT EXISTS leave_requests_department_dates_idx
  ON public.leave_requests (department_id, start_date, end_date);
CREATE INDEX IF NOT EXISTS leave_requests_department_pending_idx
  ON public.leave_requests (department_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS leave_requests_requester_dates_idx
  ON public.leave_requests (requester_id, start_date);
CREATE INDEX IF NOT EXISTS leave_requests_leave_type_id_idx ON public.leave_requests (leave_type_id);
CREATE INDEX IF NOT EXISTS leave_requests_covering_user_id_idx
  ON public.leave_requests (covering_user_id) WHERE covering_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS leave_requests_decided_by_idx
  ON public.leave_requests (decided_by) WHERE decided_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS leave_requests_cancelled_by_idx
  ON public.leave_requests (cancelled_by) WHERE cancelled_by IS NOT NULL;

COMMENT ON TABLE public.leave_requests IS
  'Staff leave requests. One department, one type, one date range. days_count/days_by_year are computed by the server at insert and never change.';
COMMENT ON COLUMN public.leave_requests.start_part IS
  'full, or pm = off from the afternoon of start_date. A one-day request uses am or pm on both parts.';
COMMENT ON COLUMN public.leave_requests.end_part IS
  'full, or am = off until lunch on end_date.';
COMMENT ON COLUMN public.leave_requests.days_by_year IS
  'Counted days split by leave year, e.g. {"2026": 3, "2027": 2.5}. Weekdays only, public holidays excluded.';
COMMENT ON COLUMN public.leave_requests.slack_notify IS
  'Server-written Slack delivery log: [{leader_id, channel_id, ts, ok, error}]. Signed-in users cannot change it.';

CREATE TABLE IF NOT EXISTS public.leave_blockouts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL DEFAULT auth.uid() REFERENCES public.users (id) ON DELETE CASCADE,
  department_id  uuid REFERENCES public.staff_ministries (id) ON DELETE CASCADE,
  start_date     date NOT NULL,
  end_date       date NOT NULL,
  reason         text CHECK (char_length(reason) <= 500),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT leave_blockouts_dates_check CHECK (end_date >= start_date AND end_date - start_date <= 366)
);
CREATE INDEX IF NOT EXISTS leave_blockouts_user_dates_idx ON public.leave_blockouts (user_id, start_date);
CREATE INDEX IF NOT EXISTS leave_blockouts_department_id_idx
  ON public.leave_blockouts (department_id) WHERE department_id IS NOT NULL;

COMMENT ON TABLE public.leave_blockouts IS
  'A person''s unavailable whole days. No approval and never counted as leave. department_id is optional context.';

-- ────────────────────────────────────────────────────────────
-- 2. Helpers
-- ────────────────────────────────────────────────────────────
-- SECURITY DEFINER, search_path '', so policies and the guard can read
-- memberships and roles without the caller passing their RLS. The
-- p_user forms let the guard check a decided_by the server supplies.

CREATE OR REPLACE FUNCTION public.leave_user_is_active(p_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users u
     WHERE u.id = p_user AND u.is_active IS NOT FALSE
  );
$$;

-- Unscoped admin or super_admin (same rule as has_any_role / is_admin),
-- and active.
CREATE OR REPLACE FUNCTION public.leave_user_is_admin(p_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT public.leave_user_is_active(p_user)
     AND EXISTS (
       SELECT 1
         FROM public.user_roles ur
         JOIN public.roles r ON r.id = ur.role_id
        WHERE ur.user_id = p_user
          AND r.name IN ('super_admin', 'admin')
          AND ur.scope_type IS NULL
     );
$$;

-- Active member (any role, or leaders only) of an active department.
CREATE OR REPLACE FUNCTION public.leave_user_in_department(
  p_user uuid,
  p_department_id uuid,
  p_leaders_only boolean DEFAULT false
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT public.leave_user_is_active(p_user)
     AND EXISTS (
       SELECT 1
         FROM public.staff_ministry_members mm
         JOIN public.staff_ministries sm ON sm.id = mm.staff_ministry_id
        WHERE mm.staff_ministry_id = p_department_id
          AND mm.user_id = p_user
          AND mm.status = 'active'
          AND sm.is_active
          AND (NOT p_leaders_only OR mm.member_role = 'leader')
     );
$$;

-- The approver rule. p_user may decide a request by p_requester in
-- p_department when p_user is not the requester and is an active leader
-- of that department or an active unscoped admin. A sole leader's own
-- request therefore falls to admins.
CREATE OR REPLACE FUNCTION public.leave_user_can_decide(
  p_department_id uuid,
  p_requester_id uuid,
  p_user uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p_user IS NOT NULL
     AND p_user IS DISTINCT FROM p_requester_id
     AND (public.leave_user_in_department(p_user, p_department_id, true)
          OR public.leave_user_is_admin(p_user));
$$;

-- Caller forms for policies.
CREATE OR REPLACE FUNCTION public.leave_can_decide(p_department_id uuid, p_requester_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT public.leave_user_can_decide(p_department_id, p_requester_id, auth.uid());
$$;

-- Read a request: the requester, a leader of its department, an admin.
CREATE OR REPLACE FUNCTION public.leave_can_read_request(p_department_id uuid, p_requester_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT public.dept_caller_is_active()
     AND (p_requester_id = auth.uid()
          OR public.dept_is_ministry_leader(p_department_id)
          OR public.is_admin());
$$;

-- See a person's block-outs: themselves, an admin, or a leader of any
-- department the person is an active member of.
CREATE OR REPLACE FUNCTION public.leave_can_view_person(p_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT public.dept_caller_is_active()
     AND (p_user = auth.uid()
          OR public.is_admin()
          OR EXISTS (
            SELECT 1
              FROM public.staff_ministry_members mm
             WHERE mm.user_id = p_user
               AND mm.status = 'active'
               AND public.dept_is_ministry_leader(mm.staff_ministry_id)
          ));
$$;

-- Write leave types: base defaults are admin-only; a department's own
-- rows are admin or a leader of that department.
CREATE OR REPLACE FUNCTION public.leave_can_manage_types(p_department_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT public.dept_caller_is_active()
     AND (public.is_admin()
          OR (p_department_id IS NOT NULL AND public.dept_is_ministry_leader(p_department_id)));
$$;

CREATE OR REPLACE FUNCTION public.leave_caller_is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT public.dept_caller_is_active() AND public.is_admin();
$$;

-- Effective types for one department: its own rows, plus base defaults
-- it has not overridden. Inactive rows are returned (is_active false) so
-- an override can switch a default off.
CREATE OR REPLACE FUNCTION public.leave_effective_types(p_department_id uuid)
RETURNS TABLE (
  id uuid,
  department_id uuid,
  slug text,
  label text,
  sort_order integer,
  is_active boolean,
  annual_allowance_days numeric,
  is_override boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT t.id, t.department_id, t.slug, t.label, t.sort_order, t.is_active,
         t.annual_allowance_days, t.department_id IS NOT NULL
    FROM public.leave_types t
   WHERE (public.dept_caller_is_active() OR auth.uid() IS NULL)
     AND (t.department_id = p_department_id
          OR (t.department_id IS NULL
              AND NOT EXISTS (
                SELECT 1 FROM public.leave_types o
                 WHERE o.department_id = p_department_id AND o.slug = t.slug)));
$$;

-- A request may use a type only if it is that department's effective,
-- active row for its slug.
CREATE OR REPLACE FUNCTION public.leave_type_is_available(p_department_id uuid, p_leave_type_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.leave_types t
     WHERE t.id = p_leave_type_id
       AND t.is_active
       AND (t.department_id = p_department_id
            OR (t.department_id IS NULL
                AND NOT EXISTS (
                  SELECT 1 FROM public.leave_types o
                   WHERE o.department_id = p_department_id AND o.slug = t.slug)))
  );
$$;

CREATE OR REPLACE FUNCTION public.leave_is_public_holiday(p_day date)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT public.sa_public_holiday(p_day)
      OR EXISTS (SELECT 1 FROM public.leave_declared_holidays h WHERE h.day = p_day);
$$;

-- Counted days split by leave year (calendar year). Weekdays only,
-- public holidays excluded, a part-day start/end counts 0.5.
CREATE OR REPLACE FUNCTION public.leave_days_by_year(
  p_start date,
  p_end date,
  p_start_part text DEFAULT 'full',
  p_end_part text DEFAULT 'full'
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  res jsonb;
BEGIN
  IF p_start IS NULL OR p_end IS NULL OR p_end < p_start OR p_end - p_start > 730
     OR p_start_part IS NULL OR p_end_part IS NULL
     OR NOT ((p_start = p_end AND p_start_part = p_end_part AND p_start_part IN ('full', 'am', 'pm'))
             OR (p_start < p_end AND p_start_part IN ('full', 'pm') AND p_end_part IN ('full', 'am'))) THEN
    RAISE EXCEPTION 'leave_days_bad_range'
      USING ERRCODE = '22023',
            DETAIL = 'end >= start, at most 730 days apart; start part full|pm and end part full|am, or one day with matching parts.';
  END IF;

  SELECT COALESCE(jsonb_object_agg(y, d ORDER BY y), '{}'::jsonb)
    INTO res
    FROM (
      SELECT extract(year FROM g.d)::int::text AS y,
             sum(CASE
                   WHEN g.d::date = p_start AND p_start_part <> 'full' THEN 0.5
                   WHEN g.d::date = p_end AND p_end_part <> 'full' THEN 0.5
                   ELSE 1
                 END)::numeric(4,1) AS d
        FROM generate_series(p_start, p_end, interval '1 day') AS g(d)
       WHERE extract(isodow FROM g.d) < 6
         AND NOT public.leave_is_public_holiday(g.d::date)
       GROUP BY 1
    ) s;
  RETURN res;
END;
$$;

CREATE OR REPLACE FUNCTION public.leave_working_days(
  p_start date,
  p_end date,
  p_start_part text DEFAULT 'full',
  p_end_part text DEFAULT 'full'
)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(sum(v::numeric), 0)::numeric(4,1)
    FROM jsonb_each_text(public.leave_days_by_year(p_start, p_end, p_start_part, p_end_part)) AS e(k, v);
$$;

-- Who should be asked: leaders of the department other than the
-- requester; if none, active admins (never the requester). For the Hub
-- server's Slack fan-out.
CREATE OR REPLACE FUNCTION public.leave_request_approvers(p_request_id uuid)
RETURNS TABLE (user_id uuid, via text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH r AS (
    SELECT lr.department_id, lr.requester_id FROM public.leave_requests lr WHERE lr.id = p_request_id
  ), leaders AS (
    SELECT DISTINCT mm.user_id
      FROM r
      JOIN public.staff_ministry_members mm ON mm.staff_ministry_id = r.department_id
     WHERE mm.user_id <> r.requester_id
       AND public.leave_user_in_department(mm.user_id, r.department_id, true)
  )
  SELECT l.user_id, 'leader'::text FROM leaders l
  UNION ALL
  SELECT DISTINCT ur.user_id, 'admin'::text
    FROM r
    JOIN public.user_roles ur ON ur.user_id <> r.requester_id
   WHERE NOT EXISTS (SELECT 1 FROM leaders)
     AND public.leave_user_is_admin(ur.user_id);
$$;

-- "Also away": department members' pending/approved leave (any
-- department) and block-outs overlapping a range. Dates and status only:
-- no type, notes or reasons (sick leave stays private). For active
-- members and leaders of the department, and admins.
CREATE OR REPLACE FUNCTION public.leave_department_away(
  p_department_id uuid,
  p_from date,
  p_to date
)
RETURNS TABLE (
  user_id uuid,
  source text,
  status text,
  start_date date,
  end_date date,
  start_part text,
  end_part text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH ok AS (
    SELECT public.dept_caller_is_active()
       AND (public.dept_is_ministry_member(p_department_id) OR public.is_admin())
       AND p_from IS NOT NULL AND p_to IS NOT NULL
       AND p_to >= p_from AND p_to - p_from <= 366 AS allowed
  ), people AS (
    SELECT mm.user_id
      FROM public.staff_ministry_members mm
     WHERE mm.staff_ministry_id = p_department_id AND mm.status = 'active'
  )
  SELECT lr.requester_id, 'leave'::text, lr.status, lr.start_date, lr.end_date, lr.start_part, lr.end_part
    FROM public.leave_requests lr
    JOIN people p ON p.user_id = lr.requester_id
   WHERE (SELECT allowed FROM ok)
     AND lr.status IN ('pending', 'approved')
     AND lr.start_date <= p_to AND lr.end_date >= p_from
  UNION ALL
  SELECT b.user_id, 'blockout'::text, NULL::text, b.start_date, b.end_date, 'full'::text, 'full'::text
    FROM public.leave_blockouts b
    JOIN people p ON p.user_id = b.user_id
   WHERE (SELECT allowed FROM ok)
     AND b.start_date <= p_to AND b.end_date >= p_from;
$$;

-- ────────────────────────────────────────────────────────────
-- 3. Request guard
-- ────────────────────────────────────────────────────────────
-- SECURITY INVOKER so current_user is the real caller role. A signed-in
-- caller acts as auth.uid() and is checked with the caller-form helpers;
-- the server (service_role, no auth.uid()) must name requester_id /
-- decided_by / cancelled_by, and the same rules are checked against that
-- person with the p_user forms (which signed-in users cannot call).

CREATE OR REPLACE FUNCTION public.leave_requests_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_server  boolean := auth.uid() IS NULL AND current_user IN ('service_role', 'postgres', 'supabase_admin');
  v_actor   uuid;
  v_ok      boolean;
  v_today   date := (now() AT TIME ZONE 'Africa/Johannesburg')::date;
BEGIN
  IF v_uid IS NULL AND NOT v_server THEN
    RAISE EXCEPTION 'leave_request_not_signed_in' USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF v_uid IS NOT NULL AND NEW.requester_id IS DISTINCT FROM v_uid THEN
      RAISE EXCEPTION 'leave_request_not_requester'
        USING ERRCODE = '42501', DETAIL = 'You can only request leave for yourself.';
    END IF;
    IF v_uid IS NOT NULL THEN
      v_ok := public.dept_is_ministry_member(NEW.department_id);
    ELSE
      v_ok := public.leave_user_in_department(NEW.requester_id, NEW.department_id, false);
    END IF;
    IF NOT v_ok THEN
      RAISE EXCEPTION 'leave_request_not_member'
        USING ERRCODE = '42501', DETAIL = 'The requester must be an active member of the department.';
    END IF;
    IF NEW.status <> 'pending' OR NEW.decided_by IS NOT NULL OR NEW.decided_at IS NOT NULL
       OR NEW.decision_note IS NOT NULL OR NEW.cancelled_by IS NOT NULL OR NEW.cancelled_at IS NOT NULL THEN
      RAISE EXCEPTION 'leave_request_must_start_pending' USING ERRCODE = '42501';
    END IF;
    IF NOT v_server AND NEW.slack_notify IS DISTINCT FROM '[]'::jsonb THEN
      RAISE EXCEPTION 'leave_request_server_only'
        USING ERRCODE = '42501', DETAIL = 'slack_notify is written by the Hub server.';
    END IF;
    IF NOT public.leave_type_is_available(NEW.department_id, NEW.leave_type_id) THEN
      RAISE EXCEPTION 'leave_request_type_not_available'
        USING ERRCODE = '23514', DETAIL = 'Use an active leave type from leave_effective_types for this department.';
    END IF;
    BEGIN
      NEW.days_by_year := public.leave_days_by_year(NEW.start_date, NEW.end_date, NEW.start_part, NEW.end_part);
    EXCEPTION WHEN invalid_parameter_value THEN
      RAISE EXCEPTION 'leave_request_bad_range'
        USING ERRCODE = '23514',
              DETAIL = 'end_date >= start_date, at most 730 days; start_part full|pm and end_part full|am, or one day with matching parts.';
    END;
    SELECT COALESCE(sum(v::numeric), 0) INTO NEW.days_count FROM jsonb_each_text(NEW.days_by_year) AS e(k, v);
    IF NEW.days_count = 0 THEN
      RAISE EXCEPTION 'leave_request_no_working_days'
        USING ERRCODE = '23514', DETAIL = 'The range has no weekdays outside public holidays.';
    END IF;
    NEW.created_at := now();
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  -- UPDATE
  IF (NEW.id, NEW.department_id, NEW.requester_id, NEW.leave_type_id, NEW.start_date, NEW.end_date,
      NEW.start_part, NEW.end_part, NEW.days_count, NEW.days_by_year, NEW.notes,
      NEW.covering_user_id, NEW.covering_note, NEW.created_at)
     IS DISTINCT FROM
     (OLD.id, OLD.department_id, OLD.requester_id, OLD.leave_type_id, OLD.start_date, OLD.end_date,
      OLD.start_part, OLD.end_part, OLD.days_count, OLD.days_by_year, OLD.notes,
      OLD.covering_user_id, OLD.covering_note, OLD.created_at) THEN
    RAISE EXCEPTION 'leave_request_immutable'
      USING ERRCODE = '42501', DETAIL = 'A request''s dates, type and details are fixed. Cancel it and make a new one.';
  END IF;
  IF NOT v_server AND NEW.slack_notify IS DISTINCT FROM OLD.slack_notify THEN
    RAISE EXCEPTION 'leave_request_server_only'
      USING ERRCODE = '42501', DETAIL = 'slack_notify is written by the Hub server.';
  END IF;

  IF NEW.status = OLD.status THEN
    IF (NEW.decided_by, NEW.decided_at, NEW.decision_note, NEW.cancelled_by, NEW.cancelled_at)
       IS DISTINCT FROM
       (OLD.decided_by, OLD.decided_at, OLD.decision_note, OLD.cancelled_by, OLD.cancelled_at) THEN
      RAISE EXCEPTION 'leave_request_immutable'
        USING ERRCODE = '42501', DETAIL = 'Decision and cancel fields change only with the status.';
    END IF;
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  IF OLD.status IN ('declined', 'cancelled') THEN
    RAISE EXCEPTION 'leave_request_locked'
      USING ERRCODE = '42501', DETAIL = 'A declined or cancelled request is final.';
  END IF;

  IF NEW.status IN ('approved', 'declined', 'pending') THEN
    IF OLD.status <> 'pending' OR NEW.status = 'pending' THEN
      RAISE EXCEPTION 'leave_request_already_decided'
        USING ERRCODE = '42501', DETAIL = 'The first decision settles a request.';
    END IF;
    IF v_uid IS NOT NULL THEN
      v_actor := v_uid;
    ELSE
      v_actor := NEW.decided_by;
    END IF;
    IF v_actor IS NOT DISTINCT FROM OLD.requester_id THEN
      RAISE EXCEPTION 'leave_request_self_decision'
        USING ERRCODE = '42501', DETAIL = 'Nobody decides their own leave.';
    END IF;
    IF v_uid IS NOT NULL THEN
      v_ok := public.leave_can_decide(OLD.department_id, OLD.requester_id);
    ELSE
      v_ok := public.leave_user_can_decide(OLD.department_id, OLD.requester_id, v_actor);
    END IF;
    IF NOT v_ok THEN
      RAISE EXCEPTION 'leave_request_not_approver'
        USING ERRCODE = '42501',
              DETAIL = 'Only another active leader of the department, or an admin, can decide.';
    END IF;
    IF NEW.status = 'declined' AND COALESCE(btrim(NEW.decision_note), '') = '' THEN
      RAISE EXCEPTION 'leave_request_decline_note_required'
        USING ERRCODE = '23514', DETAIL = 'Say why when declining.';
    END IF;
    NEW.decided_by := v_actor;
    NEW.decided_at := now();
    NEW.cancelled_by := NULL;
    NEW.cancelled_at := NULL;
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  -- NEW.status = 'cancelled', from pending or approved
  v_actor := COALESCE(v_uid, NEW.cancelled_by);
  IF v_actor IS DISTINCT FROM OLD.requester_id THEN
    RAISE EXCEPTION 'leave_request_cancel_not_allowed'
      USING ERRCODE = '42501', DETAIL = 'Only the requester can cancel a request.';
  END IF;
  IF OLD.status = 'approved' AND OLD.start_date <= v_today THEN
    RAISE EXCEPTION 'leave_request_locked'
      USING ERRCODE = '42501', DETAIL = 'Approved leave can be cancelled only before its first day.';
  END IF;
  NEW.cancelled_by := v_actor;
  NEW.cancelled_at := now();
  NEW.decided_by := OLD.decided_by;
  NEW.decided_at := OLD.decided_at;
  NEW.decision_note := OLD.decision_note;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS leave_requests_guard ON public.leave_requests;
CREATE TRIGGER leave_requests_guard
  BEFORE INSERT OR UPDATE ON public.leave_requests
  FOR EACH ROW EXECUTE FUNCTION public.leave_requests_guard();

CREATE OR REPLACE FUNCTION public.leave_blockouts_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.user_id, NEW.created_at) IS DISTINCT FROM (OLD.user_id, OLD.created_at) THEN
    RAISE EXCEPTION 'leave_blockout_immutable'
      USING ERRCODE = '42501', DETAIL = 'user_id and created_at cannot change.';
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.created_at := now();
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS leave_blockouts_guard ON public.leave_blockouts;
CREATE TRIGGER leave_blockouts_guard
  BEFORE INSERT OR UPDATE ON public.leave_blockouts
  FOR EACH ROW EXECUTE FUNCTION public.leave_blockouts_guard();

DROP TRIGGER IF EXISTS set_updated_at ON public.leave_types;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.leave_types
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- Helper and trigger grants. Trigger functions are never called directly.
DO $$
DECLARE
  f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.leave_can_decide(uuid, uuid)',
    'public.leave_can_read_request(uuid, uuid)',
    'public.leave_can_view_person(uuid)',
    'public.leave_can_manage_types(uuid)',
    'public.leave_caller_is_admin()',
    'public.leave_effective_types(uuid)',
    'public.leave_type_is_available(uuid, uuid)',
    'public.leave_is_public_holiday(date)',
    'public.leave_days_by_year(date, date, text, text)',
    'public.leave_working_days(date, date, text, text)',
    'public.leave_department_away(uuid, date, date)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', f);
  END LOOP;
END
$$;
-- Server only: the p_user forms would let a signed-in user ask whether
-- any account is active, an admin or a leader; the approver fan-out lists
-- admins.
DO $$
DECLARE
  f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.leave_user_is_active(uuid)',
    'public.leave_user_is_admin(uuid)',
    'public.leave_user_in_department(uuid, uuid, boolean)',
    'public.leave_user_can_decide(uuid, uuid, uuid)',
    'public.leave_request_approvers(uuid)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP;
END
$$;
REVOKE ALL ON FUNCTION public.leave_requests_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.leave_blockouts_guard() FROM PUBLIC, anon, authenticated;

-- ────────────────────────────────────────────────────────────
-- 4. Balances view
-- ────────────────────────────────────────────────────────────
-- security_invoker: a caller sees balances only for requests they can
-- read (their own; their departments' as a leader; all as admin).
-- One row per requester, department, leave year and type slug that has
-- at least one pending or approved day. Allowance = the department's
-- override row for the slug if any, else the request's own type row.
-- Block-outs are not leave and never appear here.

CREATE OR REPLACE VIEW public.leave_balances
WITH (security_invoker = true) AS
SELECT
  g.requester_id,
  g.department_id,
  g.leave_year,
  g.type_slug,
  g.type_label,
  g.annual_allowance_days,
  g.used_days,
  g.pending_days,
  CASE WHEN g.annual_allowance_days IS NULL THEN NULL
       ELSE (g.annual_allowance_days - g.used_days)::numeric(5,1) END AS remaining_days,
  CASE WHEN g.annual_allowance_days IS NULL THEN NULL
       ELSE GREATEST(g.used_days - g.annual_allowance_days, 0)::numeric(5,1) END AS over_days
FROM (
  SELECT
    r.requester_id,
    r.department_id,
    y.leave_year,
    COALESCE(o.slug, t.slug) AS type_slug,
    COALESCE(o.label, t.label) AS type_label,
    CASE WHEN o.id IS NOT NULL THEN o.annual_allowance_days ELSE t.annual_allowance_days END AS annual_allowance_days,
    COALESCE(sum(y.days) FILTER (WHERE r.status = 'approved'), 0)::numeric(5,1) AS used_days,
    COALESCE(sum(y.days) FILTER (WHERE r.status = 'pending'), 0)::numeric(5,1) AS pending_days
  FROM public.leave_requests r
  JOIN public.leave_types t ON t.id = r.leave_type_id
  LEFT JOIN public.leave_types o
    ON t.department_id IS NULL AND o.department_id = r.department_id AND o.slug = t.slug
  CROSS JOIN LATERAL (
    SELECT e.key::int AS leave_year, e.value::numeric AS days
      FROM jsonb_each_text(r.days_by_year) AS e(key, value)
  ) y
  WHERE r.status IN ('approved', 'pending')
  GROUP BY 1, 2, 3, 4, 5, 6
) g;

COMMENT ON VIEW public.leave_balances IS
  'Leave used (approved, future included), pending, remaining and over the guideline per person, department, leave year and type slug. remaining/over are NULL for uncapped types; remaining goes negative when over. Block-outs never count.';

-- ────────────────────────────────────────────────────────────
-- 5. Grants and RLS
-- ────────────────────────────────────────────────────────────

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['leave_types', 'leave_declared_holidays', 'leave_requests', 'leave_blockouts'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
  END LOOP;
END
$$;
-- Requests are never deleted by a signed-in user (history); cancel instead.
REVOKE DELETE ON public.leave_requests FROM authenticated;

REVOKE ALL ON public.leave_balances FROM PUBLIC, anon;
GRANT SELECT ON public.leave_balances TO authenticated, service_role;

-- leave_types
DROP POLICY IF EXISTS "Active users read leave types" ON public.leave_types;
CREATE POLICY "Active users read leave types"
  ON public.leave_types FOR SELECT TO authenticated
  USING ((SELECT public.dept_caller_is_active()));

DROP POLICY IF EXISTS "Type managers insert leave types" ON public.leave_types;
CREATE POLICY "Type managers insert leave types"
  ON public.leave_types FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.leave_can_manage_types(department_id)));

DROP POLICY IF EXISTS "Type managers update leave types" ON public.leave_types;
CREATE POLICY "Type managers update leave types"
  ON public.leave_types FOR UPDATE TO authenticated
  USING ((SELECT public.leave_can_manage_types(department_id)))
  WITH CHECK ((SELECT public.leave_can_manage_types(department_id)));

DROP POLICY IF EXISTS "Type managers delete leave types" ON public.leave_types;
CREATE POLICY "Type managers delete leave types"
  ON public.leave_types FOR DELETE TO authenticated
  USING ((SELECT public.leave_can_manage_types(department_id)));

-- leave_declared_holidays
DROP POLICY IF EXISTS "Active users read declared holidays" ON public.leave_declared_holidays;
CREATE POLICY "Active users read declared holidays"
  ON public.leave_declared_holidays FOR SELECT TO authenticated
  USING ((SELECT public.dept_caller_is_active()));

DROP POLICY IF EXISTS "Admins write declared holidays" ON public.leave_declared_holidays;
CREATE POLICY "Admins write declared holidays"
  ON public.leave_declared_holidays FOR ALL TO authenticated
  USING ((SELECT public.leave_caller_is_admin()))
  WITH CHECK ((SELECT public.leave_caller_is_admin()));

-- leave_requests
DROP POLICY IF EXISTS "Requester, leaders and admins read leave requests" ON public.leave_requests;
CREATE POLICY "Requester, leaders and admins read leave requests"
  ON public.leave_requests FOR SELECT TO authenticated
  USING ((SELECT public.leave_can_read_request(department_id, requester_id)));

DROP POLICY IF EXISTS "Members request their own leave" ON public.leave_requests;
CREATE POLICY "Members request their own leave"
  ON public.leave_requests FOR INSERT TO authenticated
  WITH CHECK (
    requester_id = (SELECT auth.uid())
    AND (SELECT public.dept_is_ministry_member(department_id))
  );

-- Who may touch a row; leave_requests_guard decides what may change.
DROP POLICY IF EXISTS "Requester and deciders update leave requests" ON public.leave_requests;
CREATE POLICY "Requester and deciders update leave requests"
  ON public.leave_requests FOR UPDATE TO authenticated
  USING (
    (SELECT public.dept_caller_is_active())
    AND (requester_id = (SELECT auth.uid()) OR (SELECT public.leave_can_decide(department_id, requester_id)))
  )
  WITH CHECK (
    (SELECT public.dept_caller_is_active())
    AND (requester_id = (SELECT auth.uid()) OR (SELECT public.leave_can_decide(department_id, requester_id)))
  );

-- leave_blockouts
DROP POLICY IF EXISTS "Owner, leaders and admins read block-outs" ON public.leave_blockouts;
CREATE POLICY "Owner, leaders and admins read block-outs"
  ON public.leave_blockouts FOR SELECT TO authenticated
  USING ((SELECT public.leave_can_view_person(user_id)));

DROP POLICY IF EXISTS "Owner adds block-outs" ON public.leave_blockouts;
CREATE POLICY "Owner adds block-outs"
  ON public.leave_blockouts FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND (SELECT public.dept_caller_is_active())
    AND (department_id IS NULL OR (SELECT public.dept_is_ministry_member(department_id)))
  );

DROP POLICY IF EXISTS "Owner updates block-outs" ON public.leave_blockouts;
CREATE POLICY "Owner updates block-outs"
  ON public.leave_blockouts FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()) AND (SELECT public.dept_caller_is_active()))
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND (SELECT public.dept_caller_is_active())
    AND (department_id IS NULL OR (SELECT public.dept_is_ministry_member(department_id)))
  );

DROP POLICY IF EXISTS "Owner deletes block-outs" ON public.leave_blockouts;
CREATE POLICY "Owner deletes block-outs"
  ON public.leave_blockouts FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()) AND (SELECT public.dept_caller_is_active()));

-- ────────────────────────────────────────────────────────────
-- 6. Seed: base default leave types (department_id NULL)
-- ────────────────────────────────────────────────────────────
-- Jack, 26 Nov 2026. Idempotent; an existing default with the same slug
-- (for example one an admin has re-labelled) is left alone.
INSERT INTO public.leave_types (department_id, slug, label, sort_order, annual_allowance_days)
VALUES
  (NULL, 'annual',          'Annual leave',          10, 15),
  (NULL, 'sick',            'Sick leave',            20, 5),
  (NULL, 'family',          'Family responsibility', 30, 3),
  (NULL, 'study',           'Study leave',           40, 5),
  (NULL, 'ministry_travel', 'Ministry travel',       50, NULL),
  (NULL, 'unpaid',          'Unpaid leave',          60, NULL)
ON CONFLICT (slug) WHERE department_id IS NULL DO NOTHING;
