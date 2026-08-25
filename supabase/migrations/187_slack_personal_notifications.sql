-- ────────────────────────────────────────────────────────────
-- 187: Personal Slack notifications — broadcast DMs
-- ────────────────────────────────────────────────────────────
-- Migration 069 laid the groundwork (notifications,
-- notification_preferences, slack_settings, users.slack_user_id) but
-- nothing ever wrote a DM. This migration adds the two things the
-- broadcast engine needs on top of that:
--
--   1. Audit columns on users.slack_user_id, so we can tell a
--      self-entered member id from one we matched by email.
--   2. notification_preferences.muted_modules — the per-module
--      opt-out. Recipients are always DERIVED (from broadcast scope
--      or permissions); preferences only ever subtract. There is no
--      "subscribe" anywhere, so a preferences row can never go stale
--      against someone's actual access.
--
-- The 069 tier columns (tier1_dm_enabled / tier2_digest_enabled /
-- digest_hour_utc) are deliberately left alone but are NOT used by
-- the broadcast engine — they belong to the never-wired tier model in
-- src/lib/slack/routing.ts.
-- ────────────────────────────────────────────────────────────

-- ── 1. Slack link audit ─────────────────────────────────────

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS slack_linked_at  timestamptz,
  ADD COLUMN IF NOT EXISTS slack_link_source text
    CHECK (slack_link_source IS NULL OR slack_link_source IN
      ('self', 'admin', 'email_match'));

COMMENT ON COLUMN public.users.slack_linked_at IS
  'When slack_user_id was last set. NULL means never linked.';

COMMENT ON COLUMN public.users.slack_link_source IS
  'How slack_user_id was established: self = the user pasted their member id on /profile; email_match = auto-matched via users.lookupByEmail; admin = set by an admin on /settings/slack.';

-- Broadcasts fan out over "every active user with a slack_user_id",
-- so that lookup wants an index.
CREATE INDEX IF NOT EXISTS idx_users_slack_linked
  ON public.users (slack_user_id)
  WHERE slack_user_id IS NOT NULL;

-- ── 2. Per-module mute ──────────────────────────────────────

ALTER TABLE public.notification_preferences
  ADD COLUMN IF NOT EXISTS muted_modules text[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.notification_preferences.muted_modules IS
  'Module keys this user has muted (e.g. {prayer_room}). Keys come from the BROADCAST_TYPES registry in src/lib/slack/broadcast-types.ts. Empty array = receive everything. Absent row = same as empty.';

-- ── 3. RLS: let a user maintain their own prefs row ─────────
-- 069 created select/insert policies for own-row; the prefs UI also
-- needs UPDATE to toggle a module off again.

DROP POLICY IF EXISTS notification_preferences_update_own ON public.notification_preferences;
CREATE POLICY notification_preferences_update_own
  ON public.notification_preferences FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
