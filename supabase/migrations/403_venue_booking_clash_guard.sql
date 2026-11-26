-- ============================================================
-- FFSA Hub — Migration 403: Space booking clash guard
-- ============================================================
-- A live (pending or approved) space booking may no longer overlap another
-- live booking of the same space. Until now the rule lived only in the app,
-- and only on create: edits, "apply to all dates", approvals and backend
-- writers could all put two bookings on top of each other (23 Nov 2026:
-- whole-series edits moved series onto existing bookings, past dates too).
--
-- What this adds:
--   venue_booking_window()               — the occupied window as a tsrange,
--                                          the SQL twin of occupiedWindow() in
--                                          src/lib/bookings/conflicts.ts
--   venue_bookings.clash_override_*      — who booked over a clash, when, why
--   venue_booking_clash_overrides        — append-only audit of every override
--   venue_bookings_clash_guard (trigger) — refuses a clashing write
--
-- A TRIGGER, not an exclusion constraint, on purpose: live has overlapping
-- rows already, and they are left exactly as they are (nothing is validated
-- or repaired here). A row that already overlaps can still be renamed,
-- described, re-pointed or cancelled; only moving it, approving it, or
-- bringing it back to life re-checks it.
--
-- Override: someone holding is_admin() or bookings.manage can book over a
-- clash by giving a reason (clash_override_reason, max 500 characters) in the
-- same write. bookings.approve alone is NOT enough. 088 defines approve as
-- "approve / deny requests" — a decision on someone's request — and manage as
-- looking after the spaces themselves; 131's Space Booking Manager role holds
-- both. Letting an approver override would let the decision step that is
-- meant to catch a double-booking create one.
--
-- Backend writers (service role: the prayer-room alt-venue booking, the Slack
-- assistant) have no auth.uid(). They are held to the same rule: a clash
-- raises unless they pass a reason, in which case clash_override_by is NULL
-- and the audit row records overridden_by NULL. "Backend" is decided by the
-- database role (service_role, or the SQL editor's own session), never by JWT
-- claims, so a signed-in or anonymous caller can't blank its claims into it.
--
-- Errors (the API maps these to 409 / 403 / 400 and re-queries the clashes
-- itself; the raw text is never shown):
--   23P01 venue_booking_clash                     DETAIL clashing_booking_ids=<uuid,...>
--   42501 venue_booking_override_forbidden
--   23514 venue_booking_override_reason_too_long
--
-- Idempotent and transactional.
-- ============================================================

BEGIN;

-- ────────────────────────────────────────────────────────────
-- 1. The occupied window
-- ────────────────────────────────────────────────────────────
-- Times are SAST wall-clock `time`, dates are `date`; no time zones.
--   • multi-day (end_date after booking_date) → every day, whole: [booking_date, end_date + 1)
--   • start = earlier of set-up / event start; end = later of set-down / event end
--   • no start-ish or no end-ish time → the whole day
--   • overnight (set-down before set-up, or end before start) → to the next 00:00
--   • start = end → the point [t, t]. Callers compare with
--     lower(a) < upper(b) AND lower(b) < upper(a), which is the app's strict
--     overlap exactly (back-to-back allowed; a zero-length booking clashes only
--     strictly inside another). An empty range would never match, so && is not used.
-- Seconds are dropped, as the app's toMinutes() drops them.

CREATE OR REPLACE FUNCTION public.venue_booking_window(
  p_booking_date date,
  p_end_date     date,
  p_setup_time   time,
  p_start_time   time,
  p_end_time     time,
  p_setdown_time time
)
RETURNS tsrange
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_setup   time := date_trunc('minute', p_setup_time::interval)::time;
  v_start   time := date_trunc('minute', p_start_time::interval)::time;
  v_end     time := date_trunc('minute', p_end_time::interval)::time;
  v_setdown time := date_trunc('minute', p_setdown_time::interval)::time;
  v_from    time;
  v_to      time;
BEGIN
  IF p_booking_date IS NULL THEN
    RETURN NULL;
  END IF;

  IF p_end_date IS NOT NULL AND p_end_date > p_booking_date THEN
    RETURN pg_catalog.tsrange(p_booking_date::timestamp, (p_end_date + 1)::timestamp, '[)');
  END IF;

  -- LEAST / GREATEST skip NULLs, like nullSafeMin / nullSafeMax.
  v_from := LEAST(v_setup, v_start);
  v_to   := GREATEST(v_setdown, v_end);

  IF v_from IS NULL OR v_to IS NULL THEN
    RETURN pg_catalog.tsrange(p_booking_date::timestamp, (p_booking_date + 1)::timestamp, '[)');
  END IF;

  IF (v_setdown IS NOT NULL AND v_setup IS NOT NULL AND v_setdown < v_setup) OR v_to < v_from THEN
    RETURN pg_catalog.tsrange(p_booking_date + v_from, (p_booking_date + 1)::timestamp, '[)');
  END IF;

  IF v_to = v_from THEN
    RETURN pg_catalog.tsrange(p_booking_date + v_from, p_booking_date + v_to, '[]');
  END IF;

  RETURN pg_catalog.tsrange(p_booking_date + v_from, p_booking_date + v_to, '[)');
END;
$$;

COMMENT ON FUNCTION public.venue_booking_window(date, date, time, time, time, time) IS
  'Occupied window of a space booking; SQL twin of occupiedWindow() in src/lib/bookings/conflicts.ts. Compare with lower(a) < upper(b) AND lower(b) < upper(a).';

-- Internal to the guard (which runs as its owner). Not callable from the API.
REVOKE EXECUTE ON FUNCTION public.venue_booking_window(date, date, time, time, time, time) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.venue_booking_window(date, date, time, time, time, time) TO service_role;

-- ────────────────────────────────────────────────────────────
-- 2. Override columns (written only by the trigger; a client's
--    by / at are always replaced, its reason only counts when the
--    write needs it)
-- ────────────────────────────────────────────────────────────

ALTER TABLE public.venue_bookings
  ADD COLUMN IF NOT EXISTS clash_override_reason text,
  ADD COLUMN IF NOT EXISTS clash_override_by uuid REFERENCES public.users (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS clash_override_at timestamptz;

-- ────────────────────────────────────────────────────────────
-- 3. Audit: one row per override, never edited
-- ────────────────────────────────────────────────────────────
-- No foreign keys: the audit outlives the booking, the space and the person,
-- and an ON DELETE action would have to rewrite it.

CREATE TABLE IF NOT EXISTS public.venue_booking_clash_overrides (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id           uuid NOT NULL,
  venue_id             uuid NOT NULL,
  overridden_by        uuid,
  reason               text NOT NULL,
  clashing_booking_ids uuid[] NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_venue_booking_clash_overrides_booking
  ON public.venue_booking_clash_overrides (booking_id);
CREATE INDEX IF NOT EXISTS idx_venue_booking_clash_overrides_created
  ON public.venue_booking_clash_overrides (created_at DESC);

ALTER TABLE public.venue_booking_clash_overrides ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.venue_booking_clash_overrides FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.venue_booking_clash_overrides TO authenticated;

DROP POLICY IF EXISTS "venue_booking_clash_overrides_read" ON public.venue_booking_clash_overrides;
CREATE POLICY "venue_booking_clash_overrides_read" ON public.venue_booking_clash_overrides
  FOR SELECT TO authenticated
  USING (
    public.is_admin()
    OR public.has_permission('bookings.manage')
    OR public.has_permission('bookings.approve')
  );
-- No INSERT / UPDATE / DELETE policies: rows arrive only from the trigger below.

-- Append-only, for the service role too.
CREATE OR REPLACE FUNCTION public.venue_booking_clash_overrides_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'venue_booking_clash_overrides is append-only'
    USING ERRCODE = '42501';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.venue_booking_clash_overrides_append_only() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS venue_booking_clash_overrides_no_edit ON public.venue_booking_clash_overrides;
CREATE TRIGGER venue_booking_clash_overrides_no_edit
  BEFORE UPDATE OR DELETE ON public.venue_booking_clash_overrides
  FOR EACH ROW EXECUTE FUNCTION public.venue_booking_clash_overrides_append_only();

DROP TRIGGER IF EXISTS venue_booking_clash_overrides_no_truncate ON public.venue_booking_clash_overrides;
CREATE TRIGGER venue_booking_clash_overrides_no_truncate
  BEFORE TRUNCATE ON public.venue_booking_clash_overrides
  FOR EACH STATEMENT EXECUTE FUNCTION public.venue_booking_clash_overrides_append_only();

-- ────────────────────────────────────────────────────────────
-- 4. The guard
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.venue_bookings_clash_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_role    text := auth.role();
  -- The database role the request runs as (SET ROLE by PostgREST), which a
  -- caller can't change through its JWT claims. 'none' outside SET ROLE.
  v_pg_role text := NULLIF(pg_catalog.current_setting('role', true), '');
  v_backend boolean;
  v_reason  text;
  v_window  tsrange;
  v_last    date;
  v_ids     uuid[];
BEGIN
  -- Not live, or an edit that doesn't move a live booking: nothing to check.
  -- This is what lets the overlaps already on live be renamed or cancelled.
  IF NEW.status NOT IN ('pending', 'approved')
     OR (
       TG_OP = 'UPDATE'
       AND OLD.status IN ('pending', 'approved')
       AND NOT (OLD.status = 'pending' AND NEW.status = 'approved')
       AND NEW.venue_id     IS NOT DISTINCT FROM OLD.venue_id
       AND NEW.booking_date IS NOT DISTINCT FROM OLD.booking_date
       AND NEW.end_date     IS NOT DISTINCT FROM OLD.end_date
       AND NEW.setup_time   IS NOT DISTINCT FROM OLD.setup_time
       AND NEW.start_time   IS NOT DISTINCT FROM OLD.start_time
       AND NEW.end_time     IS NOT DISTINCT FROM OLD.end_time
       AND NEW.setdown_time IS NOT DISTINCT FROM OLD.setdown_time
     )
  THEN
    IF TG_OP = 'UPDATE' THEN
      NEW.clash_override_reason := OLD.clash_override_reason;
      NEW.clash_override_by     := OLD.clash_override_by;
      NEW.clash_override_at     := OLD.clash_override_at;
    ELSE
      NEW.clash_override_reason := NULL;
      NEW.clash_override_by     := NULL;
      NEW.clash_override_at     := NULL;
    END IF;
    RETURN NEW;
  END IF;

  -- A reason counts only when it is supplied in this write. One left on the
  -- row from an earlier override doesn't carry the booking into a new clash.
  IF TG_OP = 'INSERT' OR NEW.clash_override_reason IS DISTINCT FROM OLD.clash_override_reason THEN
    v_reason := NULLIF(btrim(NEW.clash_override_reason), '');
  END IF;

  IF v_reason IS NOT NULL THEN
    -- Backend: no signed-in user, and the database role itself is the service
    -- role, or a superuser session that never SET ROLE (the SQL editor). JWT
    -- claims alone never qualify: an anon or authenticated session that blanks
    -- or spoofs them still runs as anon / authenticated.
    v_backend := v_uid IS NULL
      AND v_role IS DISTINCT FROM 'anon'
      AND v_role IS DISTINCT FROM 'authenticated'
      AND (
        v_pg_role = 'service_role'
        OR (
          session_user IN ('postgres', 'supabase_admin')
          AND COALESCE(v_pg_role, 'none') IN ('none', 'postgres', 'supabase_admin')
        )
      );
    IF NOT (
      public.is_admin()
      OR public.has_permission('bookings.manage')
      OR v_backend
    ) THEN
      RAISE EXCEPTION 'venue_booking_override_forbidden'
        USING ERRCODE = '42501';
    END IF;
    IF char_length(v_reason) > 500 THEN
      RAISE EXCEPTION 'venue_booking_override_reason_too_long'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  -- One writer per space at a time, so two requests can't both see the slot
  -- free and both take it. Held to the end of the transaction.
  PERFORM pg_advisory_xact_lock(
    pg_catalog.hashtext('public.venue_bookings'),
    pg_catalog.hashtext(NEW.venue_id::text)
  );

  v_window := public.venue_booking_window(
    NEW.booking_date, NEW.end_date, NEW.setup_time, NEW.start_time, NEW.end_time, NEW.setdown_time
  );
  v_last := GREATEST(NEW.booking_date, COALESCE(NEW.end_date, NEW.booking_date));

  SELECT array_agg(b.id ORDER BY b.booking_date, b.id)
    INTO v_ids
    FROM public.venue_bookings b
   CROSS JOIN LATERAL (
     SELECT public.venue_booking_window(
       b.booking_date, b.end_date, b.setup_time, b.start_time, b.end_time, b.setdown_time
     ) AS w
   ) x
   WHERE b.venue_id = NEW.venue_id
     AND b.id IS DISTINCT FROM NEW.id
     AND b.status IN ('pending', 'approved')
     AND b.booking_date <= v_last
     AND GREATEST(b.booking_date, COALESCE(b.end_date, b.booking_date)) >= NEW.booking_date
     AND lower(x.w) < upper(v_window)
     AND lower(v_window) < upper(x.w);

  IF v_ids IS NULL THEN
    NEW.clash_override_reason := NULL;
    NEW.clash_override_by     := NULL;
    NEW.clash_override_at     := NULL;
    RETURN NEW;
  END IF;

  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'venue_booking_clash'
      USING ERRCODE = '23P01',
            DETAIL = 'clashing_booking_ids=' || array_to_string(v_ids, ',');
  END IF;

  NEW.clash_override_reason := v_reason;
  NEW.clash_override_by     := v_uid;
  NEW.clash_override_at     := now();

  INSERT INTO public.venue_booking_clash_overrides
    (booking_id, venue_id, overridden_by, reason, clashing_booking_ids)
  VALUES
    (NEW.id, NEW.venue_id, v_uid, v_reason, v_ids);

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.venue_bookings_clash_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS venue_bookings_clash_guard ON public.venue_bookings;
CREATE TRIGGER venue_bookings_clash_guard
  BEFORE INSERT OR UPDATE ON public.venue_bookings
  FOR EACH ROW EXECUTE FUNCTION public.venue_bookings_clash_guard();

COMMIT;

-- ============================================================
-- Validation (run in the Supabase SQL Editor after applying)
-- ------------------------------------------------------------
--   SELECT tgname FROM pg_trigger WHERE tgrelid = 'public.venue_bookings'::regclass AND NOT tgisinternal;
--   SELECT public.venue_booking_window('2026-12-01', NULL, NULL, '11:30', '13:00', NULL);
--   -- Live overlaps that were already there (left alone by this migration):
--   SELECT a.id, b.id FROM public.venue_bookings a JOIN public.venue_bookings b
--     ON a.venue_id = b.venue_id AND a.id < b.id
--    AND a.status IN ('pending','approved') AND b.status IN ('pending','approved')
--    AND lower(public.venue_booking_window(a.booking_date,a.end_date,a.setup_time,a.start_time,a.end_time,a.setdown_time))
--      < upper(public.venue_booking_window(b.booking_date,b.end_date,b.setup_time,b.start_time,b.end_time,b.setdown_time))
--    AND lower(public.venue_booking_window(b.booking_date,b.end_date,b.setup_time,b.start_time,b.end_time,b.setdown_time))
--      < upper(public.venue_booking_window(a.booking_date,a.end_date,a.setup_time,a.start_time,a.end_time,a.setdown_time));
-- ============================================================
