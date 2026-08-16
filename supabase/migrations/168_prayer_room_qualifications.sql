-- ============================================================
-- FFSA Hub — Migration 168: per-seat qualifications + evaluator scope
-- Prayer room rebuild, PHASE B. See docs/redesign/07-prayer-room-reconciliation.md
-- ============================================================
-- Today "can this person do this job" is a binary label assignment
-- (user_label_assignments). The redesign needs three states — not evaluated /
-- in training / signed off — per seat, because the seat picker only offers
-- signed-off people and flags in-training ones.
--
-- Per the decisions taken on the reconciliation doc, instrument LABELS stay as
-- they are: labels keep describing instruments a person plays, qualifications
-- govern seats they may hold. This migration does not touch user_labels.
--
-- WHERE THE EVALUATOR SCOPE LIVES, AND WHY
-- ------------------------------------------------------------
-- The handoff proposes a `prayer_evaluators` table. Deliberately not built:
-- src/lib/auth/prayer-room-access.ts records that the `prayer_room.evaluate`
-- permission REPLACED the old per-member is_evaluator flag, and a third source
-- of truth would re-open the roles-vs-permissions split that migrations
-- 081–091 closed.
--
-- So the permission still decides IF you may evaluate. Scope only narrows
-- WHICH seats, and hangs off the prayer-room profile. user_permissions'
-- own scope columns can't carry it — scope_id is a uuid and its scope_type
-- CHECK allows only program/team/event, while a seat category is text.
--
-- Scope defaults to 'all', and a NULL scope reads as 'all', so nobody who can
-- evaluate today quietly loses that ability when this is applied.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. Evaluator scope on the prayer-room profile
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.prayer_room_members
  ADD COLUMN IF NOT EXISTS evaluator_scope text
    CHECK (evaluator_scope IS NULL
           OR evaluator_scope IN ('all', 'lead', 'worship', 'intercession', 'tech'));

COMMENT ON COLUMN public.prayer_room_members.evaluator_scope IS
  'Narrows which seat categories this person may evaluate. NULL = all. Does NOT grant the ability — that is the prayer_room.evaluate permission. Values match prayer_room_seat_types.category, plus ''all''.';

COMMENT ON COLUMN public.prayer_room_members.is_evaluator IS
  'LEGACY — superseded by the prayer_room.evaluate permission (migration 102). Kept for historical rows; do not read it for access decisions.';

