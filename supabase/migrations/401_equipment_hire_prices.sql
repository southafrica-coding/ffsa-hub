-- ============================================================
-- FFSA Hub — Migration 401: hire prices from the FFSA price list
-- Applied to production on 24 Nov 2026 under its first number, 399;
-- renumbered with 400 (was 398). Don't run it again.
-- Requires migrations 256, 257, 286 and 400. Run AFTER 400.
--
-- Source: the "Hire price list" tab of the FFSA INVENTORY sheet
-- (November 2026). Rand excl. VAT, about 10% under the cheapest
-- comparable South African hire listing; weekend = 1.5 x day,
-- week = 3 x day; deposit about 15% of replacement value.
--
-- Products are found by their units' asset tags, so this doesn't depend
-- on product ids or slugs. Every row of the price list becomes one
-- product update, listed on the store with a store category.
--
-- What ends up hireable is decided by ROOM (400), not here: products with
-- units Upstairs (DTS-DBS) or in the Old DBS classroom can be picked;
-- everything else shows as "Not for hire". can_leave_building is set
-- from the rooms at the end so the admin pages agree.
--
-- Not listed: every TV (FFSA's decision), the GX4816 mixrack (priced into
-- the dLive desk), the P16-D distributor (goes with the P16-M mixers),
-- and the unverified Sortly imports.
-- Safe to run twice.
-- ============================================================

BEGIN;

INSERT INTO public.equipment_categories (name, slug, sort_order) VALUES
  ('Computers & office', 'computers-office', 40)
ON CONFLICT (slug) DO NOTHING;

-- ── Prices, by price-list row ──────────────────────────────
UPDATE public.equipment_products p
SET price_day_cents     = v.day * 100,
    price_weekend_cents = v.weekend * 100,
    price_week_cents    = v.week * 100,
    deposit_cents       = v.deposit * 100,
    store_category_id   = (SELECT id FROM public.equipment_categories WHERE slug = v.cat),
    is_listed           = true,
    listed_at           = coalesce(p.listed_at, now()),
    updated_at          = now()
