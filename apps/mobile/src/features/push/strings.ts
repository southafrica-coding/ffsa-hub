// English strings for push notifications. One place so translation can come later.

export const pushStrings = {
  section: "Push notifications",
  master: {
    label: "Push notifications on this phone",
    hint: "Get a notification on this phone when something needs you.",
  },
  status: {
    label: "Status",
    loading: "Checking this phone",
    on: "On",
    off: "Off",
    blocked: "Off in your phone's Settings",
    blockedBody: "Notifications for FFSA Hub are switched off in your phone's Settings. Turn them on there, then come back.",
    openSettings: "Open Settings",
    unsupported: "Notifications are not switched on for this build yet",
    unsupportedBody: "This version of the app can't receive notifications yet. Everything else works as normal.",
    notEnabled: "Notifications are not switched on for FFSA Hub yet",
    notEnabledBody: "We're still setting notifications up. Everything else works as normal.",
    error: "Couldn't switch notifications on",
    errorBody: "Check your connection and try again.",
    retry: "Try again",
  },
  categories: {
    title: "What to notify me about",
    loading: "Loading your notification choices",
    error: "Couldn't load your choices. Check your connection and try again.",
    saveError: "Couldn't save that change. Check your connection and try again.",
    retry: "Try again",
    on: "On",
    off: "Off",
  },
  slackSection: "Slack messages",
  prePrompt: {
    title: "Turn on notifications?",
    lead: "Get a nudge on this phone when something needs you, like:",
    examples: [
      "Someone asks to book a space you approve",
      "Your booking is approved or declined",
    ],
    privacy: "Notifications only say what kind of thing is waiting. Names, amounts and details stay inside the app.",
    later: "You can change this any time in Me, Notification settings.",
    accept: "Turn on notifications",
    acceptHint: "Your phone will then ask you to allow notifications.",
    decline: "Not now",
  },
} as const;
