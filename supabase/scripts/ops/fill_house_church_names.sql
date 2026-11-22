-- ============================================================
-- Ops: fill Missio house church names (houses 1–20)
-- ============================================================
-- APPLY ONLY AFTER JACK OKs IT. DO NOT RUN AGAINST PROD FROM THE
-- PR THAT ADDS THIS FILE. This is not a migration: previews share
-- the prod database, so live data stays out of numbered migrations.
--
-- Jack confirmed this list is current on 22 Nov 2026. Names are
-- the leaders' names with the "House N - " prefix taken off (the
-- number is already its own column).
--
-- What it does: sets house_churches.name for the Missio
-- organisation's houses 1–20, keyed by (org_id, number), and only
-- where name is null or blank. A name someone has already typed
-- is never overwritten. meeting_day, location and everything else
-- are untouched. Running it twice changes nothing the second time.
--
-- Run it in the Supabase SQL Editor as one statement. It returns
-- the rows it changed.
-- ============================================================

WITH names (number, name) AS (
  VALUES
    (1,  'Johnson''s and Schoch''s'),
    (2,  'Veronica and Hanno Degenaar and Caleb Cox'),
    (3,  'Taylor Davis and Jurie Crots'),
    (4,  'David St John & Sharissa St John and Ruan Kriek & Mia Kriek'),
    (5,  'Crathornes and Coetzee''s'),
    (6,  'Hunter & Mary Jane Stewart and Isabelle Johnson'),
    (7,  'Delano Hattingh and Uyatholwa Mkhwanazi'),
    (8,  'Cassie Cullen and Timon Berrington'),
    (9,  'Chandre Grobler and Bianca Venter'),
    (10, 'Danielle Richwine and Nythan Pienaar'),
    (11, 'Jolizna Roestorf and Gideon & Riley Botha'),
    (12, 'Jaco & Ashley Diederiks and Rikus & Lené Jonck'),
    (13, 'Marlon & Maché van Zyl and Sarah Innes & Kelly Minnie'),
    (14, 'Chanté & Delarey Bakkes and Tharina Barnard'),
    (15, 'Davis & Lizaan Crouch and Tosca'),
    (16, 'Gabe & Michelle Strydom and Dwayne & Jennifer Roberts'),
    (17, 'Gielie & Illana Jordaan and Luke & Caitlin Lange'),
    (18, 'Wikus & Allyson Roestorf and Jack & Krissy'),
    (19, 'Heinrich & Megan Botha and Philip & Lise van Staden'),
    (20, 'Jan-Hendrik & Bianca van der Merwe and Brendon & Adeleigh Homan')
)
UPDATE public.house_churches hc
SET name = n.name
FROM names n
WHERE hc.number = n.number
  AND hc.org_id = (SELECT o.id FROM public.organisations o WHERE o.slug = 'missio')
  AND (hc.name IS NULL OR btrim(hc.name) = '')
RETURNING hc.number, hc.name;

-- Check (read-only):
--   SELECT number, name, meeting_day, location
--   FROM public.house_churches
--   WHERE org_id = (SELECT id FROM public.organisations WHERE slug = 'missio')
--   ORDER BY number;
