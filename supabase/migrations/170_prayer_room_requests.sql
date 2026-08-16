-- ============================================================
-- FFSA Hub — Migration 170: seat requests + evaluation requests
-- Prayer room rebuild, PHASE D. See docs/redesign/07-prayer-room-reconciliation.md
-- ============================================================
-- Both flows in the module run one way today: a lead INVITES someone
-- (set_slots.invitee_id). The redesign adds the other direction —
--
--   seat requests       — "I'd like the keys seat on Thursday's set."
--                         Leads get an inbox and accept or decline.
--   evaluation requests — "I'd like to be evaluated for prayer lead."
--                         Evaluators get a queue and book a session.
--
-- Neither replaces the invite flow; they sit beside it.
--
-- Accepting a seat request does NOT fill the seat by itself. Filling runs
-- through set_slots, where the cross-set overlap trigger (migration 108) can
-- still refuse a clash. Doing it here would route a fill around that guard.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 0. Who runs a given set
-- ────────────────────────────────────────────────────────────
-- The set's owner, or anyone holding a filled LEAD seat on it. Used by both
-- inboxes below, so the definition of "the lead" lives in exactly one place.
-- Reads is_lead from the seat vocabulary rather than hard-coding seat ids.
CREATE OR REPLACE FUNCTION public.leads_prayer_set(target_set uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.prayer_room_sets s
     WHERE s.id = target_set AND s.owner_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1
      FROM public.prayer_room_set_slots sl
      JOIN public.prayer_room_seat_types st ON st.id = sl.seat_type_id
     WHERE sl.set_id = target_set
       AND sl.status = 'filled'
       AND sl.filled_user_id = auth.uid()
       AND st.is_lead
  );
$$;

COMMENT ON FUNCTION public.leads_prayer_set(uuid) IS
  'True when the caller owns this set or holds one of its filled lead seats. The single definition of "the lead" for request inboxes.';

-- ────────────────────────────────────────────────────────────
-- 1. Seat requests
-- ────────────────────────────────────────────────────────────
-- Keyed on (set, seat type) rather than on a specific slot row: a set may
-- offer two vocals seats, and slots are rebuilt as a set is edited. Asking for
-- "a vocals seat on this set" survives that; asking for slot #2 does not.
CREATE TABLE IF NOT EXISTS public.prayer_room_seat_requests (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  set_id       uuid NOT NULL REFERENCES public.prayer_room_sets(id) ON DELETE CASCADE,
  seat_type_id text NOT NULL REFERENCES public.prayer_room_seat_types(id),
  user_id      uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  -- withdrawn: the asker changed their mind. Kept as a state rather than
  -- deleting the row, so a lead who already saw it isn't left confused.
  state        text NOT NULL DEFAULT 'pending'
               CHECK (state IN ('pending', 'accepted', 'declined', 'withdrawn')),
  message      text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  decided_by   uuid REFERENCES public.users(id),
  decided_at   timestamptz
);

COMMENT ON TABLE public.prayer_room_seat_requests IS
  'Someone asking for an open seat on a set. Accepting does not fill the seat — filling goes through set_slots so the overlap guard still applies.';

-- One LIVE request per person per seat per set; re-asking after a decline is
-- allowed, so the constraint only covers pending rows.
CREATE UNIQUE INDEX IF NOT EXISTS uq_prayer_seat_request_pending
  ON public.prayer_room_seat_requests (set_id, seat_type_id, user_id)
  WHERE state = 'pending';

CREATE INDEX IF NOT EXISTS idx_prayer_seat_requests_inbox
  ON public.prayer_room_seat_requests (set_id, state);
CREATE INDEX IF NOT EXISTS idx_prayer_seat_requests_user
  ON public.prayer_room_seat_requests (user_id, state);

ALTER TABLE public.prayer_room_seat_requests ENABLE ROW LEVEL SECURITY;

-- Visible to the asker, to whoever runs the set, and to staff. Not to the
-- room at large: who asked for what is between them and the lead.
DROP POLICY IF EXISTS "Read seat requests" ON public.prayer_room_seat_requests;
CREATE POLICY "Read seat requests" ON public.prayer_room_seat_requests
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.leads_prayer_set(set_id)
    OR public.is_prayer_room_staff()
  );

-- You may only ask for yourself. Staff can lodge one on someone's behalf.
DROP POLICY IF EXISTS "Ask for a seat" ON public.prayer_room_seat_requests;
CREATE POLICY "Ask for a seat" ON public.prayer_room_seat_requests
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() OR public.is_prayer_room_staff());

