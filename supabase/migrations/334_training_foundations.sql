-- ============================================================
-- FFSA Hub — Migration 334: Training foundations (phone turn 48)
-- ============================================================
-- Data for the staff Training tab in the phone app. Design: turns
-- 48–49 of the redesign; spec handoff/21-training-phone.md and
-- handoff/22-training-code-map.md (prompt T1). No UI in this PR.
--
-- 1. enrollment_staff — "walking with". A student can have several
--    staff walking with her (decided 18 Nov 2026). Replaces the single
--    enrollments.assigned_staff_id (migration 052) for new code. The
--    old column stays because the website still writes it: a trigger
--    mirrors it into this table, and existing values are backfilled.
--
-- 2. student_checkins — one weekly check-in per staff member per
--    student: met / called / couldn't reach, a mood, a note the
--    student will read, and a "needs care" flag for the school leader.
--
-- 3. student_checkin_private — the staff-only note. Its own table so
--    RLS keeps it from the student, from other school staff, and from
--    outreach leaders without column-level tricks. Readable only by
--    its author, everyone walking with that student, and people with
--    has_schools_access (admins, schools.manage, the school's leaders).
--
-- 4. today_dismissals — a person ticking an item off their Today list
--    for one ISO week.
--
-- Deliberately NOT here: new activity_events types. activity_events
-- is readable by every signed-in user (migration 043, policy "Auth
-- users can read activity events"), students included, so check-ins,
-- care flags and talk requests must never be written there. The
-- student's journey is built from the school tables instead (T3).
--
-- Students never SELECT student_checkins. They read only the notes
-- written for them, through my_checkin_notes(), which returns no mood,
-- no care flag and nothing from the private table.
--
-- Idempotent. Safe to re-run. Apply by hand in the Supabase SQL
-- editor. Rollback: supabase/rollbacks/334_training_foundations.sql.
-- ============================================================


-- ────────────────────────────────────────────────────────────
-- 1. enrollment_staff
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.enrollment_staff (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id  uuid NOT NULL REFERENCES public.enrollments(id) ON DELETE CASCADE,
  user_id        uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  starts_on      date NOT NULL DEFAULT current_date,
  ends_on        date,
  source         text NOT NULL DEFAULT 'training'
    CHECK (source IN ('assigned_staff', 'training')),
  added_by       uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (enrollment_id, user_id),
  CHECK (ends_on IS NULL OR ends_on >= starts_on)
);

CREATE INDEX IF NOT EXISTS enrollment_staff_user_active_idx
  ON public.enrollment_staff (user_id) WHERE ends_on IS NULL;
CREATE INDEX IF NOT EXISTS enrollment_staff_enrollment_idx
  ON public.enrollment_staff (enrollment_id);

COMMENT ON TABLE public.enrollment_staff IS
  'Staff walking with a student (one or more per enrolment). Active while ends_on is null or in the future. source = assigned_staff rows are mirrored from enrollments.assigned_staff_id by trigger; new code reads this table only.';

-- Helpers. SECURITY DEFINER so policies on one table can ask about
-- another without recursive RLS.

CREATE OR REPLACE FUNCTION public.training_enrollment_program(target_enrollment_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT program_id FROM public.enrollments WHERE id = target_enrollment_id;
$$;

CREATE OR REPLACE FUNCTION public.is_walking_with(target_enrollment_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.enrollment_staff
    WHERE enrollment_id = target_enrollment_id
      AND user_id = auth.uid()
      AND (ends_on IS NULL OR ends_on > current_date)
  );
$$;

CREATE OR REPLACE FUNCTION public.walking_with_enrollment_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT enrollment_id
  FROM public.enrollment_staff
  WHERE user_id = auth.uid()
    AND (ends_on IS NULL OR ends_on > current_date);
$$;

CREATE OR REPLACE FUNCTION public.is_own_enrollment(target_enrollment_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.enrollments
    WHERE id = target_enrollment_id AND user_id = auth.uid()
  );
$$;

-- Staff of the school in the widest sense: managers (has_schools_access),
-- named program staff (migration 304), or someone walking with her.
CREATE OR REPLACE FUNCTION public.is_school_staff_for_enrollment(target_enrollment_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_walking_with(target_enrollment_id)
      OR public.has_schools_access(public.training_enrollment_program(target_enrollment_id))
      OR public.is_program_staff(public.training_enrollment_program(target_enrollment_id));
$$;

REVOKE ALL ON FUNCTION public.training_enrollment_program(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_walking_with(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.walking_with_enrollment_ids() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_own_enrollment(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_school_staff_for_enrollment(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.training_enrollment_program(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_walking_with(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.walking_with_enrollment_ids() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_own_enrollment(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_school_staff_for_enrollment(uuid) TO authenticated, service_role;

-- Keep updated_at honest.
CREATE OR REPLACE FUNCTION public.training_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enrollment_staff_touch ON public.enrollment_staff;
CREATE TRIGGER enrollment_staff_touch
  BEFORE UPDATE ON public.enrollment_staff
  FOR EACH ROW EXECUTE FUNCTION public.training_touch_updated_at();

-- Mirror the website's single assigned_staff_id into enrollment_staff.
-- Changing it ends the previous mirrored row (only rows that came from
-- the column; people added through Training are left alone).
CREATE OR REPLACE FUNCTION public.enrollment_staff_mirror_assigned()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.assigned_staff_id IS NOT NULL
     AND OLD.assigned_staff_id IS DISTINCT FROM NEW.assigned_staff_id THEN
    UPDATE public.enrollment_staff
       SET ends_on = GREATEST(starts_on, current_date)
     WHERE enrollment_id = NEW.id
       AND user_id = OLD.assigned_staff_id
       AND source = 'assigned_staff'
       AND ends_on IS NULL;
  END IF;

  IF NEW.assigned_staff_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR OLD.assigned_staff_id IS DISTINCT FROM NEW.assigned_staff_id) THEN
    INSERT INTO public.enrollment_staff (enrollment_id, user_id, starts_on, source, added_by)
    VALUES (NEW.id, NEW.assigned_staff_id, current_date, 'assigned_staff', NEW.staff_assigned_by)
    ON CONFLICT (enrollment_id, user_id)
      DO UPDATE SET ends_on = NULL;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enrollment_staff_mirror_assigned() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS enrollments_mirror_assigned_staff ON public.enrollments;
CREATE TRIGGER enrollments_mirror_assigned_staff
  AFTER INSERT OR UPDATE OF assigned_staff_id ON public.enrollments
  FOR EACH ROW EXECUTE FUNCTION public.enrollment_staff_mirror_assigned();

-- Backfill once. Re-running inserts nothing new.
INSERT INTO public.enrollment_staff (enrollment_id, user_id, starts_on, source, added_by)
SELECT e.id,
       e.assigned_staff_id,
       COALESCE(e.staff_assigned_at::date, current_date),
       'assigned_staff',
       e.staff_assigned_by
FROM public.enrollments e
WHERE e.assigned_staff_id IS NOT NULL
ON CONFLICT (enrollment_id, user_id) DO NOTHING;

ALTER TABLE public.enrollment_staff ENABLE ROW LEVEL SECURITY;

-- School staff see who walks with whom; a walker sees co-walkers; the
-- student sees the people walking with her (49c).
DROP POLICY IF EXISTS "Read enrollment staff" ON public.enrollment_staff;
CREATE POLICY "Read enrollment staff"
  ON public.enrollment_staff FOR SELECT
  USING (
    user_id = auth.uid()
    OR public.is_school_staff_for_enrollment(enrollment_id)
    OR public.is_own_enrollment(enrollment_id)
  );

DROP POLICY IF EXISTS "Managers add enrollment staff" ON public.enrollment_staff;
CREATE POLICY "Managers add enrollment staff"
  ON public.enrollment_staff FOR INSERT
  WITH CHECK (public.has_schools_access(public.training_enrollment_program(enrollment_id)));

DROP POLICY IF EXISTS "Managers change enrollment staff" ON public.enrollment_staff;
CREATE POLICY "Managers change enrollment staff"
  ON public.enrollment_staff FOR UPDATE
  USING (public.has_schools_access(public.training_enrollment_program(enrollment_id)))
  WITH CHECK (public.has_schools_access(public.training_enrollment_program(enrollment_id)));

DROP POLICY IF EXISTS "Managers remove enrollment staff" ON public.enrollment_staff;
CREATE POLICY "Managers remove enrollment staff"
  ON public.enrollment_staff FOR DELETE
  USING (public.has_schools_access(public.training_enrollment_program(enrollment_id)));

-- Every walker can read the enrolment, not only the one in the old column.
DROP POLICY IF EXISTS "Walkers can read their enrollments" ON public.enrollments;
CREATE POLICY "Walkers can read their enrollments"
  ON public.enrollments FOR SELECT
  USING (public.is_walking_with(id));


-- ────────────────────────────────────────────────────────────
-- 2. student_checkins
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.student_checkins (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id     uuid NOT NULL REFERENCES public.enrollments(id) ON DELETE CASCADE,
  program_id        uuid NOT NULL REFERENCES public.programs(id) ON DELETE CASCADE,
  week_of           date NOT NULL CHECK (EXTRACT(ISODOW FROM week_of) = 1),
  by_user_id        uuid NOT NULL DEFAULT auth.uid() REFERENCES public.users(id) ON DELETE CASCADE,
  contact           text NOT NULL CHECK (contact IN ('met', 'called', 'no_reach')),
  mood              text CHECK (mood IN ('hard', 'okay', 'good', 'great')),
  note_for_student  text,
  needs_care        boolean NOT NULL DEFAULT false,
  care_taken_by     uuid REFERENCES public.users(id) ON DELETE SET NULL,
  care_taken_at     timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (enrollment_id, week_of, by_user_id),
  CHECK (contact <> 'no_reach' OR mood IS NULL),
  CHECK ((care_taken_by IS NULL) = (care_taken_at IS NULL))
);

CREATE INDEX IF NOT EXISTS student_checkins_enrollment_week_idx
  ON public.student_checkins (enrollment_id, week_of DESC);
CREATE INDEX IF NOT EXISTS student_checkins_program_care_idx
  ON public.student_checkins (program_id)
  WHERE needs_care AND care_taken_at IS NULL;

COMMENT ON TABLE public.student_checkins IS
  'Weekly check-in by a staff member with a student (phone 48d). A missed week has no row. The staff-only note lives in student_checkin_private. Students never read this table; they get note_for_student through my_checkin_notes().';
COMMENT ON COLUMN public.student_checkins.week_of IS
  'Monday of the ISO week the check-in counts for.';
COMMENT ON COLUMN public.student_checkins.program_id IS
  'Copied from the enrolment by trigger; any value sent by a client is replaced.';

-- program_id always comes from the enrolment. Identity columns are
-- fixed after insert. Someone who is not the author (a leader or a
-- co-walker taking a care flag) may only change the care columns.
CREATE OR REPLACE FUNCTION public.student_checkins_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.program_id := (SELECT program_id FROM public.enrollments WHERE id = NEW.enrollment_id);
    IF NEW.program_id IS NULL THEN
      RAISE EXCEPTION 'student_checkins: unknown enrolment %', NEW.enrollment_id;
    END IF;
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  IF NEW.enrollment_id IS DISTINCT FROM OLD.enrollment_id
     OR NEW.program_id IS DISTINCT FROM OLD.program_id
     OR NEW.week_of IS DISTINCT FROM OLD.week_of
     OR NEW.by_user_id IS DISTINCT FROM OLD.by_user_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'student_checkins: student, week and author cannot change';
  END IF;

  IF auth.uid() IS NOT NULL
     AND auth.uid() IS DISTINCT FROM OLD.by_user_id
     AND (NEW.contact IS DISTINCT FROM OLD.contact
          OR NEW.mood IS DISTINCT FROM OLD.mood
          OR NEW.note_for_student IS DISTINCT FROM OLD.note_for_student
          OR NEW.needs_care IS DISTINCT FROM OLD.needs_care) THEN
    RAISE EXCEPTION 'student_checkins: only the author can change a check-in';
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.student_checkins_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS student_checkins_guard ON public.student_checkins;
CREATE TRIGGER student_checkins_guard
  BEFORE INSERT OR UPDATE ON public.student_checkins
  FOR EACH ROW EXECUTE FUNCTION public.student_checkins_guard();

ALTER TABLE public.student_checkins ENABLE ROW LEVEL SECURITY;

-- School staff (incl. program staff) see dates, contact, mood and the
-- care flag. The student does not. Outreach leaders get nothing here
-- unless they also hold school access.
DROP POLICY IF EXISTS "School staff read check-ins" ON public.student_checkins;
CREATE POLICY "School staff read check-ins"
  ON public.student_checkins FOR SELECT
  USING (
    by_user_id = auth.uid()
    OR public.is_school_staff_for_enrollment(enrollment_id)
  );

DROP POLICY IF EXISTS "School staff write check-ins" ON public.student_checkins;
CREATE POLICY "School staff write check-ins"
  ON public.student_checkins FOR INSERT
  WITH CHECK (
    by_user_id = auth.uid()
    AND public.is_school_staff_for_enrollment(enrollment_id)
    AND NOT public.is_own_enrollment(enrollment_id)
  );

DROP POLICY IF EXISTS "Author, walkers and leaders update check-ins" ON public.student_checkins;
CREATE POLICY "Author, walkers and leaders update check-ins"
  ON public.student_checkins FOR UPDATE
  USING (
    by_user_id = auth.uid()
    OR public.is_walking_with(enrollment_id)
    OR public.has_schools_access(program_id)
  )
  WITH CHECK (
    by_user_id = auth.uid()
    OR public.is_walking_with(enrollment_id)
    OR public.has_schools_access(program_id)
  );

DROP POLICY IF EXISTS "Author or leaders delete check-ins" ON public.student_checkins;
CREATE POLICY "Author or leaders delete check-ins"
  ON public.student_checkins FOR DELETE
  USING (
    by_user_id = auth.uid()
    OR public.has_schools_access(program_id)
  );



-- ────────────────────────────────────────────────────────────
-- 3. student_checkin_private — the staff-only note
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.student_checkin_private (
  checkin_id       uuid PRIMARY KEY REFERENCES public.student_checkins(id) ON DELETE CASCADE,
  note_staff_only  text NOT NULL CHECK (length(btrim(note_staff_only)) > 0),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.student_checkin_private IS
  'Staff-only note for a check-in. Read: the author, everyone walking with the student, has_schools_access. Never: the student, other program staff, outreach leaders. Never copy this text into activity_events, Slack, push or email.';

CREATE OR REPLACE FUNCTION public.is_checkin_author(target_checkin_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.student_checkins
    WHERE id = target_checkin_id AND by_user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.can_read_checkin_private(target_checkin_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.student_checkins c
    WHERE c.id = target_checkin_id
      AND (
        c.by_user_id = auth.uid()
        OR public.is_walking_with(c.enrollment_id)
        OR public.has_schools_access(c.program_id)
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.can_manage_checkin(target_checkin_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.student_checkins c
    WHERE c.id = target_checkin_id
      AND public.has_schools_access(c.program_id)
  );
$$;

REVOKE ALL ON FUNCTION public.is_checkin_author(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_read_checkin_private(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_manage_checkin(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_checkin_author(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_read_checkin_private(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_manage_checkin(uuid) TO authenticated, service_role;

DROP TRIGGER IF EXISTS student_checkin_private_touch ON public.student_checkin_private;
CREATE TRIGGER student_checkin_private_touch
  BEFORE UPDATE ON public.student_checkin_private
  FOR EACH ROW EXECUTE FUNCTION public.training_touch_updated_at();

ALTER TABLE public.student_checkin_private ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read staff-only check-in notes" ON public.student_checkin_private;
CREATE POLICY "Read staff-only check-in notes"
  ON public.student_checkin_private FOR SELECT
  USING (public.can_read_checkin_private(checkin_id));

DROP POLICY IF EXISTS "Author writes staff-only note" ON public.student_checkin_private;
CREATE POLICY "Author writes staff-only note"
  ON public.student_checkin_private FOR INSERT
  WITH CHECK (public.is_checkin_author(checkin_id));

DROP POLICY IF EXISTS "Author edits staff-only note" ON public.student_checkin_private;
CREATE POLICY "Author edits staff-only note"
  ON public.student_checkin_private FOR UPDATE
  USING (public.is_checkin_author(checkin_id))
  WITH CHECK (public.is_checkin_author(checkin_id));

DROP POLICY IF EXISTS "Author or leaders remove staff-only note" ON public.student_checkin_private;
CREATE POLICY "Author or leaders remove staff-only note"
  ON public.student_checkin_private FOR DELETE
  USING (public.is_checkin_author(checkin_id) OR public.can_manage_checkin(checkin_id));

-- What the student may read: only notes written for her, with who and
-- when. No mood, no care flag, nothing from the private table.
CREATE OR REPLACE FUNCTION public.my_checkin_notes()
RETURNS TABLE (
  checkin_id        uuid,
  enrollment_id     uuid,
  week_of           date,
  author_id         uuid,
  author_name       text,
  note_for_student  text,
  created_at        timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.id, c.enrollment_id, c.week_of, c.by_user_id, u.display_name,
         c.note_for_student, c.created_at
  FROM public.student_checkins c
  JOIN public.enrollments e ON e.id = c.enrollment_id
  LEFT JOIN public.users u ON u.id = c.by_user_id
  WHERE e.user_id = auth.uid()
    AND c.note_for_student IS NOT NULL
    AND length(btrim(c.note_for_student)) > 0
  ORDER BY c.week_of DESC, c.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.my_checkin_notes() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_checkin_notes() TO authenticated, service_role;


-- ────────────────────────────────────────────────────────────
-- 4. today_dismissals
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.today_dismissals (
  user_id     uuid NOT NULL DEFAULT auth.uid() REFERENCES public.users(id) ON DELETE CASCADE,
  item_key    text NOT NULL CHECK (length(item_key) BETWEEN 1 AND 200),
  iso_week    text NOT NULL CHECK (iso_week ~ '^[0-9]{4}-W[0-9]{2}$'),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, item_key, iso_week)
);

COMMENT ON TABLE public.today_dismissals IS
  'A Today item (phone 48a) ticked off by its owner for one ISO week, e.g. 2026-W48. Only hides the line; the work itself is done elsewhere.';

ALTER TABLE public.today_dismissals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Own today dismissals read" ON public.today_dismissals;
CREATE POLICY "Own today dismissals read"
  ON public.today_dismissals FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Own today dismissals add" ON public.today_dismissals;
CREATE POLICY "Own today dismissals add"
  ON public.today_dismissals FOR INSERT
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Own today dismissals remove" ON public.today_dismissals;
CREATE POLICY "Own today dismissals remove"
  ON public.today_dismissals FOR DELETE
  USING (user_id = auth.uid());


-- ────────────────────────────────────────────────────────────
-- 5. Grants (lesson of migration 308: no anon, no TRUNCATE)
-- ────────────────────────────────────────────────────────────

REVOKE ALL ON TABLE public.enrollment_staff, public.student_checkins,
  public.student_checkin_private, public.today_dismissals FROM anon;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLE public.enrollment_staff,
  public.student_checkins, public.student_checkin_private,
  public.today_dismissals FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.enrollment_staff,
  public.student_checkins, public.student_checkin_private TO authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE public.today_dismissals TO authenticated;
REVOKE UPDATE ON TABLE public.today_dismissals FROM authenticated;
GRANT ALL ON TABLE public.enrollment_staff, public.student_checkins,
  public.student_checkin_private, public.today_dismissals TO service_role;
