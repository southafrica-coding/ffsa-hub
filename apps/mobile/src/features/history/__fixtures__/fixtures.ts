// Shared test data for the My History tests (not a test file). Placeholder data only.

import type { ApplicationRecord, DocumentRecord, EnrollmentRecord, History, PaymentRecord } from "../types";

export const application = (o: Partial<ApplicationRecord> = {}): ApplicationRecord => ({
  id: "a1",
  program_name: "DTS",
  cohort: "2019 Winter",
  status: "accepted",
  submitted_at: "2019-03-12T08:00:00+00:00",
  raw_data: { "Home church": "Sample Church", Phone: null },
  ...o,
});

export const enrollment = (o: Partial<EnrollmentRecord> = {}): EnrollmentRecord => ({
  id: "e1",
  school_name: "DTS Cape Town",
  program_name: "DTS",
  role: "student",
  start_date: "2019-07-01",
  end_date: "2019-12-13",
  raw_data: {},
  ...o,
});

export const payment = (o: Partial<PaymentRecord> = {}): PaymentRecord => ({
  id: "p1",
  amount: 1500,
  currency: "ZAR",
  description: "School fees deposit",
  paid_at: "2019-04-02",
  raw_data: { Reference: "INV-1" },
  ...o,
});

export const document = (o: Partial<DocumentRecord> = {}): DocumentRecord => ({
  id: "d1",
  doc_type: "Passport",
  file_url: "https://files.example.test/passport.pdf",
  identifier: "A0000000",
  expires_at: "2029-01-31",
  raw_data: {},
  ...o,
});

export const history = (o: Partial<History> = {}): History => ({
  applications: [application()],
  enrollments: [enrollment()],
  payments: [payment()],
  documents: [document()],
  ...o,
});

export const emptyHistory = (): History => ({ applications: [], enrollments: [], payments: [], documents: [] });
