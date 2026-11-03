// English strings for the Me tab. One place so translation can come later.

export const meStrings = {
  context: "FFSA Hub · Me",
  fallbackTitle: "Me",
  loading: "Loading your profile",
  error: {
    title: "Couldn't load your profile",
    retry: "Try again",
  },
  sections: {
    profile: "Profile",
    settings: "Settings",
    about: "About",
  },
  email: "Email",
  roles: "Roles",
  noRoles: "No roles yet",
  rows: {
    edit: { title: "Edit name and phone", subtitle: "Change how your name and number appear" },
    notifications: { title: "Notification settings", subtitle: "Choose which team-wide messages you get" },
    fullProfile: { title: "Open full profile on the web", subtitle: "Household, documents, insurance and more" },
    privacy: { title: "Privacy policy" },
    deletion: {
      title: "Request account deletion",
      subtitle: "Ask us to delete your account and data",
    },
  },
  // The row's subtitle (current choice) is in src/features/appearance/strings.ts.
  appearance: {
    label: "Appearance",
  },
  version: {
    label: "App version",
    value: (v: string) => v,
    unknown: "Unknown",
  },
  signOut: "Sign out",
  signOutHint: "Signs you out on this phone only. You stay signed in on the website.",

  edit: {
    title: "Edit profile",
    firstName: "First name",
    lastName: "Last name",
    phone: "Phone",
    phoneHint: "Include the country code, for example +27 82 123 4567.",
    save: "Save",
    saved: "Saved.",
    loading: "Loading your details",
    loadError: "Couldn't load your details. Check your connection and try again.",
    saveErrorTitle: "Couldn't save",
    saveError: "Couldn't save your changes. Check your details and try again.",
    errors: {
      firstNameRequired: "Enter your first name.",
      tooLong: (max: number) => `Keep this under ${max} characters.`,
      phoneInvalid: "Enter a phone number with digits only (spaces, +, - and brackets are fine).",
    },
  },

  prefs: {
    title: "Notifications",
    intro:
      "FFSA Hub sends some Slack messages to everyone on the team. Turn a group off to stop getting those messages. Messages meant for you personally always arrive.",
    loading: "Loading your notification settings",
    empty: {
      title: "Nothing to turn off",
      body: "There are no team-wide messages you can switch off right now.",
    },
    error: {
      title: "Couldn't load your settings",
      retry: "Try again",
    },
    saveError: "Couldn't save that change. Check your connection and try again.",
    forbidden: {
      title: "Not available on your account",
      body: "Ask an FFSA Hub admin if you think you should have access.",
    },
    switchA11y: (label: string, on: boolean) => `${label}, ${on ? "on" : "off"}`,
    on: "On",
    off: "Off",
  },
} as const;
