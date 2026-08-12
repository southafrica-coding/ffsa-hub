-- ============================================================
-- FFSA Hub — Migration 163: Signed waivers per ticket tier
-- ============================================================
-- A tier can require a signable waiver / indemnity form (e.g. a youth
-- camp parental-consent form). The organizer uploads the actual form
-- document (a PDF) and, at checkout, the parent/guardian reads it, fills
-- in guardian + minor details, types their name as a signature and
-- agrees. One signed record is captured per attendee (per ticket of the
-- waiver-required tier) and drained onto each issued ticket at fulfilment
-- — mirroring the per-tier questions model (migration 138).
--
-- Design notes:
--   * Buyers are anonymous, so — exactly like the ticket consent
--     agreement (migration 157) — the signature is recorded on the
--     order/ticket, NOT in the account-scoped consent tables.
--   * `ticket_types.waiver` holds the waiver CONFIG (a jsonb object, not
--     an array): { enabled, version, title, body_markdown, document_path,
--     document_name, require_minor_name, require_relationship }.
--   * `orders.waiver_signatures` holds the pending signatures captured at
--     checkout: [{ ticket_type_id, signature: {...} }] — grouped by tier,
--     FIFO, like orders.ticket_answers.
--   * `tickets.waiver_signature` holds the immutable per-attendee signed
--     record drained onto the issued ticket, plus the generated
--     certificate's storage path once rendered.
-- ============================================================

ALTER TABLE ticket_types
  ADD COLUMN IF NOT EXISTS waiver jsonb;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS waiver_signatures jsonb;

ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS waiver_signature jsonb;

-- Private bucket for waiver documents: the blank forms organizers upload
-- and the generated signed certificates. All reads/writes go through
-- admin-client (service-role) API routes, so no storage.objects policies
-- are needed. Modeled on migration 082 (avatars) but private, since these
-- are consent documents naming minors.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'waiver-documents',
  'waiver-documents',
  false,
  10485760,  -- 10 MB
  ARRAY['application/pdf']
)
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- Validation
-- ------------------------------------------------------------
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'ticket_types' AND column_name = 'waiver';
--   SELECT id, public FROM storage.buckets WHERE id = 'waiver-documents';
--   -- one row, public = false
-- ============================================================
