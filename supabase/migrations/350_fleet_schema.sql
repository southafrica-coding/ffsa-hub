-- ============================================================
-- FFSA Hub — Migration 350: Fleet (vehicle inspections) — schema
-- ============================================================
-- Numbered 350–353 on Jack's instruction (main ends at 330; 331–333 and
-- 316–326 are taken by other open branches).
--
-- The FFSA Fleet app (vehicles-module/) rebuilt in the Hub as "Fleet", under
-- Bookings → Vehicles → Fleet. Field names follow vehicles-module/docs/SPEC.md
-- section 4; src/lib/fleet/mapping.ts maps these columns onto them.
--
--   • Role vehicle_coordinator ("Vehicle Coordinator"): one holder, gets the
--     07:00 reminder, printed on the in-car guides. Bundle: fleet.view,
--     fleet.manage + the vehicle booking permissions of vehicle_manager.
--   • Permissions fleet.view (read-only) and fleet.manage (everything).
--   • The vehicle list stays public.vehicles: fleet_vehicle_details is 1:1.
--   • Trips are approved public.vehicle_bookings: there is no fleet_trips.
--   • Private bucket fleet-files; every read goes through an API route that
--     checks the role and hands out a short-lived signed URL.
--
-- Apply 350, then 351 (RLS), then 352 (seed), then 353 (reminder log) in the
-- Supabase SQL Editor.
--
-- Safe to re-run: IF NOT EXISTS / ON CONFLICT / DROP … IF EXISTS throughout,
-- and the whole file is one transaction. Grants and RLS are in 351.
-- ============================================================

BEGIN;

-- ────────────────────────────────────────────────────────────
-- 1. Role and permissions
-- ────────────────────────────────────────────────────────────
INSERT INTO public.roles (name, display_name, description, is_system) VALUES
  ('vehicle_coordinator', 'Vehicle Coordinator',
   'Runs vehicle inspections, km readings and workshop visits in Fleet; receives the daily 07:00 reminder; printed on the in-car guides. Also manages vehicle bookings.', false)
ON CONFLICT (name) DO NOTHING;

INSERT INTO public.permissions (module, key, display_name, sort_order) VALUES
  ('fleet', 'fleet.view',   'View Fleet (vehicles, inspections, workshop visits)', 10),
  ('fleet', 'fleet.manage', 'Run Fleet (inspections, km, workshop visits, settings)', 20)
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM public.roles r
JOIN public.permissions p ON p.key IN ('fleet.view','fleet.manage','vehicles.view','vehicles.approve','vehicles.manage')
WHERE r.name = 'vehicle_coordinator'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ────────────────────────────────────────────────────────────
-- 2. Workshops (the app's `providers`)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.fleet_providers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legacy_id   text UNIQUE,                 -- id in the Fleet app's export
  name        text NOT NULL,
  services    text,
  phone       text,
  phone2      text,
  email       text,
  website     text,
  address     text,
  hours       text,
  notes       text,
  created_by  uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- ────────────────────────────────────────────────────────────
-- 3. Vehicle details, 1:1 with public.vehicles
--    (registration, name, make/model, fuel, seats stay on vehicles)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.fleet_vehicle_details (
  vehicle_id        uuid PRIMARY KEY REFERENCES public.vehicles(id) ON DELETE CASCADE,
  legacy_id         text UNIQUE,           -- "h1-2", "crv", … in the Fleet app
  make              text,
  model             text,
  profile           text,                  -- vehicle-profiles.json key; null = guess from make/model
  year              integer,
  colour            text,
  transmission      text,
  vin               text,
  engine_no         text,
  insurer           text,
  policy_no         text,
  tracker           text,
  base              text,
  photo_file_id     text,
  fleet_status      text NOT NULL DEFAULT 'In service'
                    CHECK (fleet_status IN ('In service','On a trip','Booked for workshop','In workshop','Off the road','For sale')),
  status_since      date,
  licence_expiry    date,
  odometer_km       integer CHECK (odometer_km IS NULL OR odometer_km >= 0),
  odometer_date     date,
  odo_prev          jsonb,                 -- {km, date}
  last_service      jsonb,                 -- {date, km, provider}
  last_b2b          jsonb,                 -- {date, km, provider}
  service_km        integer,               -- optional override of 10 000
  service_months    integer,
  inspection_day    smallint CHECK (inspection_day IS NULL OR inspection_day BETWEEN 1 AND 7),
  tyres             text,
  where_text        text,                  -- "Label: text" per line
  watch             jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(watch) = 'array'),
  condition         jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(condition) = 'object'),
  last_inspection   jsonb,                 -- {id, date, type, counts}
  last_check        jsonb,                 -- {id, date, type}
  last_monthly      jsonb,                 -- {id, date}
  last_post         jsonb,                 -- {id, date}
  card_printed      jsonb,                 -- {date, sig, stale}
  follow_up         jsonb,                 -- {date, until, km, kind, provider, recId}
  notes             text,
  sort_order        integer NOT NULL DEFAULT 0,
  updated_by        uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- ────────────────────────────────────────────────────────────
