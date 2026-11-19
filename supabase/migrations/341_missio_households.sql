-- ============================================================
-- FFSA Hub — Migration 341: Missio households
-- ============================================================
-- Depends on 329 (contacts in Missio), 338 (missio_my_house_ids).
-- Board M14a.
--
-- People belong to families. A household links adults (contacts)
-- and children, so a family is placed together, multiplies together
-- and gets one family message. One adult is the main contact.
--
-- Children are not contacts: only a first name, an optional
-- surname and a birth year are kept. They never get messages.
--
-- Separate from public.households (FFSA staff households with
-- passports and insurance); nothing here touches that.
--
-- Pastors read and write. House leaders and coaches read the
-- households of adults in their houses (children's first names and
-- birth year only).
--
-- Idempotent.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.missio_households (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid NOT NULL REFERENCES public.organisations (id) ON DELETE CASCADE,
  name             text CHECK (name IS NULL OR char_length(name) BETWEEN 1 AND 80),
  main_contact_id  uuid REFERENCES public.contacts (id) ON DELETE SET NULL,
  created_by       uuid REFERENCES public.users (id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.missio_household_members (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id  uuid NOT NULL REFERENCES public.missio_households (id) ON DELETE CASCADE,
  kind          text NOT NULL CHECK (kind IN ('adult', 'child')),
  contact_id    uuid REFERENCES public.contacts (id) ON DELETE CASCADE,
  first_name    text CHECK (first_name IS NULL OR char_length(first_name) BETWEEN 1 AND 60),
  last_name     text CHECK (last_name IS NULL OR char_length(last_name) BETWEEN 1 AND 60),
  birth_year    integer CHECK (birth_year IS NULL OR birth_year BETWEEN 1990 AND 2100),
  label         text CHECK (label IS NULL OR char_length(label) BETWEEN 1 AND 30),
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT missio_household_member_shape CHECK (
    (kind = 'adult' AND contact_id IS NOT NULL AND first_name IS NULL AND birth_year IS NULL)
    OR (kind = 'child' AND contact_id IS NULL AND first_name IS NOT NULL AND birth_year IS NOT NULL)
  )
);

-- An adult is in one household.
CREATE UNIQUE INDEX IF NOT EXISTS missio_household_members_contact_uidx
  ON public.missio_household_members (contact_id)
  WHERE contact_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS missio_household_members_household_idx
  ON public.missio_household_members (household_id);
CREATE INDEX IF NOT EXISTS missio_households_org_idx
  ON public.missio_households (org_id);

COMMENT ON TABLE public.missio_households IS
  'Missio families (board M14a). One main contact gets family messages. Not the FFSA staff households table.';
COMMENT ON TABLE public.missio_household_members IS
  'Adults are contacts. Children keep a first name, optional surname and birth year only, and never get messages.';

DROP TRIGGER IF EXISTS set_updated_at ON public.missio_households;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.missio_households
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

ALTER TABLE public.missio_households ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.missio_household_members ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.missio_households FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.missio_household_members FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.missio_households TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.missio_household_members TO authenticated;
GRANT ALL ON TABLE public.missio_households TO service_role;
GRANT ALL ON TABLE public.missio_household_members TO service_role;

-- Pastors: everything in Missio.
DROP POLICY IF EXISTS "Pastors manage households" ON public.missio_households;
CREATE POLICY "Pastors manage households"
  ON public.missio_households
  FOR ALL
  TO authenticated
  USING (
    (SELECT public.has_org_role('missio', ARRAY['pastor']))
    AND org_id = (SELECT o.id FROM public.organisations o WHERE o.slug = 'missio')
  )
  WITH CHECK (
    (SELECT public.has_org_role('missio', ARRAY['pastor']))
    AND org_id = (SELECT o.id FROM public.organisations o WHERE o.slug = 'missio')
  );

DROP POLICY IF EXISTS "Pastors manage household members" ON public.missio_household_members;
CREATE POLICY "Pastors manage household members"
  ON public.missio_household_members
  FOR ALL
  TO authenticated
  USING (
    (SELECT public.has_org_role('missio', ARRAY['pastor']))
    AND EXISTS (
      SELECT 1 FROM public.missio_households h
      WHERE h.id = household_id
        AND h.org_id = (SELECT o.id FROM public.organisations o WHERE o.slug = 'missio')
    )
  )
  WITH CHECK (
    (SELECT public.has_org_role('missio', ARRAY['pastor']))
    AND EXISTS (
      SELECT 1 FROM public.missio_households h
      WHERE h.id = household_id
        AND h.org_id = (SELECT o.id FROM public.organisations o WHERE o.slug = 'missio')
    )
  );

-- Coaches and leaders: households with an adult in one of their houses.
CREATE OR REPLACE FUNCTION public.missio_my_household_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT DISTINCT m.household_id
  FROM public.missio_household_members m
  JOIN public.house_church_members hcm
    ON hcm.contact_id = m.contact_id
   AND hcm.ended_at IS NULL
  WHERE m.kind = 'adult'
    AND hcm.house_church_id IN (SELECT public.missio_my_house_ids())
$$;

REVOKE ALL ON FUNCTION public.missio_my_household_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.missio_my_household_ids() TO authenticated, service_role;

DROP POLICY IF EXISTS "House leaders and coaches read their households" ON public.missio_households;
CREATE POLICY "House leaders and coaches read their households"
  ON public.missio_households
  FOR SELECT
  TO authenticated
  USING (id IN (SELECT public.missio_my_household_ids()));

DROP POLICY IF EXISTS "House leaders and coaches read their household members" ON public.missio_household_members;
CREATE POLICY "House leaders and coaches read their household members"
  ON public.missio_household_members
  FOR SELECT
  TO authenticated
  USING (household_id IN (SELECT public.missio_my_household_ids()));
