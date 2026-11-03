// English strings for Home ("needs you" feed). One place so translation can
// come later.

export const homeStrings = {
  context: "FFSA Hub · Home",
  greeting: (name: string | null) => (name ? `Hello, ${name}` : "Hello"),
  band: {
    title: "Needs you",
    count: (n: number) => (n === 1 ? "1 thing needs you" : `${n} things need you`),
    open: "Open",
    openA11y: (title: string) => `Open: ${title}`,
  },
  sections: {
    needsYou: (n: number) => `Needs you (${n})`,
    earlier: "Earlier",
    shortcuts: "Shortcuts",
  },
  markAllRead: "Mark all read",
  markAllReadA11y: (n: number) => `Mark all ${n} as read`,
  unread: "Unread",
  loading: "Loading your notifications",
  empty: {
    title: "You're all caught up",
    body: "Nothing needs you right now. Pull down to check again.",
  },
  error: {
    title: "Couldn't load your notifications",
    retry: "Try again",
  },
  forbidden: {
    title: "Notifications aren't available on your account",
    body: "If you think that's wrong, ask an FFSA Hub admin to check your access.",
  },
  offline: {
    title: "Offline",
    body: (savedAgo: string | null) =>
      savedAgo ? `Showing saved items from ${savedAgo}.` : "Showing saved items.",
  },
  stale: {
    title: "Couldn't refresh",
    body: (message: string) => `${message} Showing saved items.`,
  },
  shortcuts: {
    finance: { title: "My Finance", subtitle: "Outreach budgets, expenses and receipts" },
    tickets: { title: "My Tickets", subtitle: "Your event tickets" },
    me: { title: "Me", subtitle: "Profile, notifications and sign out" },
  },
  itemA11y: (title: string, body: string, read: boolean, when: string | null, web: boolean) =>
    [read ? null : "Unread", title, body, when, web ? "Opens in browser" : null].filter(Boolean).join(". "),
} as const;
