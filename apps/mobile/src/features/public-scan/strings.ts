// English for the volunteer door (a scan link opened in the app). Kept in one
// place so translation can come later. The door itself (tally, scanner,
// verdicts, offline queue) reuses the Tickets strings: one door, one voice.

export const strings = {
  title: "Door scanner",
  context: "Door scanner",
  done: "Done",
  doneHint: "Leaves the door scanner",

  loading: "Opening the door scanner",

  deadTitle: "This scanning link isn't active",
  deadBody:
    "It may have been replaced, switched off, or the event has passed. Ask the event organiser to send you a current one.",
  badLinkBody: "This doesn't look like a complete scanning link. Ask the event organiser to send it again, then open it from the message.",

  errorTitle: "Couldn't open the door scanner",
  offlineBody: "You're offline. Connect to Wi-Fi or mobile data, then try again.",
  busyBody: "Lots of scans are coming in right now. Wait a moment, then try again.",
  retry: "Try again",
  openWeb: "Open on the website",
  openWebHint: "Opens this scanning link in the browser instead",

  nameTitle: "Who's on the door?",
  nameBody: "Your first name, so the organiser knows who scanned what. We remember it on this phone, so you'll only be asked once.",
  nameField: "First name",
  nameStart: "Start scanning",
  nameStartHint: "Saves your name and opens the door scanner",

  scanningAs: (name: string) => `Scanning as ${name}`,
  notYou: "Not you?",
  notYouHint: "Changes the name your scans are recorded under",
} as const;
