-- ============================================================
-- FFSA Hub — Migration 404: Operations → the guide (bit 0)
-- ============================================================
-- docs/operations-plan.md, "Every area has a guide and a handover".
-- Each Operations area has a guide in two parts:
--
--   HOW WE DO IT        ops_guide_pages — written by the team in the Hub;
--                       every save is kept in ops_guide_page_versions.
--   RESOURCES           ops_guide_links — the forms, templates and docs the
--                       area uses, each with a note on when and why.
--   HOW THE HUB DOES IT kept with the code (src/lib/operations/content/
--                       guide-hub.json), not in the database.
--
-- Who: everyone in Operations (is_ops_team) reads every guide. Only the
-- area's LEAD writes it: a permission given on the Hub, so the role can
-- move from person to person. Admins pass.
--   maintenance → operations.maintenance.lead     (new)
--   hospitality → operations.hospitality.lead     (new)
--   teams       → operations.visiting_teams.lead  (migration 402)
--   any other   → operations.<area>.lead          (added with its area)
--
-- Needs 400 (is_ops_team). Run after 402.
--
-- ROLLBACK:
--   DROP TABLE IF EXISTS public.ops_guide_page_versions, public.ops_guide_pages,
--     public.ops_guide_links;
--   DROP FUNCTION IF EXISTS public.is_ops_area_lead(text),
--     public.ops_guide_pages_version(), public.ops_guide_touch();
--   DELETE FROM public.permissions
--    WHERE key IN ('operations.maintenance.lead', 'operations.hospitality.lead');
-- ============================================================

-- ── 1. Lead roles ───────────────────────────────────────────
INSERT INTO public.permissions (module, key, display_name, sort_order) VALUES
  ('operations', 'operations.maintenance.lead',
   'Maintenance lead: edits the Maintenance guide and runs its handovers', 21),
  ('operations', 'operations.hospitality.lead',
   'Hospitality lead: edits the Hospitality guide (base housing, kitchens) and runs its handovers', 22)
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.is_ops_area_lead(area text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT public.is_admin() OR public.has_permission(
    CASE area WHEN 'teams' THEN 'operations.visiting_teams.lead'
              ELSE 'operations.' || area || '.lead' END);
$$;
REVOKE ALL ON FUNCTION public.is_ops_area_lead(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_ops_area_lead(text) TO authenticated;

-- ── 2. How we do it ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ops_guide_pages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  area        text NOT NULL CHECK (area IN ('maintenance','transport','buildings','hospitality',
                                            'teams','events','equipment','innovations')),
  title       text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 120),
  body        text NOT NULL DEFAULT '' CHECK (length(body) <= 60000),
  sort        integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid REFERENCES public.users (id) ON DELETE SET NULL DEFAULT auth.uid()
);
CREATE INDEX IF NOT EXISTS ops_guide_pages_area_idx ON public.ops_guide_pages (area, sort);

-- Every save, newest last: the page can always be put back.
CREATE TABLE IF NOT EXISTS public.ops_guide_page_versions (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  page_id    uuid NOT NULL REFERENCES public.ops_guide_pages (id) ON DELETE CASCADE,
  title      text NOT NULL,
  body       text NOT NULL,
  edited_by  uuid REFERENCES public.users (id) ON DELETE SET NULL,
  edited_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ops_guide_page_versions_page_idx
  ON public.ops_guide_page_versions (page_id, edited_at DESC);

-- ── 3. Resources ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ops_guide_links (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  area        text NOT NULL CHECK (area IN ('maintenance','transport','buildings','hospitality',
                                            'teams','events','equipment','innovations')),
  section     text,                                   -- "Communication to leaders"
  title       text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 160),
  url         text CHECK (url IS NULL OR url ~* '^https?://'),
  note        text CHECK (note IS NULL OR length(note) <= 4000),  -- when and why it's used
  sort        integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid REFERENCES public.users (id) ON DELETE SET NULL DEFAULT auth.uid()
);
CREATE INDEX IF NOT EXISTS ops_guide_links_area_idx ON public.ops_guide_links (area, sort);

-- ── 4. Triggers ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ops_guide_touch()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  NEW.updated_by := COALESCE(auth.uid(), NEW.updated_by);
  IF TG_OP = 'UPDATE' AND NEW.area IS DISTINCT FROM OLD.area THEN
    RAISE EXCEPTION 'A guide page stays in its area';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ops_guide_pages_touch ON public.ops_guide_pages;
