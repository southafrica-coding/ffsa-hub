-- ============================================================
-- FFSA Hub — Migration 169: two-note evaluations
-- Prayer room rebuild, PHASE C. See docs/redesign/07-prayer-room-reconciliation.md
-- ============================================================
-- Evaluations today are attached to an APPLICATION (joining the team) and
-- carry one `notes` field. The redesign needs them attached to a PERSON and a
-- SEAT, with two notes that behave differently:
--
--   feedback     — written for the person. They read it.
--   private_note — written for other evaluators. The person must NEVER see it,
--                  and must not be able to tell it exists.
--
-- That promise is the whole point of this migration, so it is enforced by the
-- shape of the schema rather than by the UI:
--
--   * The base table stays readable by evaluators and staff ONLY. The subject
--     has no SELECT on it at all, so no policy mistake can expose the column.
--   * The subject reads a VIEW that does not contain private_note. You cannot
--     select a column that isn't there.
--
-- WHY THAT VIEW IS DELIBERATELY *NOT* security_invoker
-- ------------------------------------------------------------
-- Migration 166 fixed two views that bypassed RLS by accident. This one
-- bypasses it ON PURPOSE, and safely: the subject cannot read the base table,
-- so an invoker-rights view would return them nothing. Owner rights let it
-- answer — and it can only ever answer about the caller, because the view body
-- hard-filters `user_id = auth.uid()` and exposes no private column. With no
-- JWT (SQL editor, service role) auth.uid() is NULL and it returns zero rows.
--
-- SAFE AGAINST THE CURRENTLY-DEPLOYED CODE
-- ------------------------------------------------------------
-- `notes` is NOT dropped: services/prayer-room-applications.ts still selects
-- and writes it. It is copied into private_note, marked deprecated, and kept
-- in sync by trigger so old writes keep landing somewhere the new UI reads.
-- application_id becomes nullable, because a per-seat evaluation of an
-- existing member has no application behind it.
--
-- Per the decision on the reconciliation doc, legacy `notes` migrate to
-- private_note — they were written with no expectation the subject would
-- read them, so private is the only safe reading.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. Widen the table
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.prayer_room_evaluations
  ADD COLUMN IF NOT EXISTS user_id        uuid REFERENCES public.users(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS seat_type_id   text REFERENCES public.prayer_room_seat_types(id),
  ADD COLUMN IF NOT EXISTS outcome        text
    CHECK (outcome IS NULL OR outcome IN ('not_yet', 'in_training', 'signed_off')),
  ADD COLUMN IF NOT EXISTS feedback       text,
  ADD COLUMN IF NOT EXISTS private_note   text,
  ADD COLUMN IF NOT EXISTS observed_set_id uuid REFERENCES public.prayer_room_sets(id) ON DELETE SET NULL;

-- Who the evaluation is ABOUT. Every legacy row has an application, and every
-- application has an applicant, so this backfills completely.
UPDATE public.prayer_room_evaluations e
   SET user_id = a.applicant_id
  FROM public.prayer_room_applications a
 WHERE a.id = e.application_id
   AND e.user_id IS NULL;

DO $$
DECLARE orphaned int;
BEGIN
  SELECT count(*) INTO orphaned
    FROM public.prayer_room_evaluations WHERE user_id IS NULL;
  IF orphaned > 0 THEN
    RAISE EXCEPTION
      'Backfill incomplete: % evaluation(s) have no subject. Resolve before re-running.', orphaned;
  END IF;
END $$;

ALTER TABLE public.prayer_room_evaluations
  ALTER COLUMN user_id SET NOT NULL;

-- A per-seat evaluation of an existing member has no application behind it.
ALTER TABLE public.prayer_room_evaluations
  ALTER COLUMN application_id DROP NOT NULL;

-- The legacy note becomes the PRIVATE one. It was written when nobody expected
-- the subject to read it; promoting it to `feedback` would retroactively
-- publish candid remarks to the person they are about.
UPDATE public.prayer_room_evaluations
   SET private_note = notes
 WHERE private_note IS NULL
   AND notes IS NOT NULL;

COMMENT ON COLUMN public.prayer_room_evaluations.feedback IS
  'Written FOR the person being evaluated. They can read this.';
COMMENT ON COLUMN public.prayer_room_evaluations.private_note IS
  'Evaluators only. Never expose this to the subject, and never hint that it exists. The subject reads prayer_room_my_evaluations, which does not contain this column.';
COMMENT ON COLUMN public.prayer_room_evaluations.notes IS
  'DEPRECATED — superseded by private_note, and trigger-mirrored into it. Kept because already-deployed code still reads and writes it. Drop once the redesigned prayer room has shipped.';

CREATE INDEX IF NOT EXISTS idx_prayer_evals_subject_seat
  ON public.prayer_room_evaluations (user_id, seat_type_id);

-- Keeps already-deployed writes valid. services/prayer-room-applications.ts
-- inserts { application_id, evaluator_id, notes, met_at } and knows nothing
-- about user_id or private_note — without this, the NOT NULL above would
-- break the live evaluator flow the moment this migration is applied.
-- BEFORE-insert triggers run ahead of constraint checks, so deriving the
-- subject here satisfies NOT NULL.
CREATE OR REPLACE FUNCTION public.prayer_room_normalise_evaluation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.user_id IS NULL AND NEW.application_id IS NOT NULL THEN
    SELECT a.applicant_id INTO NEW.user_id
      FROM public.prayer_room_applications a
     WHERE a.id = NEW.application_id;
  END IF;

  -- Old code writing `notes` must still land where the new UI reads. The
  -- legacy note is private, never feedback.
  IF NEW.private_note IS NULL AND NEW.notes IS NOT NULL THEN
    NEW.private_note := NEW.notes;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_prayer_room_sync_eval_note ON public.prayer_room_evaluations;
DROP TRIGGER IF EXISTS trg_prayer_room_normalise_evaluation ON public.prayer_room_evaluations;
CREATE TRIGGER trg_prayer_room_normalise_evaluation
  BEFORE INSERT OR UPDATE ON public.prayer_room_evaluations
  FOR EACH ROW EXECUTE FUNCTION public.prayer_room_normalise_evaluation();

-- ────────────────────────────────────────────────────────────
-- 2. Who may read the base table
-- ────────────────────────────────────────────────────────────
-- Unchanged for legacy rows: the author or prayer-room staff. Widened only for
-- seat-based rows, where the design wants any evaluator competent for that
-- seat to see prior notes. can_evaluate_seat(NULL) is NULL — not true — so
-- legacy rows (seat_type_id IS NULL) keep exactly today's visibility.
--
-- The subject is deliberately absent from this policy.
DROP POLICY IF EXISTS "Evaluator/staff read evaluations" ON public.prayer_room_evaluations;
CREATE POLICY "Evaluator/staff read evaluations" ON public.prayer_room_evaluations
  FOR SELECT TO authenticated
  USING (
    evaluator_id = auth.uid()
    OR public.is_prayer_room_staff()
    OR COALESCE(public.can_evaluate_seat(seat_type_id), false)
  );

DROP POLICY IF EXISTS "Evaluator/staff write evaluations" ON public.prayer_room_evaluations;
CREATE POLICY "Evaluator/staff write evaluations" ON public.prayer_room_evaluations
  FOR INSERT TO authenticated
  WITH CHECK (
    (evaluator_id = auth.uid() OR public.is_prayer_room_staff())
    AND (seat_type_id IS NULL OR COALESCE(public.can_evaluate_seat(seat_type_id), false))
  );

-- Correcting your own wording is normal; rewriting someone else's is not.
DROP POLICY IF EXISTS "Evaluator/staff amend evaluations" ON public.prayer_room_evaluations;
CREATE POLICY "Evaluator/staff amend evaluations" ON public.prayer_room_evaluations
  FOR UPDATE TO authenticated
  USING (evaluator_id = auth.uid() OR public.is_prayer_room_staff())
  WITH CHECK (evaluator_id = auth.uid() OR public.is_prayer_room_staff());

-- ────────────────────────────────────────────────────────────
-- 3. What the SUBJECT sees
-- ────────────────────────────────────────────────────────────
-- Owner rights on purpose (see the header). private_note is absent from the
-- projection, so it cannot be selected, aliased, or filtered on through here.
DROP VIEW IF EXISTS public.prayer_room_my_evaluations;

CREATE VIEW public.prayer_room_my_evaluations AS
SELECT
  e.id,
  e.user_id,
  e.seat_type_id,
  st.label AS seat_label,
  e.outcome,
  e.feedback,
  e.observed_set_id,
  e.created_at
FROM public.prayer_room_evaluations e
LEFT JOIN public.prayer_room_seat_types st ON st.id = e.seat_type_id
WHERE e.user_id = auth.uid()
  -- Only surfaced once an evaluator has actually written something for the
  -- person. A bare outcome with no feedback would read as a verdict with no
  -- explanation, which is worse than saying nothing yet.
  AND e.feedback IS NOT NULL;

COMMENT ON VIEW public.prayer_room_my_evaluations IS
  'The evaluation feedback a person may read about THEMSELVES. Hard-filtered to auth.uid() and deliberately does not contain private_note — the subject must not be able to read it or infer it exists. Owner-rights on purpose: the base table is closed to subjects, so an invoker-rights view would return nothing.';

REVOKE ALL ON public.prayer_room_my_evaluations FROM PUBLIC;
GRANT SELECT ON public.prayer_room_my_evaluations TO authenticated;

-- ============================================================
-- Validation
-- ------------------------------------------------------------
--   -- 1. Every legacy note preserved as PRIVATE, none leaked to feedback:
--   SELECT count(*) FILTER (WHERE notes IS NOT NULL AND private_note IS NULL) AS unmigrated,
--          count(*) FILTER (WHERE feedback IS NOT NULL)                       AS with_feedback
--   FROM public.prayer_room_evaluations;
--   -- expect unmigrated = 0; with_feedback = 0 (nothing has been written yet)
--
--   -- 2. The subject view cannot expose the private column:
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'prayer_room_my_evaluations';
--   -- expect NO private_note, NO notes
--
--   -- 3. The real test — impersonate the SUBJECT of an evaluation and confirm
--   --    they can read their feedback but not the base table:
--   BEGIN;
--   SELECT set_config('request.jwt.claims',
--     json_build_object('sub','SUBJECT-UUID','role','authenticated')::text, true);
--   SET LOCAL ROLE authenticated;
--   SELECT count(*) FROM public.prayer_room_my_evaluations;   -- their feedback
--   SELECT count(*) FROM public.prayer_room_evaluations;      -- expect 0 rows
--   ROLLBACK;
-- ============================================================

-- ------------------------------------------------------------
-- ROLLBACK (private_note is a copy; `notes` is never touched):
--   DROP VIEW IF EXISTS public.prayer_room_my_evaluations;
--   DROP TRIGGER IF EXISTS trg_prayer_room_normalise_evaluation ON public.prayer_room_evaluations;
--   DROP FUNCTION IF EXISTS public.prayer_room_normalise_evaluation();
--   -- restore application_id NOT NULL only if no seat-based rows exist yet
--   ALTER TABLE public.prayer_room_evaluations
--     DROP COLUMN IF EXISTS user_id,
--     DROP COLUMN IF EXISTS seat_type_id,
--     DROP COLUMN IF EXISTS outcome,
--     DROP COLUMN IF EXISTS feedback,
--     DROP COLUMN IF EXISTS private_note,
--     DROP COLUMN IF EXISTS observed_set_id;
--   -- and restore the original SELECT policy from migration 084.
-- ------------------------------------------------------------
