// FFSA Hub — Inbound replies (migration 228).
//
// Resend receives mail for ffsahub.com and posts an email.received webhook.
// The webhook carries only metadata, so this fetches the full email, then:
//
//   1. stores it in inbound_emails (deduped on Resend's id — webhooks retry),
//   2. routes it to the identity (team) it was addressed to, by matching the
//      To/Cc addresses against each identity's from_email and reply_to (an
//      identity sending From a staff domain keeps its ffsahub.com address as
//      Reply-To, and that's where the reply arrives),
//   3. links it to the contact by the sender's address and puts
//      "email_replied" on her timeline,
//   4. forwards it to the team's real inboxes (sending_identities.forward_to)
//      with Reply-To set to the sender — so when a staff member presses Reply
//      in Gmail, she gets a personal answer from a real person, not the Hub.
//
// Out-of-office and other auto-replies are stored and marked, but neither
// forwarded nor flagged as new: nobody needs 200 "I'm away" emails after a
// campaign.
//
// Everything here is best-effort and never throws into the webhook: a reply
// that fails to forward is still saved, with the error on the row, and shows
// in the Hub Inbox.

import { getResend } from "@/lib/email/resend";
import { escapeHtml } from "@/lib/email/placeholders";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any;

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://www.ffsahub.com";

/** Our own receiving domain. Mail is never forwarded back into it (loops). */
const OWN_DOMAIN = "ffsahub.com";

/** Fallback team for mail to an address no identity owns (e.g. hello@). */
const DEFAULT_IDENTITY_SLUG = "default-marketing";

/** Resend's send limit is 40MB per email; stay well clear after base64. */
const MAX_FORWARD_ATTACHMENT_BYTES = 25 * 1024 * 1024;

type Identity = {
  id: string;
  slug: string;
  from_email: string;
  reply_to: string | null;
  from_name: string;
  display_name: string;
  forward_to: string[] | null;
};

/** "Jane Doe <jane@x.com>" → { email: "jane@x.com", name: "Jane Doe" } */
export function parseAddress(raw: string): { email: string; name: string | null } {
  const m = raw.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) {
    return { email: m[2].trim().toLowerCase(), name: m[1].trim() || null };
  }
  return { email: raw.trim().toLowerCase(), name: null };
}

function header(headers: Record<string, string> | null, name: string): string | null {
  if (!headers) return null;
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase());
  return key ? String(headers[key]) : null;
}

/**
 * Is this an out-of-office / auto-responder rather than a person writing?
 * RFC 3834 Auto-Submitted is the standard signal; the rest are the common
 * non-standard ones Outlook, Gmail and help desks still send.
 */
export function isAutoReply(
  headers: Record<string, string> | null,
  subject: string | null
): boolean {
  const autoSubmitted = header(headers, "auto-submitted");
  if (autoSubmitted && autoSubmitted.toLowerCase() !== "no") return true;
  if (header(headers, "x-autoreply") || header(headers, "x-autorespond")) return true;
  if (header(headers, "x-auto-response-suppress")?.toLowerCase().includes("all")) {
    // Outlook marks its own auto-replies this way.
    if (/^(automatic reply|auto(matic)?[- ]?reply|out of (the )?office)/i.test(subject ?? "")) {
      return true;
    }
  }
  const precedence = header(headers, "precedence")?.toLowerCase();
  if (precedence === "auto_reply" || precedence === "junk") return true;
  return /^(automatic reply|auto[- ]?reply|out of (the )?office|autoreply)\b/i.test(
    (subject ?? "").trim()
  );
}

function domainOf(email: string): string {
  return email.slice(email.lastIndexOf("@") + 1).toLowerCase();
}

async function findContactId(admin: Admin, email: string): Promise<string | null> {
  // Any address a contact holds, not just the primary one.
  const { data: viaEmails } = await admin
    .from("contact_emails")
    .select("contact_id")
    .eq("email_normalized", email)
    .limit(1);
  if (viaEmails?.[0]?.contact_id) return viaEmails[0].contact_id;
  const { data: direct } = await admin
    .from("contacts")
    .select("id")
    .eq("email_normalized", email)
    .limit(1);
  return direct?.[0]?.id ?? null;
}

/**
 * Handle one email.received webhook. Returns a short status for the webhook
 * response; never throws.
 */
