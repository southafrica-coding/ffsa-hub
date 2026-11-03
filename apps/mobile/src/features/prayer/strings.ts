// English strings for the Prayer Room slice. One place, so translation can
// come later. Voice: plain and direct, like the web's prayer room.

export const strings = {
  title: "Prayer Room",
  segments: {
    week: "Week",
    practice: "Practice",
    mine: "My sets",
    a11yHint: (n: number, total: number) => `Section ${n} of ${total}`,
  },

  week: {
    loading: "Loading the week",
    previous: "Previous week",
    next: "Next week",
    today: "This week",
    todayHint: "Jumps back to the current week.",
    weekOf: (label: string) => `Week of ${label}`,
    context: (label: string, sets: number, open: number, seats: number) =>
      sets === 0
        ? `${label} · nothing booked`
        : `${label} · ${sets} ${sets === 1 ? "set" : "sets"} · ${
            open > 0 ? `${open} ${open === 1 ? "seat" : "seats"} open` : seats > 0 ? "every seat filled" : "no lineup yet"
          }`,
    nothingThisDay: "Nothing booked.",
    emptyTitle: "Nothing on the wall this week",
    emptyBody: "No sets are booked for this week yet. Try another week, or put a set on the wall from the website.",
    needLead: (n: number) =>
      n === 1
        ? "1 set this week has nobody in a lead seat. It holds its slot, but it isn't live."
        : `${n} sets this week have nobody in a lead seat. They hold their slots, but they aren't live.`,
    openFirst: "Open the first",
    offline: "Offline, showing saved week",
    offlineBody: (when: string) => `Saved ${when}. Pull down to refresh when you're back online.`,
    staleTitle: "Couldn't refresh",
    staleBody: (when: string) => `Showing the copy saved ${when}.`,
    blocked: (when: string, reason: string | null, moved: string | null) =>
      `Room blocked ${when}${reason ? `: ${reason}` : ""}${moved ? `. Sets move to ${moved}` : ""}`,
    allDay: "all day",
  },

  set: {
    devo: "Devo set",
    needsLead: "Needs a lead",
    you: "You",
    invited: "Invited",
    yourSet: "Your set",
    repeats: "Repeats weekly",
    ledBy: (names: string) => `Led by ${names}`,
    noLead: "No one in a lead seat yet",
    setUpBy: (name: string) => `Set up by ${name}`,
    seatsTaken: (taken: number, total: number) =>
      total === 0 ? "No seats yet" : `${taken} of ${total} ${total === 1 ? "seat" : "seats"} taken`,
    openSeats: (open: number, total: number) =>
      total === 0 ? "No seats yet" : open === 0 ? "Full" : `${open} ${open === 1 ? "seat" : "seats"} open`,
    relocated: (where: string) => `Moved to ${where}`,
    praying: "What we're praying",
    nothingWritten: "Nothing written for this set yet.",
    lineup: "The lineup",
    noSeats: "No seats on this set yet.",
    nobody: "Nobody in this seat yet",
    invitedPending: "Invited, not confirmed yet",
    walkIn: "If you walk in",
    loading: "Loading the set",
    notFound: "This set isn't on the wall any more. It may have been cancelled.",
    close: "Close",
    openHint: "Opens the set's lineup.",
    // Actions
    askToJoin: "Ask to join",
    askHint: (seat: string) => `Asks the set's lead for the ${seat} seat. It doesn't put you in the seat yet.`,
    asked: "Asked. Waiting on the lead",
    accept: "Accept",
    decline: "Decline",
    manageOnWeb: "Fill seats or edit this set on the website",
    leaveNote: (owner: string | null) =>
      owner
        ? `Can't make it? Tell ${owner}. Only the person who set this up can change the lineup.`
        : "Can't make it? Tell the set's lead. Only they can change the lineup.",
    // Confirmations
    confirmAcceptTitle: "Take this seat?",
    confirmAcceptBody: (seat: string, when: string) => `You'll be on ${seat} for ${when}.`,
    confirmDeclineTitle: "Decline this invitation?",
    confirmDeclineBody: "The seat opens up again for someone else.",
    confirmAskTitle: "Ask for this seat?",
    confirmAskBody: (seat: string) => `The set's lead gets a request for ${seat}. They decide.`,
    cancel: "Not now",
    // Results
    accepted: "You're in.",
    declined: "Invitation declined.",
    requestSent: "Asked. The set's lead will see it.",
  },

  mine: {
    loading: "Loading your sets",
    invitations: "Invitations",
    invitationsBand: (n: number) =>
      n === 1 ? "1 invitation is waiting on your answer." : `${n} invitations are waiting on your answer.`,
    noInvitations: "No invitations waiting.",
    leading: "Sets you set up",
    noLeading: "No upcoming sets you've set up.",
    serving: "Sets you're serving in",
    noServing: "No upcoming sets you're on. Ask to join an open seat from the week.",
    roleOn: (seat: string, title: string) => `${seat} · ${title}`,
    more: "More on the website",
    join: "Join the prayer room, or ask to be evaluated for a seat",
    evaluator: "Open evaluator tools on the web",
    calendarLater: "Adding sets to your phone's calendar is coming later. The website can download a calendar file today.",
  },

  practice: {
    loading: "Loading practice times",
    intro: (start: string, end: string, max: number) =>
      `Practise in the room ${start}–${end} on weekdays, ${max} minutes at most. Practice isn't prayer room cover.`,
    closedDay: (label: string) => `${label}. No practice.`,
    notOpenYet: (when: string) => `Bookings for this week open ${when}.`,
    cantBook: "Only people on the prayer room team can book practice. You can still see who's practising.",
    yours: "Your practice this week",
    noneYours: "You haven't booked any practice this week.",
    rowFree: (open: number, total: number) => `${open} of ${total} stations open`,
    rowFull: "Every station taken",
    band: (name: string) => `Full band: ${name}`,
    gone: "This time has gone",
    pickStation: "Pick a station",
    taken: (who: string) => `Taken by ${who}`,
    open: "Open",
    yourInstrument: "Your instrument",
    howLong: "How long",
    minutes: (n: number) => `${n} min`,
    longerNote: (station: string) => `${station} is free for the next half hour too.`,
    endsAt: (t: string) => `Practice ends at ${t}.`,
    bandNext: (t: string) => `A band has the room at ${t}.`,
    takenNext: (station: string, t: string) => `${station} is taken at ${t}.`,
    book: (station: string, range: string) => `Book ${station} · ${range}`,
    booked: (station: string, range: string) => `${station} booked · ${range}`,
    cancelBooking: "Cancel booking",
    cancelled: "Practice booking cancelled.",
    confirmBookTitle: "Book this practice time?",
    confirmBookBody: (station: string, when: string) => `${station}, ${when}. You can cancel any time.`,
    confirmCancelTitle: "Cancel this booking?",
    confirmCancelBody: (station: string, when: string) => `${station}, ${when}. Someone else can book it after.`,
    keep: "Keep it",
    bandRoom: "This row has a full band. Nobody else can book it.",
    groupOnWeb: "Booking a full band or a vocal group with other singers is on the website.",
    everyStationTaken: "Every station is taken in this row.",
    stationA11y: (label: string, state: string) => `${label}, ${state}`,
    picked: "Picked",
    nobody: "Nobody",
    until: (t: string) => ` · until ${t}`,
    takenCount: (taken: number, total: number) => `${taken} of ${total} taken`,
    rowHint: "Opens the stations for this half hour.",
  },

  errors: {
    title: "Couldn't load the prayer room",
    retry: "Try again",
    forbiddenTitle: "Not available on your account",
    forbiddenBody: "The prayer room isn't open to your account. If you think that's wrong, ask an administrator.",
    actionFailed: "That didn't work. Try again in a moment.",
    seatTaken: "Someone just took this seat. Pick another.",
    clash: "That clashes with something you're already on at that time. Pick another time or seat.",
    offlineAction: "You're offline. Connect to the internet and try again.",
  },
  // Screen-reader-only words (accessibility slice). Keep at the end.
  a11y: {
    /** "2 hours", "30 minutes", "1 hour 30 minutes". */
    duration: (mins: number) => {
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      const hours = h === 0 ? "" : `${h} ${h === 1 ? "hour" : "hours"}`;
      const minutes = m === 0 ? "" : `${m} ${m === 1 ? "minute" : "minutes"}`;
      return [hours, minutes].filter(Boolean).join(" ") || "0 minutes";
    },
    /** Appended to a set row's sentence: how long, and who leads. */
    setRowExtra: (duration: string, lead: string | null) => `${duration}. ${lead ? `Led by ${lead}` : "No one in a lead seat yet"}`,
    bandStation: (station: string, people: string) => `${station}, ${people}`,
    bookBlockedHint: (reason: string) => `Can't book yet. ${reason}`,
  },
} as const;
