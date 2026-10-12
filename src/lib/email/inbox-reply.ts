// FFSA Hub — Reply to an inbound email from the Hub Inbox (migration 229).
//
// The reply goes out:
//   From:      "<staff first name> · <team>" <identity.reply_from_email>
//              — the team's work address (e.g. camps@ffsouthafrica.com),
//              falling back to the identity's own ffsahub.com address.
//   Reply-To:  the identity's ffsahub.com address, so when she answers again
//              it lands back in the Hub Inbox and is forwarded to the team,
//              instead of leaving the record.
//   Threading: In-Reply-To / References point at her message, so mail apps
//              file the reply in the same conversation.
//
// It's written to look like a person typed it — plain text, no template
// chrome — because it is one.

import { getResend } from "@/lib/email/resend";
import { escapeHtml } from "@/lib/email/placeholders";
import { recordEmail, markSent, markFailed } from "@/lib/email/ledger";
import { replySender } from "@/lib/email/reply-sender";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any;

const DEFAULT_IDENTITY_SLUG = "default-marketing";

type IdentityRow = {
  id: string;
  from_email: string;
  from_name: string;
  display_name: string;
  reply_from_email: string | null;
};

export type InboxReplyResult =
  | { ok: true; replyId: string | null; from: string }
  | { ok: false; error: string; status: number };

function bracketed(id: string | null): string | null {
  if (!id) return null;
  const t = id.trim();
  return t.startsWith("<") ? t : `<${t}>`;
}

function paragraphs(text: string): string {
  return escapeHtml(text.trim())
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 12px;">${p.replace(/\n/g, "<br>")}</p>`)
    .join("");
}

