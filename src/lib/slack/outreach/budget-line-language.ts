/**
 * The words on the receipt card. People confirm a budget line by its name
 * ("Food for the team"), never by an account code.
 */

export type PlainBudgetLine = {
  id: string;
  budgetId: string;
  name: string;
};

export type ChosenBudgetLine = {
  budget_id: string | null;
  budget_line_id: string | null;
  budget_line_label: string;
};

const clean = (s: string | null | undefined) => (s ?? "").trim();

/** "Food for the team — Groceries". The line's own name wins; the receipt says what was bought. */
export function budgetLineSentence(args: { lineName: string | null; categoryName: string | null; description: string }): string {
  const head = clean(args.lineName) || clean(args.categoryName);
  const what = clean(args.description);
  if (!head) return what ? `Not on a budget line yet — ${what}` : "Not on a budget line yet";
  if (!what || head.toLowerCase() === what.toLowerCase() || head.toLowerCase().includes(what.toLowerCase())) return head;
  return `${head} — ${what}`;
}

function loose(hay: string, needle: string): boolean {
  const h = hay.toLowerCase();
  const n = needle.toLowerCase().trim();
  if (n.length < 3) return false;
  return h === n || h.includes(n) || n.includes(h);
}

/**
 * Picks a line only when the note, the suggested category, or the
 * description actually names it. No guess when several lines could fit,
 * and no guess when the budget is still empty.
 */
export function choosePlainBudgetLine(args: {
  userNote: string | null;
  suggested: string | null;
  description: string;
  categoryName: string | null;
  lines: PlainBudgetLine[];
}): ChosenBudgetLine {
  const hints = [args.userNote, args.suggested, args.categoryName, args.description].map(clean).filter(Boolean);
  const hits = args.lines.filter((line) => hints.some((hint) => loose(line.name, hint) || loose(hint, line.name)));
  const unique = new Map(hits.map((line) => [line.id, line]));
  const chosen = unique.size === 1 ? [...unique.values()][0] : null;
  return {
    budget_id: chosen?.budgetId ?? null,
    budget_line_id: chosen?.id ?? null,
    budget_line_label: budgetLineSentence({
      lineName: chosen?.name ?? null,
      categoryName: args.categoryName,
      description: args.description,
    }),
  };
}
