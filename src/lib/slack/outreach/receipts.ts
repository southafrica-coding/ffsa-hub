/**
 * Receipts from Slack — the I/O half (pure logic lives in receipt-logic.ts).
 *
 *   photo arrives ─► original stored (outreach-receipts bucket) + draft row
 *                 ─► Claude reads it ─► card [Confirm <team>] [Change] [Cancel]
 *                    The card names a budget line in plain words. Xero is
 *                    written only after Confirm, and only when that line
 *                    has an account. No photo means the purchaser repays.
 *   bank notice   ─► a screenshot of an ATM withdrawal becomes a CASH PULL
 *                    card instead [Log pull to <team>] [Change] [Cancel] —
 *                    priced exactly like the Hub form (migration 263/264)
 *   receipt + bank notification in one message ─► paired: local from the
 *                    receipt, rand from the bank, card confirmed (migration 265)
 *   bank notice for a card payment on its own ─► matched to the sender's
 *                    card payments still waiting for one [Yes, confirm]
 *   Team          ─► in a DM, someone who can log for several teams picks
 *                    (or corrects) the team on the card; nothing is logged
 *                    until a team is chosen (migration 262)
 *   Confirm       ─► outreach_expenses (source 'slack') + the ORIGINAL file
 *                    then, and only then, a Xero spend if the line is coded
 *                    moved under the expense and recorded in
 *                    outreach_receipts, exactly like a Hub upload
 *   Change        ─► Slack form ─► then Confirm
 *   Cancel        ─► draft cancelled, stored photo removed
 *
 * Bookkeeping guarantee: the original bytes are saved before anything else
 * happens and are never re-encoded; Claude reads a copy. If reading fails
 * the photo is still kept and the card says so.
 *
 * Everything runs with the service-role client, so every write re-checks
 * who may do it: logging is for the team's owner and co-leaders, and
 * finance staff.
 */

import crypto from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import sharp from "sharp";
import * as slack from "@/lib/slack/client";
import { checkCashAlert } from "@/lib/outreach/cash-alerts";
import { createAdminClient } from "@/lib/supabase/admin";
import type { BudgetCategory } from "@/lib/finance/outreach-budget";
import { OUTREACH_LEADER_ROLES } from "@/lib/finance/outreach-roles";
import { currencyForCountry } from "@/lib/currencies";
import {
  bankAmounts,
  cardConfirmBlocks,
  confirmWithBank,
  matchCardCandidates,
  pairCardNotices,
  type CardCandidate,
} from "./card-logic";
import {
  buildPullProposal,
  missingForPull,
  pullCardBlocks,
  pullChangeModal,
  pullLine,
  type PullProposal,
} from "./pull-logic";
import { xeroResultSentence } from "@/lib/finance/xero-spend";
import { writeConfirmedSpend } from "@/lib/finance/record-xero-spend";
import {
  orgForReceiptCurrency,
  selectTeamBudget,
  xeroBook,
  type BudgetOrgKey,
  type TeamBudgetRow,
} from "@/lib/finance/team-budget-pick";
import { isFinanceStaff, pickTeam, sastDate, summarise, type OutreachScope, type OutreachTeamRef } from "@/lib/slack/assistant/outreach";
import { choosePlainBudgetLine, type PlainBudgetLine } from "./budget-line-language";
import {
  ACTION_CANCEL,
  buildProposal,
  CLAUDE_IMAGE_TYPES,
  changeModal,
  decidedBlocks,
  duplicateWarning,
  fileKind,
  fmtNum,
  MAX_RECEIPT_BYTES,
  missingForLog,
  money,
  pickCurrency,
  rateFromCash,
  rateFromLive,
  readingPrompt,
  ReceiptReadingSchema,
  receiptCardBlocks,
  safeFileName,
  logButtonText,
  toZar,
  type CashBatchRow,
  type ChangeInput,
  type PriorReceipt,
  type Proposal,
  type RateChoice,
  type ReceiptReading,
  type SlackFile,
} from "./receipt-logic";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any;

const BUCKET = "outreach-receipts";
const MODEL = "claude-opus-5-5";
const EDITOR_ROLES = OUTREACH_LEADER_ROLES;
const SITE = process.env.NEXT_PUBLIC_SITE_URL || "https://www.ffsahub.com";
const MAX_FILES_PER_MESSAGE = 4;

let anthropic: Anthropic | null = null;
function claude(): Anthropic {
  if (!anthropic) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not configured");
    anthropic = new Anthropic({ apiKey });
  }
  return anthropic;
}

const post = (channel: string, text: string, threadTs?: string, blocks?: unknown[]) =>
  slack.postMessage({ channel, text, thread_ts: threadTs, blocks, bot: "outreach" });
const update = (channel: string, ts: string, text: string, blocks?: unknown[]) =>
  slack.updateMessage({ channel, ts, text, blocks, bot: "outreach" });

async function displayName(admin: Admin, hubUserId: string | null): Promise<string> {
  if (!hubUserId) return "someone";
  const { data } = await admin.from("users").select("first_name, last_name, email").eq("id", hubUserId).maybeSingle();
  if (!data) return "someone";
  return [data.first_name, data.last_name].filter(Boolean).join(" ") || data.email || "someone";
}

/** May this person log expenses for this team? */
export async function canLog(admin: Admin, teamId: string, hubUserId: string | null): Promise<boolean> {
  if (!hubUserId) return false;
  const { data } = await admin
    .from("outreach_team_members")
    .select("role")
    .eq("team_id", teamId)
    .eq("user_id", hubUserId)
    .maybeSingle();
  if (data && EDITOR_ROLES.includes(data.role)) return true;
  return isFinanceStaff(admin, hubUserId);
}

type TeamChoice = { id: string; name: string };