export async function handleInboundEmail(
  admin: Admin,
  resendEmailId: string
): Promise<{ ok: boolean; status: string }> {
  try {
    // Webhook retries: if we've stored it, we're done.
    const { data: existing } = await admin
      .from("inbound_emails")
      .select("id")
      .eq("resend_email_id", resendEmailId)
      .maybeSingle();
    if (existing) return { ok: true, status: "duplicate" };

    const { data: email, error } = await getResend().emails.receiving.get(resendEmailId);
    if (error || !email) {
      // Let Resend retry: a 5xx response makes it try the webhook again.
      return { ok: false, status: `fetch failed: ${error?.message ?? "no data"}` };
    }

    const sender = parseAddress(email.from);
    const toList = (email.to ?? []).map((a) => parseAddress(a).email);
    const ccList = (email.cc ?? []).map((a) => parseAddress(a).email);
    const autoReply = isAutoReply(email.headers, email.subject);

    // Route to the team whose address it was sent to. Two identities may
    // share an address (events@ is used by two brands); the first one wins
    // as the owner, and every matching identity's forward list is used.
    const { data: identityRows } = await admin
      .from("sending_identities")
      .select("id, slug, from_email, reply_to, from_name, display_name, forward_to")
      .eq("is_active", true);
    const identities = (identityRows ?? []) as Identity[];
    const addressed = new Set([...toList, ...ccList]);
    const matched = identities.filter(
      (i) =>
        addressed.has(i.from_email.toLowerCase()) ||
        (!!i.reply_to && addressed.has(i.reply_to.trim().toLowerCase()))
    );
    const fallback = identities.find((i) => i.slug === DEFAULT_IDENTITY_SLUG) ?? null;
    const owner = matched[0] ?? null;
    const routing = matched.length > 0 ? matched : fallback ? [fallback] : [];

    const contactId = await findContactId(admin, sender.email);

    const attachments = (email.attachments ?? []).map((a) => ({
      id: a.id,
      filename: a.filename,
      size: a.size,
      content_type: a.content_type,
    }));

    const { data: row, error: insertErr } = await admin
      .from("inbound_emails")
      .insert({
        resend_email_id: resendEmailId,
        message_id: email.message_id ?? null,
        in_reply_to: header(email.headers, "in-reply-to"),
        from_email: sender.email,
        from_name: sender.name,
        to_emails: toList,
        cc_emails: ccList,
        subject: email.subject ?? null,
        text_body: email.text ?? null,
        html_body: email.html ?? null,
        attachments,
        received_at: email.created_at ?? new Date().toISOString(),
        identity_id: owner?.id ?? null,
        contact_id: contactId,
        is_auto_reply: autoReply,
        // An auto-reply needs no one's attention.
        status: autoReply ? "archived" : "new",
      })
      .select("id")
      .single();
    if (insertErr || !row) {
      // Unique violation = a concurrent retry stored it first.
      if (insertErr?.code === "23505") return { ok: true, status: "duplicate" };
      return { ok: false, status: `store failed: ${insertErr?.message ?? "unknown"}` };
    }

    if (contactId && !autoReply) {
      await admin.from("activity_events").insert({
        contact_id: contactId,
        event_type: "email_replied",
        occurred_at: email.created_at ?? new Date().toISOString(),
        payload: {
          inbound_email_id: row.id,
          subject: email.subject ?? null,
          to: owner?.display_name ?? toList[0] ?? null,
        },
      });
    }

    if (autoReply) return { ok: true, status: "stored (auto-reply)" };

    // Forward to the team. Never back into our own domain (it would arrive
    // here again and loop), and not to the person who wrote it — a staff
    // member who CCs the team address on her own reply shouldn't get it back.
    const recipients = Array.from(
      new Set(routing.flatMap((i) => i.forward_to ?? []).map((a) => a.trim().toLowerCase()))
    ).filter((a) => a.includes("@") && domainOf(a) !== OWN_DOMAIN && a !== sender.email);

    if (recipients.length === 0) return { ok: true, status: "stored (no forward list)" };
    if (domainOf(sender.email) === OWN_DOMAIN) {
      return { ok: true, status: "stored (own domain, not forwarded)" };
    }

    const via = owner ?? fallback;
    const fwd = await forwardToTeam({
      resendEmailId,
      inboundId: row.id,
      sender,
      subject: email.subject ?? "(no subject)",
      html: email.html,
      text: email.text,
      toAddress: toList[0] ?? null,
      teamName: via?.display_name ?? "FFSA Hub",
      fromEmail: via?.from_email ?? `hello@${OWN_DOMAIN}`,
      recipients,
      contactId,
      hasAttachments: attachments.length > 0,
    });

    await admin
      .from("inbound_emails")
      .update(
        fwd.error
          ? { forward_error: fwd.error.slice(0, 500) }
          : {
              forwarded_to: recipients,
              forwarded_at: new Date().toISOString(),
              forward_error: fwd.note,
            }
      )
      .eq("id", row.id);

    return { ok: true, status: fwd.error ? "stored (forward failed)" : "stored + forwarded" };
  } catch (e) {
    console.error("[inbound] handleInboundEmail threw:", e);
    return { ok: false, status: e instanceof Error ? e.message : "inbound failed" };
  }
}

