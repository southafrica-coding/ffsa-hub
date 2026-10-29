-- ============================================================
-- FFSA Hub — Migration 256: seed equipment from FFSA INVENTORY (handoff file 111)
-- Tab "Auditorium-Prayer Room" · 95 units · 28 products
-- Generated from the sheet as written. Nothing listed on the store.
-- Rows AUX-0006 … AUX-0017 were empty and are skipped.
-- Requires migration 255.
-- ============================================================

INSERT INTO public.ministries (name, slug)
VALUES ('Prayer & Worship Ministry', 'prayer-worship')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.equipment_locations (name, slug)
VALUES ('Auditorium', 'auditorium')
ON CONFLICT (slug) DO NOTHING;

-- Products (seed_key is only used to join units below)
INSERT INTO public.equipment_products
  (seed_key, name, brand, model, register_category, owner_ministry_id, slug)
SELECT v.seed_key, v.name, v.brand, v.model, v.cat,
       (SELECT id FROM public.ministries WHERE slug = 'prayer-worship'),
       v.slug
FROM (VALUES
  ('dlive', 'Surface mixer', 'Allen & Heath', 'dLive C2500', 'audio', 'allen-heath-dlive-c2500-surface-mixer'),
  ('gx', 'Digital stage box', 'Allen & Heath', 'GX4816', 'audio', 'allen-heath-gx4816-digital-stage-box'),
  ('xr18', 'Tablet-controlled digital mixer', 'Behringer', 'X Air XR18', 'audio', 'behringer-x-air-xr18-tablet-controlled-digital-mixer'),
  ('xsw', 'Headset microphone', 'Sennheiser', 'EM-XSW1', 'audio', 'sennheiser-em-xsw1-headset-microphone'),
  ('p16d', 'IEM digital distributor', 'Behringer', 'P16-D', 'audio', 'behringer-p16-d-iem-digital-distributor'),
  ('p16m', 'Personal monitor mixer', 'Behringer', 'P16-M', 'audio', 'behringer-p16-m-personal-monitor-mixer'),
  ('dp5a', 'Drum microphone kit (5 mics)', 'Audix', 'DP5A', 'audio', 'audix-dp5a-drum-microphone-kit-5-mics'),
  ('amp', 'PA amplifier', 'Powersoft', NULL, 'audio', 'powersoft-no-model-pa-amplifier'),
  ('p125', 'Digital piano', 'Yamaha', 'P125B', 'audio', 'yamaha-p125b-digital-piano'),
  ('sub', 'Subwoofer', 'DAS Audio', NULL, 'audio', 'das-audio-no-model-subwoofer'),
  ('line', 'Line array speaker', 'DAS Audio', NULL, 'audio', 'das-audio-no-model-line-array-speaker'),
  ('mr18', 'Tablet-controlled digital mixer', 'Midas', 'MR18', 'audio', 'midas-mr18-tablet-controlled-digital-mixer'),
  ('mt200', 'Speaker', 'Montarbo', 'MT200A', 'audio', 'montarbo-mt200a-speaker'),
  ('imac', 'Computer', 'Apple', 'iMac M4', 'visual', 'apple-imac-m4-computer'),
  ('pm', 'IEM personal mixer belt pack', 'Behringer', 'PM1–PM6', 'audio', 'behringer-pm1-pm6-iem-personal-mixer-belt-pack'),
  ('polar', 'Column speaker', 'HK Audio', 'Polar', 'audio', 'hk-audio-polar-column-speaker'),
  ('ptouch', 'Label printer', 'Brother', 'P-Touch', 'auxiliary', 'brother-p-touch-label-printer'),
  ('his58', 'Television 58"', 'Hisense', '58Q6Q', 'visual', 'hisense-58q6q-television-58'),
  ('sam32', 'Television 32"', 'Samsung', 'UA32J4003DR', 'visual', 'samsung-ua32j4003dr-television-32'),
  ('atm510', 'Vocal microphone', 'Audio-Technica', 'ATM510', 'audio', 'audio-technica-atm510-vocal-microphone'),
  ('sm58', 'Vocal microphone', 'Shure', 'SM58', 'audio', 'shure-sm58-vocal-microphone'),
  ('sm57', 'Instrument microphone', 'Shure', 'SM57', 'audio', 'shure-sm57-instrument-microphone'),
  ('iem', 'IEM belt pack', NULL, NULL, 'audio', 'no-brand-no-model-iem-belt-pack'),
  ('mevo', 'Streaming camera', 'Logitech', 'Mevo', 'visual', 'logitech-mevo-streaming-camera'),
  ('shure', 'Microphone', 'Shure', NULL, 'audio', 'shure-no-model-microphone'),
  ('defacto', 'Microphone', 'Defacto', NULL, 'audio', 'defacto-no-model-microphone'),
  ('pstand', 'Piano stand', NULL, 'PL4KD', 'auxiliary', 'no-brand-pl4kd-piano-stand'),
  ('fan', 'Fan', 'Salton', 'SFF75', 'auxiliary', 'salton-sff75-fan')
) AS v(seed_key, name, brand, model, cat, slug)
ON CONFLICT (seed_key) DO NOTHING;

