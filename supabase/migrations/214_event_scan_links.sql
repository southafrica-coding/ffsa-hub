-- 214: Shareable door-scanner links for people with no Hub account
--
-- An organiser running a door needs a welcome team: people who scan tickets
-- for one night and never touch the Hub again. Giving each of them a Hub
-- account and an events.manage_attendance grant is the wrong shape — it is
-- slow to set up, and it hands a volunteer far more than a door needs.
--
-- Instead: ONE standing, rotatable token per event. The organiser copies
-- /scan/<token> to their team; rotating kills every copy already out there.
-- The token IS the credential, so it is 24 random bytes and the table is
-- never readable from the browser — the public page resolves it through a
-- route handler on the service-role client.

-- ────────────────────────────────────────────────────────────
-- 1. THE LINK
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.event_scan_links (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  token       text NOT NULL UNIQUE,
  is_active   boolean NOT NULL DEFAULT true,
  created_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  rotated_at  timestamptz,
  -- Hard stop independent of is_active: a link nobody remembers to turn off
  -- should not still open a door months after the event. Set on creation
  -- from the event's end date; NULL means no expiry (never set by the app).
  expires_at  timestamptz
);

-- One ACTIVE link per event. Rotation flips the old row inactive first, so
-- the partial unique index is what actually enforces "one standing token".
CREATE UNIQUE INDEX IF NOT EXISTS event_scan_links_one_active_per_event
  ON public.event_scan_links (event_id)
  WHERE is_active;

CREATE INDEX IF NOT EXISTS event_scan_links_token_idx
  ON public.event_scan_links (token);

ALTER TABLE public.event_scan_links ENABLE ROW LEVEL SECURITY;

-- No anon policy, by design — see the header. Only staff who can already
-- manage attendance can see or mint a link, and they do it through the
-- authenticated admin routes.
DROP POLICY IF EXISTS "Attendance managers manage scan links"
  ON public.event_scan_links;
CREATE POLICY "Attendance managers manage scan links"
  ON public.event_scan_links FOR ALL
  USING (
    public.is_admin()
    OR public.has_permission('events.manage_attendance')
    OR public.has_permission('events.manage')
  )
  WITH CHECK (
    public.is_admin()
    OR public.has_permission('events.manage_attendance')
    OR public.has_permission('events.manage')
  );

-- ────────────────────────────────────────────────────────────
-- 2. SCANS BY PEOPLE WHO AREN'T HUB USERS
-- ────────────────────────────────────────────────────────────
--
-- tickets.checked_in_by is a FK to a Hub user, which a door volunteer on a
-- shared link is not. Rather than lose the audit trail entirely, record the
-- name they typed on the scanner and which link they came through. The FK
-- stays for staff scans, so existing rows and the roster's "By" column are
-- untouched.

ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS checked_in_by_name text,
  ADD COLUMN IF NOT EXISTS checked_in_via_link uuid
                             REFERENCES public.event_scan_links(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.tickets.checked_in_by_name IS
  'Self-declared name of a non-Hub door volunteer who scanned this ticket. Unverified — attribution, not identity.';

-- checked_in_by was already nullable; assert it so a future tightening
-- cannot silently break token scans.
ALTER TABLE public.tickets ALTER COLUMN checked_in_by DROP NOT NULL;