FROM (VALUES
  -- Upstairs Classroom (DTS-DBS): for hire
  (ARRAY['UCL0001'],                         2100, 3150,  6300, 15000, 'mixers'),
  (ARRAY['UCL0002'],                          550,  825,  1650,  2200, 'mixers'),
  (ARRAY['UCL0003','UCL0004'],                450,  675,  1350,  3000, 'speakers'),
  (ARRAY['UCL0005','UCL0006'],                400,  600,  1200,  2400, 'speakers'),
  (ARRAY['UCL0007','UCL0008'],                450,  675,  1350,  2200, 'speakers'),
  (ARRAY['UCL0009'],                          230,  345,   690,   500, 'microphones'),
  (ARRAY['UCL0014','UCL0015'],                110,  165,   330,   350, 'microphones'),
  (ARRAY['UCL0010'],                          150,  225,   450,   600, 'mixers'),
  (ARRAY['UCL0011'],                          180,  270,   540,   800, 'mixers'),
  -- SBS classroom: on show, not for hire
  (ARRAY['SBS-0003'],                         580,  870,  1740,  3500, 'instruments'),
  (ARRAY['SBS-0004'],                         500,  750,  1500,  2700, 'screens-cameras'),
  (ARRAY['SBS-0005'],                         220,  330,   660,   800, 'computers-office'),
  (ARRAY['SBS-0007'],                         230,  345,   690,   900, 'microphones'),
  (ARRAY['SBS-0008'],                         450,  675,  1350,  2500, 'mixers'),
  -- The Vault (studio): on show, not for hire
  (ARRAY['STU0001','STU0002'],                400,  600,  1200,  2900, 'speakers'),
  (ARRAY['STU0003'],                          100,  150,   300,   350, 'instruments'),
  (ARRAY['STU0004'],                          190,  285,   570,   900, 'mixers'),
  (ARRAY['STU0005'],                           90,  135,   270,   300, 'computers-office'),
  (ARRAY['STU0006'],                          800, 1200,  2400,  4400, 'mixers'),
  -- Auditorium: on show, not for hire
  (ARRAY['AUD-0001'],                        5800, 8700, 17400, 60000, 'mixers'),
  (ARRAY['AUD-0003','AUD-0055'],              500,  750,  1500,  2600, 'mixers'),
  (ARRAY['AUD-0044'],                         500,  750,  1500,  2600, 'mixers'),
  (ARRAY['AUD-0004'],                         330,  495,   990,  1600, 'microphones'),
  (ARRAY['AUD-0006'],                         270,  405,   810,  1250, 'in-ear-monitors'),
  (ARRAY['AUD-0049','AUD-0050','AUD-0051','AUD-0052','AUD-0053','AUD-0054',
         'AUD-0076'],                         130,  195,   390,   700, 'in-ear-monitors'),
  (ARRAY['AUD-0019'],                         580,  870,  1740,  3500, 'microphones'),
  (ARRAY['AUD-0020'],                        1350, 2025,  4050, 18500, 'mixers'),
  (ARRAY['AUD-0021'],                         580,  870,  1740,  3500, 'instruments'),
  (ARRAY['AUD-0022'],                        1150, 1725,  3450, 12250, 'speakers'),
  (ARRAY['AUD-0028'],                         800, 1200,  2400,  5000, 'speakers'),
  (ARRAY['AUD-0045'],                         400,  600,  1200,  2000, 'speakers'),
  (ARRAY['AUD-0056'],                         900, 1350,  2700,  3900, 'speakers'),
  (ARRAY['AUD-0047'],                         950, 1425,  2850,  8250, 'computers-office'),
  (ARRAY['AUD-0058'],                          90,  135,   270,   600, 'computers-office'),
  (ARRAY['AUD-0070','AUD-0089'],              140,  210,   420,   500, 'microphones'),
  (ARRAY['AUD-0074'],                         140,  210,   420,   450, 'microphones'),
  (ARRAY['AUD-0090'],                         100,  150,   300,   500, 'microphones'),
  (ARRAY['AUD-0086','AUD-0087','AUD-0088'],   500,  750,  1500,  2700, 'screens-cameras')
) AS v(tags, day, weekend, week, deposit, cat)
WHERE p.id IN (SELECT u.product_id FROM public.equipment_units u WHERE u.tag = ANY (v.tags));
-- The Agera CA-12A (SBS-0001/2) and ATM510 (SBS-0009/10, AUD-0066-69)
-- share products with the Upstairs rows above, at the same prices.

-- ── Never on the store ─────────────────────────────────────
UPDATE public.equipment_products p
SET is_listed = false, updated_at = now()
WHERE p.id IN (SELECT u.product_id FROM public.equipment_units u
               WHERE u.tag IN ('UCL0012', 'DBS-0001', 'SBS-0006', 'AUD-0059', 'AUD-0063',  -- TVs
                               'AUD-0002',                                               -- GX4816
                               'AUD-0005'));                                             -- P16-D

-- ── May it leave the building? From its rooms ─────────────
UPDATE public.equipment_products p
SET can_leave_building = EXISTS (
      SELECT 1 FROM public.equipment_units u
      JOIN public.equipment_locations l ON l.id = u.location_id
      WHERE u.product_id = p.id AND l.hire_allowed),
    updated_at = now()
WHERE p.is_listed;

COMMIT;

-- Checks:
-- SELECT count(*) FILTER (WHERE can_leave_building) AS for_hire,
--        count(*) FILTER (WHERE NOT can_leave_building) AS on_show
--   FROM public.equipment_products WHERE is_listed;           -- 9 for hire, the rest on show
-- SELECT p.name, p.model FROM public.equipment_products p
--  WHERE p.is_listed AND p.model ILIKE ANY (ARRAY['%58%','%65%','%32J%']);   -- no TVs