-- 4. Workshop visits (the app's `records`)
--    A booked visit blocks the vehicle from date to until (PR 5).
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.fleet_workshop_visits (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legacy_id       text UNIQUE,
  vehicle_id      uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  status          text NOT NULL CHECK (status IN ('booked','done')),
  kind            text NOT NULL,
  date            date NOT NULL,
  until           date,
  provider_id     uuid REFERENCES public.fleet_providers(id) ON DELETE SET NULL,
  provider        text,                   -- the name as written (the app stores names)
  odometer_km     integer,
  cost            numeric(12,2),          -- ZAR, as the app records it
  ref             text,
  description     text,
  work            jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(work) = 'array'),
  warranty_until  date,
  checked_by      text,
  files           jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(files) = 'array'),  -- [{id, name, type}], ids in fleet_files
  next_date       date,
  next_km         integer,
  created_by      uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (until IS NULL OR until >= date)
);
CREATE INDEX IF NOT EXISTS idx_fleet_visits_vehicle ON public.fleet_workshop_visits (vehicle_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_fleet_visits_booked ON public.fleet_workshop_visits (date) WHERE status = 'booked';

-- ────────────────────────────────────────────────────────────
-- 5. Inspections and drafts
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.fleet_inspections (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id    uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  type          text NOT NULL CHECK (type IN ('pre','post','weekly','monthly','workshop')),
  date          date NOT NULL,
  odometer_km   integer NOT NULL CHECK (odometer_km >= 0),
  fuel          text,
  inspector     text,
  provider      text,
  booking_id    uuid REFERENCES public.vehicle_bookings(id) ON DELETE SET NULL,
  docs          jsonb NOT NULL DEFAULT '[]'::jsonb,   -- workshop report files [{id, name, type}]
  results       jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(results) = 'object'),  -- {itemId: {s, v, n, p[], t, sec}}
  walk          jsonb NOT NULL DEFAULT '{}'::jsonb,   -- {front, rear, left, right, interior, dash: fileId}
  extra         jsonb NOT NULL DEFAULT '[]'::jsonb,   -- extra photos
  summary       text,
  counts        jsonb,                                -- {ok, mon, fix, na}
  mins          integer,
  started_at    timestamptz,
  created_by    uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fleet_inspections_vehicle ON public.fleet_inspections (vehicle_id, date DESC);

-- A draft is kept per person and vehicle, so it can be finished on another device.
CREATE TABLE IF NOT EXISTS public.fleet_inspection_drafts (
  user_id     uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  vehicle_id  uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  data        jsonb NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, vehicle_id)
);