-- Units. status = maintenance where the sheet says broken.
INSERT INTO public.equipment_units
  (product_id, tag, label, serial, status, condition, condition_note,
   location_id, supplier, last_checked_on, source)
SELECT p.id, v.tag, v.label, v.serial, v.status, v.cond, v.note,
       (SELECT id FROM public.equipment_locations WHERE slug = 'auditorium'),
       v.supplier, v.checked::date,
       jsonb_build_object('sheet', 'FFSA INVENTORY', 'tab', 'Auditorium-Prayer Room', 'row', v.row)
FROM (VALUES
  ('dlive', 'AUD-0001', NULL, 'DLC25X-1001352', 'available', NULL, NULL, NULL, '2026-04-30', 2),
  ('gx', 'AUD-0002', NULL, 'CDM4BX-10011580', 'available', NULL, NULL, NULL, '2026-04-30', 3),
  ('xr18', 'AUD-0003', NULL, 'S250601267BI8', 'available', NULL, NULL, 'MSM Productions', '2026-04-30', 4),
  ('xsw', 'AUD-0004', NULL, 'SN303000276', 'available', NULL, NULL, NULL, '2026-04-30', 5),
  ('p16d', 'AUD-0005', NULL, 'S1400598944', 'available', NULL, NULL, NULL, '2026-04-30', 6),
  ('p16m', 'AUD-0006', NULL, 'S1610878421', 'available', NULL, NULL, NULL, '2026-04-30', 7),
  ('p16m', 'AUD-0007', NULL, 'S1224781421', 'available', NULL, NULL, NULL, '2026-04-30', 8),
  ('p16m', 'AUD-0008', NULL, 'S1414093421', 'available', NULL, NULL, NULL, '2026-04-30', 9),
  ('p16m', 'AUD-0009', NULL, 'S231102067421', 'available', NULL, NULL, NULL, '2026-04-30', 10),
  ('p16m', 'AUD-0010', NULL, 'S1414092421', 'available', NULL, NULL, NULL, '2026-04-30', 11),
  ('p16m', 'AUD-0011', NULL, 'S1414094421', 'available', NULL, NULL, NULL, '2026-04-30', 12),
  ('p16m', 'AUD-0012', NULL, 'S1223888421', 'available', NULL, NULL, NULL, '2026-04-30', 13),
  ('p16m', 'AUD-0013', NULL, 'S231107048421', 'available', NULL, NULL, NULL, '2026-04-30', 14),
  ('p16m', 'AUD-0014', NULL, 'S1222692421', 'maintenance', 'Broken', 'Needs to be booked for repair', NULL, '2026-04-30', 15),
  ('p16m', 'AUD-0015', NULL, 'S1222695421', 'maintenance', 'Broken', 'Needs to be booked for repair', NULL, '2026-04-30', 16),
  ('p16m', 'AUD-0016', NULL, 'S1222693421', 'maintenance', 'Broken', 'Needs to be booked for repair', NULL, '2026-04-30', 17),
  ('p16m', 'AUD-0017', NULL, 'S1222691421', 'maintenance', 'Broken', 'Needs to be booked for repair', NULL, '2026-04-30', 18),
  ('p16m', 'AUD-0018', NULL, 'S1225082421', 'maintenance', 'Broken', 'Needs to be booked for repair', NULL, '2026-04-30', 19),
  ('dp5a', 'AUD-0019', NULL, 'DP5A25224-14', 'available', 'Brand new', NULL, NULL, '2026-04-30', 20),
  ('amp', 'AUD-0020', NULL, 'SN00285417', 'available', NULL, NULL, NULL, '2026-04-30', 21),
  ('p125', 'AUD-0021', NULL, 'UBAX01845', 'available', NULL, NULL, NULL, '2026-04-30', 22),
  ('sub', 'AUD-0022', NULL, 'SN10424290000185', 'available', NULL, NULL, NULL, '2026-04-30', 23),
  ('sub', 'AUD-0023', NULL, 'SN10424290000186', 'available', NULL, NULL, NULL, '2026-04-30', 24),
  ('sub', 'AUD-0024', NULL, 'SN10424290000187', 'available', NULL, NULL, NULL, '2026-04-30', 25),
  ('sub', 'AUD-0025', NULL, 'SN10424290000169', 'available', NULL, NULL, NULL, '2026-04-30', 26),
  ('sub', 'AUD-0026', NULL, NULL, 'available', NULL, NULL, NULL, '2026-04-30', 27),
  ('sub', 'AUD-0027', NULL, NULL, 'available', NULL, NULL, NULL, '2026-04-30', 28),
  ('line', 'AUD-0028', NULL, 'SN0291246', 'available', NULL, NULL, NULL, '2026-04-30', 29),
  ('line', 'AUD-0029', NULL, 'SN0291365', 'available', NULL, NULL, NULL, '2026-04-30', 30),
  ('line', 'AUD-0030', NULL, 'SN0291347', 'available', NULL, NULL, NULL, '2026-04-30', 31),
  ('line', 'AUD-0031', NULL, 'SN0290628', 'available', NULL, NULL, NULL, '2026-04-30', 32),
  ('line', 'AUD-0032', NULL, 'SN0290627', 'available', NULL, NULL, NULL, '2026-04-30', 33),
  ('line', 'AUD-0033', NULL, 'SN0290633', 'available', NULL, NULL, NULL, '2026-04-30', 34),
  ('line', 'AUD-0034', NULL, 'SN0290634', 'available', NULL, NULL, NULL, '2026-04-30', 35),
  ('line', 'AUD-0035', NULL, 'SN0290629', 'available', NULL, NULL, NULL, '2026-04-30', 36),
  ('line', 'AUD-0036', NULL, 'SN0291378', 'available', NULL, NULL, NULL, '2026-04-30', 37),
  ('line', 'AUD-0037', NULL, 'SN0291338', 'available', NULL, NULL, NULL, '2026-04-30', 38),
  ('line', 'AUD-0038', NULL, 'SN0291268', 'available', NULL, NULL, NULL, '2026-04-30', 39),
  ('line', 'AUD-0039', NULL, 'SN0291274', 'available', NULL, NULL, NULL, '2026-04-30', 40),
  ('line', 'AUD-0040', NULL, 'SN0290632', 'available', NULL, NULL, NULL, '2026-04-30', 41),
  ('line', 'AUD-0041', NULL, 'SN0290635', 'available', NULL, NULL, NULL, '2026-04-30', 42),
  ('line', 'AUD-0042', NULL, 'SN0290631', 'available', NULL, NULL, NULL, '2026-04-30', 43),
  ('line', 'AUD-0043', NULL, 'SN0290630', 'available', NULL, NULL, NULL, '2026-04-30', 44),
  ('mr18', 'AUD-0044', NULL, 'S190400203C8H', 'available', 'Internal wifi busted', NULL, NULL, '2026-04-30', 45),
  ('mt200', 'AUD-0045', NULL, 'SN0441914', 'available', NULL, NULL, NULL, '2026-04-30', 46),
  ('mt200', 'AUD-0046', NULL, 'SN0539013', 'available', NULL, NULL, NULL, '2026-04-30', 47),
  ('imac', 'AUD-0047', NULL, 'DVQMLYFTHY', 'available', NULL, NULL, NULL, '2026-04-30', 48),
  ('imac', 'AUD-0048', NULL, 'G46VQH7YH3', 'available', NULL, NULL, NULL, '2026-04-30', 49),
  ('pm', 'AUD-0049', 'PM1', 'S250408768BKB', 'available', NULL, NULL, NULL, '2026-04-30', 50),
  ('pm', 'AUD-0050', 'PM2', 'S250408770BKB', 'available', NULL, NULL, NULL, '2026-04-30', 51),
  ('pm', 'AUD-0051', 'PM3', 'S250408889BKB', 'available', NULL, NULL, NULL, '2026-04-30', 52),
  ('pm', 'AUD-0052', 'PM4', 'S250408888BKB', 'available', NULL, NULL, NULL, '2026-04-30', 53),
  ('pm', 'AUD-0053', 'PM5', 'S250408918BKB', 'available', NULL, NULL, NULL, '2026-04-30', 54),
  ('pm', 'AUD-0054', 'PM6', 'S250408919BKB', 'available', NULL, NULL, NULL, '2026-04-30', 55),
  ('xr18', 'AUD-0055', NULL, 'S201200796BI8', 'available', 'Internal wifi busted', NULL, NULL, '2026-04-30', 56),
  ('polar', 'AUD-0056', NULL, 'NO1-2122-70026181', 'available', NULL, NULL, NULL, '2026-04-30', 57),
  ('polar', 'AUD-0057', NULL, 'NO1-2122-70026174', 'available', NULL, NULL, NULL, '2026-04-30', 58),
  ('ptouch', 'AUD-0058', NULL, 'E76541L2H455385', 'available', NULL, NULL, NULL, '2026-04-30', 59),
  ('his58', 'AUD-0059', NULL, '3TE58F25201X0 18DKA60076', 'available', 'Brand new', NULL, NULL, '2026-04-30', 60),
  ('his58', 'AUD-0060', NULL, '3TE58F25303F0 1852A60486', 'available', 'Brand new', NULL, NULL, '2026-04-30', 61),
  ('his58', 'AUD-0061', NULL, '3TE58F25201X0 18DKA60661', 'available', 'Brand new', NULL, NULL, '2026-04-30', 62),
  ('his58', 'AUD-0062', NULL, '3TE58F25211Q0 184AA61071', 'available', 'Brand new', NULL, NULL, '2026-04-30', 63),
  ('sam32', 'AUD-0063', NULL, 'SN00PW3FAK703466K', 'available', 'Working', NULL, NULL, '2026-04-30', 64),
  ('sam32', 'AUD-0064', NULL, 'SN00PW3FAK503808Y', 'maintenance', 'Fully broken screen', NULL, NULL, '2026-04-30', 65),
  ('sam32', 'AUD-0065', NULL, NULL, 'available', NULL, NULL, NULL, '2026-04-30', 66),
  ('atm510', 'AUD-0066', NULL, NULL, 'available', 'Brand new', NULL, NULL, '2026-04-30', 67),
  ('atm510', 'AUD-0067', NULL, NULL, 'available', 'Brand new', NULL, NULL, '2026-04-30', 68),
  ('atm510', 'AUD-0068', NULL, NULL, 'available', 'Brand new', NULL, NULL, '2026-04-30', 69),
  ('atm510', 'AUD-0069', NULL, NULL, 'available', 'Brand new', NULL, NULL, '2026-04-30', 70),
  ('sm58', 'AUD-0070', NULL, NULL, 'available', 'Brand new', NULL, NULL, '2026-04-30', 71),
  ('sm58', 'AUD-0071', NULL, NULL, 'available', 'Brand new', NULL, NULL, '2026-04-30', 72),
  ('sm58', 'AUD-0072', NULL, NULL, 'available', 'Brand new', NULL, NULL, '2026-04-30', 73),
  ('sm58', 'AUD-0073', NULL, NULL, 'available', 'Brand new', NULL, NULL, '2026-04-30', 74),
  ('sm57', 'AUD-0074', NULL, NULL, 'available', 'Brand new', NULL, NULL, '2026-04-30', 75),
  ('sm57', 'AUD-0075', NULL, NULL, 'available', 'Brand new', 'Screen got stepped on at some point', NULL, '2026-04-30', 76),
  ('iem', 'AUD-0076', NULL, NULL, 'available', NULL, NULL, NULL, NULL, 77),
  ('iem', 'AUD-0077', NULL, NULL, 'available', NULL, NULL, NULL, NULL, 78),
  ('iem', 'AUD-0078', NULL, NULL, 'available', NULL, NULL, NULL, NULL, 79),
  ('iem', 'AUD-0079', NULL, NULL, 'available', NULL, NULL, NULL, NULL, 80),
  ('iem', 'AUD-0080', NULL, NULL, 'available', NULL, NULL, NULL, NULL, 81),
  ('iem', 'AUD-0081', NULL, NULL, 'available', NULL, NULL, NULL, NULL, 82),
  ('iem', 'AUD-0082', NULL, NULL, 'available', NULL, NULL, NULL, NULL, 83),
  ('iem', 'AUD-0083', NULL, NULL, 'available', NULL, NULL, NULL, NULL, 84),
  ('iem', 'AUD-0084', NULL, NULL, 'available', NULL, NULL, NULL, NULL, 85),
  ('iem', 'AUD-0085', NULL, NULL, 'available', NULL, NULL, NULL, NULL, 86),
  ('mevo', 'AUD-0086', '26P6K', 'SN2132CDS02U18', 'available', NULL, NULL, NULL, NULL, 87),
  ('mevo', 'AUD-0087', '26JN4', 'SN2132CDS07VE8', 'available', NULL, NULL, NULL, NULL, 88),
  ('mevo', 'AUD-0088', '26KGJ', 'SN2132CDS03UX8', 'available', NULL, NULL, NULL, NULL, 89),
  ('shure', 'AUD-0089', NULL, NULL, 'available', 'Brand new', NULL, NULL, '2026-09-22', 90),
  ('defacto', 'AUD-0090', NULL, NULL, 'available', 'Brand new', NULL, NULL, '2026-09-22', 91),
  ('pstand', 'AUX-0001', NULL, 'Q32100116000038', 'available', NULL, NULL, NULL, NULL, 2),
  ('fan', 'AUX-0002', 'SFF75', NULL, 'available', NULL, NULL, NULL, NULL, 3),
  ('fan', 'AUX-0003', NULL, NULL, 'available', NULL, NULL, NULL, NULL, 4),
  ('fan', 'AUX-0004', NULL, NULL, 'available', NULL, NULL, NULL, NULL, 5),
  ('fan', 'AUX-0005', NULL, NULL, 'available', NULL, NULL, NULL, NULL, 6)
) AS v(seed_key, tag, label, serial, status, cond, note, supplier, checked, row)
JOIN public.equipment_products p ON p.seed_key = v.seed_key
ON CONFLICT (tag) DO NOTHING;

-- One history event per unit: where it came from.
INSERT INTO public.equipment_events (unit_id, kind, detail)
SELECT u.id, 'imported',
       'Imported from FFSA INVENTORY, tab Auditorium-Prayer Room, row ' || (u.source->>'row')
FROM public.equipment_units u
WHERE u.source->>'tab' = 'Auditorium-Prayer Room'
  AND NOT EXISTS (SELECT 1 FROM public.equipment_events e WHERE e.unit_id = u.id AND e.kind = 'imported');

-- Units marked broken open a maintenance job, so they show in Maintenance.
INSERT INTO public.equipment_maintenance (unit_id, status, reason)
SELECT u.id, 'reported', coalesce(nullif(u.condition_note, ''), u.condition)
FROM public.equipment_units u
WHERE u.status = 'maintenance'
  AND NOT EXISTS (SELECT 1 FROM public.equipment_maintenance m WHERE m.unit_id = u.id AND m.status <> 'done');

-- Check: expect 95 units in 28 products, 6 in maintenance (5 × P16-M + the Samsung 32" TV).
-- SELECT status, count(*) FROM public.equipment_units GROUP BY status;
