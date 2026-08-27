-- ============================================================
-- FFSA Hub — Migration 194: label the buyers of events that already ran
-- ------------------------------------------------------------
-- Migration 193 + PR #298 made every ticket buyer pick up the event's
-- labels, but only at fulfilment time. Events that already happened
-- have buyers who are contacts (all 288 paid orders resolved cleanly)
-- yet hold no event label, so they cannot be pulled into a follow-up
-- audience. This backfills them.
--
-- RUN AFTER 193 — it reads event_labels.
--
-- Two deliberate exclusions:
--   * anyone with an unsubscribes row for that label, or a global one.
--     Per-label opt-out is expressed by DELETING the contact_labels row
--     (046 trigger), so a blind backfill would silently re-subscribe
--     people who opted out. It must not.
--   * orders not in 'paid' status, and orders never resolved to a
--     contact (there are none today, but the join stays honest).
--
-- marketing_consent is NOT a filter, matching the live behaviour: the
-- label is a CRM audience marker; consent governs sending.
--
-- Idempotent — re-running inserts nothing and logs nothing.
-- ============================================================

WITH candidates AS (
  -- One row per (contact, label); the earliest paid order is the one
  -- credited in added_via, so the timeline points at a real order.
  SELECT DISTINCT ON (o.buyer_contact_id, el.label_id)
         o.buyer_contact_id AS contact_id,
         el.label_id        AS label_id,
         o.id               AS order_id
  FROM public.orders o
  JOIN public.event_labels el ON el.event_id = o.event_id
  WHERE o.status = 'paid'
    AND o.buyer_contact_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.unsubscribes u
      WHERE u.contact_id = o.buyer_contact_id
        AND (u.label_id = el.label_id OR u.label_id IS NULL)
    )
  ORDER BY o.buyer_contact_id, el.label_id, o.created_at
),
inserted AS (
  INSERT INTO public.contact_labels (contact_id, label_id, added_via, added_by)
  SELECT contact_id, label_id, 'ticket:' || order_id, NULL
  FROM candidates
  ON CONFLICT (contact_id, label_id) DO NOTHING
  RETURNING contact_id, label_id, added_via
)
-- Timeline entry, so a follow-up list is traceable to why someone is on it.
INSERT INTO public.activity_events (contact_id, event_type, related_label_id, payload)
SELECT contact_id, 'label_added', label_id,
       jsonb_build_object('added_via', added_via, 'backfill', 'migration_194')
FROM inserted;
