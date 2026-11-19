// Every English string the Staff decisions screens show, in one place so a
// translation can be added later. Plain words: the people reading this are
// the Leadership Team, not technical staff.

export const strings = {
  common: {
    back: "Back",
    home: "Home",
    generic: "Something went wrong. Pull down to try again.",
    network: "Couldn't reach FFSA Hub. Check your connection and pull down to try again.",
    forbidden: "Staff decisions are for the Leadership Team only.",
    notFound: "This school isn't a Leadership Track school, or it no longer exists.",
    refreshFailed: (when: string) => `Couldn't refresh. Showing what was saved at ${when}.`,
    lastUpdated: (when: string) => `Last updated ${when}`,
  },
  shortcut: { title: "Staff decisions", subtitle: "Leadership Track: who is accepted onto staff" },
  gate: {
    checking: "Checking your access",
    title: "Leadership Team only",
    body: "Staff decisions are for the Leadership Team only. Ask an admin if you think you should have access.",
  },
  list: {
    context: "Leadership Track",
    title: "Staff decisions",
    intro: "Decide which Leadership Track students are accepted onto staff. Only the Leadership Team can see this, and it stays available after a school ends.",
    loading: "Loading schools",
    errorTitle: "Couldn't load schools",
    emptyTitle: "No Leadership Track schools yet.",
    emptyBody: "When a Leadership Track school is set up, it shows here.",
    archived: "Archived",
    rowSummary: (total: number, yes: number, no: number, undecided: number) =>
      `${total} ${total === 1 ? "student" : "students"} · ${yes} yes · ${no} no · ${undecided} undecided`,
    rowHint: "Opens this school's students",
    rowA11y: (name: string, archived: boolean, total: number, yes: number, no: number, undecided: number) =>
      [
        name,
        archived ? "Archived" : null,
        `${total} ${total === 1 ? "student" : "students"}`,
        `${yes} yes, ${no} no, ${undecided} undecided`,
      ]
        .filter(Boolean)
        .join(". "),
  },
  detail: {
    context: "Leadership Track · Staff decision",
    loading: "Loading students",
    errorTitle: "Couldn't load this school",
    intro: "Everyone who arrived at this school. Students never see their decision or note.",
    counts: (yes: number, no: number, undecided: number) => `${yes} yes · ${no} no · ${undecided} undecided`,
    students: "Students",
    studentsCount: (n: number) => `Students · ${n}`,
    noteLine: (note: string) => `Note: ${note}`,
    emptyTitle: "Nobody has arrived yet",
    emptyBody: "Students show up here once they're set to Arrived on the school's Arrival tab on the website.",
    needsYouTitle: "Needs a decision",
    needsYouOne: "1 student is still waiting on a staff decision.",
    needsYouMany: (n: number) => `${n} students are still waiting on a staff decision.`,
    staff: "Staff",
    acceptedYes: "Accepted: yes",
    acceptedNo: "Accepted: no",
    notDecided: "Not decided",
    decidedOn: (date: string, by: string | null) => (by ? `Decided ${date} by ${by}` : `Decided ${date}`),
    decide: "Decide",
    change: "Change",
    makeStaff: "Make staff",
    decideA11y: (name: string) => `Decide on ${name}`,
    changeA11y: (name: string) => `Change the decision for ${name}`,
    decideHint: "Opens a sheet to record yes or no",
    makeStaffA11y: (name: string) => `Make ${name} staff`,
    makeStaffHint: "Opens a sheet to switch their Hub role to Staff",
    rowA11y: (parts: { name: string; email: string | null; staff: boolean; decision: string; note: string | null; decided: string | null }) =>
      [parts.name, parts.email, parts.staff ? "Staff" : null, parts.decision, parts.note ? `Note: ${parts.note}` : null, parts.decided]
        .filter(Boolean)
        .join(". "),
    openWeb: "Open this school on the website",
    openWebSub: "Arrival, applications and the full school page",
    openWebHint: "Opens this school on the FFSA Hub website",
  },
  sheet: {
    decideTitle: (name: string) => `Accept ${name} as staff?`,
    decideIntro: "Only the Leadership Team sees this decision and note.",
    acceptedLabel: "Accepted as staff",
    yes: "Yes",
    no: "No",
    noteLabelRequired: "Note (required: why not?)",
    noteLabelOptional: "Note (optional)",
    notePlaceholderRequired: "Why they weren't accepted onto staff",
    notePlaceholderOptional: "Anything worth remembering",
    noteRequired: "Please add a note explaining why they weren't accepted.",
    chooseFirst: "Choose yes or no first.",
    save: "Save decision",
    saved: (name: string) => `Decision saved for ${name}.`,
    saveFailed: "Couldn't save the decision. Check your connection and try again.",
    saveRejected: "This student can't be decided on any more. Close this and pull down to refresh.",
    forbidden: "Only the Leadership Team can do this.",
    makeStaffTitle: (name: string) => `Make ${name} staff now?`,
    makeStaffIntro: "This switches their Hub role from Student to Staff. You can also do it later from this list.",
    departmentLabel: "Department",
    departmentLater: "Choose later",
    currentDepartment: (label: string) => `Current department: ${label}`,
    makeStaffConfirm: "Make staff",
    notNow: "Not now",
    madeStaff: (name: string) => `${name} is now staff.`,
    makeStaffFailed: "Couldn't make them staff. Check your connection and try again.",
    makeStaffRejected: "Couldn't make them staff. Their yes may have changed, or they no longer have a Hub account. Close this and pull down to refresh.",
    confirmTitle: (name: string) => `Make ${name} staff?`,
    confirmBody: (department: string | null) =>
      department
        ? `Their Hub role changes from Student to Staff, in ${department}.`
        : "Their Hub role changes from Student to Staff. You can pick a department later.",
    confirmYes: "Make staff",
    confirmNo: "Cancel",
  },
};
