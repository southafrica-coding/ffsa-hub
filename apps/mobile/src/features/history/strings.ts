// Every English string the My History screen shows, in one place so a
// translation can be added later. Plain words: the people reading this are
// students, missionaries and staff.

export const strings = {
  common: {
    back: "Back",
    home: "Home",
    tryAgain: "Try again",
    generic: "Something went wrong. Pull down to try again.",
    network: "Couldn't reach FFSA Hub. Check your connection and pull down to try again.",
    forbidden: "This isn't available on your account. If you think it should be, ask the office.",
    refreshFailed: (when: string) => `Couldn't refresh. Showing what was saved at ${when}.`,
    lastUpdated: (when: string) => `Last updated ${when}`,
  },
  shortcut: { title: "My History", subtitle: "Past applications, schools, payments and documents" },
  list: {
    context: "Personal",
    records: (n: number) => `${n} ${n === 1 ? "record" : "records"} on file`,
    title: "My history",
    intro: "Records on file from past applications, payments, schools and documents.",
    loading: "Loading your history",
    errorTitle: "Couldn't load your history",
    emptyTitle: "Nothing on file yet",
    emptyBody: "If you have applied to FFSA before, staff will link your history here.",
    rowHint: "Shows the full record",
  },
  sections: {
    applications: "Applications",
    enrollments: "Training attended",
    payments: "Payments",
    documents: "Documents",
  },
  fallback: {
    application: "Application",
    enrollment: "Enrollment",
    payment: "Payment",
    document: "Document",
  },
  dateLabel: {
    applications: "Submitted",
    enrollments: "Dates",
    payments: "Paid",
    documents: "Expires",
  },
  detail: {
    close: "Close",
    openFile: "Open file",
    openFileHint: "Opens the file in the in-app browser",
    more: "Additional details",
    nothingMore: "There are no other details on this record.",
    empty: "—",
  },
} as const;
