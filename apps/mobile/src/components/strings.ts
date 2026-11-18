// English defaults for the component kit. Features pass their own wording
// where it differs; these match the app's existing copy.

export const kitStrings = {
  close: "Close",
  back: "Back",
  backTo: (parent: string) => `Back to ${parent}`,
  tryAgain: "Try again",
  opensInBrowser: "Opens in browser",
  loading: "Loading",
  unread: "Unread",
  photo: {
    empty: "No photo yet",
    onFile: "Photo on file",
    view: "View",
    take: "Take a photo",
    choose: "Choose a photo",
    remove: "Remove",
  },
} as const;
