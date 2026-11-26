// English strings for the app shell (tab bar, shared rows). One place per
// feature so translation can come later.

export const shellStrings = {
  tabs: {
    home: "Home",
    training: "Training",
    finance: "Finance",
    prayer: "Prayer",
    tickets: "Tickets",
    me: "Me",
  },
  tabA11y: (label: string, badge: number) =>
    badge > 0 ? `${label}, ${badge} unread` : label,
  opensInBrowser: "Opens in browser",
  opensInBrowserHint: "Opens the FFSA Hub website in a browser inside the app.",
} as const;
