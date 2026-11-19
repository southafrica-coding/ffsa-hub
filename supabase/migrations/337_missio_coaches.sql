-- ============================================================
-- FFSA Hub — Migration 337: Missio coaches
-- ============================================================
-- Depends on 329 (organisations, contacts, users, has_org_role,
-- handle_updated_at, org_people) and 331 (house_churches).
--
-- A coach is pastoral covering for a house's leaders (Jack):
-- pastors place people, leaders receive them, coaches cover. A
-- coach is never an approval step. This file only records who
-- coaches which house. Coach logins and the coach's own view come
-- with the roles work (M10).
--
-- One open coach per house at a time. Changing the coach ends the
-- open row (ended_at = today) and inserts a new one, so the history
-- stays. A coach must be a Missio person (an org_people row).
--
-- Same wall as 331: every policy calls
-- (SELECT public.has_org_role('missio', ARRAY['pastor'])) and checks
-- the house belongs to the missio organisation. FFSA roles are not
-- consulted. Nothing is ever deleted by authenticated users.
--
-- Idempotent: CREATE IF NOT EXISTS, DROP POLICY IF EXISTS.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.missio_coach_assignments (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  house_church_id   uuid NOT NULL REFERENCES public.house_churches (id) ON DELETE CASCADE,
  coach_contact_id  uuid NOT NULL REFERENCES public.contacts (id) ON DELETE RESTRICT,
  started_at        date NOT NULL DEFAULT current_date,
  ended_at          date CHECK (ended_at IS NULL OR ended_at >= started_at),
  created_by        uuid DEFAULT auth.uid() REFERENCES public.users (id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS missio_coach_assignments_open_house_uidx
  ON public.missio_coach_assignments (house_church_id)
  WHERE ended_at IS NULL;

CREATE INDEX IF NOT EXISTS missio_coach_assignments_coach_idx
  ON public.missio_coach_assignments (coach_contact_id);

COMMENT ON TABLE public.missio_coach_assignments IS
  'Who coaches a Missio house church. One open row per house; changing the coach ends the open row and inserts a new one. Pastoral covering only, never an approval step.';

DROP TRIGGER IF EXISTS set_updated_at ON public.missio_coach_assignments;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.missio_coach_assignments
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

ALTER TABLE public.missio_coach_assignments ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.missio_coach_assignments FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.missio_coach_assignments TO authenticated;
GRANT UPDATE (ended_at) ON TABLE public.missio_coach_assignments TO authenticated;
GRANT ALL ON TABLE public.missio_coach_assignments TO service_role;

DROP POLICY IF EXISTS "Pastors can read coach assignments" ON public.missio_coach_assignments;
CREATE POLICY "Pastors can read coach assignments"
  ON public.missio_coach_assignments
  FOR SELECT
  TO authenticated
  USING (
    (SELECT public.has_org_role('missio', ARRAY['pastor']))
    AND EXISTS (
      SELECT 1
      FROM public.house_churches hc
      WHERE hc.id = house_church_id
        AND hc.org_id = (SELECT o.id FROM public.organisations o WHERE o.slug = 'missio')
    )
  );

DROP POLICY IF EXISTS "Pastors can add coach assignments" ON public.missio_coach_assignments;
CREATE POLICY "Pastors can add coach assignments"
  ON public.missio_coach_assignments
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (SELECT public.has_org_role('missio', ARRAY['pastor']))
    AND ended_at IS NULL
    AND EXISTS (
      SELECT 1
      FROM public.house_churches hc
      WHERE hc.id = house_church_id
        AND hc.org_id = (SELECT o.id FROM public.organisations o WHERE o.slug = 'missio')
        AND EXISTS (
          SELECT 1
          FROM public.org_people op
          WHERE op.org_id = hc.org_id
            AND op.contact_id = missio_coach_assignments.coach_contact_id
        )
    )
  );

DROP POLICY IF EXISTS "Pastors can end coach assignments" ON public.missio_coach_assignments;
CREATE POLICY "Pastors can end coach assignments"
  ON public.missio_coach_assignments
  FOR UPDATE
  TO authenticated
  USING (
    (SELECT public.has_org_role('missio', ARRAY['pastor']))
    AND EXISTS (
      SELECT 1
      FROM public.house_churches hc
      WHERE hc.id = house_church_id
        AND hc.org_id = (SELECT o.id FROM public.organisations o WHERE o.slug = 'missio')
    )
  )
  WITH CHECK (
    (SELECT public.has_org_role('missio', ARRAY['pastor']))
    AND EXISTS (
      SELECT 1
      FROM public.house_churches hc
      WHERE hc.id = house_church_id
        AND hc.org_id = (SELECT o.id FROM public.organisations o WHERE o.slug = 'missio')
    )
  );
