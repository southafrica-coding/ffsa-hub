-- ============================================================
-- FFSA Hub — Migration 352: Fleet — seed
-- ============================================================
-- Requires 350 and 351.
--
-- Only the empty settings row and a details row per existing vehicle. FFSA's
-- real data (workshops, km, workshop visits, photos, the live checklist and
-- schedule) is loaded by scripts/fleet-import.ts from vehicles-module/seed:
-- that data is private and never goes into a migration.
-- ============================================================

BEGIN;

INSERT INTO public.fleet_settings (id) VALUES ('global')
ON CONFLICT (id) DO NOTHING;

-- Every vehicle gets a details row, so Fleet lists the Hub's vehicles even
-- before the import. Retired vehicles start as Off the road.
INSERT INTO public.fleet_vehicle_details (vehicle_id, fleet_status, sort_order)
SELECT v.id,
       CASE WHEN v.status = 'retired' THEN 'Off the road' ELSE 'In service' END,
       COALESCE(v.sort_order, 0)
FROM public.vehicles v
ON CONFLICT (vehicle_id) DO NOTHING;

COMMIT;

-- ────────────────────────────────────────────────────────────
-- Validation
-- ────────────────────────────────────────────────────────────
--   SELECT * FROM public.fleet_settings;
--   SELECT v.registration_plate, d.fleet_status FROM public.vehicles v
--     JOIN public.fleet_vehicle_details d ON d.vehicle_id = v.id ORDER BY v.sort_order;
