// Words every outbox uses for an item's state, so finance, vehicle checks
// and the door say the same thing. Feature-specific wording stays in each
// feature's strings.ts.

import { MAX_ATTEMPTS } from "./backoff";

export const outboxStrings = {
  state: {
    offline: "Waiting for signal",
    waiting: "Waiting to try again",
    sending: "Sending…",
    needsYou: "Needs you",
  },
  /** One line under the state, saying what happens next. */
  next: {
    offline: "Saved on this phone. It will send by itself when you have signal.",
    waiting: "Saved on this phone. It will try again by itself.",
    sending: "Sending now. Keep the app open if you can.",
    needsYou: "Tap Retry to try again, or Remove if you don't need it.",
  },
  gaveUp: `Couldn't send after ${MAX_ATTEMPTS} tries. Check your signal, then tap Retry.`,
  lastTried: (when: string) => `Last tried ${when}`,
  summary: (waiting: number, needsYou: number) =>
    [waiting > 0 ? `${waiting} waiting` : null, needsYou > 0 ? `${needsYou} need${needsYou === 1 ? "s" : ""} you` : null]
      .filter(Boolean)
      .join(" · "),
  problem: {
    title: "Some saved items couldn't be read",
    corrupt:
      "The list of unsent items on this phone was damaged, so nothing could be read from it. A copy has been kept on this phone. Check FFSA Hub for anything you saved recently and add it again if it's missing.",
    partial:
      "Part of the list of unsent items on this phone couldn't be read. Everything that could be read is below, and a copy of the rest has been kept on this phone. Check FFSA Hub for anything you saved recently.",
    dismiss: "OK",
    dismissHint: "Hides this message",
  },
} as const;
