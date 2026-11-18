// English strings for the Training tab. One place per feature so
// translation can come later.

import type { SectionId, TrainingRole } from "./logic";

export const strings = {
  switcherLabel: "Training sections",
  loading: "Loading Training",
  scope: {
    director: "All schools",
    leader: "Your school",
    staff: "Your school",
    walker: "Your students",
  } satisfies Record<TrainingRole, string>,
  sections: {
    today: "Today",
    schools: "Schools",
    applicants: "Applicants",
    people: "People",
    students: "Students",
    myStudents: "My students",
    grades: "Grades",
  } satisfies Record<SectionId, string>,
  titles: {
    today: (name: string) => `Your week, ${name}`,
    schools: "Schools",
    applicants: "Applicants",
    people: "People",
    students: "Students",
    myStudents: "Your students",
    grades: "Grades",
  },
  empty: {
    today: {
      title: "Nothing needs you yet",
      body: "Check-ins, grades, fees and decisions that need you will be listed here, each one tap from the screen that does it.",
    },
    schools: { title: "Schools will be listed here", body: "Every running school, with what needs attention." },
    applicants: { title: "Applicants will be listed here", body: "The queue by stage, oldest first, with the decision one tap away." },
    people: { title: "Staff and students will be listed here", body: "Who is walking with whom, across every school." },
    students: { title: "Students will be listed here", body: "Each with their last check-in, grades and fees." },
    myStudents: {
      title: "The students you walk with will be listed here",
      body: "With a weekly check-in for each. A short one counts.",
    },
    grades: { title: "Grades will be listed here", body: "One course at a time, and only the courses you teach open for editing." },
  } satisfies Record<SectionId, { title: string; body: string }>,
  openWeb: "Open Training on the website",
  noAccess: {
    title: "Training is for school staff",
    body: "It shows to school leaders, school staff and anyone walking with a student.",
  },
} as const;