-- ────────────────────────────────────────────────────────────
-- 6. Odometer readings and time log
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.fleet_odometer_readings (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id  uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  km          integer NOT NULL CHECK (km > 0),
  date        date NOT NULL,
  note        text,
  source      text NOT NULL DEFAULT 'km-log'
              CHECK (source IN ('inspection','post-trip','workshop','km-log','handover')),
  source_id   uuid,                      -- the inspection, visit or vehicle_inspections row
  created_by  uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fleet_odometer_vehicle ON public.fleet_odometer_readings (vehicle_id, date DESC);
-- One reading per handover form (PR 5 saves handover mileage here).
CREATE UNIQUE INDEX IF NOT EXISTS uq_fleet_odometer_source ON public.fleet_odometer_readings (source, source_id) WHERE source_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.fleet_time_logs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date        date NOT NULL,
  week        date NOT NULL,             -- the Monday
  kind        text NOT NULL CHECK (kind IN ('inspection','km','trip','workshop','admin')),
  type        text,                      -- inspection type
  vehicle_id  uuid REFERENCES public.vehicles(id) ON DELETE SET NULL,
  mins        integer NOT NULL CHECK (mins > 0),
  user_id     uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fleet_time_logs_date ON public.fleet_time_logs (date);

-- ────────────────────────────────────────────────────────────
-- 7. Settings (one row) and tutorial progress
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.fleet_settings (
  id            text PRIMARY KEY DEFAULT 'global' CHECK (id = 'global'),
  days          smallint[] NOT NULL DEFAULT '{2,3,4}',   -- inspection weekdays, Mon = 1
  max_per_day   smallint NOT NULL DEFAULT 2,
  budget_hours  numeric(4,1) NOT NULL DEFAULT 5,
  weekly_only   date[] NOT NULL DEFAULT '{}',            -- Mondays of weekly-only weeks
  checklist     jsonb,                                   -- {sections: [{id, name, items: [{id, t, h, in[], m}]}]}
  notify        jsonb NOT NULL DEFAULT '{"email": true, "slack": true}'::jsonb,
  updated_by    uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.fleet_guide_progress (
  user_id   uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  step      text NOT NULL,
  done_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, step)
);

-- ────────────────────────────────────────────────────────────
-- 8. Files (photos and PDFs) in the private fleet-files bucket
--    id is a 32-character hex id; the import keeps the Fleet app's ids.
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.fleet_files (
  id            text PRIMARY KEY CHECK (id ~ '^[0-9a-f]{32}$'),
  path          text NOT NULL UNIQUE,     -- object path in fleet-files
  content_type  text NOT NULL,
  size_bytes    integer NOT NULL,
  owner_type    text CHECK (owner_type IN ('vehicle','inspection','visit','draft')),
  owner_id      text,
  name          text,
  created_by    uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fleet_files_owner ON public.fleet_files (owner_type, owner_id);

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'fleet-files',
  'fleet-files',
  false,
  20971520,  -- 20 MB, as the Fleet app
  ARRAY['image/jpeg','image/png','image/webp','image/gif','image/heic','image/heif','application/pdf']
)
ON CONFLICT (id) DO NOTHING;

-- ────────────────────────────────────────────────────────────
-- 9. updated_at
-- ────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS fleet_providers_updated_at ON public.fleet_providers;
CREATE TRIGGER fleet_providers_updated_at BEFORE UPDATE ON public.fleet_providers
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
DROP TRIGGER IF EXISTS fleet_vehicle_details_updated_at ON public.fleet_vehicle_details;
CREATE TRIGGER fleet_vehicle_details_updated_at BEFORE UPDATE ON public.fleet_vehicle_details
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
DROP TRIGGER IF EXISTS fleet_workshop_visits_updated_at ON public.fleet_workshop_visits;
CREATE TRIGGER fleet_workshop_visits_updated_at BEFORE UPDATE ON public.fleet_workshop_visits
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
DROP TRIGGER IF EXISTS fleet_inspections_updated_at ON public.fleet_inspections;
CREATE TRIGGER fleet_inspections_updated_at BEFORE UPDATE ON public.fleet_inspections
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
DROP TRIGGER IF EXISTS fleet_inspection_drafts_updated_at ON public.fleet_inspection_drafts;
CREATE TRIGGER fleet_inspection_drafts_updated_at BEFORE UPDATE ON public.fleet_inspection_drafts
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
DROP TRIGGER IF EXISTS fleet_settings_updated_at ON public.fleet_settings;
CREATE TRIGGER fleet_settings_updated_at BEFORE UPDATE ON public.fleet_settings
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

COMMIT;

-- ────────────────────────────────────────────────────────────
-- Validation
-- ────────────────────────────────────────────────────────────
--   SELECT name, display_name FROM public.roles WHERE name = 'vehicle_coordinator';
--   SELECT key FROM public.permissions WHERE module = 'fleet' ORDER BY sort_order;
--   SELECT p.key FROM public.role_permissions rp JOIN public.roles r ON r.id = rp.role_id
--     JOIN public.permissions p ON p.id = rp.permission_id WHERE r.name = 'vehicle_coordinator';
--   SELECT table_name FROM information_schema.tables WHERE table_name LIKE 'fleet\_%' ORDER BY 1;
--   SELECT id, public, file_size_limit FROM storage.buckets WHERE id = 'fleet-files';
