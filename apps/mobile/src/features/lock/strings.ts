// Face ID lock (lock screen, frame 1.6, and the Me › Settings switch).
// English only for now; kept in one place so translation can come later.

import type { BiometricKind } from "./logic";

const NAMES: Record<BiometricKind, string> = {
  faceId: "Face ID",
  touchId: "Touch ID",
  fingerprint: "Fingerprint",
  faceUnlock: "Face unlock",
  iris: "Iris unlock",
};

export const lockStrings = {
  biometricName: (kind: BiometricKind) => NAMES[kind],

  // Lock screen
  locked: "FFSA Hub is locked",
  who: (name: string | null, email: string | null) => [name, email].filter(Boolean).join(" · "),
  whoA11y: (name: string | null, email: string | null) =>
    `Signed in as ${[name, email].filter(Boolean).join(", ")}`,
  unlock: "Unlock",
  unlockA11y: (kind: BiometricKind) => `Unlock with ${NAMES[kind]}`,
  unlockHint: "Your phone's passcode works too.",
  promptMessage: "Unlock FFSA Hub",
  cancel: "Cancel",
  signOut: "Sign out instead",
  signOutHint: "Signs you out on this phone only. You stay signed in on the website.",
  failed: {
    title: "Couldn't unlock",
    body: "Tap Unlock to try again.",
  },
  unavailable: {
    title: "Can't unlock with this phone",
    body: "Face ID, Touch ID or a passcode isn't set up on this phone any more. Sign out, then sign in again.",
  },

  // Me › Settings
  setting: {
    label: (kind: BiometricKind) => `Lock with ${NAMES[kind]}`,
    description: (kind: BiometricKind) =>
      `Asks for ${NAMES[kind]} when you open the app, and when you come back after 5 minutes away. Saved on this phone only.`,
    on: "On",
    off: "Off",
    confirmPrompt: (kind: BiometricKind) => `Turn on ${NAMES[kind]} lock`,
    failed: {
      title: "Couldn't turn it on",
      body: "Your phone didn't confirm it was you. Try the switch again.",
    },
    saveFailed: {
      title: "Couldn't save your choice",
      body: "Your phone didn't save it. Try the switch again.",
    },
  },
};
