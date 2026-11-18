export type NudgePerson = { firstName: string; url: string };

function datesBlock(labels: readonly string[]): string {
  return labels.map((label) => label).join("\n");
}

export function whatsAppNudge(person: NudgePerson, labels: readonly string[]): string {
  return [
    `Hi ${person.firstName}, Missio is asking which Sundays you can serve. The link is only for you.`,
    "",
    datesBlock(labels),
    "",
    person.url,
  ].join("\n");
}

export function emailNudge(person: NudgePerson, labels: readonly string[]): string {
  return [
    "Subject: Which Sundays can you serve?",
    "",
    `Hi ${person.firstName},`,
    "",
    "Missio is asking which Sundays you can serve. Open the link and mark each one. The link is only for you.",
    "",
    datesBlock(labels),
    "",
    person.url,
  ].join("\n");
}

/** Text the pastor copies. Nothing in here is sent. */
export function bundleNudges(
  people: readonly NudgePerson[],
  labels: readonly string[]
): { whatsapp: string; email: string; count: number } {
  return {
    whatsapp: people.map((person) => whatsAppNudge(person, labels)).join("\n\n---\n\n"),
    email: people.map((person) => emailNudge(person, labels)).join("\n\n---\n\n"),
    count: people.length,
  };
}
