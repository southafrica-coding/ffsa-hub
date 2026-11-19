-- DO NOT APPLY until Jack says so.
-- ============================================================
-- FFSA Hub — Migration 362: visa applications (seed: document types)
-- ============================================================
-- DRAFT checklist, waiting on legal to confirm. Drawn from
-- Home Affairs' published visitor's-visa requirements and FFSA's own
-- visa instructions. Legal edits these rows in the Hub afterwards; this
-- seed only gives them a starting point.
--
-- Up to 90 days → the short list. Over 90 days (e.g. FFX + FFBX, FFSBI)
-- → the short list plus police clearance, medical and X-ray reports and
-- a birth certificate.
--
-- No personal data. Country rules are NOT seeded: legal enters them
-- (exempt days, embassy processing times) so nothing here guesses.
--
-- One transaction: it applies whole or not at all.
-- Additive only. Idempotent: ON CONFLICT (code) DO NOTHING, so a re-run
-- never overwrites legal's later edits.
-- ============================================================

BEGIN;

INSERT INTO public.visa_document_types
  (code, label, guidance, needed_up_to_90, needed_over_90, is_conditional,
   is_offline, needs_certified, lead_time_weeks, max_age_months, sort_order)
VALUES
  ('passport', 'Passport',
   'Valid for at least 30 days after your last day in South Africa, with at least 2 blank pages. Upload the photo page.',
   true, true, false, false, false, NULL, NULL, 10),
  ('passport_copy_certified', 'Certified copy of the passport photo page',
   'A copy certified by a notary, bank or commissioner of oaths. On base, legal can certify it for you.',
   true, true, false, false, true, 1, NULL, 20),
  ('passport_photos', 'Two passport photos',
   'Colour, with a white or light background.',
   true, true, false, false, false, NULL, 6, 30),
  ('application_form', 'Visa application form, signed',
   'Fill in and sign the embassy''s visa application form. Tick this off once it''s done; you hand it in at the embassy.',
   true, true, false, true, false, NULL, NULL, 40),
  ('return_ticket', 'Return ticket booking',
   'A reservation or itinerary is enough. Don''t buy the ticket until the visa is granted.',
   true, true, false, false, false, NULL, NULL, 50),
  ('proof_of_funds', 'Proof of funds',
   'Bank statements for the last 3 months, stamped by the bank. Donor or support records can be added.',
   true, true, false, false, false, 1, 3, 60),
  ('medical_cover', 'Medical cover',
   'Proof of health insurance that covers your whole stay in South Africa.',
   true, true, false, false, false, 1, NULL, 70),
  ('yellow_fever', 'Yellow fever certificate',
   'Only if you live in or travel through the yellow fever belt of Africa or South America.',
   true, true, true, false, false, 2, NULL, 80),
  ('embassy_fee_envelope', 'Embassy fee and return envelope',
   'Pay the embassy''s fee and bring a prepaid return envelope if they ask for one. Tick this off once it''s ready.',
   true, true, false, true, false, NULL, NULL, 90),
  ('legal_residence', 'Proof of legal residence',
   'Only if you live outside your country of citizenship: your residence permit or visa there.',
   true, true, true, false, true, 1, NULL, 100),
  ('police_clearance', 'Police clearance',
   'From every country you have lived in for a year or more since age 18. This can take 6 to 8 weeks, so start early.',
   false, true, false, false, false, 8, 6, 110),
  ('medical_report', 'Medical report',
   'On the official South African form, signed by a doctor, no older than 6 months.',
   false, true, false, false, false, 2, 6, 120),
  ('radiology_report', 'Chest X-ray report',
   'On the official South African form, no older than 6 months. Not needed for children under 12 or pregnant women.',
   false, true, true, false, false, 2, 6, 130),
  ('birth_certificate', 'Unabridged birth certificate',
   'An official or certified copy.',
   false, true, false, false, true, 4, NULL, 140)
ON CONFLICT (code) DO NOTHING;

COMMIT;
