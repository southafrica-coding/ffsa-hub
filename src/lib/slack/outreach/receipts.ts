/**
 * Receipts from Slack — the I/O half (pure logic lives in receipt-logic.ts).
 *
 *   photo arrives ─► original stored (outreach-receipts bucket) + draft row
 *                 ─► Claude reads it ─► card [Log to <team>] [Change] [Cancel]
 *   bank notice   ─► a screenshot of an ATM withdrawal becomes a CASH PULL
 *                    card instead [Log pull to <team>] [Change] [Cancel] —
 *                    priced exactly like the Hub form (migration 263/264)
 *   Team          ─► in a DM, someone who can log for several teams picks
 *                    (or corrects) the team on the card; nothing is logged
 *                    until a team is chosen (migration 262)
 *   Log it        ─► outreach_expenses (source 'slack') + the ORIGINAL file
 *                    moved under the expense and recorded in
 *                    outreach_receipts, exactly like a Hub upload
 *   Change        ─► Slack form ─► then Log it
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
  buildPullProposal,
  missingForPull,
  pullCardBlocks,
  pullChangeModal,
  pullLine,
  type PullProposal,
} from "./pull-logic";
import { isFinanceStaff, pickTeam, sastDate, summarise, type OutreachScope, type OutreachTeamRef } from "@/lib/slack/assistant/outreach";
import {
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
    const { data } = await admin.from("outreach_teams").select("id, team_name").order("team_name");
    return ((data ?? []) as { id: string; team_name: string }[]).map((t) => ({ id: t.id, name: t.team_name }));
  }
  const { data } = await admin
    .from("outreach_team_members")
    .select("outreach_teams!inner(id, team_name)")
    .eq("user_id", hubUserId)
    .in("role", EDITOR_ROLES)
    // Same teams the bot answers them about in a DM (resolveOutreachScope).
    .eq("outreach_teams.slack_enabled", true);
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
  await Promise.all(
    files.map(async (file) => {
      try {
        await handleOneFile(admin, team, choices, file, m);
      } catch (err) {
        console.error("[slack/outreach] receipt failed", file.id, err);
        await post(m.channelId, `Something went wrong with *${file.name ?? "that file"}*. Try sending it again, or log it in the Hub.`, m.threadTs).catch(() => {});
      }
    })
  );
}

async function handleOneFile(
  admin: Admin,
  team: OutreachTeamRef | null,
  choices: TeamChoice[],
  file: SlackFile,
  m: IncomingReceipts
) {
  if (fileKind(file) === "unsupported") {
    await post(m.channelId, `*${file.name ?? "That file"}* isn't a photo or PDF, so I can't read it as a receipt.`, m.threadTs);
    return;
  }
  if ((file.size ?? 0) > MAX_RECEIPT_BYTES) {
    await post(m.channelId, `*${file.name ?? "That file"}* is over 20 MB — send a smaller photo.`, m.threadTs);
    return;
  }

  // The card starts as a "reading" note and becomes the confirm card.
  const card = await post(m.channelId, "📸 Got it — reading your receipt…", m.threadTs);
  const cardTs = card.ok ? card.ts : undefined;
  const say = (text: string, blocks?: unknown[]) =>
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
  const [categories, batches, { data: teamRow }] = await Promise.all([
    loadCategories(admin),
    team ? cashBatches(admin, team.id) : Promise.resolve([] as CashBatchRow[]),
    team
      ? admin.from("outreach_teams").select("country").eq("id", team.id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const latestCash = [...batches].sort((a, b) => b.batch_date.localeCompare(a.batch_date))[0];
  const likely = latestCash?.local_currency ?? (teamRow?.country === "South Africa" ? "ZAR" : null);
  const today = sastDate(new Date());

  let reading: ReceiptReading;
  try {
    reading = await readReceipt(
      await readableCopy(file, original),
      readingPrompt({
        categories: categories.map((c) => c.name),
        teamCountry: teamRow?.country ?? null,
        likelyCurrency: likely,
        today,
        userNote: m.userNote,
      })
    );
  } catch (err) {
    await admin
      .from("outreach_receipt_drafts")
      .update({ status: "failed", error: String(err instanceof Error ? err.message : err), updated_at: new Date().toISOString() })
      .eq("id", draftId);
    await say(
      "😕 I couldn't read that receipt. The photo is saved — send a clearer photo, or log it in the Hub.",
      decidedBlocks("😕 I couldn't read that receipt. The photo is saved — send a clearer photo, or log it in the Hub.")
    );
    return;
  }

  if (reading.document_kind === "atm_withdrawal_notification") {
    await proposePull(admin, {
      draftId,
      sha,
      reading,
      team,
      choices,
      m,
      today,
      fallbackCurrency: latestCash?.local_currency ?? currencyForCountry(teamRow?.country) ?? null,
      say,
    });
    return;
  }
  if (reading.document_kind === "card_payment_notification") {
    await admin.storage.from(BUCKET).remove([storagePath]);
    await admin
      .from("outreach_receipt_drafts")
      .update({ status: "cancelled", extracted: reading, error: "card notification on its own", updated_at: new Date().toISOString() })
      .eq("id", draftId);
    await say("That's a card payment notification. For card spending, send the receipt photo — I'll log it from that.");
    return;
  }

  if (!reading.is_receipt) {
    await admin.storage.from(BUCKET).remove([storagePath]);
    await admin
      .from("outreach_receipt_drafts")
      .update({ status: "cancelled", extracted: reading, error: "not a receipt", updated_at: new Date().toISOString() })
      .eq("id", draftId);
    await say("That doesn't look like a receipt, so I haven't kept it. If it is one, send a clearer photo.");
    return;
  }

  // 3. Propose.
  const currency = pickCurrency(reading.currency, likely);
  const rate = await chooseRate(admin, team?.id ?? null, currency, batches);
  const built = buildProposal({ reading, userNote: m.userNote, categories, currency, rate, today });
  const proposal: Proposal = { ...built.proposal, read_warnings: built.warnings };
  const warnings = [...built.warnings];
  const dup = team ? duplicateWarning(sha, proposal, await priorReceipts(admin, team.id, draftId)) : null;
  if (dup) warnings.unshift(dup);

  await admin
    .from("outreach_receipt_drafts")
    .update({ status: "pending", extracted: reading, proposal, updated_at: new Date().toISOString() })
    .eq("id", draftId);

  const sender = await displayName(admin, m.hubUserId);
  const catName = categories.find((c) => c.id === proposal.category_id)?.name ?? null;
  const current = team ? { id: team.id, name: team.team_name } : null;
  await say(
    cardText(sender, proposal, current),
    receiptCardBlocks({
      draftId,
      senderName: sender,
      proposal,
      categoryName: catName,
      warnings,
      team: current,
      teamChoices: isDM(m.channelId) ? choices : [],
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
  kind: "receipt" | "cash_pull";
  team_id: string | null;
  hub_user_id: string | null;
  channel_id: string;
  card_ts: string | null;
  file_name: string;
  mime_type: string | null;
  file_size: number | null;
  file_sha256: string;
  storage_path: string;
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
    const left = await categoryLeft(admin, teamId, p.category_id!);
    await checkCashAlert(teamId);
    const { data: teamRow } = await admin.from("outreach_teams").select("team_name").eq("id", teamId).maybeSingle();
    if (draft.card_ts) {
      const amount =
        p.local_currency === "ZAR"
          ? money(p.zar_amount, "ZAR")
          : `${money(p.local_amount, p.local_currency)} (${money(zarFinal, "ZAR")}${fromPulls ? " from your cash pulls" : ""})`;
      const text = `✅ *Logged to ${teamRow?.team_name ?? "the team"} by ${logger}* — ${p.vendor ?? "Receipt"} · ${p.expense_date} · ${amount} · ${left.category}`;
      const detail = `${left.category} now has *${left.left < 0 ? `over by R${fmtNum(-left.left)}` : `R${fmtNum(left.left)} left`}* of R${fmtNum(left.planned)} · receipt saved · <${SITE}/finance/outreach/${teamId}|View in the Hub>`;
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

  await admin.storage.from(BUCKET).remove([draft.storage_path]);
  if (draft.card_ts) {
    const name = await displayName(admin, userId);
    const what = draft.kind === "cash_pull" ? "Cash pull" : "Receipt";
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

  const { data: moved } = await admin
    .from("outreach_receipt_drafts")
    .update({ team_id: teamId, proposal, updated_at: new Date().toISOString() })
    .eq("id", draftId)
    .eq("status", "pending")
    .select("id");
  if (!moved?.length) return reply("That receipt has just been handled by someone else.");

  await redrawCard(admin, { ...draft, team_id: teamId, proposal });
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
  const res = await slack.openView(triggerId, changeModal({ draftId, proposal: draft.proposal, categories }), "outreach");
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

  const proposal: Proposal = {
    ...p,
    vendor: input.vendor,
    expense_date: input.expense_date,
    description: input.description,
    category_id: input.category_id,
    payment_method: input.payment_method,
    local_currency: input.local_currency,
    local_amount: input.local_amount,
    exchange_rate: input.local_currency === "ZAR" ? 1 : rate.exchange_rate,
    zar_amount: input.local_currency === "ZAR" ? input.local_amount : input.zar_override ?? toZar(input.local_amount, rate.exchange_rate),
    rate_label: input.local_currency === "ZAR" ? "" : rate.label,
    cash_batch_id: rate.cash_batch_id,
  };
  await admin
    .from("outreach_receipt_drafts")
    .update({ proposal, updated_at: new Date().toISOString() })
    .eq("id", draftId)
    .eq("status", "pending");
  await logReceipt(draftId, slackUserId, reply);
}
