/**
 * Cash pulls from Slack — the pure part. Someone at an ATM sends the bank
 * notification (screenshot of the app push / SMS) to the bot; this turns
 * what Claude read into a proposed cash pull, its card and its Change
 * form. Priced exactly like the Hub form (lib/finance/outreach-pulls,
 * migration 263): cash got, rand that left the account, fee if shown
 * separately — the rate is worked out, never read or typed.
 */

import { KNOWN_CURRENCY_CODES } from "@/lib/currencies";
import { pullPrice, rateText } from "@/lib/finance/outreach-pulls";

export { rateText };
import {
  ACTION_CANCEL,
  ACTION_CHANGE,
  ACTION_LOG,
  currencyMenu,
  fmtNum,
  money,
  opt,
  parseTypedAmount,
  pickDate,
  teamSelectBlock,
  type ReceiptReading,
  type ViewValues,
} from "./receipt-logic";

export const VIEW_PULL_CHANGE = "cash_pull_change_view";

export type PullProposal = {
  batch_date: string;
  local_currency: string | null;
  local_amount: number | null; // cash in hand
  zar_out: number | null; // everything that left the account
  bank_fee: number; // the part shown as a fee
  read_warnings?: string[];
};

const cents = (n: number) => Math.round(n * 100) / 100;

/**
 * "pulled 500000 BIF", "500 000 bif", "BIF 500,000", "got 2000" — the
 * cash amount and (if given) currency someone typed with the screenshot.
 */
export function parseTypedPull(note: string | null | undefined): { amount: number | null; currency: string | null } {
  const text = String(note ?? "");
  const codes = (text.toUpperCase().match(/\b[A-Z]{3}\b/g) ?? []).filter((c) => KNOWN_CURRENCY_CODES.has(c) && c !== "ZAR");
  // Digits with spaces/commas/dots inside, e.g. "500 000", "1,200.50".
  const nums = text.match(/\d[\d\s.,]*\d|\d/g) ?? [];
  const amounts = nums.map((n) => parseTypedAmount(n.replace(/\s+/g, ""))).filter((n): n is number => n != null && n > 0);
  return { amount: amounts.length ? Math.max(...amounts) : null, currency: codes[0] ?? null };
}

export function buildPullProposal(args: {
  reading: ReceiptReading;
  userNote: string | null;
  /** The team's last pull currency, else its country's — a guess. */
  fallbackCurrency: string | null;
  today: string;
}): { proposal: PullProposal; warnings: string[] } {
  const { reading } = args;
  const warnings: string[] = [];
  const typed = parseTypedPull(args.userNote);

  const readCur = (reading.bank_foreign_currency ?? "").toUpperCase().trim();
  const currency =
    (KNOWN_CURRENCY_CODES.has(readCur) && readCur !== "ZAR" ? readCur : null) ?? typed.currency ?? args.fallbackCurrency;
  const local =
    reading.bank_foreign_amount != null && reading.bank_foreign_amount > 0
      ? cents(reading.bank_foreign_amount)
      : typed.amount != null
        ? cents(typed.amount)
        : null;
  const zarOut = reading.bank_zar_total != null && reading.bank_zar_total > 0 ? cents(reading.bank_zar_total) : null;
  let fee = reading.bank_zar_fee != null && reading.bank_zar_fee > 0 ? cents(reading.bank_zar_fee) : 0;
  if (zarOut != null && fee >= zarOut) {
    warnings.push("The fee looked bigger than the total — check it.");
    fee = 0;
  }

  const { date, warning } = pickDate(reading.date, args.today);
  if (warning) warnings.push(warning.replace("receipt", "notification"));
  if (local == null) warnings.push("How much cash did you get? Tap *Change* and enter it.");
  if (!currency) warnings.push("Which currency is the cash in? Tap *Change* and pick it.");
  if (zarOut == null) warnings.push("Couldn't read the rand that left the account — tap *Change* to enter it.");
  if (reading.legibility !== "clear") warnings.push("Parts of the screenshot are hard to read — double-check the numbers.");
  if (reading.notes) warnings.push(reading.notes);

  return {
    proposal: { batch_date: date, local_currency: currency, local_amount: local, zar_out: zarOut, bank_fee: fee },
    warnings,
  };
}

/** What's still missing before this can become a cash pull. */
export function missingForPull(p: PullProposal): string[] {
  const out: string[] = [];
  if (!p.local_amount) out.push("the cash you got");
  if (!p.local_currency) out.push("the currency");
  if (!p.zar_out) out.push("the rand that left the account");
  if (p.zar_out != null && p.bank_fee >= p.zar_out) out.push("a fee smaller than the total");
  return out;
}

/** "500 000 BIF for R2 873.30 (incl. R65.00 fee) → 178.0437 BIF per R1" */
export function pullLine(p: PullProposal): string {
  const cash = p.local_amount != null ? `${fmtNum(p.local_amount)} ${p.local_currency ?? "?"}` : `? ${p.local_currency ?? ""}`.trim();
  const out = p.zar_out != null ? money(p.zar_out, "ZAR") : "R ?";
  const fee = p.bank_fee > 0 ? ` (incl. ${money(p.bank_fee, "ZAR")} fee)` : "";
  const price = pullPrice({ zarOut: p.zar_out ?? 0, fee: p.bank_fee, localReceived: p.local_amount ?? 0 });
  const rate = price.localPerZar && p.local_currency ? ` → *${rateText(price.localPerZar, p.local_currency)}*` : "";
  return `${cash} for ${out}${fee}${rate}`;
}