CREATE TRIGGER ops_guide_pages_touch BEFORE INSERT OR UPDATE ON public.ops_guide_pages
  FOR EACH ROW EXECUTE FUNCTION public.ops_guide_touch();
DROP TRIGGER IF EXISTS ops_guide_links_touch ON public.ops_guide_links;
CREATE TRIGGER ops_guide_links_touch BEFORE INSERT OR UPDATE ON public.ops_guide_links
  FOR EACH ROW EXECUTE FUNCTION public.ops_guide_touch();

CREATE OR REPLACE FUNCTION public.ops_guide_pages_version()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' OR OLD.title IS DISTINCT FROM NEW.title OR OLD.body IS DISTINCT FROM NEW.body THEN
    INSERT INTO public.ops_guide_page_versions (page_id, title, body, edited_by)
    VALUES (NEW.id, NEW.title, NEW.body, COALESCE(auth.uid(), NEW.updated_by));
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.ops_guide_pages_version() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS ops_guide_pages_version ON public.ops_guide_pages;
CREATE TRIGGER ops_guide_pages_version AFTER INSERT OR UPDATE ON public.ops_guide_pages
  FOR EACH ROW EXECUTE FUNCTION public.ops_guide_pages_version();

-- ── 5. RLS ──────────────────────────────────────────────────
ALTER TABLE public.ops_guide_pages          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ops_guide_page_versions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ops_guide_links          ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.ops_guide_pages, public.ops_guide_page_versions, public.ops_guide_links FROM anon;

-- Pages: Operations reads; the area's lead writes.
DROP POLICY IF EXISTS ops_guide_pages_select ON public.ops_guide_pages;
CREATE POLICY ops_guide_pages_select ON public.ops_guide_pages
  FOR SELECT TO authenticated USING (public.is_ops_team());
DROP POLICY IF EXISTS ops_guide_pages_insert ON public.ops_guide_pages;
CREATE POLICY ops_guide_pages_insert ON public.ops_guide_pages
  FOR INSERT TO authenticated WITH CHECK (public.is_ops_area_lead(area));
DROP POLICY IF EXISTS ops_guide_pages_update ON public.ops_guide_pages;
CREATE POLICY ops_guide_pages_update ON public.ops_guide_pages
  FOR UPDATE TO authenticated
  USING (public.is_ops_area_lead(area)) WITH CHECK (public.is_ops_area_lead(area));
DROP POLICY IF EXISTS ops_guide_pages_delete ON public.ops_guide_pages;
CREATE POLICY ops_guide_pages_delete ON public.ops_guide_pages
  FOR DELETE TO authenticated USING (public.is_ops_area_lead(area));

-- Versions: read-only (written by the trigger).
DROP POLICY IF EXISTS ops_guide_page_versions_select ON public.ops_guide_page_versions;
CREATE POLICY ops_guide_page_versions_select ON public.ops_guide_page_versions
  FOR SELECT TO authenticated USING (public.is_ops_team());

-- Resources: same as pages.
DROP POLICY IF EXISTS ops_guide_links_select ON public.ops_guide_links;
CREATE POLICY ops_guide_links_select ON public.ops_guide_links
  FOR SELECT TO authenticated USING (public.is_ops_team());
DROP POLICY IF EXISTS ops_guide_links_insert ON public.ops_guide_links;
CREATE POLICY ops_guide_links_insert ON public.ops_guide_links
  FOR INSERT TO authenticated WITH CHECK (public.is_ops_area_lead(area));
DROP POLICY IF EXISTS ops_guide_links_update ON public.ops_guide_links;
CREATE POLICY ops_guide_links_update ON public.ops_guide_links
  FOR UPDATE TO authenticated
  USING (public.is_ops_area_lead(area)) WITH CHECK (public.is_ops_area_lead(area));
DROP POLICY IF EXISTS ops_guide_links_delete ON public.ops_guide_links;
CREATE POLICY ops_guide_links_delete ON public.ops_guide_links
  FOR DELETE TO authenticated USING (public.is_ops_area_lead(area));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ops_guide_pages, public.ops_guide_links TO authenticated;
GRANT SELECT ON public.ops_guide_page_versions TO authenticated;
