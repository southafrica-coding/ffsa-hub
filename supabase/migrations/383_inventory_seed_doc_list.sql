-- ============================================================
-- FFSA Hub — Migration 383: Inventory seed — the "INVENTORY LIST" Google Doc
-- ============================================================
-- Requires 381. The 42 lines of the first inventory list (events, catering
-- and décor), imported as counted and consumable items.
--
--   • Each item's count goes in as an 'opening' stock move, so the count
--     has a history; the trigger from 381 sets stock_quantity.
--   • The Doc has no descriptions, prices, photos or locations. Items come
--     in with description NULL, and the register flags them ("No
--     description yet") until the inventory manager fills them in.
--   • Counted items can be borrowed (is_requestable); consumables can't.
--   • Judgement calls, each noted in the move so they can be checked:
--       - "Beige Table Cloth" and "One Beige Table Cloth" were two lines of 1;
--         imported as one item with 2. Recount if it's really one cloth.
--       - "Pack of Clear Forks: 100-150 ish" → 100.
--       - "Pack of White Balloons" had no quantity → 1 pack.
--       - "Small Glass Jars with Metal Lid: 19 (one without lid)" → 19.
--       - Lighter, candles, tealights, plastic and paper cups and plates,
--         plastic forks and balloons are consumables.
--       - Spellings tidied ("Citronella", "Light Brown"); the Doc's wording
--         is kept in each opening move's note.
--
-- Safe to run twice: products are keyed on seed_key (ON CONFLICT DO
-- NOTHING) and an opening move is only added to a product that has none.
-- ============================================================

BEGIN;

CREATE TEMP TABLE inventory_doc1 (
  seed_key text, name text, slug text, category text, tracking text, qty integer, doc_text text
) ON COMMIT DROP;

INSERT INTO inventory_doc1 (seed_key, name, slug, category, tracking, qty, doc_text) VALUES
  ('doc1-01', 'Small green glass vases',                     'small-green-glass-vases',        'decor',    'counted',    8,  'Small Green Glass Vases: 8'),
  ('doc1-02', 'Tealights',                                   'tealights',                      'decor',    'consumable', 20, 'Tealights: 1 pack of 20'),
  ('doc1-03', 'Lamp head',                                   'lamp-head',                      'lighting', 'counted',    1,  'Lamp Head: 1'),
  ('doc1-04', 'Glasses',                                     'glasses',                        'catering', 'counted',    60, 'Glasses: 60'),
  ('doc1-05', 'Silver cake plates',                          'silver-cake-plates',             'catering', 'counted',    15, 'Silver Cake Plates: 15'),
  ('doc1-06', 'LED string lights, 50 m',                     'led-string-lights-50m',          'lighting', 'counted',    1,  'LED 50M Lights: 1'),
  ('doc1-07', 'Glass jars',                                  'glass-jars',                     'decor',    'counted',    4,  'Glass Jars: 4'),
  ('doc1-08', 'Lighter',                                     'lighter',                        'decor',    'consumable', 1,  'Lighter: 1'),
  ('doc1-09', 'Communion cups, plastic, large',              'communion-cups-large',           'catering', 'consumable', 48, 'Large Communion Plastic Cups: 48'),
  ('doc1-10', 'Communion cups, plastic, small',              'communion-cups-small',           'catering', 'consumable', 40, 'Small Communion Plastic Cups: 40'),
  ('doc1-11', 'White candle lanterns',                       'white-candle-lanterns',          'decor',    'counted',    4,  'White Candle Lanterns: 4'),
  ('doc1-12', 'Citronella and eucalyptus candles, 6-piece set', 'citronella-eucalyptus-candle-sets', 'decor', 'consumable', 3, '6 Piece Set of Citronelle, Eucalyptus Candles: 3'),
  ('doc1-13', 'Silver forks',                                'silver-forks',                   'catering', 'counted',    30, 'Silver Forks: 30'),
  ('doc1-14', 'Silver knives',                               'silver-knives',                  'catering', 'counted',    28, 'Silver Knives: 28'),
  ('doc1-15', 'String light bulbs, large',                   'string-light-bulbs-large',       'lighting', 'counted',    1,  'Stringed Light Bulbs (Large): 1'),
  ('doc1-16', 'Beige tablecloth',                            'beige-tablecloth',               'linen',    'counted',    2,  'Beige Table Cloth: 1 and One Beige Table Cloth: 1 (two lines; recount if it is one cloth)'),
  ('doc1-17', 'Glass drink dispenser, 9 L',                  'glass-drink-dispenser-9l',       'catering', 'counted',    1,  '9 Lt. Glass Drink Dispenser: 1'),
  ('doc1-18', 'Wooden platter / cutting board, spearhead shape', 'wooden-platter-spearhead',   'catering', 'counted',    1,  'Wooden Platter/Cutting Board (Spearhead Shape): 1'),
  ('doc1-19', 'Green vine',                                  'green-vine',                     'decor',    'counted',    1,  'One Green Vine: 1'),
  ('doc1-20', 'Olive green tablecloth',                      'olive-green-tablecloth',         'linen',    'counted',    1,  'One Olive Green Table Cloth: 1'),
  ('doc1-21', 'Dark grey tablecloths',                       'dark-grey-tablecloths',          'linen',    'counted',    2,  'Two Dark Grey Table Cloths: 2'),
  ('doc1-22', 'Clear string lights, battery',                'clear-string-lights-battery',    'lighting', 'counted',    2,  'Two Clear Stringed Lights Battery Powered: 2'),
  ('doc1-23', 'Yellow bulb string lights',                   'yellow-bulb-string-lights',      'lighting', 'counted',    1,  'Yellow Bulb Stringed Lights: 1'),
  ('doc1-24', 'Paper plates (pack)',                         'paper-plates-pack',              'catering', 'consumable', 1,  'Pack of Paper Plates: 1'),
  ('doc1-25', 'Balloons, pastel green',                      'balloons-pastel-green',          'decor',    'consumable', 5,  'Pastel Green Balloons: 5'),
  ('doc1-26', 'Balloons, white (pack)',                      'balloons-white-pack',            'decor',    'consumable', 1,  'Pack of White Balloons: no quantity given; 1 pack'),
  ('doc1-27', 'Forks, clear plastic',                        'forks-clear-plastic',            'catering', 'consumable', 100, 'Pack of Clear Forks: 100-150 ish; counted as 100'),
  ('doc1-28', 'Small beige vase',                            'small-beige-vase',               'decor',    'counted',    1,  'Small Beige Vase: 1'),
  ('doc1-29', 'Small pink pottery piece',                    'small-pink-pottery-piece',       'decor',    'counted',    1,  'Small Pink Pottery Piece: 1'),
  ('doc1-30', 'Big clear vases with candles',                'big-clear-vases-with-candles',   'decor',    'counted',    2,  'Big Clear Vases with Candles: 2'),
  ('doc1-31', 'Paper cups, compostable',                     'paper-cups-compostable',         'catering', 'consumable', 7,  'Compostable Paper Cups: 7'),
  ('doc1-32', 'Balloon, yellow',                             'balloon-yellow',                 'decor',    'consumable', 1,  'Yellow Balloon: 1'),
  ('doc1-33', 'Tall light brown glass vases',                'tall-light-brown-glass-vases',   'decor',    'counted',    2,  'Tall Light Brow Glass Vases: 2'),
  ('doc1-34', 'Wooden letter “N”',                           'wooden-letter-n',                'decor',    'counted',    1,  'Wooden “N”: 1'),
  ('doc1-35', 'Wooden letter “R”',                           'wooden-letter-r',                'decor',    'counted',    1,  'Wooden “R”: 1'),
  ('doc1-36', 'Small glass jars with metal lid',             'small-glass-jars-metal-lid',     'decor',    'counted',    19, 'Small Glass Jars with Metal Lid: 19 (one without lid)'),
  ('doc1-37', 'Fake plant, big',                             'fake-plant-big',                 'decor',    'counted',    1,  'Big fake plant: 1'),
  ('doc1-38', 'Fake plant, tiny',                            'fake-plant-tiny',                'decor',    'counted',    1,  'Tiny fake plant: 1'),
  ('doc1-39', 'Black tablecloths',                           'black-tablecloths',              'linen',    'counted',    10, 'Black table cloths: 10'),
  ('doc1-40', 'Eucalyptus tealight candles',                 'eucalyptus-tealight-candles',    'decor',    'consumable', 26, 'Eucalyptus Tealight candles (in MRP bag): 26'),
  ('doc1-41', 'Small glass containers',                      'small-glass-containers',         'decor',    'counted',    2,  'Small glass containers: 2');

INSERT INTO public.equipment_products
  (seed_key, name, slug, register_category, tracking, is_requestable, description)
SELECT s.seed_key, s.name, s.slug, s.category, s.tracking, s.tracking = 'counted', NULL
FROM inventory_doc1 s
ON CONFLICT (seed_key) DO NOTHING;

INSERT INTO public.equipment_stock_moves (product_id, delta, reason, note, happened_on)
SELECT p.id, s.qty, 'opening', 'Inventory list (Google Doc): ' || s.doc_text, DATE '2026-11-20'
FROM public.equipment_products p
JOIN inventory_doc1 s ON s.seed_key = p.seed_key
WHERE s.qty > 0
  AND NOT EXISTS (SELECT 1 FROM public.equipment_stock_moves m WHERE m.product_id = p.id AND m.reason = 'opening');

COMMIT;

-- Check (expect 41 items: 29 counted with 204 in all, 12 consumable with 253):
-- SELECT tracking, count(*), sum(stock_quantity) FROM public.equipment_products
--  WHERE seed_key LIKE 'doc1-%' GROUP BY 1;