async function loadAttachments(
  resendEmailId: string
): Promise<{ files: { filename: string; content: Buffer; contentType: string }[]; skipped: string[] }> {
  const files: { filename: string; content: Buffer; contentType: string }[] = [];
  const skipped: string[] = [];
  const { data } = await getResend().emails.receiving.attachments.list({
    emailId: resendEmailId,
  });
  let total = 0;
  for (const a of data?.data ?? []) {
    const name = a.filename ?? "attachment";
    if (total + a.size > MAX_FORWARD_ATTACHMENT_BYTES) {
      skipped.push(name);
      continue;
    }
    try {
      const res = await fetch(a.download_url);
      if (!res.ok) {
        skipped.push(name);
        continue;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      total += buf.length;
      files.push({ filename: name, content: buf, contentType: a.content_type });
    } catch {
      skipped.push(name);
    }
  }
  return { files, skipped };
}

async function forwardToTeam(args: {
  resendEmailId: string;
  inboundId: string;
  sender: { email: string; name: string | null };
  subject: string;
  html: string | null;
  text: string | null;
  toAddress: string | null;
  teamName: string;
  fromEmail: string;
  recipients: string[];
  contactId: string | null;
  hasAttachments: boolean;
}): Promise<{ error: string | null; note: string | null }> {
  const who = args.sender.name
    ? `${args.sender.name} <${args.sender.email}>`
    : args.sender.email;
  const inboxUrl = `${APP_URL}/communications/inbox?open=${args.inboundId}`;
  const contactUrl = args.contactId ? `${APP_URL}/contacts/${args.contactId}` : null;

  const { files, skipped } = args.hasAttachments
    ? await loadAttachments(args.resendEmailId).catch(() => ({ files: [], skipped: ["(attachments)"] }))
    : { files: [], skipped: [] };
  const skippedNote = skipped.length
    ? `Not attached (too large or unavailable — open it in the Hub): ${skipped.join(", ")}`
    : null;

  const banner = `<div style="font-family:Arial,sans-serif;font-size:13px;line-height:1.5;color:#475569;background:#f4f2ea;border:1px solid #dedace;padding:12px 14px;margin:0 0 16px 0;">
<strong style="color:#0f172a;">${escapeHtml(who)}</strong> replied to <strong style="color:#0f172a;">${escapeHtml(args.teamName)}</strong>${args.toAddress ? ` (${escapeHtml(args.toAddress)})` : ""}.<br>
Press <strong>Reply</strong> to answer them directly from your inbox.<br>
<a href="${inboxUrl}" style="color:#0f172a;">Open in the Hub</a>${contactUrl ? ` &middot; <a href="${contactUrl}" style="color:#0f172a;">View contact</a>` : ""}${skippedNote ? `<br><em>${escapeHtml(skippedNote)}</em>` : ""}
</div>`;

  const bodyHtml =
    args.html ??
    `<pre style="font-family:inherit;white-space:pre-wrap;">${escapeHtml(args.text ?? "")}</pre>`;

  const text = [
    `${who} replied to ${args.teamName}${args.toAddress ? ` (${args.toAddress})` : ""}.`,
    `Press Reply to answer them directly. Open in the Hub: ${inboxUrl}`,
    skippedNote ?? "",
    "",
    "———",
    "",
    args.text ?? "",
  ].join("\n");

  // From: our verified address (Resend only sends from verified domains),
  // displayed as the person who wrote. Reply-To: that person — so Reply in
  // Gmail goes straight back to her, from the staff member's own address.
  const displayName = `${args.sender.name ?? args.sender.email} via ${args.teamName}`.replace(
    /[<>"]/g,
    ""
  );

  try {
    const { error } = await getResend().emails.send({
      from: `${displayName} <${args.fromEmail}>`,
      to: args.recipients,
      replyTo: args.sender.email,
      subject: args.subject,
      html: banner + bodyHtml,
      text,
      headers: { "X-FFSA-Inbound-Id": args.inboundId },
      tags: [{ name: "category", value: "inbound_forward" }],
      ...(files.length > 0
        ? {
            attachments: files.map((f) => ({
              filename: f.filename,
              content: f.content,
              contentType: f.contentType,
            })),
          }
        : {}),
    });
    if (error) return { error: `Resend ${error.name}: ${error.message}`, note: null };
    return { error: null, note: skippedNote };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "forward failed", note: null };
  }
}