/** Every team this person may log expenses for: all of them for finance staff, else the ones they lead. */
async function loggableTeams(admin: Admin, hubUserId: string | null): Promise<TeamChoice[]> {
  if (!hubUserId) return [];
  if (await isFinanceStaff(admin, hubUserId)) {
    const { data } = await admin
      .from("outreach_teams")
      .select("id, team_name")
      .is("archived_at", null) // archived teams leave the pickers (migration 272)
      .order("team_name");
    return ((data ?? []) as { id: string; team_name: string }[]).map((t) => ({ id: t.id, name: t.team_name }));
  }
  const { data } = await admin
    .from("outreach_team_members")
    .select("outreach_teams!inner(id, team_name)")
    .eq("user_id", hubUserId)
    .in("role", EDITOR_ROLES)
    // Same teams the bot answers them about in a DM (resolveOutreachScope).
    .eq("outreach_teams.slack_enabled", true)
    .is("outreach_teams.archived_at", null);
  return ((data ?? []) as { outreach_teams: { id: string; team_name: string } }[])
    .map((r) => ({ id: r.outreach_teams.id, name: r.outreach_teams.team_name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** A DM, where the sender picks the team. In a team's channel the team is the channel's. */
const isDM = (channelId: string) => channelId.startsWith("D");

async function editorNames(admin: Admin, teamId: string): Promise<string[]> {
  const { data } = await admin
    .from("outreach_team_members")
    .select("role, users(first_name, last_name)")
    .eq("team_id", teamId)
    .in("role", EDITOR_ROLES);
  return ((data ?? []) as { users: { first_name: string | null; last_name: string | null } | null }[])
    .map((r) => [r.users?.first_name, r.users?.last_name].filter(Boolean).join(" "))
    .filter(Boolean);
}

async function financeClosed(admin: Admin, teamId: string): Promise<boolean> {
  const { data } = await admin.from("outreach_closeouts").select("status").eq("team_id", teamId).maybeSingle();
  return data?.status === "auto_closed" || data?.status === "admin_override";
}

type BudgetQueryRow = {
  id: string;
  name: string;
  status: string;
  currency: string | null;
  org_id: string | null;
  fiscal_periods?:
    | { id?: string; org_id?: string; start_date?: string; end_date?: string }
    | { id?: string; org_id?: string; start_date?: string; end_date?: string }[]
    | null;
  budget_lines?: { id: string; name: string; archived_at: string | null }[] | null;
};

function onePeriod(
  value: BudgetQueryRow["fiscal_periods"]
): { id?: string; org_id?: string; start_date?: string; end_date?: string } | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] ?? null : value;
}

/**
 * Lines from the one budget this receipt belongs to. Look up by
 * outreach_team_id, then narrow with selectTeamBudget: NPC/ZAR or USA/USD
 * from the slip's currency (leaders do not read finance_orgs), and the
 * fiscal period that contains the date. Several budgets for the team are
 * not merged.
 */
async function linesForReceipt(
  admin: Admin,
  teamId: string | null,
  proposal: Proposal,
  nameHint: string | null
): Promise<{
  lines: PlainBudgetLine[];
  org: BudgetOrgKey | null;
  budgetId: string | null;
  status: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  reason: "none" | "ambiguous" | "chosen";
}> {
  const none = {
    lines: [] as PlainBudgetLine[],
    org: null,
    budgetId: null,
    status: null,
    periodStart: null,
    periodEnd: null,
    reason: "none" as const,
  };
  if (!teamId) return none;
  const { data, error } = await admin
    .from("budgets")
    .select(
      `id, name, status, currency, org_id,
       fiscal_periods!budgets_period_org_fkey(id, org_id, label, kind, start_date, end_date),
       budget_lines!budget_lines_budget_id_fkey(id, name, archived_at)`
    )
    .eq("outreach_team_id", teamId)
    .is("archived_at", null);
  if (error || !data) return none;

  const rows = data as BudgetQueryRow[];
  const candidates: TeamBudgetRow[] = rows.flatMap((row) => {
    const period = onePeriod(row.fiscal_periods);
    // The period's org and the budget's org are the same composite key.
    // Leaders cannot read finance_orgs, so npc/usa comes from the currency.
    if (row.org_id && period?.org_id && row.org_id !== period.org_id) return [];
    const currency = (row.currency ?? "").toUpperCase();
    const orgKey: BudgetOrgKey | null = currency === "USD" ? "usa" : currency === "ZAR" ? "npc" : null;
    return [{
      id: row.id,
      name: row.name,
      status: row.status,
      orgKey,
      currency: row.currency,
      periodStart: period?.start_date ?? null,
      periodEnd: period?.end_date ?? null,
      lines: (row.budget_lines ?? [])
        .filter((line) => !line.archived_at && line.name)
        .map((line) => ({ id: line.id, name: line.name })),
    }];
  });

  const org = orgForReceiptCurrency(proposal.local_currency);
  const picked = selectTeamBudget(candidates, {
    org,
    expenseDate: proposal.expense_date,
    nameHint,
  });
  if (!picked.ok) return { ...none, reason: picked.reason };
  return {
    org,
    budgetId: picked.budget.id,
    status: picked.budget.status,
    periodStart: picked.budget.periodStart,
    periodEnd: picked.budget.periodEnd,
    reason: "chosen",
    lines: picked.budget.lines.map((line) => ({ id: line.id, budgetId: picked.budget.id, name: line.name })),
  };
}

/** Names the budget line in plain words. An empty budget, or no budget tables yet, falls back to the category. */
async function withPlainLine(
  admin: Admin,
  proposal: Proposal,
  teamId: string | null,
  hint: { userNote: string | null; suggested: string | null; explicitLineId?: string | null }
): Promise<Proposal> {
  const [found, categories] = await Promise.all([
    linesForReceipt(admin, teamId, proposal, hint.userNote),
    loadCategories(admin),
  ]);
  const categoryName = categories.find((c) => c.id === proposal.category_id)?.name ?? null;
  // Exact name only, and only on an approved budget. A draft is not an account.
  const chosen = choosePlainBudgetLine({
    userNote: hint.userNote,
    suggested: hint.suggested ?? categoryName,
    description: proposal.description,
    categoryName,
    lines: found.status === "approved" ? found.lines : [],
  });
  const picked = hint.explicitLineId ? found.lines.find((line) => line.id === hint.explicitLineId) : undefined;
  const warnings = (proposal.read_warnings ?? []).filter((warning) => !warning.startsWith("Two budgets match"));
  if (found.reason === "ambiguous") {
    warnings.push(
      "Two budgets match this team, organisation and period. Put the budget's name in your note so I know which one."
    );
  }
  return {
    ...proposal,
    ...chosen,
    ...(picked
      ? {
          budget_id: picked.budgetId,
          budget_line_id: picked.id,
          budget_line_label: picked.name,
        }
      : {}),
    read_warnings: warnings,
    budget_id: picked?.budgetId ?? chosen.budget_id ?? found.budgetId,
    budget_org_key: found.org,
    budget_status: found.status,
    budget_period_start: found.periodStart,
    budget_period_end: found.periodEnd,
  };
}

async function loadCategories(admin: Admin): Promise<BudgetCategory[]> {
  const { data } = await admin.from("outreach_budget_categories").select("id, name, slug, sort_order");
  return (data ?? []) as BudgetCategory[];
}

// ────────────────────────────────────────────────────────────
// Reading the receipt
// ────────────────────────────────────────────────────────────

type ClaudeBlock = Anthropic.ImageBlockParam | Anthropic.DocumentBlockParam;

/** A copy Claude can read. The original is never touched. */
async function readableCopy(file: SlackFile, original: Buffer): Promise<ClaudeBlock> {
  if (fileKind(file) === "pdf") {
    return {
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: original.toString("base64") },
    };
  }
  const mime = (file.mimetype ?? "").toLowerCase();
  // Shrink big photos (Claude caps images at 5 MB); convert types it can't read.
  if (CLAUDE_IMAGE_TYPES.has(mime) && original.length <= 3.5 * 1024 * 1024) {
    return {
      type: "image",
      source: { type: "base64", media_type: mime as "image/jpeg" | "image/png" | "image/webp" | "image/gif", data: original.toString("base64") },
    };
  }
  try {
    const jpeg = await sharp(original).rotate().resize(2000, 2000, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
    return { type: "image", source: { type: "base64", media_type: "image/jpeg", data: jpeg.toString("base64") } };
  } catch {
    // HEIC from iPhones isn't decodable here — read Slack's own JPEG preview.
    const thumb = file.thumb_1024 || file.thumb_720 || file.thumb_480;
    if (!thumb) throw new Error("Can't open this image type");
    const buf = await slack.downloadFile(thumb, "outreach");
    return { type: "image", source: { type: "base64", media_type: "image/jpeg", data: buf.toString("base64") } };
  }
}

async function readReceipt(block: ClaudeBlock, prompt: string): Promise<ReceiptReading> {
  const res = await claude().messages.parse({
    model: MODEL,
    max_tokens: 16000,
    output_config: { effort: "medium", format: zodOutputFormat(ReceiptReadingSchema) },
    messages: [{ role: "user", content: [block, { type: "text", text: prompt }] }],
  });
  if (res.stop_reason === "refusal") throw new Error("The receipt reader declined this image");
  if (!res.parsed_output) throw new Error(`No reading returned (${res.stop_reason})`);
  return res.parsed_output;
}

// ────────────────────────────────────────────────────────────
// Exchange rate
// ────────────────────────────────────────────────────────────

async function cashBatches(admin: Admin, teamId: string): Promise<CashBatchRow[]> {
  const { data } = await admin
    .from("outreach_cash_batches")
    .select("id, batch_date, local_currency, exchange_rate")
    .eq("team_id", teamId);
  return (data ?? []) as CashBatchRow[];
}

/** Same source as the Hub's expense form (/api/finance/outreach/exchange-rate). */
async function liveRate(currency: string): Promise<RateChoice | null> {
  try {
    const res = await fetch(`https://open.er-api.com/v6/latest/${currency}`, { next: { revalidate: 3600 } });
    if (!res.ok) return null;
    const data = (await res.json()) as { result?: string; rates?: Record<string, number> };
    const zarPerUnit = data.rates?.ZAR;
    if (data.result !== "success" || !zarPerUnit) return null;
    return rateFromLive(currency, zarPerUnit, sastDate(new Date()));
  } catch {
    return null;
  }
}

async function chooseRate(admin: Admin, teamId: string | null, currency: string, batches?: CashBatchRow[]) {
  const cash = batches ?? (teamId ? await cashBatches(admin, teamId) : []);
  return rateFromCash(currency, cash) ?? (await liveRate(currency));
}

// ────────────────────────────────────────────────────────────
// 1. A photo arrives
// ────────────────────────────────────────────────────────────

export type IncomingReceipts = {
  files: SlackFile[];
  slackUserId: string;
  hubUserId: string | null;
  channelId: string;
  threadTs?: string;
  userNote: string | null;
  scope: OutreachScope;
};

/** Which team the receipt is for: the conversation's, or one named in the note. */
function teamFor(scope: OutreachScope, note: string | null): OutreachTeamRef | null {
  const def = pickTeam(scope);
  if (def.ok) return def.team;
  const lower = (note ?? "").toLowerCase();
  const named = scope.teams.filter((t) => lower.includes(t.team_name.toLowerCase()));
  return named.length === 1 ? named[0] : null;
}

export async function handleIncomingReceipts(m: IncomingReceipts): Promise<void> {
  const admin: Admin = createAdminClient();
  const team = teamFor(m.scope, m.userNote);
  // No team yet: read it anyway and let them pick on the card — as long as
  // there's a team they're allowed to log for.
  const choices = await loggableTeams(admin, m.hubUserId);
  if (!team) {
    if (!choices.length) {
      await post(m.channelId, "You're not an owner or co-leader of any outreach team, so I can't log receipts for you.", m.threadTs);
      return;
    }
  } else if (!(await canLog(admin, team.id, m.hubUserId))) {
    const names = await editorNames(admin, team.id);
    await post(
      m.channelId,
      names.length
        ? `Only ${names.join(" or ")} can log ${team.team_name}'s expenses — tag them here, or send them the photo.`
        : `Only ${team.team_name}'s owner and co-leaders can log its expenses.`,
      m.threadTs
    );
    return;
  }
  if (team && (await financeClosed(admin, team.id))) {
    await post(m.channelId, `${team.team_name}'s finances are closed, so I can't log new expenses. Talk to the finance team.`, m.threadTs);
    return;
  }

  // Read side by side: the whole request has ~60s on Vercel, and one
  // receipt can take 10–20s to read.
  const files = m.files.slice(0, MAX_FILES_PER_MESSAGE);
  if (m.files.length > files.length) {
    await post(
      m.channelId,
      `I'll read the first ${MAX_FILES_PER_MESSAGE} — send the other ${m.files.length - files.length} in another message.`,
      m.threadTs
    );
  }
  const ctx = await intakeContext(admin, team);
  const failed = (file: SlackFile) => async (err: unknown) => {
    console.error("[slack/outreach] receipt failed", file.id, err);
    await post(m.channelId, `Something went wrong with *${file.name ?? "that file"}*. Try sending it again, or log it in the Hub.`, m.threadTs).catch(() => {});
    return null;
  };

  // 1. Store and read every file first, so a receipt and its bank
  //    notification sent together can be paired.
  const got = (await Promise.all(files.map((file) => ingestFile(admin, team, file, m, ctx).catch(failed(file))))).filter(
    (g): g is Ingested => g !== null
  );

  const receipts = got.filter((g) => g.reading.document_kind === "receipt" && g.reading.is_receipt);
  const notices = got.filter((g) => g.reading.document_kind === "card_payment_notification");
  const pairs = pairCardNotices(
    receipts.map((r) => ({ total: r.reading.total, currency: pickCurrency(r.reading.currency, ctx.likely) })),
    notices.map((n) => ({
      foreignAmount: n.reading.bank_foreign_amount,
      foreignCurrency: n.reading.bank_foreign_currency,
      zarTotal: n.reading.bank_zar_total,
    }))
  );
  const noticeFor = new Map(pairs.map((p) => [receipts[p.receipt], { notice: notices[p.notice], mismatch: p.mismatch }]));
  const attached = new Set(pairs.map((p) => notices[p.notice]));

  // 2. Propose each.
  await Promise.all(
    got.map(async (g) => {
      try {
        if (g.reading.document_kind === "atm_withdrawal_notification") {
          await proposePull(admin, {
            draftId: g.draftId,
            sha: g.sha,
            reading: g.reading,
            team,
            choices,
            m,
            today: ctx.today,
            fallbackCurrency: ctx.latestCash?.local_currency ?? currencyForCountry(ctx.teamRow?.country) ?? null,
            say: g.say,
          });
        } else if (g.reading.document_kind === "card_payment_notification") {
          if (attached.has(g)) await markAttached(admin, g);
          else await proposeCardConfirm(admin, g, m, ctx.today);
        } else if (g.reading.is_receipt) {
          await proposeReceipt(admin, g, { team, choices, m, ctx, bank: noticeFor.get(g) ?? null });
        } else {
          await notAReceipt(admin, g);
        }
      } catch (err) {
        await failed(g.file)(err);
      }
    })
  );
}

type IntakeContext = {
  categories: BudgetCategory[];
  batches: CashBatchRow[];
  teamRow: { country: string | null } | null;
  latestCash: CashBatchRow | undefined;
  likely: string | null;
  today: string;
};

async function intakeContext(admin: Admin, team: OutreachTeamRef | null): Promise<IntakeContext> {
  const [categories, batches, { data: teamRow }] = await Promise.all([
    loadCategories(admin),
    team ? cashBatches(admin, team.id) : Promise.resolve([] as CashBatchRow[]),
    team
      ? admin.from("outreach_teams").select("country").eq("id", team.id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const latestCash = [...batches].sort((a, b) => b.batch_date.localeCompare(a.batch_date))[0];
  return {
    categories,
    batches,
    teamRow: teamRow ?? null,
    latestCash,
    likely: latestCash?.local_currency ?? (teamRow?.country === "South Africa" ? "ZAR" : null),
    today: sastDate(new Date()),
  };
}

type Say = (text: string, blocks?: unknown[]) => Promise<unknown>;

type Ingested = {
  file: SlackFile;
  draftId: string;
  sha: string;
  storagePath: string;
  name: string;
  mime: string | null;
  size: number;
  reading: ReceiptReading;
  say: Say;
};

/** Store the original and read it. Null when it's already been answered (wrong type, unreadable). */
async function ingestFile(
  admin: Admin,
  team: OutreachTeamRef | null,
  file: SlackFile,
  m: IncomingReceipts,
  ctx: IntakeContext
): Promise<Ingested | null> {
  if (fileKind(file) === "unsupported") {
    await post(m.channelId, `*${file.name ?? "That file"}* isn't a photo or PDF, so I can't read it as a receipt.`, m.threadTs);
    return null;
  }
  if ((file.size ?? 0) > MAX_RECEIPT_BYTES) {
    await post(m.channelId, `*${file.name ?? "That file"}* is over 20 MB — send a smaller photo.`, m.threadTs);
    return null;
  }

  // The card starts as a "reading" note and becomes the confirm card.
  const card = await post(m.channelId, "📸 Got it — reading it…", m.threadTs);
  const cardTs = card.ok ? card.ts : undefined;
  const say: Say = (text, blocks) =>
    cardTs ? update(m.channelId, cardTs, text, blocks ?? decidedBlocks(text)) : post(m.channelId, text, m.threadTs, blocks);

  // 1. Keep the original, before anything else can go wrong.
  const url = file.url_private_download || file.url_private;
  if (!url) throw new Error("Slack gave no download link");
  const original = await slack.downloadFile(url, "outreach");
  const sha = crypto.createHash("sha256").update(original).digest("hex");
  const draftId = crypto.randomUUID();
  const name = safeFileName(file);
  // Moved under the expense once logged, so a team-less draft can wait here.
  const storagePath = `${team?.id ?? "unassigned"}/slack/${draftId}/${name}`;

  const { error: upErr } = await admin.storage
    .from(BUCKET)
    .upload(storagePath, original, { contentType: file.mimetype || "application/octet-stream", upsert: false });
  if (upErr) throw new Error(`Storage upload failed: ${upErr.message}`);

  const { error: insErr } = await admin.from("outreach_receipt_drafts").insert({
    id: draftId,
    team_id: team?.id ?? null,
    hub_user_id: m.hubUserId,
    slack_user_id: m.slackUserId,
    channel_id: m.channelId,
    thread_ts: m.threadTs ?? null,
    card_ts: cardTs ?? null,
    user_note: m.userNote,
    slack_file_id: file.id,
    file_name: name,
    mime_type: file.mimetype ?? null,
    file_size: original.length,
    file_sha256: sha,
    storage_path: storagePath,
    status: "reading",
  });
  if (insErr) throw new Error(`Couldn't save the receipt: ${insErr.message}`);

  // 2. Read it.
  try {
    const reading = await readReceipt(
      await readableCopy(file, original),
      readingPrompt({
        categories: ctx.categories.map((c) => c.name),
        teamCountry: ctx.teamRow?.country ?? null,
        likelyCurrency: ctx.likely,
        today: ctx.today,
        userNote: m.userNote,
      })
    );
    return { file, draftId, sha, storagePath, name, mime: file.mimetype ?? null, size: original.length, reading, say };
  } catch (err) {
    await admin
      .from("outreach_receipt_drafts")
      .update({ status: "failed", error: String(err instanceof Error ? err.message : err), updated_at: new Date().toISOString() })
      .eq("id", draftId);
    await say(
      "😕 I couldn't read that receipt. The photo is saved — send a clearer photo, or log it in the Hub.",
      decidedBlocks("😕 I couldn't read that receipt. The photo is saved — send a clearer photo, or log it in the Hub.")
    );
    return null;
  }
}

async function notAReceipt(admin: Admin, g: Ingested) {
  await admin.storage.from(BUCKET).remove([g.storagePath]);
  await admin
    .from("outreach_receipt_drafts")
    .update({ status: "cancelled", extracted: g.reading, error: "not a receipt", updated_at: new Date().toISOString() })
    .eq("id", g.draftId);
  await g.say(
    "That doesn't look like a receipt, so I haven't kept it. No receipt means you repay this yourself — it doesn't come out of the budget and it isn't sent to Xero. If it is a receipt, send a clearer photo."
  );
}

/** A notification sent with its receipt: its file rides on the receipt's draft. */
async function markAttached(admin: Admin, g: Ingested) {
  await admin
    .from("outreach_receipt_drafts")
    .update({ status: "cancelled", extracted: g.reading, error: "attached to its receipt", updated_at: new Date().toISOString() })
    .eq("id", g.draftId);
  await g.say("📎 Bank notification — attached to its receipt, so the real rand is used.");
}

async function proposeReceipt(
  admin: Admin,
  g: Ingested,
  a: {
    team: OutreachTeamRef | null;
    choices: TeamChoice[];
    m: IncomingReceipts;
    ctx: IntakeContext;
    bank: { notice: Ingested; mismatch: boolean } | null;
  }
) {
  const { team, ctx } = a;
  const currency = pickCurrency(g.reading.currency, ctx.likely);
  const rate = await chooseRate(admin, team?.id ?? null, currency, ctx.batches);
  const built = buildProposal({ reading: g.reading, userNote: a.m.userNote, categories: ctx.categories, currency, rate, today: ctx.today });
  let proposal: Proposal = { ...built.proposal, read_warnings: built.warnings };
  const warnings = [...built.warnings];

  if (a.bank) {
    // Paired with its bank notification: the rand is the bank's.
    const confirmed = confirmWithBank(proposal, a.bank.notice.reading);
    const n = a.bank.notice;
    proposal = {
      ...confirmed.proposal,
      bank_proof: { path: n.storagePath, name: n.name, mime: n.mime, size: n.size },
      read_warnings: [...built.warnings.filter((w) => !w.startsWith("No exchange rate")), ...confirmed.warnings],
    };
    warnings.splice(0, warnings.length, ...(proposal.read_warnings ?? []));
    if (a.bank.mismatch) {
      const mis = "⚠️ The bank notification's amount doesn't match the receipt — check they belong together.";
      warnings.unshift(mis);
      proposal.read_warnings = [mis, ...(proposal.read_warnings ?? [])];
    }
  }

  const dup = team ? duplicateWarning(g.sha, proposal, await priorReceipts(admin, team.id, g.draftId)) : null;
  if (dup) warnings.unshift(dup);

  proposal = await withPlainLine(admin, proposal, team?.id ?? null, {
    userNote: a.m.userNote,
    suggested: g.reading.suggested_category,
  });

  await admin
    .from("outreach_receipt_drafts")
    .update({ status: "pending", extracted: g.reading, proposal, updated_at: new Date().toISOString() })
    .eq("id", g.draftId);

  const sender = await displayName(admin, a.m.hubUserId);
  const catName = ctx.categories.find((c) => c.id === proposal.category_id)?.name ?? null;
  const current = team ? { id: team.id, name: team.team_name } : null;
  await g.say(
    cardText(sender, proposal, current),
    receiptCardBlocks({
      draftId: g.draftId,
      senderName: sender,
      proposal,
      categoryName: catName,
      warnings: proposal.read_warnings ?? warnings,
      team: current,
      teamChoices: isDM(a.m.channelId) ? a.choices : [],
    })
  );
}

function cardText(sender: string, p: Proposal, team: TeamChoice | null): string {
  const what = `${p.vendor ?? "?"} ${money(p.local_amount, p.local_currency)}`;
  return team
    ? `Receipt from ${sender} for ${team.name}: ${what} — tap ${logButtonText(team.name).replace("✅ ", "")} to save it.`
    : `Receipt from ${sender}: ${what} — pick which team it's for.`;
}

// ────────────────────────────────────────────────────────────
// Cash pulls (a bank notification for an ATM withdrawal)
// ────────────────────────────────────────────────────────────

async function proposePull(
  admin: Admin,
  a: {
    draftId: string;
    sha: string;
    reading: ReceiptReading;
    team: OutreachTeamRef | null;
    choices: TeamChoice[];
    m: IncomingReceipts;
    today: string;
    fallbackCurrency: string | null;
    say: (text: string, blocks?: unknown[]) => Promise<unknown>;
  }
) {
  const built = buildPullProposal({ reading: a.reading, userNote: a.m.userNote, fallbackCurrency: a.fallbackCurrency, today: a.today });
  const proposal: PullProposal = { ...built.proposal, read_warnings: built.warnings };
  const warnings = [...built.warnings];
  const dup = a.team ? await pullDuplicate(admin, a.team.id, a.sha, proposal, a.draftId) : null;
  if (dup) warnings.unshift(dup);

  await admin
    .from("outreach_receipt_drafts")
    .update({ kind: "cash_pull", status: "pending", extracted: a.reading, proposal, updated_at: new Date().toISOString() })
    .eq("id", a.draftId);

  const sender = await displayName(admin, a.m.hubUserId);
  const current = a.team ? { id: a.team.id, name: a.team.team_name } : null;
  await a.say(
    pullCardText(sender, proposal, current),
    pullCardBlocks({
      draftId: a.draftId,
      senderName: sender,
      proposal,
      warnings,
      team: current,
      teamChoices: isDM(a.m.channelId) ? a.choices : [],
    })
  );
}

function pullCardText(sender: string, p: PullProposal, team: TeamChoice | null): string {
  const line = pullLine(p).replace(/\*/g, "");
  return team ? `Cash pull from ${sender} for ${team.name}: ${line}` : `Cash pull from ${sender}: ${line} — pick which team it's for.`;
}

/** Same screenshot sent before, or a pull of the same rand on the same day. */
async function pullDuplicate(admin: Admin, teamId: string, sha: string, p: PullProposal, excludeDraft: string): Promise<string | null> {
  const [{ data: drafts }, { data: pulls }] = await Promise.all([
    admin
      .from("outreach_receipt_drafts")
      .select("id, status")
      .eq("team_id", teamId)
      .eq("file_sha256", sha)
      .neq("id", excludeDraft)
      .in("status", ["pending", "logging", "logged"]),
    p.zar_out != null
      ? admin
          .from("outreach_cash_batches")
          .select("id")
          .eq("team_id", teamId)
          .eq("batch_date", p.batch_date)
          .eq("zar_withdrawn", p.zar_out)
      : Promise.resolve({ data: [] }),
  ]);
  if ((drafts ?? []).length) return "⚠️ This exact screenshot was sent before — check it isn't a duplicate.";
  if ((pulls ?? []).length) return `⚠️ A pull of ${money(p.zar_out, "ZAR")} on ${p.batch_date} is already logged — check it isn't a duplicate.`;
  return null;
}

/** ✅ Log pull — becomes an outreach_cash_batches row; the screenshot is kept as proof. */
async function logPull(admin: Admin, draft: Draft, slackUserId: string, reply: Reply): Promise<void> {
  if (!draft.team_id) return reply("Pick which team this cash pull is for first — use the *Team* menu on the card.");
  const teamId: string = draft.team_id;
  const userId = await clicker(admin, slackUserId, draft, reply);
  if (!userId) return;

  const p = draft.proposal as unknown as PullProposal;
  const missing = missingForPull(p);
  if (missing.length) return reply(`Before logging, tap *✏️ Change* and add ${missing.join(", ")}.`);
  if (await financeClosed(admin, teamId)) return reply("This team's finances are closed, so I can't log a new cash pull.");

  const { data: claimed } = await admin
    .from("outreach_receipt_drafts")
    .update({ status: "logging", updated_at: new Date().toISOString() })
    .eq("id", draft.id)
    .eq("status", "pending")
    .select("id");
  if (!claimed?.length) return reply("That cash pull has just been handled by someone else.");

  try {
    const logger = await displayName(admin, userId);
    const { data: batch, error } = await admin
      .from("outreach_cash_batches")
      .insert({
        team_id: teamId,
        batch_date: p.batch_date,
        zar_withdrawn: p.zar_out,
        bank_fee: p.bank_fee,
        local_currency: p.local_currency,
        local_currency_received: p.local_amount,
        exchange_rate: 0, // worked out by the database (migration 263)
        notes: `Logged from Slack by ${logger}`,
        created_by: userId,
      })
      .select("id")
      .single();
    if (error || !batch) throw new Error(error?.message ?? "cash pull insert failed");

    // Keep the screenshot as the pull's proof. If the move fails the
    // original stays where it is — never lose the proof.
    let proof = draft.storage_path;
    const target = `${teamId}/pulls/${batch.id}/${draft.file_name}`;
    const { error: mvErr } = await admin.storage.from(BUCKET).move(draft.storage_path, target);
    if (!mvErr) proof = target;
    else console.error("[slack/outreach] pull proof move failed — keeping original path", mvErr);
    await admin.from("outreach_cash_batches").update({ proof_path: proof }).eq("id", batch.id);

    await admin
      .from("outreach_receipt_drafts")
      .update({
        status: "logged",
        cash_batch_id: batch.id,
        storage_path: proof,
        decided_by: userId,
        decided_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", draft.id);

    await checkCashAlert(teamId);
    if (draft.card_ts) {
      const { data: teamRow } = await admin.from("outreach_teams").select("team_name").eq("id", teamId).maybeSingle();
      const text = `✅ *Cash pull logged to ${teamRow?.team_name ?? "the team"} by ${logger}* — ${pullLine(p)}`;
      const detail = `${p.bank_fee > 0 ? `${money(p.bank_fee, "ZAR")} fee logged in Bank Costs · ` : ""}cash spending in ${p.local_currency} is charged to pulls oldest first · <${SITE}/finance/outreach/${teamId}|View in the Hub>`;
      await update(draft.channel_id, draft.card_ts, text.replace(/\*/g, ""), decidedBlocks(text, detail));
    }
  } catch (err) {
    console.error("[slack/outreach] pull log failed", draft.id, err);
    await admin
      .from("outreach_receipt_drafts")
      .update({ status: "pending", error: String(err instanceof Error ? err.message : err), updated_at: new Date().toISOString() })
      .eq("id", draft.id);
    await reply("Something went wrong logging that cash pull — nothing was saved. Try again in a moment.");
  }
}

/** The pull's Change form was submitted: apply the edits, then log. */
export async function applyPullChangeAndLog(
  draftId: string,
  input: Omit<PullProposal, "read_warnings">,
  slackUserId: string,
  reply: Reply
): Promise<void> {
  const admin: Admin = createAdminClient();
  const draft = await getDraft(admin, draftId);
  if (!draft || draft.status !== "pending" || draft.kind !== "cash_pull") {
    return reply(ALREADY[draft?.status ?? ""] ?? "That cash pull has already been handled.");
  }
  if (!(await clicker(admin, slackUserId, draft, reply))) return;
  const proposal = { ...(draft.proposal as unknown as PullProposal), ...input };
  await admin
    .from("outreach_receipt_drafts")
    .update({ proposal, updated_at: new Date().toISOString() })
    .eq("id", draftId)
    .eq("status", "pending");
  await logPull(admin, { ...draft, proposal: proposal as unknown as Proposal }, slackUserId, reply);
}

// ────────────────────────────────────────────────────────────
// Card payments confirmed by the bank (migration 265)
// ────────────────────────────────────────────────────────────

/** File the bank notification under the expense, as one of its receipts. */
async function fileBankProof(
  admin: Admin,
  teamId: string,
  expenseId: string,
  proof: { path: string; name: string; mime: string | null; size: number | null },
  uploadedBy: string
) {
  let path = proof.path;
  const target = `${teamId}/${expenseId}/${Date.now()}_bank_${proof.name}`;
  const { error: mvErr } = await admin.storage.from(BUCKET).move(proof.path, target);
  if (!mvErr) path = target;
  else console.error("[slack/outreach] bank proof move failed — keeping original path", mvErr);
  await admin.from("outreach_receipts").insert({
    expense_id: expenseId,
    file_path: path,
    file_name: `Bank notification — ${proof.name}`,
    file_size: proof.size,
    mime_type: proof.mime,
    uploaded_by: uploadedBy,
  });
  await admin.from("outreach_expenses").update({ bank_proof_path: path }).eq("id", expenseId);
}

/** A fee the bank listed separately: its own Bank Costs expense, like a cash pull's. */
async function logCardFee(
  admin: Admin,
  a: { teamId: string; expenseId: string; fee: number; date: string; vendor: string | null; createdBy: string }
) {
  const { data: cat } = await admin.from("outreach_budget_categories").select("id").eq("slug", "bank-costs").maybeSingle();
  if (!cat) {
    console.error("[slack/outreach] no Bank Costs category — card fee not logged", a.expenseId);
    return;
  }
  const { error } = await admin.from("outreach_expenses").upsert(
    {
      team_id: a.teamId,
      category_id: cat.id,
      expense_date: a.date,
      vendor: "Bank",
      description: `Card fee — ${a.vendor ?? "card payment"}`,
      payment_method: "card",
      local_currency: "ZAR",
      local_amount: a.fee,
      zar_amount: a.fee,
      exchange_rate: 1,
      zar_confirmed: true,
      notes: "The bank's fee on a card payment, logged from its notification.",
      created_by: a.createdBy,
      fee_for_expense_id: a.expenseId,
    },
    { onConflict: "fee_for_expense_id" }
  );
  if (error) console.error("[slack/outreach] card fee failed", a.expenseId, error);
}

/** A card notification on its own: find which of the sender's payments it's for. */
async function proposeCardConfirm(admin: Admin, g: Ingested, m: IncomingReceipts, today: string) {
  const since = new Date(new Date(today + "T00:00:00Z").getTime() - 30 * 86_400_000).toISOString().slice(0, 10);
  const { data } = m.hubUserId
    ? await admin
        .from("outreach_expenses")
        .select("id, team_id, vendor, description, expense_date, local_amount, local_currency, zar_amount, outreach_teams!inner(team_name)")
        .eq("created_by", m.hubUserId)
        .eq("payment_method", "card")
        .neq("local_currency", "ZAR")
        .eq("zar_confirmed", false)
        .gte("expense_date", since)
        .order("expense_date", { ascending: false })
        .limit(200)
    : { data: [] };
  const all: CardCandidate[] = ((data ?? []) as (Omit<CardCandidate, "team_name"> & { outreach_teams: { team_name: string } })[]).map((r) => ({
    ...r,
    local_amount: Number(r.local_amount),
    zar_amount: Number(r.zar_amount),
    team_name: r.outreach_teams.team_name,
  }));
  const candidates = matchCardCandidates(g.reading, all);

  if (!candidates.length) {
    await admin.storage.from(BUCKET).remove([g.storagePath]);
    await admin
      .from("outreach_receipt_drafts")
      .update({ status: "cancelled", extracted: g.reading, error: "no card payment to confirm", updated_at: new Date().toISOString() })
      .eq("id", g.draftId);
    await g.say(
      "🏦 That's a bank notification for a card payment, but none of your card payments is waiting for one. Send it in the same message as its receipt and I'll log both."
    );
    return;
  }

  await admin
    .from("outreach_receipt_drafts")
    .update({
      kind: "card_confirm",
      status: "pending",
      extracted: g.reading,
      proposal: { candidates: candidates.map((c) => c.id) },
      updated_at: new Date().toISOString(),
    })
    .eq("id", g.draftId);
  const bank = bankAmounts(g.reading);
  await g.say(
    `Bank notification${bank ? ` for ${money(bank.total, "ZAR")}` : ""} — which card payment is it for?`,
    cardConfirmBlocks({ draftId: g.draftId, notice: g.reading, candidates, cancelActionId: ACTION_CANCEL })
  );
}

/**
 * [Yes, confirm] / the payment menu: replace that card payment's estimate
 * with the bank's rand, file the screenshot with it, log any fee.
 */
export async function confirmCardPayment(draftId: string, expenseId: string, slackUserId: string, reply: Reply): Promise<void> {
  const admin: Admin = createAdminClient();
  const draft = await getDraft(admin, draftId);
  if (!draft || draft.kind !== "card_confirm") return reply("I can't find that bank notification any more.");
  if (draft.status !== "pending") return reply(ALREADY[draft.status] ?? "That's already been handled.");
  const candidates = ((draft.proposal as unknown as { candidates?: string[] }).candidates ?? []);
  if (!candidates.includes(expenseId)) return reply("That payment isn't one of the matches.");

  const { data: u } = await admin.from("users").select("id").eq("slack_user_id", slackUserId).maybeSingle();
  const userId = (u as { id: string } | null)?.id ?? null;
  if (!userId) return reply("Your Slack isn't linked to a Hub account yet — link it on your Hub profile.");
  if (userId !== draft.hub_user_id) return reply("Only the person who sent this notification can confirm it.");

  const { data: exp } = await admin
    .from("outreach_expenses")
    .select("id, team_id, vendor, description, expense_date, local_amount, local_currency, zar_amount, zar_confirmed, payment_method")
    .eq("id", expenseId)
    .maybeSingle();
  if (!exp || exp.payment_method !== "card") return reply("I can't find that card payment any more.");
  if (exp.zar_confirmed) return reply("That card payment is already confirmed.");
  if (!(await canLog(admin, exp.team_id, userId))) return reply("You can't change that team's expenses.");
  if (await financeClosed(admin, exp.team_id)) return reply("That team's finances are closed.");

  const { data: row } = await admin.from("outreach_receipt_drafts").select("extracted").eq("id", draftId).maybeSingle();
  const bank = row?.extracted ? bankAmounts(row.extracted as ReceiptReading) : null;
  if (!bank) return reply("I couldn't read the rand on that notification — enter it in the Hub instead.");

  const { data: claimed } = await admin
    .from("outreach_receipt_drafts")
    .update({ status: "logging", team_id: exp.team_id, updated_at: new Date().toISOString() })
    .eq("id", draftId)
    .eq("status", "pending")
    .select("id");
  if (!claimed?.length) return reply("That's just been handled.");

  try {
    const estimate = Number(exp.zar_amount);
    const { error } = await admin
      .from("outreach_expenses")
      .update({
        zar_amount: bank.purchase,
        zar_estimate: estimate,
        exchange_rate: Number(exp.local_amount) / bank.purchase,
        zar_confirmed: true,
        zar_confirmed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", expenseId)
      .eq("zar_confirmed", false);
    if (error) throw new Error(error.message);

    await fileBankProof(admin, exp.team_id, expenseId, { path: draft.storage_path, name: draft.file_name, mime: draft.mime_type, size: draft.file_size }, userId);
    if (bank.fee > 0) {
      await logCardFee(admin, { teamId: exp.team_id, expenseId, fee: bank.fee, date: exp.expense_date, vendor: exp.vendor, createdBy: userId });
    }
    await admin
      .from("outreach_receipt_drafts")
      .update({
        status: "logged",
        confirmed_expense_id: expenseId,
        decided_by: userId,
        decided_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", draftId);
    await checkCashAlert(exp.team_id);

    const { data: origins } = await admin
      .from("outreach_receipt_drafts")
      .select("*")
      .eq("expense_id", expenseId)
      .neq("id", draftId)
      .order("created_at", { ascending: false })
      .limit(1);
    const origin = (origins?.[0] ?? null) as Draft | null;
    const target = origin ?? draft;
    const originProposal = (target.proposal ?? {}) as Proposal;
    let xeroStatus = "failed";
    // The bank notification confirms rand, so it posts to FFSA NPC. A dollar
    // slip was already booked on FF USA Inc at Confirm and is not re-posted in rand.
    const merchant = origin && origin.kind !== "card_confirm" ? origin : null;
    if (originProposal.budget_org_key === "usa") {
      xeroStatus = originProposal.xero_write?.status ?? "not_confirmed";
    } else if (!merchant?.storage_path) {
      xeroStatus = "bank_proof_only";
    } else {
      try {
        const book = xeroBook("npc", {
          localCurrency: "ZAR",
          localAmount: bank.purchase,
          zarAmount: bank.purchase,
          zarConfirmed: true,
        });
        const xero = await writeConfirmedSpend(admin, {
          draftId: merchant?.id ?? target.id,
          expenseId,
          hubUserId: merchant?.hub_user_id ?? target.hub_user_id,
          confirmed: true,
          // The screenshot on this card is the bank notification, not the shop receipt.
          hasReceipt: Boolean(merchant?.storage_path),
          repayment: false,
          zarConfirmed: book.zarConfirmed,
          amountZar: book.amount,
          date: exp.expense_date,
          description: originProposal.budget_line_label || exp.description,
          vendor: exp.vendor,
          budgetId: originProposal.budget_id ?? null,
          budgetLineId: originProposal.budget_line_id ?? null,
          orgKey: "npc",
          currency: book.currency,
          region: book.region,
          paymentMethod: "card",
          budgetStatus: originProposal.budget_status ?? null,
          periodStart: originProposal.budget_period_start ?? null,
          periodEnd: originProposal.budget_period_end ?? null,
          proposal: (merchant?.proposal ?? originProposal) as unknown as Record<string, unknown>,
        });
        xeroStatus = xero.status;
      } catch (xeroErr) {
        console.error("[slack/outreach] xero after bank confirm failed", draftId, xeroErr);
      }
    }

    if (draft.card_ts) {
      const diff = bank.purchase - estimate;
      const text = `✅ *Confirmed by the bank* — ${exp.vendor ?? exp.description} ${money(Number(exp.local_amount), exp.local_currency)} is *${money(bank.purchase, "ZAR")}*`;
      const detail = `The estimate was ${money(estimate, "ZAR")} (${diff >= 0 ? "+" : "−"}${money(Math.abs(diff), "ZAR")})${bank.fee > 0 ? ` · ${money(bank.fee, "ZAR")} fee logged in Bank Costs` : ""} · ${xeroResultSentence(xeroStatus)} · <${SITE}/finance/outreach/${exp.team_id}|View in the Hub>`;
      await update(draft.channel_id, draft.card_ts, text.replace(/\*/g, ""), decidedBlocks(text, detail));
    }
  } catch (err) {
    console.error("[slack/outreach] card confirm failed", draftId, err);
    await admin.from("outreach_receipt_drafts").update({ status: "pending", updated_at: new Date().toISOString() }).eq("id", draftId);
    await reply("Something went wrong confirming that — nothing was changed. Try again in a moment.");
  }
}

async function priorReceipts(admin: Admin, teamId: string, excludeDraft: string): Promise<PriorReceipt[]> {
  const [{ data: drafts }, { data: receipts }, { data: expenses }] = await Promise.all([
    admin.from("outreach_receipt_drafts").select("id, file_sha256, status").eq("team_id", teamId).neq("id", excludeDraft),
    admin.from("outreach_receipts").select("file_sha256, outreach_expenses!inner(team_id)").eq("outreach_expenses.team_id", teamId).not("file_sha256", "is", null),
    admin.from("outreach_expenses").select("vendor, expense_date, zar_amount").eq("team_id", teamId).order("expense_date", { ascending: false }).limit(1000),
  ]);
  return [
    ...((drafts ?? []) as PriorReceipt[]),
    ...((receipts ?? []) as PriorReceipt[]),
    ...((expenses ?? []) as PriorReceipt[]),
  ];
}

// ────────────────────────────────────────────────────────────
// 2. Buttons
// ────────────────────────────────────────────────────────────

type Draft = {
  id: string;
  kind: "receipt" | "cash_pull" | "card_confirm";
  team_id: string | null;
  hub_user_id: string | null;
  channel_id: string;
  card_ts: string | null;
  file_name: string;
  mime_type: string | null;
  file_size: number | null;
  file_sha256: string;
  storage_path: string;
  user_note: string | null;
  /** A PullProposal when kind is cash_pull. */
  proposal: Proposal;
  status: string;
};

async function getDraft(admin: Admin, id: string): Promise<Draft | null> {
  const { data } = await admin.from("outreach_receipt_drafts").select("*").eq("id", id).maybeSingle();
  return data as Draft | null;
}

export type Reply = (text: string) => Promise<void>;

async function clicker(admin: Admin, slackUserId: string, draft: Draft, reply: Reply): Promise<string | null> {
  const { data } = await admin.from("users").select("id").eq("slack_user_id", slackUserId).maybeSingle();
  const id = (data as { id: string } | null)?.id ?? null;
  if (!id) {
    await reply("Your Slack isn't linked to a Hub account yet — link it on your Hub profile.");
    return null;
  }
  // No team chosen yet: it's the sender's receipt to sort out.
  if (!draft.team_id) {
    if (id === draft.hub_user_id) return id;
    await reply("Only the person who sent this receipt can pick its team.");
    return null;
  }
  if (!(await canLog(admin, draft.team_id, id))) {
    const names = await editorNames(admin, draft.team_id);
    await reply(names.length ? `Only ${names.join(" or ")} can log this team's expenses.` : "Only the team's leaders can log expenses.");
    return null;
  }
  return id;
}

const ALREADY: Record<string, string> = {
  logged: "This receipt is already logged.",
  logging: "This receipt is being logged right now.",
  cancelled: "This receipt was cancelled.",
  failed: "This receipt couldn't be read — send a clearer photo or log it in the Hub.",
  reading: "Still reading this receipt — give it a moment.",
};

/** ✅ Log it — or the Change form's submit, with its edits applied first. */
export async function logReceipt(draftId: string, slackUserId: string, reply: Reply): Promise<void> {
  const admin: Admin = createAdminClient();
  const draft = await getDraft(admin, draftId);
  if (!draft) return reply("I can't find that receipt any more.");
  if (draft.status !== "pending") return reply(ALREADY[draft.status] ?? "That receipt has already been handled.");
  if (draft.kind === "cash_pull") return logPull(admin, draft, slackUserId, reply);

  if (!draft.team_id) return reply("Pick which team this receipt is for first — use the *Team* menu on the card.");
  const teamId: string = draft.team_id;
  const userId = await clicker(admin, slackUserId, draft, reply);
  if (!userId) return;

  const p = draft.proposal;
  const missing = missingForLog(p);
  if (missing.length) return reply(`Before logging, tap *✏️ Change* and add ${missing.join(", ")}.`);
  if (await financeClosed(admin, teamId)) return reply("This team's finances are closed, so I can't log new expenses.");

  // Claim it, so a double tap can't create two expenses.
  const { data: claimed } = await admin
    .from("outreach_receipt_drafts")
    .update({ status: "logging", updated_at: new Date().toISOString() })
    .eq("id", draftId)
    .eq("status", "pending")
    .select("id");
  if (!claimed?.length) return reply("That receipt has just been handled by someone else.");

  try {
    const [sender, logger] = await Promise.all([displayName(admin, draft.hub_user_id), displayName(admin, userId)]);
    const { data: expense, error } = await admin
      .from("outreach_expenses")
      .insert({
        team_id: teamId,
        category_id: p.category_id,
        expense_date: p.expense_date,
        receipt_code: p.receipt_code,
        vendor: p.vendor,
        description: p.description,
        purchaser: sender,
        payment_method: p.payment_method,
        local_currency: p.local_currency,
        local_amount: p.local_amount,
        zar_amount: p.zar_amount,
        exchange_rate: p.exchange_rate,
        cash_batch_id: p.cash_batch_id,
        // Card abroad: confirmed when the bank's rand came with it; else an
        // estimate waiting for the notification (migration 265).
        zar_confirmed: p.local_currency === "ZAR" || Boolean(p.zar_confirmed),
        zar_estimate: p.payment_method === "card" && p.local_currency !== "ZAR" && !p.zar_confirmed ? p.zar_amount : null,
        zar_confirmed_at: p.zar_confirmed ? new Date().toISOString() : null,
        source: "slack",
        notes: logger === sender ? `Logged from Slack by ${logger}` : `Sent from Slack by ${sender}, logged by ${logger}`,
        created_by: userId,
      })
      .select("id")
      .single();
    if (error || !expense) throw new Error(error?.message ?? "expense insert failed");

    // File it under the expense exactly like a Hub upload. If the move
    // fails the original stays where it is — never lose the photo.
    let filePath = draft.storage_path;
    const target = `${teamId}/${expense.id}/${Date.now()}_${draft.file_name}`;
    const { error: mvErr } = await admin.storage.from(BUCKET).move(draft.storage_path, target);
    if (!mvErr) filePath = target;
    else console.error("[slack/outreach] receipt move failed — keeping original path", mvErr);

    const { error: rcErr } = await admin.from("outreach_receipts").insert({
      expense_id: expense.id,
      file_path: filePath,
      file_name: draft.file_name,
      file_size: draft.file_size,
      mime_type: draft.mime_type,
      file_sha256: draft.file_sha256,
      uploaded_by: draft.hub_user_id ?? userId,
    });
    if (rcErr) console.error("[slack/outreach] receipt row failed", rcErr);

    if (p.bank_proof) {
      await fileBankProof(admin, teamId, expense.id, p.bank_proof, draft.hub_user_id ?? userId);
    }
    if ((p.bank_fee_zar ?? 0) > 0) {
      await logCardFee(admin, { teamId, expenseId: expense.id, fee: p.bank_fee_zar!, date: p.expense_date, vendor: p.vendor, createdBy: userId });
    }

    await admin
      .from("outreach_receipt_drafts")
      .update({
        status: "logged",
        expense_id: expense.id,
        storage_path: filePath,
        decided_by: userId,
        decided_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", draftId);

    // Foreign cash is re-priced by the database from the team's cash pulls,
    // oldest first (migration 263) — show that figure, not the card's estimate.
    const { data: saved } = await admin.from("outreach_expenses").select("zar_amount").eq("id", expense.id).maybeSingle();
    const zarFinal = saved?.zar_amount != null ? Number(saved.zar_amount) : p.zar_amount;
    const fromPulls = p.payment_method === "cash" && p.local_currency !== "ZAR";
    const book = xeroBook(p.budget_org_key ?? null, {
      localCurrency: p.local_currency,
      localAmount: p.local_amount,
      zarAmount: Number(zarFinal),
      zarConfirmed: p.local_currency === "ZAR" || Boolean(p.zar_confirmed),
    });
    let xeroStatus = "failed";
    try {
      const xero = await writeConfirmedSpend(admin, {
        draftId,
        expenseId: expense.id,
        hubUserId: draft.hub_user_id,
        confirmed: true,
        hasReceipt: true,
        repayment: false,
        zarConfirmed: book.zarConfirmed,
        amountZar: book.amount,
        date: p.expense_date,
        description: p.budget_line_label || p.description,
        vendor: p.vendor,
        budgetId: p.budget_id ?? null,
        budgetLineId: p.budget_line_id ?? null,
        orgKey: p.budget_org_key ?? null,
        currency: book.currency,
        region: book.region,
        paymentMethod: p.payment_method,
        budgetStatus: p.budget_status ?? null,
        periodStart: p.budget_period_start ?? null,
        periodEnd: p.budget_period_end ?? null,
        proposal: p as unknown as Record<string, unknown>,
      });
      xeroStatus = xero.status;
    } catch (xeroErr) {
      console.error("[slack/outreach] xero after confirm failed", draftId, xeroErr);
    }
    const left = p.budget_line_id ? null : await categoryLeft(admin, teamId, p.category_id!);
    await checkCashAlert(teamId);
    const { data: teamRow } = await admin.from("outreach_teams").select("team_name").eq("id", teamId).maybeSingle();
    if (draft.card_ts) {
      const amount =
        p.local_currency === "ZAR"
          ? money(p.zar_amount, "ZAR")
          : `${money(p.local_amount, p.local_currency)} (${money(zarFinal, "ZAR")}${fromPulls ? " from your cash pulls" : p.zar_confirmed ? " confirmed by bank" : p.payment_method === "card" ? " estimate — send the bank notification" : ""})`;
      const lineBit = p.budget_line_label ? ` · ${p.budget_line_label}` : left ? ` · ${left.category}` : "";
      const text = `✅ *Confirmed for ${teamRow?.team_name ?? "the team"} by ${logger}* — ${p.vendor ?? "Receipt"} · ${p.expense_date} · ${amount}${lineBit}`;
      const spent = left
        ? `${left.category} now has *${left.left < 0 ? `over by R${fmtNum(-left.left)}` : `R${fmtNum(left.left)} left`}* of R${fmtNum(left.planned)} · `
        : `${p.budget_line_label ?? "Budget line"} · `;
      const detail = `${spent}receipt saved · ${xeroResultSentence(xeroStatus)} · <${SITE}/finance/outreach/${teamId}|View in the Hub>`;
      await update(draft.channel_id, draft.card_ts, text.replace(/\*/g, ""), decidedBlocks(text, detail));
    }
  } catch (err) {
    console.error("[slack/outreach] log failed", draftId, err);
    await admin
      .from("outreach_receipt_drafts")
      .update({ status: "pending", error: String(err instanceof Error ? err.message : err), updated_at: new Date().toISOString() })
      .eq("id", draftId);
    await reply("Something went wrong logging that — nothing was saved. Try again in a moment.");
  }
}

async function categoryLeft(admin: Admin, teamId: string, categoryId: string) {
  const [categories, { data: lines }, { data: expenses }] = await Promise.all([
    loadCategories(admin),
    admin.from("outreach_budget_lines").select("category_id, description, total_zar").eq("team_id", teamId).eq("category_id", categoryId),
    admin.from("outreach_expenses").select("category_id, zar_amount").eq("team_id", teamId).eq("category_id", categoryId),
  ]);
  const s = summarise(categories, lines ?? [], expenses ?? []).categories[0];
  return s ?? { category: categories.find((c) => c.id === categoryId)?.name ?? "That category", planned: 0, spent: 0, left: 0, receipts: 0 };
}

/** Cancel — nothing logged, stored photo removed. */
export async function cancelReceipt(draftId: string, slackUserId: string, reply: Reply): Promise<void> {
  const admin: Admin = createAdminClient();
  const draft = await getDraft(admin, draftId);
  if (!draft) return reply("I can't find that receipt any more.");
  if (draft.status !== "pending" && draft.status !== "failed") return reply(ALREADY[draft.status] ?? "Already handled.");
  const userId = await clicker(admin, slackUserId, draft, reply);
  if (!userId) return;

  const { data: claimed } = await admin
    .from("outreach_receipt_drafts")
    .update({ status: "cancelled", decided_by: userId, decided_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", draftId)
    .in("status", ["pending", "failed"])
    .select("id");
  if (!claimed?.length) return reply("That receipt has just been handled by someone else.");

  const proof = (draft.proposal as Proposal | undefined)?.bank_proof?.path;
  await admin.storage.from(BUCKET).remove(proof ? [draft.storage_path, proof] : [draft.storage_path]);
  if (draft.card_ts) {
    const name = await displayName(admin, userId);
    const what = draft.kind === "cash_pull" ? "Cash pull" : draft.kind === "card_confirm" ? "Bank notification" : "Receipt";
    await update(draft.channel_id, draft.card_ts, `${what} cancelled by ${name}`, decidedBlocks(`🗑️ ${what} cancelled by ${name} — nothing was logged.`));
  }
}

/**
 * Team menu on the card: the sender picks (or corrects) which team the
 * receipt is for. The rate and the duplicate check are redone against
 * that team, and the card is redrawn so the button names it.
 */
export async function chooseTeam(draftId: string, teamId: string, slackUserId: string, reply: Reply): Promise<void> {
  const admin: Admin = createAdminClient();
  const draft = await getDraft(admin, draftId);
  if (!draft) return reply("I can't find that receipt any more.");
  if (draft.status !== "pending") return reply(ALREADY[draft.status] ?? "That receipt has already been handled.");

  const { data: u } = await admin.from("users").select("id").eq("slack_user_id", slackUserId).maybeSingle();
  const userId = (u as { id: string } | null)?.id ?? null;
  if (!userId) return reply("Your Slack isn't linked to a Hub account yet — link it on your Hub profile.");
  if (userId !== draft.hub_user_id && !(await isFinanceStaff(admin, userId))) {
    return reply("Only the person who sent this receipt can change its team.");
  }
  if (!(await canLog(admin, teamId, userId))) return reply("You can't log expenses for that team.");
  if (await financeClosed(admin, teamId)) return reply("That team's finances are closed, so I can't log new expenses to it.");

  // Re-price against the new team's own cash (a typed rand amount never
  // gets here: the Change form logs straight away).
  const p = draft.proposal;
  const rate =
    draft.kind === "cash_pull" || p.local_currency === "ZAR" ? null : await chooseRate(admin, teamId, p.local_currency);
  const proposal: Proposal =
    draft.kind === "cash_pull" || p.local_currency === "ZAR"
      ? p
      : {
          ...p,
          exchange_rate: rate?.exchange_rate ?? null,
          zar_amount: rate && p.local_amount != null ? toZar(p.local_amount, rate.exchange_rate) : null,
          rate_label: rate?.label ?? "",
          cash_batch_id: rate?.cash_batch_id ?? null,
        };
  const lined =
    draft.kind === "cash_pull"
      ? proposal
      : await withPlainLine(admin, proposal, teamId, { userNote: draft.user_note ?? null, suggested: null });

  const { data: moved } = await admin
    .from("outreach_receipt_drafts")
    .update({ team_id: teamId, proposal: lined, updated_at: new Date().toISOString() })
    .eq("id", draftId)
    .eq("status", "pending")
    .select("id");
  if (!moved?.length) return reply("That receipt has just been handled by someone else.");

  await redrawCard(admin, { ...draft, team_id: teamId, proposal: lined });
}

/** Draw a pending draft's card again from what's stored. */
async function redrawCard(admin: Admin, draft: Draft): Promise<void> {
  if (!draft.card_ts) return;
  const p = draft.proposal;
  const [categories, sender, { data: teamRow }] = await Promise.all([
    loadCategories(admin),
    displayName(admin, draft.hub_user_id),
    draft.team_id
      ? admin.from("outreach_teams").select("id, team_name").eq("id", draft.team_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const team = teamRow ? { id: teamRow.id as string, name: teamRow.team_name as string } : null;
  const choices = isDM(draft.channel_id) ? await loggableTeams(admin, draft.hub_user_id) : [];

  if (draft.kind === "cash_pull") {
    const pull = p as unknown as PullProposal;
    const pullWarnings = [...(pull.read_warnings ?? [])];
    const dup = team ? await pullDuplicate(admin, team.id, draft.file_sha256, pull, draft.id) : null;
    if (dup) pullWarnings.unshift(dup);
    await update(
      draft.channel_id,
      draft.card_ts,
      pullCardText(sender, pull, team),
      pullCardBlocks({ draftId: draft.id, senderName: sender, proposal: pull, warnings: pullWarnings, team, teamChoices: choices })
    );
    return;
  }

  const warnings = (p.read_warnings ?? []).filter((w) => !w.startsWith("No exchange rate"));
  if (p.local_currency !== "ZAR" && !p.exchange_rate) {
    warnings.push(`No exchange rate for ${p.local_currency} — tap *Change* to enter the rand amount.`);
  }
  if (team) {
    const dup = duplicateWarning(draft.file_sha256, p, await priorReceipts(admin, team.id, draft.id));
    if (dup) warnings.unshift(dup);
  }

  const catName = categories.find((c) => c.id === p.category_id)?.name ?? null;
  await update(
    draft.channel_id,
    draft.card_ts,
    cardText(sender, p, team),
    receiptCardBlocks({ draftId: draft.id, senderName: sender, proposal: p, categoryName: catName, warnings, team, teamChoices: choices })
  );
}

/** ✏️ Change — open the form. Must run within 3s of the click (trigger_id). */
export async function openChangeForm(draftId: string, triggerId: string, slackUserId: string, reply: Reply): Promise<void> {
  const admin: Admin = createAdminClient();
  const draft = await getDraft(admin, draftId);
  if (!draft) return reply("I can't find that receipt any more.");
  if (draft.status !== "pending") return reply(ALREADY[draft.status] ?? "Already handled.");
  if (!(await clicker(admin, slackUserId, draft, reply))) return;
  if (draft.kind === "cash_pull") {
    const res = await slack.openView(
      triggerId,
      pullChangeModal({ draftId, proposal: draft.proposal as unknown as PullProposal }),
      "outreach"
    );
    if (!res.ok) await reply(`Couldn't open the form (${res.error ?? "unknown error"}). Try again.`);
    return;
  }
  const categories = await loadCategories(admin);
  const found = await linesForReceipt(admin, draft.team_id, draft.proposal, draft.user_note);
  const res = await slack.openView(
    triggerId,
    changeModal({
      draftId,
      proposal: draft.proposal,
      categories,
      budgetLines: found.lines.map((line) => ({ id: line.id, name: line.name })),
    }),
    "outreach"
  );
  if (!res.ok) await reply(`Couldn't open the form (${res.error ?? "unknown error"}). Try again.`);
}

/** The Change form was submitted: apply the edits, then log. */
export async function applyChangeAndLog(draftId: string, input: ChangeInput, slackUserId: string, reply: Reply): Promise<void> {
  const admin: Admin = createAdminClient();
  const draft = await getDraft(admin, draftId);
  if (!draft || draft.status !== "pending") return reply(ALREADY[draft?.status ?? ""] ?? "That receipt has already been handled.");
  if (!(await clicker(admin, slackUserId, draft, reply))) return;

  const p = draft.proposal;
  let rate: RateChoice | null;
  if (input.zar_override) {
    rate = { exchange_rate: input.local_amount / input.zar_override, source: "cash_batch", label: "rand amount entered", cash_batch_id: null };
  } else if (input.local_currency === p.local_currency && p.exchange_rate) {
    rate = { exchange_rate: p.exchange_rate, source: "cash_batch", label: p.rate_label, cash_batch_id: p.cash_batch_id };
  } else {
    rate = await chooseRate(admin, draft.team_id, input.local_currency);
  }
  if (!rate) return reply(`I couldn't find an exchange rate for ${input.local_currency} — tap *Change* again and fill in the rand amount.`);

  // The bank's rand stays the rand when only receipt details changed.
  const keepBank =
    Boolean(p.zar_confirmed) && !input.zar_override && input.local_currency === p.local_currency && p.zar_amount != null;
  const zar =
    input.local_currency === "ZAR"
      ? input.local_amount
      : keepBank
        ? p.zar_amount!
        : input.zar_override ?? toZar(input.local_amount, rate.exchange_rate);
  const proposal: Proposal = {
    ...p,
    vendor: input.vendor,
    expense_date: input.expense_date,
    description: input.description,
    category_id: input.category_id,
    payment_method: input.payment_method,
    local_currency: input.local_currency,
    local_amount: input.local_amount,
    exchange_rate: input.local_currency === "ZAR" ? 1 : input.local_amount / zar,
    zar_amount: zar,
    rate_label: input.local_currency === "ZAR" ? "" : keepBank ? p.rate_label : rate.label,
    cash_batch_id: keepBank ? null : rate.cash_batch_id,
    // A rand amount typed from the bank app confirms a card payment too.
    zar_confirmed: input.local_currency !== "ZAR" && input.payment_method === "card" && (keepBank || Boolean(input.zar_override)),
  };
  const lined = await withPlainLine(admin, proposal, draft.team_id, {
    userNote: draft.user_note ?? null,
    suggested: null,
    explicitLineId: input.budget_line_id,
  });
  await admin
    .from("outreach_receipt_drafts")
    .update({ proposal: lined, updated_at: new Date().toISOString() })
    .eq("id", draftId)
    .eq("status", "pending");
  await logReceipt(draftId, slackUserId, reply);
}
