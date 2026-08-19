-- ============================================================
-- FFSA Hub — Migration 181: the seat catalogue, and how people get into it
-- ============================================================
-- Requested 2026-08-19. Three changes that belong together, because each one
-- is useless without the others:
--
--   1. The seat vocabulary becomes the eleven seats the room actually runs.
--   2. An application says WHICH SEATS the person does, and whether they have
--      been evaluated for each before — replacing a generic `labels` list that
--      could never line up with the evaluation system.
--   3. Creating a set requires being signed off for at least one seat. That is
--      what "approved means you are in the catalogue and can book" means, and
--      it had no enforcement anywhere.
--
-- READ BEFORE RUNNING — this one changes who can do something
-- ------------------------------------------------------------
-- Section 4 gates set creation on a signed-off seat. At the time of writing
-- there are 13 active members and ZERO qualifications, so on the day this runs
-- **only prayer room staff can create a set** until evaluators sign people off.
-- That is the intended behaviour and it was chosen deliberately: every existing
-- member is funnelled through the evaluators tab, which lists anyone with
-- nothing signed off, and an evaluator records what each person is approved for
-- on their profile. No sign-offs are seeded here — a sign-off is a record with
-- an evaluator's name on it, and inventing 13 of them would make the catalogue
-- a lie on its first day.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. The eleven seats
-- ────────────────────────────────────────────────────────────
-- Five already exist and only need renaming, so NOTHING is repointed: every
-- prayer_room_set_slots row keeps the seat_type_id it already had.
UPDATE public.prayer_room_seat_types SET label = 'WORSHIP LEADER',  category = 'lead',    is_lead = true,  sort_order = 1,  is_active = true WHERE id = 'worship_leader';
UPDATE public.prayer_room_seat_types SET label = 'PRAYER LEADER',   category = 'lead',    is_lead = true,  sort_order = 2,  is_active = true WHERE id = 'prayer_leader';
UPDATE public.prayer_room_seat_types SET label = 'ACOUSTIC GUITAR', category = 'worship', is_lead = false, sort_order = 3,  is_active = true WHERE id = 'acoustic';
UPDATE public.prayer_room_seat_types SET label = 'PIANO / KEYS',    category = 'worship', is_lead = false, sort_order = 6,  is_active = true WHERE id = 'keys';
UPDATE public.prayer_room_seat_types SET label = 'VOCAL',           category = 'worship', is_lead = false, sort_order = 11, is_active = true WHERE id = 'vocals';

-- Six new ones. MD is an ordinary seat: only WORSHIP LEADER and PRAYER LEADER
-- make a set "live" on the wall.
INSERT INTO public.prayer_room_seat_types (id, label, category, is_lead, sort_order) VALUES
  ('electric_guitar', 'ELECTRIC GUITAR', 'worship', false, 4),
  ('bass_guitar',     'BASS GUITAR',     'worship', false, 5),
  ('strings',         'STRINGS',         'worship', false, 7),
  ('md',              'MD',              'worship', false, 8),
  ('drums',           'DRUMS',           'worship', false, 9),
  ('cajon',           'CAJON',           'worship', false, 10)
ON CONFLICT (id) DO UPDATE
  SET label = EXCLUDED.label, category = EXCLUDED.category,
      is_lead = EXCLUDED.is_lead, sort_order = EXCLUDED.sort_order, is_active = true;

-- Retired, NOT deleted: prayer_room_set_slots rows still point at some of
-- these, and deleting the row would break the label on historical sets.
-- is_active = false is what every read already filters on.
UPDATE public.prayer_room_seat_types
   SET is_active = false
 WHERE id IN ('co_lead', 'sound', 'scribe', 'instrument');

