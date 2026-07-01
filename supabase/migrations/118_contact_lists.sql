-- ============================================================
-- FFSA Hub — Migration 118: Contact Lists
-- ============================================================
-- Ad-hoc, organizational groupings of contacts — e.g. "Camp 2026
-- Attendees", "March Fundraiser Invitees". Unlike labels, lists
-- carry NO marketing/email semantics: adding a contact to a list
-- does not subscribe them to anything, does not touch unsubscribes,
-- and does not feed campaign audiences. They are purely a way for
-- staff to gather people together for a purpose.
--
--   1. contact_lists         — the list itself (name, description)
--   2. contact_list_members  — join table: which contacts are in it
--
-- A contact may belong to many lists (like labels). Lists are shared
-- across staff (not private), so any authenticated user can read them
-- and anyone who can write contacts can create/manage them.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. contact_lists
-- ────────────────────────────────────────────────────────────

CREATE TABLE public.contact_lists (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  description text,
  color       text,
  created_by  uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_contact_lists_name ON public.contact_lists (name);

ALTER TABLE public.contact_lists ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Auth users can read contact lists"
  ON public.contact_lists FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Contacts writers can manage contact lists"
  ON public.contact_lists FOR ALL
  USING (
    public.is_admin()
    OR public.has_role('events_admin')
    OR public.has_permission('contacts.write')
    OR public.has_permission('contacts.edit')
    OR public.has_permission('contacts.create')
  )
  WITH CHECK (
    public.is_admin()
    OR public.has_role('events_admin')
    OR public.has_permission('contacts.write')
    OR public.has_permission('contacts.edit')
    OR public.has_permission('contacts.create')
  );

COMMENT ON TABLE public.contact_lists IS
  'Ad-hoc organizational grouping of contacts. Purely for gathering people (e.g. per event); NO email/marketing/unsubscribe semantics — that is what labels are for.';

-- ────────────────────────────────────────────────────────────
-- 2. contact_list_members
-- ────────────────────────────────────────────────────────────

CREATE TABLE public.contact_list_members (
  list_id    uuid NOT NULL REFERENCES public.contact_lists(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  added_at   timestamptz NOT NULL DEFAULT now(),
  added_by   uuid REFERENCES public.users(id) ON DELETE SET NULL,
  PRIMARY KEY (list_id, contact_id)
);

CREATE INDEX idx_contact_list_members_contact ON public.contact_list_members (contact_id);
CREATE INDEX idx_contact_list_members_list    ON public.contact_list_members (list_id);

ALTER TABLE public.contact_list_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Auth users can read contact list members"
  ON public.contact_list_members FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Contacts writers can manage contact list members"
  ON public.contact_list_members FOR ALL
  USING (
    public.is_admin()
    OR public.has_role('events_admin')
    OR public.has_permission('contacts.write')
    OR public.has_permission('contacts.edit')
    OR public.has_permission('contacts.create')
  )
  WITH CHECK (
    public.is_admin()
    OR public.has_role('events_admin')
    OR public.has_permission('contacts.write')
    OR public.has_permission('contacts.edit')
    OR public.has_permission('contacts.create')
  );

COMMENT ON TABLE public.contact_list_members IS
  'Join table: which contacts belong to each contact_list. Removing a row simply takes the contact out of the list — no side effects.';

-- ============================================================
-- Validation
-- ------------------------------------------------------------
--   SELECT count(*) FROM public.contact_lists;         -- expect 0
--   SELECT count(*) FROM public.contact_list_members;  -- expect 0
--   SELECT relname, relrowsecurity FROM pg_class
--   WHERE relname IN ('contact_lists', 'contact_list_members');
--   -- both relrowsecurity = true
-- ============================================================
