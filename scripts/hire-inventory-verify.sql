-- ============================================================
-- Hire inventory import: checks to paste into the Supabase SQL editor
-- after applying migrations 285 and 286 (and 287). SELECT only: nothing
-- here changes data. Expected numbers assume no gear was added by hand
-- since 256; the PR lists them too.
-- ============================================================

-- 1. Units per location. Expect: Auditorium 95, Upstairs Classroom 15,
--    SBS Classroom 10, Studio 6, Old Prayer Room 2, (none) 25 = 153.
SELECT coalesce(l.name, '(none: unverified Sortly)') AS location, count(*) AS units
FROM public.equipment_units u
LEFT JOIN public.equipment_locations l ON l.id = u.location_id
GROUP BY 1
ORDER BY 2 DESC;

-- 2. Units per owner_label. Expect: Prayer & Worship Ministry 101 (95 + 6
--    studio), DTS/DBS/LTS Schools 15, SBS School 10, DBS 2, (none) 25.
SELECT coalesce(owner_label, '(none)') AS owner_label, count(*) AS units
FROM public.equipment_units
GROUP BY 1
ORDER BY 2 DESC;

-- 3. Totals. Expect units 153, products 58 (28 + 20 + 10), unverified 25.
SELECT
  (SELECT count(*) FROM public.equipment_units)                                    AS units,
  (SELECT count(*) FROM public.equipment_products)                                 AS products,
  (SELECT count(*) FROM public.equipment_units WHERE source->>'unverified' = 'true') AS unverified_units;

-- 4. Units without a product. Must be 0 (product_id is NOT NULL; belt and braces).
SELECT count(*) AS units_without_product
FROM public.equipment_units u
LEFT JOIN public.equipment_products p ON p.id = u.product_id
WHERE p.id IS NULL;

-- 5. Duplicate tags. Must return no rows.
SELECT tag, count(*) FROM public.equipment_units GROUP BY tag HAVING count(*) > 1;

-- 6. Listed products. Must still be exactly what was listed before the
--    import (1 row: the Shure SM58). No imported product is listed.
SELECT seed_key, name, is_listed, price_day_cents
FROM public.equipment_products
WHERE is_listed;

-- 7. SM58 still listed and untouched by the import (value and Sortly id NULL).
SELECT seed_key, is_listed, price_day_cents, replacement_value_cents, sortly_sid
FROM public.equipment_products
WHERE seed_key = 'sm58';

-- 8. Imported products that are listed, priced or allowed out. Must be 0.
SELECT count(*) AS imported_but_listed
FROM public.equipment_products
WHERE (seed_key IN ('wing','s32','turbo','ca12a','ts315s','wms40','scsolo','sc2i2','sky65','p225',
                    'officejet','his58a7g','atone','ui16','his58a6n','a7x','v25','ssl2','elgato','apollo')
       OR seed_key LIKE 'sortly-%')
  AND (is_listed OR price_day_cents IS NOT NULL OR can_leave_building OR store_category_id IS NOT NULL);

-- 9. Replacement values filled. Expect 18 rows: 11 from product_value_updates
--    plus the 7 Sortly-only products that had a price.
SELECT seed_key, name, replacement_value_cents, sortly_sid
FROM public.equipment_products
WHERE replacement_value_cents IS NOT NULL
ORDER BY seed_key;

-- 10. The school gear's ministry link. NULL here means there is no
--     'training' row in public.ministries (see the PR's open questions);
--     owner_label still says who it belongs to.
SELECT u.owner_label, m.slug AS ministry, count(*)
FROM public.equipment_units u
LEFT JOIN public.ministries m ON m.id = u.owner_ministry_id
WHERE u.owner_label IS NOT NULL
GROUP BY 1, 2
ORDER BY 1;

-- 11. One 'imported' event per unit. Must return no rows.
SELECT u.tag
FROM public.equipment_units u
WHERE NOT EXISTS (SELECT 1 FROM public.equipment_events e WHERE e.unit_id = u.id AND e.kind = 'imported');

-- 12. After 287: anon can't read the internal product columns. Expect
--     replacement_value_cents and sortly_sid to be absent from this list.
SELECT column_name
FROM information_schema.column_privileges
WHERE table_schema = 'public' AND table_name = 'equipment_products'
  AND grantee = 'anon' AND privilege_type = 'SELECT'
ORDER BY column_name;