-- ────────────────────────────────────────────────────────────
-- 2. What an applicant says they do
-- ────────────────────────────────────────────────────────────
-- prayer_room_application_skills points at `labels`, a generic taxonomy shared
-- with the rest of the Hub. It can never answer "has this person been
-- evaluated for drums", because a label is not a seat. This is the seat-shaped
-- version. The old table is left alone; nothing new writes to it.
CREATE TABLE IF NOT EXISTS public.prayer_room_application_seats (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id       uuid NOT NULL REFERENCES public.prayer_room_applications(id) ON DELETE CASCADE,
  seat_type_id         text NOT NULL REFERENCES public.prayer_room_seat_types(id),
  -- The applicant's OWN claim, not a verified fact. The evaluators' queue shows
  -- it beside whatever qualification actually exists, so the two can disagree
  -- visibly rather than one quietly overwriting the other.
  previously_evaluated boolean NOT NULL DEFAULT false,
  created_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (application_id, seat_type_id)
);

COMMENT ON TABLE public.prayer_room_application_seats IS
  'Seats an applicant says they play or lead, one row per seat, with their own claim about having been evaluated for it before.';
COMMENT ON COLUMN public.prayer_room_application_seats.previously_evaluated IS
  'Self-reported. Never treated as a qualification — an evaluator still has to sign the seat off.';

CREATE INDEX IF NOT EXISTS idx_pras_application ON public.prayer_room_application_seats(application_id);

ALTER TABLE public.prayer_room_application_seats ENABLE ROW LEVEL SECURITY;

-- Readable by the applicant, by staff, and by anyone who may evaluate that
-- seat — the same audience that can already read the application itself.
DROP POLICY IF EXISTS "Read application seats" ON public.prayer_room_application_seats;
CREATE POLICY "Read application seats" ON public.prayer_room_application_seats
  FOR SELECT TO authenticated
  USING (
    public.is_prayer_room_staff()
    OR COALESCE(public.can_evaluate_seat(seat_type_id), false)
    OR EXISTS (
      SELECT 1 FROM public.prayer_room_applications a
       WHERE a.id = application_id AND a.applicant_id = auth.uid()
    )
  );

-- Written only as part of your own application, while it is still open.
DROP POLICY IF EXISTS "Write own application seats" ON public.prayer_room_application_seats;
CREATE POLICY "Write own application seats" ON public.prayer_room_application_seats
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_prayer_room_staff()
    OR EXISTS (
      SELECT 1 FROM public.prayer_room_applications a
       WHERE a.id = application_id
         AND a.applicant_id = auth.uid()
         AND a.status IN ('applied', 'assigned', 'evaluated')
    )
  );

DROP POLICY IF EXISTS "Delete own application seats" ON public.prayer_room_application_seats;
CREATE POLICY "Delete own application seats" ON public.prayer_room_application_seats
  FOR DELETE TO authenticated
  USING (
    public.is_prayer_room_staff()
    OR EXISTS (
      SELECT 1 FROM public.prayer_room_applications a
       WHERE a.id = application_id
         AND a.applicant_id = auth.uid()
         AND a.status IN ('applied', 'assigned')
    )
  );

-- ────────────────────────────────────────────────────────────
-- 3. "In the catalogue" as something the database can answer
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_in_prayer_catalogue(p_user uuid DEFAULT auth.uid())
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.prayer_room_qualifications q
     WHERE q.user_id = p_user AND q.state = 'signed_off'
  );
$$;

COMMENT ON FUNCTION public.is_in_prayer_catalogue(uuid) IS
  'Signed off for at least one seat. This is what "approved, and can book without asking" means.';

-- ────────────────────────────────────────────────────────────
-- 4. Creating a set requires a seat  ← changes who can do something
-- ────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Create sets" ON public.prayer_room_sets;
CREATE POLICY "Create sets" ON public.prayer_room_sets
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_prayer_room_staff()
    OR (
      owner_id = auth.uid()
      AND public.is_prayer_room_member()
      AND public.is_in_prayer_catalogue()
    )
  );

-- ────────────────────────────────────────────────────────────
-- Rolling back section 4 only, if the gate turns out to be too early:
--
--   DROP POLICY IF EXISTS "Create sets" ON public.prayer_room_sets;
--   CREATE POLICY "Create sets" ON public.prayer_room_sets
--     FOR INSERT TO authenticated
--     WITH CHECK (
--       public.is_prayer_room_staff()
--       OR (owner_id = auth.uid() AND public.is_prayer_room_member())
--     );
-- ============================================================