-- ────────────────────────────────────────────────────────────
-- 2. May the caller evaluate this particular seat?
-- ────────────────────────────────────────────────────────────
-- Wraps the whole rule in one place so RLS policies and the app can never
-- drift apart on it.
CREATE OR REPLACE FUNCTION public.can_evaluate_seat(target_seat text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    public.is_prayer_room_staff()
    OR (
      public.has_permission('prayer_room.evaluate')
      AND COALESCE(
            (SELECT m.evaluator_scope
               FROM public.prayer_room_members m
              WHERE m.user_id = auth.uid()),
            'all'
          ) IN (
            'all',
            (SELECT st.category
               FROM public.prayer_room_seat_types st
              WHERE st.id = target_seat)
          )
    );
$$;

COMMENT ON FUNCTION public.can_evaluate_seat(text) IS
  'True when the caller may set a qualification for this seat: prayer-room staff always, otherwise a prayer_room.evaluate holder whose scope covers the seat''s category. NULL/absent scope reads as ''all''.';

-- ────────────────────────────────────────────────────────────
-- 3. The qualifications themselves
-- ────────────────────────────────────────────────────────────
-- ABSENCE OF A ROW MEANS not_evaluated. Rows are written when somebody has
-- actually been looked at, so this table stays small — seeding every person
-- against every seat would be ~10 rows per member that say nothing. The
-- explicit 'not_evaluated' state exists for the case where an evaluator
-- deliberately records "looked, not yet", which is different from silence.
CREATE TABLE IF NOT EXISTS public.prayer_room_qualifications (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  seat_type_id text NOT NULL REFERENCES public.prayer_room_seat_types(id),
  state        text NOT NULL DEFAULT 'not_evaluated'
               CHECK (state IN ('not_evaluated', 'in_training', 'signed_off')),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   uuid REFERENCES public.users(id),
  UNIQUE (user_id, seat_type_id)
);

COMMENT ON TABLE public.prayer_room_qualifications IS
  'Per-seat sign-off. Absence of a row = not_evaluated. Prayer lead and worship lead are separate seats and therefore separate qualifications — holding one says nothing about the other.';

CREATE INDEX IF NOT EXISTS idx_prayer_quals_user ON public.prayer_room_qualifications (user_id);
-- Serves the picker's "who is signed off for this seat" lookup.
CREATE INDEX IF NOT EXISTS idx_prayer_quals_seat_state
  ON public.prayer_room_qualifications (seat_type_id, state);

DROP TRIGGER IF EXISTS trg_prayer_quals_updated_at ON public.prayer_room_qualifications;
CREATE TRIGGER trg_prayer_quals_updated_at
  BEFORE UPDATE ON public.prayer_room_qualifications
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

ALTER TABLE public.prayer_room_qualifications ENABLE ROW LEVEL SECURITY;

-- READ: any signed-in user. This is deliberate and matches design rule 5 —
-- a set lead filling a seat must see the STATE of each candidate. State is all
-- that lives here; the evaluator's notes live in prayer_room_evaluations and
-- are locked down separately in Phase C.
DROP POLICY IF EXISTS "Read qualifications" ON public.prayer_room_qualifications;
CREATE POLICY "Read qualifications" ON public.prayer_room_qualifications
  FOR SELECT TO authenticated USING (true);

-- WRITE: scoped evaluators and prayer-room staff only. Split per command so a
-- scoped evaluator can't move a row to a seat outside their scope: the USING
-- clause tests the row as it stands, WITH CHECK tests it as it would become.
DROP POLICY IF EXISTS "Evaluators add qualifications" ON public.prayer_room_qualifications;
CREATE POLICY "Evaluators add qualifications" ON public.prayer_room_qualifications
  FOR INSERT TO authenticated
  WITH CHECK (public.can_evaluate_seat(seat_type_id));

DROP POLICY IF EXISTS "Evaluators change qualifications" ON public.prayer_room_qualifications;
CREATE POLICY "Evaluators change qualifications" ON public.prayer_room_qualifications
  FOR UPDATE TO authenticated
  USING (public.can_evaluate_seat(seat_type_id))
  WITH CHECK (public.can_evaluate_seat(seat_type_id));

DROP POLICY IF EXISTS "Evaluators remove qualifications" ON public.prayer_room_qualifications;
CREATE POLICY "Evaluators remove qualifications" ON public.prayer_room_qualifications
  FOR DELETE TO authenticated
  USING (public.can_evaluate_seat(seat_type_id));

-- ============================================================
-- Validation
-- ------------------------------------------------------------
--   -- 1. Nobody lost the ability to evaluate (NULL scope = all):
--   SELECT count(*) FILTER (WHERE evaluator_scope IS NULL) AS unscoped
--   FROM public.prayer_room_members;
--
--   -- 2. The rule resolves (run as a signed-in user, not the SQL editor's
--   --    service role, or it will simply answer true for everything):
--   SELECT public.can_evaluate_seat('keys'), public.can_evaluate_seat('scribe');
--
--   -- 3. Nothing is qualified yet — expected, this table starts empty:
--   SELECT count(*) FROM public.prayer_room_qualifications;
-- ============================================================

-- ------------------------------------------------------------
-- ROLLBACK (no data destroyed — the table starts empty):
--   DROP TABLE IF EXISTS public.prayer_room_qualifications;
--   DROP FUNCTION IF EXISTS public.can_evaluate_seat(text);
--   ALTER TABLE public.prayer_room_members DROP COLUMN IF EXISTS evaluator_scope;
-- ------------------------------------------------------------
