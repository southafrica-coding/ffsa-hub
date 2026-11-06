-- ============================================================
-- FFSA Hub — Migration 302: Communications RLS orphan keys,
--            and public reads for email image buckets
-- ============================================================
--
-- DO NOT APPLY.
-- Draft only. Do not run this file in production, in a branch
-- database, or in any other database. Do not merge the pull
-- request that carries it until someone has decided to apply it
-- by hand in the Supabase SQL editor.
--
-- Once-only. It does not insert permission rows, role grants, or
-- email_templates. Re-running it is safe: each policy is dropped
-- and recreated, so a second run replaces the same definitions
-- and does not add a second copy.
--
-- ── 1. Orphan permission keys ──
--
-- communications.view and communications.send are referenced by
-- RLS (migrations 141, 187, 188) and are not rows in
-- public.permissions. has_permission() on a missing key never
-- matches a user_permissions or role_permissions grant, so those
-- branches are dead.
--
-- They are not the product keys. The seeded communications-module
-- keys are communications.send_announcements, communications.send_emails,
-- communications.manage_templates (014), forms.read, forms.manage,
-- campaigns.read, campaigns.draft, campaigns.send, unsubscribes.manage
-- (048), communications.manage_labels, communications.manage_brand_kits
-- (142). This file does not invent keys and does not seed the two
-- orphan names.
--
-- Each dead predicate is replaced with the seeded key that matches
-- what that clause was doing. Every other predicate is copied
-- unchanged, including is_admin() and the events / finance / contacts
-- branches. comms_admin is not added: it was not on these policies.
-- No one is granted comms_admin. email_templates is left empty.
--
--   email_messages SELECT "Staff can read email messages"
--     communications.view
--       → campaigns.read
--     Read of the delivery ledger, written beside events.view and
--     contacts.view. campaigns.read is the seeded "View campaigns
--     + analytics" key (048).
--
--   consent_events SELECT "Staff can read consent events"
--     communications.view
--       → campaigns.read
--     Read of the consent log, beside contacts.view / contacts.edit.
--     Same view key: this is the audience record campaigns.read is for.
--
--   consent_events INSERT "Staff can write consent events"
--     communications.send
--       → communications.send_emails
--       → communications.send_announcements
--       → campaigns.send
--     The clause is the send grant, beside contacts.edit. Those three
--     are the seeded send keys (014 and 048) and the set
--     COMMS_SEND_PERMS already treats as "may send".
--
--   sending_domains SELECT "Comms staff can read sending domains"
--     communications.view → campaigns.read
--     communications.send → communications.send_emails
--                         → communications.send_announcements
--                         → campaigns.send
--     The route comment on this policy is "view or send". Both
--     branches stay; each one now names a key that can actually
--     be granted.
--
-- INSERT / UPDATE on sending_domains already use
-- communications.manage_brand_kits. They are not touched.
--
-- ── 2. storage.objects has RLS and no policies ──
--
-- brand-assets and campaign-images were created public in
-- migration 065 (logos and in-email images, served on the public
-- CDN). This file does not set either bucket private, does not
-- change storage.buckets, and does not add INSERT, UPDATE, or
-- DELETE policies. Writes stay service-role only (service_role
-- bypasses RLS). No policy is added for any other bucket.
--
-- The two SELECT policies open anon and authenticated reads by
-- bucket_id, which is what a public bucket's API read needs when
-- storage.objects has RLS and nothing else allows it. Public CDN
-- URLs keep working because the buckets stay public.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. email_messages — replace communications.view
-- ────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Staff can read email messages" ON public.email_messages;
CREATE POLICY "Staff can read email messages"
  ON public.email_messages FOR SELECT
  USING (
    public.is_admin()
    OR public.has_role('events_admin')
    OR public.has_role('finance_admin')
    OR public.has_permission('events.view')
    OR public.has_permission('campaigns.read')
    OR public.has_permission('contacts.view')
  );

-- ────────────────────────────────────────────────────────────
-- 2. consent_events — replace communications.view / .send
-- ────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Staff can read consent events" ON public.consent_events;
CREATE POLICY "Staff can read consent events"
  ON public.consent_events FOR SELECT
  USING (
    public.is_admin()
    OR public.has_permission('contacts.view')
    OR public.has_permission('contacts.edit')
    OR public.has_permission('campaigns.read')
  );

DROP POLICY IF EXISTS "Staff can write consent events" ON public.consent_events;
CREATE POLICY "Staff can write consent events"
  ON public.consent_events FOR INSERT
  WITH CHECK (
    public.is_admin()
    OR public.has_permission('contacts.edit')
    OR public.has_permission('communications.send_emails')
    OR public.has_permission('communications.send_announcements')
    OR public.has_permission('campaigns.send')
  );

-- ────────────────────────────────────────────────────────────
-- 3. sending_domains — replace communications.view / .send
--    Write policies (manage_brand_kits) are left as migration 188
--    wrote them.
-- ────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Comms staff can read sending domains" ON public.sending_domains;
CREATE POLICY "Comms staff can read sending domains"
  ON public.sending_domains FOR SELECT
  USING (
    public.is_admin()
    OR public.has_permission('campaigns.read')
    OR public.has_permission('communications.send_emails')
    OR public.has_permission('communications.send_announcements')
    OR public.has_permission('campaigns.send')
  );

-- ────────────────────────────────────────────────────────────
-- 4. Public SELECT on the two email image buckets
-- ────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Public read brand-assets" ON storage.objects;
CREATE POLICY "Public read brand-assets"
  ON storage.objects FOR SELECT
  TO anon, authenticated
  USING (bucket_id = 'brand-assets');

DROP POLICY IF EXISTS "Public read campaign-images" ON storage.objects;
CREATE POLICY "Public read campaign-images"
  ON storage.objects FOR SELECT
  TO anon, authenticated
  USING (bucket_id = 'campaign-images');

-- ============================================================
-- Validation (do not run until someone has decided to apply
-- this migration; these queries only read)
-- ------------------------------------------------------------
--   SELECT tablename, policyname, cmd, qual, with_check
--   FROM pg_policies
--   WHERE schemaname = 'public'
--     AND tablename IN ('email_messages', 'consent_events', 'sending_domains')
--     AND policyname IN (
--       'Staff can read email messages',
--       'Staff can read consent events',
--       'Staff can write consent events',
--       'Comms staff can read sending domains'
--     );
--   -- communications.view and communications.send must be absent.
--   -- campaigns.read on the three SELECTs.
--   -- communications.send_emails, communications.send_announcements,
--   -- and campaigns.send on consent_events INSERT and
--   -- sending_domains SELECT.
--
--   SELECT id, public FROM storage.buckets
--   WHERE id IN ('brand-assets', 'campaign-images');
--   -- both rows, public = true (unchanged)
--
--   SELECT policyname, cmd, roles, qual
--   FROM pg_policies
--   WHERE schemaname = 'storage' AND tablename = 'objects'
--     AND policyname IN ('Public read brand-assets', 'Public read campaign-images');
--   -- two SELECT policies, roles {anon, authenticated}, qual is bucket_id only
-- ============================================================
