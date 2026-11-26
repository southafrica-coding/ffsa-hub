// ────────────────────────────────────────────────────────────
// Missio WhatsApp menu — every word the menu sends
// ────────────────────────────────────────────────────────────
// Client-safe and pure. One place so the tests can pin each string and a
// pastor reviewing the menu reads it all here. Voice: plain, kind,
// unhurried. No slogans, no emoji, no "chatbot" wording.
//
// WhatsApp limits (checked by interactiveProblem in messages.ts and the
// tests): body ≤ 1024, button title ≤ 20, list button ≤ 20, list row
// title ≤ 24, row description ≤ 72, ≤ 3 buttons, ≤ 10 list rows.

export const WELCOME =
  "Hi, it’s Missio. Thanks for writing — we’re glad you’re here.\n\n" +
  "Pastors can see this chat in our Hub so they can help you. Reply STOP at any time if you don’t want messages from this number.\n\n" +
  "How can we help?";

export const CHOOSE = "Choose";

export type MenuId = "new" | "house" | "serve" | "care" | "feedback" | "human";

export const MAIN_MENU: ReadonlyArray<{ id: MenuId; title: string; description: string }> = [
  { id: "new", title: "I’m new here", description: "First time, or coming back" },
  { id: "house", title: "Find a house church", description: "A midweek home group" },
  { id: "serve", title: "I want to serve", description: "Join a Sunday team" },
  { id: "care", title: "Prayer or care", description: "A pastor will take this chat" },
  { id: "feedback", title: "Weekly feedback", description: "For house church leaders" },
  { id: "human", title: "Talk to a person", description: "A pastor will reply" },
];

/** They asked for a person. */
export const HANDOFF_HUMAN =
  "Of course. A pastor will take this chat from here. You can keep writing — the menu will stay quiet.";

/** New / house / care / feedback: paths that aren't built yet. */
export const HANDOFF_DEFERRED =
  "Thanks. A pastor will take this and help you with that. You can keep writing — the menu will stay quiet.";

export const FALLBACK =
  "I didn’t catch that. You can pick from the menu, or type “talk to a person” and a pastor will take over.";

// ── Serving ───────────────────────────────────────────────

export const SERVE_TEAMS =
  "We’d love to have you serve with us. Which team interests you? Pick one or more, then tap Done.";
export const SERVE_TEAMS_AGAIN = "Which other team interests you?";
export const SERVE_TEAMS_BUTTON = "Teams";
export const SERVE_MORE_TEAMS = { title: "More teams", description: "See the rest of the list" };
export const SERVE_OTHER_ROW = { title: "Other", description: "Type the team’s name" };
export const SERVE_OTHER_PROMPT = "Which team would you like to serve on? Type its name.";

export function serveAdded(team: string): string {
  return `Added ${team}. Pick another team, or tap Done.`;
}
export const ADD_ANOTHER = "Add another";
export const DONE = "Done";

/** When live missio_teams is empty or can't be read. Ids are stable. */
export const FALLBACK_TEAMS: ReadonlyArray<{ id: string; name: string }> = [
  { id: "welcome", name: "Welcome" },
  { id: "worship", name: "Worship / band" },
  { id: "kids", name: "Kids" },
  { id: "hospitality", name: "Hospitality" },
  { id: "production", name: "Production / tech" },
  { id: "prayer", name: "Prayer" },
];

export const SERVE_AVAILABILITY = "How often could you help?";
export type Availability = "most_sundays" | "monthly" | "midweek" | "not_sure";
export const AVAILABILITY: ReadonlyArray<{ id: Availability; title: string }> = [
  { id: "most_sundays", title: "Most Sundays" },
  { id: "monthly", title: "Once or twice a month" },
  { id: "midweek", title: "Midweek or once-off" },
  { id: "not_sure", title: "Not sure yet" },
];

export const SERVE_EXPERIENCE = "Have you served on a church team before?";
export type Experience = "yes" | "a_little" | "not_yet";
export const EXPERIENCE: ReadonlyArray<{ id: Experience; title: string }> = [
  { id: "yes", title: "Yes" },
  { id: "a_little", title: "A little" },
  { id: "not_yet", title: "Not yet" },
];

/** "Kids", "Kids and Welcome", "Kids, Welcome and Prayer". */
export function teamList(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export function serveThanks(name: string | null, teams: readonly string[]): string {
  return (
    `Thank you${name ? `, ${name}` : ""}. We’ve noted your interest in ${teamList(teams)} and let the team leader know. They’ll follow up.\n\n` +
    "If you want to add a note — experience, times that work, anything else — send it now, or tap Done."
  );
}

export const SERVE_CLOSE = "Thank you. If you need anything else, type menu.";

// ── Pastor-facing status line (the open thread) ───────────

export const STATUS_LINE: Record<string, string> = {
  "menu:main": "Bot is showing the menu",
  "serve:teams": "Bot is asking which team",
  "serve:other": "Bot is asking which team",
  "serve:added": "Bot is asking about another team",
  "serve:availability": "Bot is asking how often they could help",
  "serve:experience": "Bot is asking if they’ve served before",
  "serve:note": "Bot is waiting for an optional note",
};

/** The slim line above an open thread: who has the chat, and what the bot is waiting for. */
export function botStatusLine(bot: { mode: string; reason: string | null; flow: string | null; step: string | null }): string {
  if (bot.mode === "paused") {
    return bot.reason === "pastor" ? "A pastor has this chat. The bot is quiet." : "Bot is paused. It stays quiet until a pastor resumes it.";
  }
  if (bot.mode === "handed_off") {
    if (bot.reason === "human") return "They asked for a person. A pastor has this chat.";
    if (bot.reason === "care") return "Handed to a pastor for prayer or care.";
    return "Handed to a pastor. The menu can’t help with that yet.";
  }
  if (bot.flow && bot.flow !== "rest" && bot.step) return STATUS_LINE[`${bot.flow}:${bot.step}`] ?? "Bot is answering.";
  return "Bot is on. It answers new messages with the menu.";
}
