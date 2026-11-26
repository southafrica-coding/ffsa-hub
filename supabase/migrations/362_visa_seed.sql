-- DO NOT APPLY until Jack says so.
-- ============================================================
-- FFSA Hub — Migration 362: visa applications (seed: document types)
-- ============================================================
-- The starting checklist, following legal's answers (23 Nov 2026). Drawn
-- from Home Affairs' published visitor's-visa requirements and FFSA's own
-- visa instructions. Legal edits these rows in the Hub afterwards; this
-- seed only gives them a starting point. Home Affairs changes these rules
-- often, so nothing in the app hard-codes a document.
--
-- Up to 90 days → the short list. Over 90 days (FFSBI, a full year, or a
-- short school plus a few buffer days) → the long-stay form and a police
-- clearance as well. Which list applies comes from the real arrival and
-- departure days, never the school's name.
--
-- Changed after legal's answers: no chest X-ray (dropped by Home Affairs
-- in 2023); the medical report and medical cover only if the embassy asks;
-- the birth certificate is gone (the form asks it for dependent children,
-- not the applicant); police clearance from each country lived in for 12
-- months or more since 18, in the last 5 years; DHA-84 / DHA-1738 forms
-- and the student's signed undertaking added. Police clearance and the
-- medical report are restricted (POPIA special personal information, 361).
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
   is_offline, is_restricted, needs_certified, lead_time_weeks, max_age_months,
   leader_checks, sort_order)
VALUES
  ('passport', 'Passport',
   'Valid for at least 30 days after your last day in South Africa, with blank pages (most embassies want 2 or 3). Upload the photo page.',
   true, true, false, false, false, false, NULL, NULL,
   ARRAY['Valid at least 30 days after the last day in South Africa',
         'Has blank pages',
         'The name matches the other documents'], 10),
  ('passport_copy_certified', 'Certified copy of the passport photo page',
   'A copy certified by a notary, bank or commissioner of oaths, less than 6 months old. On base, legal can certify it for you at a booked time.',
   true, true, false, false, false, true, 1, 6,
   ARRAY['Certified, with a stamp and signature', 'Certified less than 6 months ago'], 20),
  ('passport_photos', 'Two passport photos',
   'Colour, with a white or light background.',
   true, true, false, false, false, false, NULL, 6,
   ARRAY['Colour, light background'], 30),
  ('form_dha84', 'Visa application form (DHA-84), signed',
   'Fill it in by hand in black ink and sign it in the original. Tick this off once it''s done; you hand it in at the embassy.',
   true, false, false, true, false, false, NULL, NULL, '{}', 40),
  ('form_dha1738', 'Long-stay visa application form (DHA-1738), signed',
   'For stays over 90 days. Fill it in by hand in black ink and sign it in the original. Tick this off once it''s done; you hand it in at the embassy.',
   false, true, false, true, false, false, NULL, NULL, '{}', 45),
  ('return_ticket', 'Return ticket booking',
   'A reservation or itinerary is enough. Don''t buy the ticket until the visa is granted.',
   true, true, false, false, false, false, NULL, NULL,
   ARRAY['The name matches the passport', 'Leaves after the last school day'], 50),
  ('proof_of_funds', 'Proof of funds',
   'Bank statements for the last 3 months, stamped by the bank. Donor or support records can be added.',
   true, true, false, false, false, false, 1, 3,
   ARRAY['Stamped by the bank', 'Covers the last 3 months', 'The name matches the passport'], 60),
  ('medical_cover', 'Medical cover',
   'Only if your embassy asks for it: proof of health insurance for your whole stay in South Africa.',
   true, true, true, false, false, false, 1, NULL,
   ARRAY['Covers the whole stay'], 70),
  ('yellow_fever', 'Yellow fever certificate',
   'Only if you live in or travel through the yellow fever belt of Africa or South America.',
   true, true, true, false, false, false, 2, NULL, '{}', 80),
  ('embassy_fee_envelope', 'Embassy fee and return envelope',
   'Pay the embassy''s fee and bring a prepaid return envelope if they ask for one. Tick this off once it''s ready.',
   true, true, false, true, false, false, NULL, NULL, '{}', 90),
  ('legal_residence', 'Proof of legal residence',
   'Only if you live outside your country of citizenship: your residence permit or visa there.',
   true, true, true, false, false, true, 1, NULL,
   ARRAY['Valid on the day you apply'], 100),
  ('police_clearance', 'Police clearance',
   'From every country you have lived in for 12 months or more in a row since you turned 18, in the last 5 years (for US citizens, the FBI check). Less than 6 months old when you apply. Only FFSA''s legal officer sees it.',
   false, true, false, false, true, false, 8, 6, '{}', 110),
  ('student_undertaking', 'Your signed undertaking',
   'Only if your embassy asks for it: a signed statement that you won''t take paid work and will leave South Africa at the end of your stay.',
   false, true, true, false, false, false, NULL, NULL,
   ARRAY['Signed'], 120),
  ('medical_report', 'Medical report',
   'Only if your embassy''s checklist asks for it: on the official South African form, signed by a doctor, less than 6 months old. Only FFSA''s legal officer sees it.',
   false, true, true, false, true, false, 1, 6, '{}', 130)
ON CONFLICT (code) DO NOTHING;

COMMIT;
