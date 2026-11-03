// A one-shot message handed from the expense form to the team screen it
// returns to ("Expense saved." / "Saved on this phone, not yet sent").

export type Flash = { tone: "positive" | "info"; message: string };

const pending = new Map<string, Flash>();

export function setFlash(teamId: string, flash: Flash) {
  pending.set(teamId, flash);
}

export function takeFlash(teamId: string): Flash | null {
  const f = pending.get(teamId) ?? null;
  pending.delete(teamId);
  return f;
}