-- Leads decide; the asker can withdraw. Both go through UPDATE, and the app
-- decides which transition it is writing.
DROP POLICY IF EXISTS "Decide or withdraw seat requests" ON public.prayer_room_seat_requests;
CREATE POLICY "Decide or withdraw seat requests" ON public.prayer_room_seat_requests
  FOR UPDATE TO authenticated
  USING (
    user_id = auth.uid()
    OR public.leads_prayer_set(set_id)
    OR public.is_prayer_room_staff()
  )
  WITH CHECK (
    user_id = auth.uid()
    OR public.leads_prayer_set(set_id)
    OR public.is_prayer_room_staff()
  );

-- ────────────────────────────────────────────────────────────
-- 2. Evaluation requests
-- ────────────────────────────────────────────────────────────
-- Deliberately NOT folded into prayer_room_applications. That table is the
-- live join-the-team pipeline with its own status vocabulary; overloading it
-- would mix "let me in" with "look at me again for keys".
CREATE TABLE IF NOT EXISTS public.prayer_room_evaluation_requests (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  seat_type_id text NOT NULL REFERENCES public.prayer_room_seat_types(id),
  state        text NOT NULL DEFAULT 'waiting'
               CHECK (state IN ('waiting', 'booked', 'done', 'cancelled')),
  note         text,
  scheduled_at timestamptz,
  evaluator_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.prayer_room_evaluation_requests IS
  'Someone asking to be evaluated for a seat. Feeds the evaluators queue. Separate from prayer_room_applications, which is about joining the team at all.';

-- One open ask per person per seat; asking again after it is done or
-- cancelled is fine.
CREATE UNIQUE INDEX IF NOT EXISTS uq_prayer_eval_request_open
  ON public.prayer_room_evaluation_requests (user_id, seat_type_id)
  WHERE state IN ('waiting', 'booked');

CREATE INDEX IF NOT EXISTS idx_prayer_eval_requests_queue
  ON public.prayer_room_evaluation_requests (state, seat_type_id);
CREATE INDEX IF NOT EXISTS idx_prayer_eval_requests_user
  ON public.prayer_room_evaluation_requests (user_id, state);

DROP TRIGGER IF EXISTS trg_prayer_eval_requests_updated_at ON public.prayer_room_evaluation_requests;
CREATE TRIGGER trg_prayer_eval_requests_updated_at
  BEFORE UPDATE ON public.prayer_room_evaluation_requests
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

ALTER TABLE public.prayer_room_evaluation_requests ENABLE ROW LEVEL SECURITY;

-- The asker, evaluators competent for that seat, and staff. Asking to be
-- looked at is not something the whole room needs to see.
DROP POLICY IF EXISTS "Read evaluation requests" ON public.prayer_room_evaluation_requests;
CREATE POLICY "Read evaluation requests" ON public.prayer_room_evaluation_requests
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR COALESCE(public.can_evaluate_seat(seat_type_id), false)
    OR public.is_prayer_room_staff()
  );

DROP POLICY IF EXISTS "Ask to be evaluated" ON public.prayer_room_evaluation_requests;
CREATE POLICY "Ask to be evaluated" ON public.prayer_room_evaluation_requests
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    OR COALESCE(public.can_evaluate_seat(seat_type_id), false)
    OR public.is_prayer_room_staff()
  );

-- Evaluators book and complete; the asker can cancel their own.
DROP POLICY IF EXISTS "Book or cancel evaluation requests" ON public.prayer_room_evaluation_requests;
CREATE POLICY "Book or cancel evaluation requests" ON public.prayer_room_evaluation_requests
  FOR UPDATE TO authenticated
  USING (
    user_id = auth.uid()
    OR COALESCE(public.can_evaluate_seat(seat_type_id), false)
    OR public.is_prayer_room_staff()
  )
  WITH CHECK (
    user_id = auth.uid()
    OR COALESCE(public.can_evaluate_seat(seat_type_id), false)
    OR public.is_prayer_room_staff()
  );

-- ============================================================
-- Validation
-- ------------------------------------------------------------
--   -- 1. Both tables exist and start empty:
--   SELECT (SELECT count(*) FROM public.prayer_room_seat_requests)       AS seat_requests,
--          (SELECT count(*) FROM public.prayer_room_evaluation_requests) AS eval_requests;
--
--   -- 2. The lead test resolves (impersonate a set owner; see migration 168's
--   --    notes — in the SQL editor auth.uid() is NULL and this is false):
--   -- SELECT public.leads_prayer_set('SET-UUID');
--
--   -- 3. The pending-only uniqueness works: two pending asks for the same
--   --    seat should fail, a second ask after a decline should not.
-- ============================================================

-- ------------------------------------------------------------
-- ROLLBACK (both tables start empty; nothing else is touched):
--   DROP TABLE IF EXISTS public.prayer_room_seat_requests;
--   DROP TABLE IF EXISTS public.prayer_room_evaluation_requests;
--   DROP FUNCTION IF EXISTS public.leads_prayer_set(uuid);
-- ------------------------------------------------------------
