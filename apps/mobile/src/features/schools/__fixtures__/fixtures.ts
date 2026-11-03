// Placeholder rows for the schools tests (not a test file).

import type { EnrolmentData, SchoolsList } from "../data";
import type { Application, AttendanceRecord, Course, Enrolment, Programme } from "../types";

export const ENROLMENT_ID = "11111111-2222-4333-8444-555555555555";

export const programme = (o: Partial<Programme> = {}): Programme => ({ id: "p1", name: "DTS Winter", code: "DTS-W", credit_hours: 12, ...o });

export const enrolment = (o: Partial<Enrolment> = {}): Enrolment => ({
  id: ENROLMENT_ID,
  status: "active",
  enrolled_at: "2026-07-01T09:00:00.000Z",
  completed_at: null,
  programs: programme(),
  assigned_staff: null,
  ...o,
});

export const application = (o: Partial<Application> = {}): Application => ({
  id: "a1",
  program_id: "p1",
  status: "submitted",
  submitted_at: "2026-05-02T10:00:00.000Z",
  programs: { id: "p1", name: "DTS Winter", code: "DTS-W" },
  assigned_staff: null,
  ...o,
});

export const course = (o: Partial<Course> = {}): Course => ({
  id: "c1",
  code: "DTS-L",
  name: "Lecture phase",
  credit_hours: 6,
  sequence: 1,
  start_date: "2026-07-01",
  end_date: "2026-09-30",
  arrival_date: null,
  ...o,
});

export const schoolsList = (o: Partial<SchoolsList> = {}): SchoolsList => ({ enrolments: [enrolment()], applications: [], openProgrammes: [], ...o });

export const enrolmentData = (o: { courses?: Course[]; grades?: EnrolmentData["grades"]; enrolment?: Partial<Enrolment> } = {}): EnrolmentData => ({
  enrolment: {
    ...enrolment(o.enrolment),
    programs: { ...programme(), courses: o.courses ?? [course(), course({ id: "c2", code: "DTS-O", name: "Outreach phase", sequence: 2, start_date: "2026-10-01", end_date: "2026-12-15" })] },
  },
  grades: o.grades ?? [],
});

export const record = (o: Partial<AttendanceRecord> = {}): AttendanceRecord => ({
  id: "r1",
  status: "present",
  checked_in_at: null,
  events: { id: "e1", title: "Morning lecture", start_date: "2026-11-03", location: "Main hall" },
  ...o,
});
