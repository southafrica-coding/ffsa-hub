-- 136_list_options.sql
-- Generic, admin-editable option lists (dropdown vocabularies) so a super
-- admin can add / rename / reorder / deactivate options without a code deploy
-- or a hand-run migration.
--
-- One row per option. `list_key` groups options into a list. The app reads
-- these at render time; the hard-coded arrays in src/lib/profile/options.ts
-- remain as the seed source and as a runtime fallback if the table is empty.

CREATE TABLE IF NOT EXISTS public.list_options (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  list_key    text NOT NULL,          -- 'department' | 'insurance_provider' | 'gender' | 'relationship'
  value       text NOT NULL,          -- stored value written onto user/contact rows
  label       text NOT NULL,          -- display label
  sort_order  integer NOT NULL DEFAULT 0,
  is_active   boolean NOT NULL DEFAULT true,
  is_system   boolean NOT NULL DEFAULT false,  -- protects sentinels (e.g. 'other') from deletion
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (list_key, value)
);

CREATE INDEX IF NOT EXISTS list_options_key_order_idx
  ON public.list_options (list_key, sort_order);

ALTER TABLE public.list_options ENABLE ROW LEVEL SECURITY;

-- Anyone logged in can read the lists (they drive dropdowns everywhere).
DROP POLICY IF EXISTS "list_options_read" ON public.list_options;
CREATE POLICY "list_options_read" ON public.list_options
  FOR SELECT TO authenticated
  USING (true);

-- Only super_admin / admin can change them.
DROP POLICY IF EXISTS "list_options_manage" ON public.list_options;
CREATE POLICY "list_options_manage" ON public.list_options
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ── Seed from the current hard-coded arrays ────────────────────────────────
-- Idempotent: ON CONFLICT DO NOTHING keeps re-runs and manual edits safe.

INSERT INTO public.list_options (list_key, value, label, sort_order, is_system) VALUES
  -- Staff departments (from DEPARTMENT_LABELS)
  ('department', 'leadership_team',    'Leadership Team',    0, false),
  ('department', 'prayer_and_worship', 'Prayer and Worship', 1, false),
  ('department', 'media',              'Media',              2, false),
  ('department', 'hulk',               'Hulk',               3, false),
  ('department', 'operations',         'Operations',         4, false),
  ('department', 'training',           'Training',           5, false),
  ('department', 'project_54',         'Project 54',         6, false),
  ('department', 'education',          'Education',          7, false),
  ('department', 'woven',              'Woven',              8, false),

  -- Gender
  ('gender', 'male',              'Male',               0, false),
  ('gender', 'female',            'Female',             1, false),
  ('gender', 'prefer_not_to_say', 'Prefer not to say',  2, false),

  -- Emergency-contact relationship ('other' is a sentinel the form depends on)
  ('relationship', 'parent',   'Parent',                   0, false),
  ('relationship', 'spouse',   'Spouse',                   1, false),
  ('relationship', 'sibling',  'Sibling',                  2, false),
  ('relationship', 'child',    'Child',                    3, false),
  ('relationship', 'guardian', 'Guardian',                 4, false),
  ('relationship', 'friend',   'Friend',                   5, false),
  ('relationship', 'pastor',   'Pastor / Spiritual leader',6, false),
  ('relationship', 'other',    'Other',                    7, true),

  -- Health insurance providers ('other' reveals a free-text field)
  ('insurance_provider', 'Discovery Health', 'Discovery Health',            0, false),
  ('insurance_provider', 'Bonitas',          'Bonitas',                     1, false),
  ('insurance_provider', 'Momentum Health',  'Momentum Health',             2, false),
  ('insurance_provider', 'Medihelp',         'Medihelp',                    3, false),
  ('insurance_provider', 'Fedhealth',        'Fedhealth',                   4, false),
  ('insurance_provider', 'Bestmed',          'Bestmed',                     5, false),
  ('insurance_provider', 'GEMS',             'GEMS (Government Employees)',  6, false),
  ('insurance_provider', 'Polmed',           'Polmed (Police)',             7, false),
  ('insurance_provider', 'Profmed',          'Profmed',                     8, false),
  ('insurance_provider', 'Sizwe Hosmed',     'Sizwe Hosmed',                9, false),
  ('insurance_provider', 'Liberty Health',   'Liberty Health',             10, false),
  ('insurance_provider', 'other',            'Other (specify)',            11, true)
ON CONFLICT (list_key, value) DO NOTHING;