export function pullCardBlocks(args: {
  draftId: string;
  senderName: string;
  proposal: PullProposal;
  warnings: string[];
  team: { id: string; name: string } | null;
  teamChoices?: { id: string; name: string }[];
}): unknown[] {
  const p = args.proposal;
  const blocks: unknown[] = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: args.team
          ? `💵 *Cash pull from ${args.senderName}* for *${args.team.name}* — check it, then tap *Log pull to ${args.team.name}*.`
          : `💵 *Cash pull from ${args.senderName}* — *which team is this for?* Pick it below.`,
      },
    },
    { type: "section", text: { type: "mrkdwn", text: `${pullLine(p)}\n_${p.batch_date}_` } },
  ];
  if (p.bank_fee > 0) {
    blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: `The ${money(p.bank_fee, "ZAR")} fee will be logged in *Bank Costs*.` }] });
  }
  if (args.warnings.length) {
    blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: args.warnings.join("\n") }] });
  }
  const menu = teamSelectBlock(args.draftId, args.team, args.teamChoices ?? []);
  if (menu) blocks.push(menu);
  const label = args.team ? `✅ Log pull to ${args.team.name}` : "✅ Log pull";
  blocks.push({
    type: "actions",
    block_id: `receipt:${args.draftId}`,
    elements: [
      {
        type: "button",
        style: "primary",
        action_id: ACTION_LOG,
        value: args.draftId,
        text: { type: "plain_text", text: label.length <= 75 ? label : `${label.slice(0, 74)}…` },
      },
      { type: "button", action_id: ACTION_CHANGE, value: args.draftId, text: { type: "plain_text", text: "✏️ Change" } },
      {
        type: "button",
        style: "danger",
        action_id: ACTION_CANCEL,
        value: args.draftId,
        text: { type: "plain_text", text: "Cancel" },
        confirm: {
          title: { type: "plain_text", text: "Cancel this cash pull?" },
          text: { type: "plain_text", text: "It won't be logged, and the screenshot will be removed." },
          confirm: { type: "plain_text", text: "Yes, cancel" },
          deny: { type: "plain_text", text: "Keep it" },
        },
      },
    ],
  });
  return blocks;
}

export function pullChangeModal(args: { draftId: string; proposal: PullProposal }): unknown {
  const p = args.proposal;
  const curOpts = currencyMenu(p.local_currency).map((c) => opt(`${c.code} — ${c.name}`, c.code));
  const initialCur = curOpts.find((o) => o.value === p.local_currency);
  const text = (blockId: string, label: string, value: number | null, optional = false, hint?: string) => ({
    type: "input",
    block_id: blockId,
    optional,
    label: { type: "plain_text", text: label },
    ...(hint ? { hint: { type: "plain_text", text: hint } } : {}),
    element: { type: "plain_text_input", action_id: "v", ...(value != null && value > 0 ? { initial_value: String(value) } : {}) },
  });
  return {
    type: "modal",
    callback_id: VIEW_PULL_CHANGE,
    private_metadata: args.draftId,
    title: { type: "plain_text", text: "Check the cash pull" },
    submit: { type: "plain_text", text: "Log pull" },
    close: { type: "plain_text", text: "Back" },
    blocks: [
      {
        type: "input",
        block_id: "date",
        label: { type: "plain_text", text: "Date" },
        element: { type: "datepicker", action_id: "v", initial_date: p.batch_date },
      },
      {
        type: "input",
        block_id: "currency",
        label: { type: "plain_text", text: "Currency of the cash" },
        element: { type: "static_select", action_id: "v", options: curOpts, ...(initialCur ? { initial_option: initialCur } : {}) },
      },
      text("cash", "Cash you got", p.local_amount, false, "Count it."),
      text("zar", "Rand that left the account", p.zar_out, false, "From your bank app, fees included."),
      text("fee", "Of that, bank fee (optional)", p.bank_fee, true, "Only if the bank shows it separately."),
    ],
  };
}

export function parsePullChange(
  values: ViewValues
): { ok: true; proposal: Omit<PullProposal, "read_warnings"> } | { ok: false; errors: Record<string, string> } {
  const v = (b: string) => values[b]?.v;
  const errors: Record<string, string> = {};
  const num = (s: string | null | undefined) => {
    const n = parseTypedAmount(s);
    return n != null && n > 0 ? cents(n) : null;
  };
  const date = v("date")?.selected_date ?? null;
  if (!date) errors.date = "Pick the date";
  const currency = v("currency")?.selected_option?.value ?? null;
  if (!currency) errors.currency = "Pick the currency";
  const cash = num(v("cash")?.value);
  if (cash == null) errors.cash = "Enter the cash you got, e.g. 500000";
  const zar = num(v("zar")?.value);
  if (zar == null) errors.zar = "Enter the rand that left the account, e.g. 2873.30";
  const feeRaw = v("fee")?.value;
  const fee = feeRaw && feeRaw.trim() ? num(feeRaw) : 0;
  if (feeRaw && feeRaw.trim() && fee == null) errors.fee = "Enter a rand amount, or leave it empty";
  if (zar != null && fee != null && fee >= zar) errors.fee = "The fee must be less than the rand that left the account";
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, proposal: { batch_date: date!, local_currency: currency!, local_amount: cash!, zar_out: zar!, bank_fee: fee ?? 0 } };
}