/** Her message as plain text for quoting: the text part, else the HTML stripped. */
function originalText(text: string | null, html: string | null): string {
  if (text?.trim()) return text.trim();
  return (html ?? "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function loadReplyIdentity(
  admin: Admin,
  identityId: string | null
): Promise<IdentityRow | null> {
  const cols = "id, from_email, from_name, display_name, reply_from_email";
  if (identityId) {
    const { data } = await admin
      .from("sending_identities")
      .select(cols)
      .eq("id", identityId)
      .maybeSingle();
    if (data) return data as IdentityRow;
  }
  const { data } = await admin
    .from("sending_identities")
    .select(cols)
    .eq("slug", DEFAULT_IDENTITY_SLUG)
    .maybeSingle();
  return (data as IdentityRow) ?? null;
}

export async function sendInboxReply(
  admin: Admin,
  args: { inboundId: string; body: string; userId: string }
): Promise<InboxReplyResult> {
  const body = args.body.trim();
  if (!body) return { ok: false, error: "Write a reply first.", status: 400 };

  const { data: inbound } = await admin
    .from("inbound_emails")
    .select(
      "id, from_email, from_name, subject, text_body, html_body, message_id, received_at, identity_id, contact_id"
    )
    .eq("id", args.inboundId)
    .maybeSingle();
  if (!inbound) return { ok: false, error: "Reply not found.", status: 404 };

  const identity = await loadReplyIdentity(admin, inbound.identity_id);
  if (!identity) {
    return { ok: false, error: "No sending identity to reply from.", status: 400 };
  }

  const { data: staff } = await admin
    .from("users")
    .select("first_name, preferred_name")
    .eq("id", args.userId)
    .maybeSingle();
  const firstName = staff?.preferred_name?.trim() || staff?.first_name?.trim() || null;
  const sender = replySender(identity, firstName);

  const subject = /^re:/i.test(inbound.subject ?? "")
    ? inbound.subject
    : `Re: ${inbound.subject ?? ""}`.trim();

  const quotedFrom = inbound.from_name
    ? `${inbound.from_name} <${inbound.from_email}>`
    : inbound.from_email;
  const quotedWhen = new Date(inbound.received_at).toLocaleString("en-ZA", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Africa/Johannesburg",
  });
  const original = originalText(inbound.text_body, inbound.html_body);

  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#1f2937;">
${paragraphs(body)}
<div style="margin-top:20px;font-size:12px;color:#6b7280;">On ${escapeHtml(quotedWhen)}, ${escapeHtml(quotedFrom)} wrote:</div>
<blockquote style="margin:6px 0 0;padding-left:12px;border-left:2px solid #d1d5db;color:#4b5563;font-size:13px;">${paragraphs(original || "(no text)")}</blockquote>
</div>`;
  const text = `${body}\n\nOn ${quotedWhen}, ${quotedFrom} wrote:\n${original
    .split("\n")
    .map((l) => `> ${l}`)
    .join("\n")}`;

  const inReplyTo = bracketed(inbound.message_id);
  const ledgerId = await recordEmail(admin, {
    toEmail: inbound.from_email,
    provider: "resend",
    category: "inbox_reply",
    subject,
    contactId: inbound.contact_id,
    sourceType: "inbound_email",
    sourceId: inbound.id,
    reason: `Reply from ${identity.display_name} to her email "${inbound.subject ?? "(no subject)"}"`,
    fromIdentityId: identity.id,
  });

  let messageId: string | null = null;
  let sendError: string | null = null;
  try {
    const { data, error } = await getResend().emails.send({
      from: `${sender.name} <${sender.email}>`,
      to: [inbound.from_email],
      // Her next answer comes back into the Hub (and is forwarded to the team).
      replyTo: identity.from_email,
      subject,
      html,
      text,
      headers: inReplyTo ? { "In-Reply-To": inReplyTo, References: inReplyTo } : undefined,
      tags: [{ name: "category", value: "inbox_reply" }],
    });
    if (error) sendError = `${error.name}: ${error.message}`;
    else messageId = data?.id ?? null;
  } catch (e) {
    sendError = e instanceof Error ? e.message : "send failed";
  }

  if (sendError) {
    await markFailed(admin, ledgerId, sendError);
    // A From domain Resend hasn't verified is the likely cause — say so.
    const hint = /domain|verif|from/i.test(sendError)
      ? ` Check that ${sender.email.split("@")[1]} is verified in Resend.`
      : "";
    await admin.from("inbound_email_replies").insert({
      inbound_email_id: inbound.id,
      identity_id: identity.id,
      contact_id: inbound.contact_id,
      from_email: sender.email,
      from_name: sender.name,
      reply_to: identity.from_email,
      to_email: inbound.from_email,
      subject,
      body_text: body,
      status: "failed",
      error: sendError.slice(0, 500),
      sent_by: args.userId,
    });
    return { ok: false, error: `Couldn't send: ${sendError}.${hint}`, status: 502 };
  }

  await markSent(admin, ledgerId, messageId);
  const { data: reply } = await admin
    .from("inbound_email_replies")
    .insert({
      inbound_email_id: inbound.id,
      identity_id: identity.id,
      contact_id: inbound.contact_id,
      from_email: sender.email,
      from_name: sender.name,
      reply_to: identity.from_email,
      to_email: inbound.from_email,
      subject,
      body_text: body,
      provider_message_id: messageId,
      status: "sent",
      sent_by: args.userId,
    })
    .select("id")
    .single();

  // Answered = handled.
  await admin
    .from("inbound_emails")
    .update({
      status: "handled",
      handled_by: args.userId,
      handled_at: new Date().toISOString(),
    })
    .eq("id", inbound.id);

  if (inbound.contact_id) {
    await admin.from("activity_events").insert({
      contact_id: inbound.contact_id,
      event_type: "email_sent",
      occurred_at: new Date().toISOString(),
      payload: {
        source: "inbox_reply",
        subject,
        inbound_email_id: inbound.id,
        from: sender.email,
      },
    });
  }

  return { ok: true, replyId: reply?.id ?? null, from: sender.email };
}
