// English strings for the delete-account screen. One place so translation
// can come later. The "delete / keep" lists mirror the website's
// /legal/delete-account page (src/lib/account-deletion/config.ts at the repo
// root); change both together.

import type { ErrorKind } from "./logic";

/** Used until the server tells us the address (and when it can't be reached). */
export const FALLBACK_CONTACT_EMAIL = "info@fireandfragrance.com";

export const strings = {
  title: "Delete account",
  loading: "Checking for a request",
  intro:
    "You can ask us to delete your FFSA Hub account. Someone on our team will finish it within 30 days and email you when it's done.",
  staysActive:
    "Sending a request doesn't sign you out. Your account keeps working until our team deletes it.",
  deleteHeading: "What we delete",
  deleteItems: [
    "Your sign-in, so the account can no longer be used.",
    "Your profile: name, phone, photo, address and other personal details.",
    "Your roles, permissions and settings.",
  ],
  keepHeading: "What we have to keep",
  keepIntro: "Some records are kept because the law requires it:",
  keepItems: [
    "Receipts, payments and invoices, because tax and accounting law requires it.",
    "Donor statements and donation records, for the same reason.",
    "School records: applications, enrolments, grades and certificates, so we can confirm your training later.",
    "Signed consent forms and agreements.",
  ],
  requestHeading: "Your request",
  reason: {
    label: "Why are you leaving? (optional)",
    hint: "Only our team sees this. Up to 1000 characters.",
    placeholder: "You don't have to say",
  },
  request: {
    button: "Request account deletion",
    hint: "Opens a confirmation. Nothing is sent yet.",
  },
  confirm: {
    title: "Delete your account?",
    body: "We'll send your request to our team. Once they delete your account you can't sign in again, and we can't bring it back.",
    yes: "Yes, send my request",
    yesHint: "Sends your deletion request to the FFSA team",
    no: "Go back",
  },
  requested: {
    title: "Request sent",
    body: (date: string) => `Requested on ${date}. We'll email you when it's done.`,
    bodyNoDate: "We have your request. We'll email you when it's done.",
    emailedOnly: "Our team has your request by email.",
    sentNow: "We've also emailed you a copy.",
    cancel: "Cancel my request",
    cancelHint: "Opens a confirmation. Your account stays as it is.",
  },
  cancelConfirm: {
    title: "Keep your account?",
    body: "We'll tell our team you've changed your mind, and your account stays as it is.",
    yes: "Yes, cancel my request",
    no: "Go back",
  },
  web: {
    title: "Do this on the website instead",
    subtitle: "Same request, at ffsahub.com",
  },
  close: "Close",
  retry: "Try again",
  loadErrorTitle: "Couldn't check your request",
  errorTitle: "Not sent",
  cancelErrorTitle: "Not cancelled",
  errors: {
    offline: (contact: string) =>
      `You're offline, or FFSA Hub didn't answer. Check your connection and try again, or email ${contact}.`,
    unavailable: (contact: string) =>
      `We couldn't send your request just now. Please email ${contact} and ask for your account to be deleted.`,
    cannotCancel: (contact: string) =>
      `We can't cancel this in the app yet. Please email ${contact} and say you want to keep your account.`,
    forbidden: (contact: string) => `Your account can't do this in the app. Please email ${contact}.`,
    tooMany: (contact: string) =>
      `You've tried this a few times already. Wait an hour and try again, or email ${contact}.`,
    generic: (contact: string) => `Something went wrong. Try again, or email ${contact}.`,
  } satisfies Record<ErrorKind, (contact: string) => string>,
} as const;
