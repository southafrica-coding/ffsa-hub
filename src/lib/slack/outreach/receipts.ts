/**
 * Receipts from Slack — the I/O half (pure logic lives in receipt-logic.ts).
 *
 *   photo arrives ─► original stored (outreach-receipts bucket) + draft row
 *                 ─► Claude reads it ─► card [Log it] [Change] [Cancel]
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
 * who may do it: logging is for the team's outreach leader, finance
 * student, school leader or finance admin, and finance staff.
 */

import crypto from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import sharp from "sharp";
import * as slack from "@/lib/slack/client";
import { checkCashAlert } from "@/lib/outreach/cash-alerts";
import { createAdminClient } from "@/lib/supabase/admin";
import type { BudgetCategory } from "@/lib/finance/outreach-budget";
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
const EDITOR_ROLES = ["outreach_leader", "finance_student", "school_leader", "finance_admin"];
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

async function chooseRate(admin: Admin, teamId: string, currency: string, batches?: CashBatchRow[]) {
  return rateFromCash(currency, batches ?? (await cashBatches(admin, teamId))) ?? (await liveRate(currency));
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
  if (!team) {
    const own = m.scope.teams.filter((t) => t.role !== null).map((t) => t.team_name);
    await post(
      m.channelId,
      `Which team is this receipt for? Send it again with the team name in the message${own.length ? ` (${own.join(" or ")})` : ""}.`,
      m.threadTs
    );
    return;
  }

  if (!(await canLog(admin, team.id, m.hubUserId))) {
    const names = await editorNames(admin, team.id);
    await post(
      m.channelId,
      names.length
        ? `Only ${names.join(" or ")} can log ${team.team_name}'s expenses — tag them here, or send them the photo.`
        : `Only the team's outreach leader or finance student can log ${team.team_name}'s expenses.`,
      m.threadTs
    );
    return;
  }
  if (await financeClosed(admin, team.id)) {
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
        await handleOneFile(admin, team, file, m);
      } catch (err) {
        console.error("[slack/outreach] receipt failed", file.id, err);
        await post(m.channelId, `Something went wrong with *${file.name ?? "that file"}*. Try sending it again, or log it in the Hub.`, m.threadTs).catch(() => {});
      }
    })
  );
}

async function handleOneFile(admin: Admin, team: OutreachTeamRef, file: SlackFile, m: IncomingReceipts) {
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
  const storagePath = `${team.id}/slack/${draftId}/${name}`;

  const { error: upErr } = await admin.storage
    .from(BUCKET)
    .upload(storagePath, original, { contentType: file.mimetype || "application/octet-stream", upsert: false });
  if (upErr) throw new Error(`Storage upload failed: ${upErr.message}`);

  const { error: insErr } = await admin.from("outreach_receipt_drafts").insert({
    id: draftId,
    team_id: team.id,
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
    cashBatches(admin, team.id),
    admin.from("outreach_teams").select("country").eq("id", team.id).maybeSingle(),
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
  const rate = await chooseRate(admin, team.id, currency, batches);
  const { proposal, warnings } = buildProposal({ reading, userNote: m.userNote, categories, currency, rate, today });
  const dup = duplicateWarning(sha, proposal, await priorReceipts(admin, team.id, draftId));
  if (dup) warnings.unshift(dup);

  await admin
    .from("outreach_receipt_drafts")
    .update({ status: "pending", extracted: reading, proposal, updated_at: new Date().toISOString() })
    .eq("id", draftId);

  const sender = await displayName(admin, m.hubUserId);
  const catName = categories.find((c) => c.id === proposal.category_id)?.name ?? null;
  await say(
    `Receipt from ${sender}: ${proposal.vendor ?? "?"} ${money(proposal.local_amount, proposal.local_currency)} — tap Log it to save it.`,
    receiptCardBlocks({ draftId, senderName: sender, proposal, categoryName: catName, warnings })
  );
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
  team_id: string;
  hub_user_id: string | null;
  channel_id: string;
  card_ts: string | null;
  file_name: string;
  mime_type: string | null;
  file_size: number | null;
  file_sha256: string;
  storage_path: string;
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

  const userId = await clicker(admin, slackUserId, draft, reply);
  if (!userId) return;

  const p = draft.proposal;
  const missing = missingForLog(p);
  if (missing.length) return reply(`Before logging, tap *✏️ Change* and add ${missing.join(", ")}.`);
  if (await financeClosed(admin, draft.team_id)) return reply("This team's finances are closed, so I can't log new expenses.");

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
        team_id: draft.team_id,
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
    const target = `${draft.team_id}/${expense.id}/${Date.now()}_${draft.file_name}`;
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

    const left = await categoryLeft(admin, draft.team_id, p.category_id!);
    await checkCashAlert(draft.team_id);
    if (draft.card_ts) {
      const amount =
        p.local_currency === "ZAR"
          ? money(p.zar_amount, "ZAR")
          : `${money(p.local_amount, p.local_currency)} (${money(p.zar_amount, "ZAR")})`;
      const text = `✅ *Logged by ${logger}* — ${p.vendor ?? "Receipt"} · ${p.expense_date} · ${amount} · ${left.category}`;
      const detail = `${left.category} now has *${left.left < 0 ? `over by R${fmtNum(-left.left)}` : `R${fmtNum(left.left)} left`}* of R${fmtNum(left.planned)} · receipt saved · <${SITE}/my-finance/outreach/${draft.team_id}|View in the Hub>`;
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
    await update(draft.channel_id, draft.card_ts, `Receipt cancelled by ${name}`, decidedBlocks(`🗑️ Receipt cancelled by ${name} — nothing was logged.`));
  }
}

/** ✏️ Change — open the form. Must run within 3s of the click (trigger_id). */
export async function openChangeForm(draftId: string, triggerId: string, slackUserId: string, reply: Reply): Promise<void> {
  const admin: Admin = createAdminClient();
  const draft = await getDraft(admin, draftId);
  if (!draft) return reply("I can't find that receipt any more.");
  if (draft.status !== "pending") return reply(ALREADY[draft.status] ?? "Already handled.");
  if (!(await clicker(admin, slackUserId, draft, reply))) return;
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
