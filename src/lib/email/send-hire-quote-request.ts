// Tells the rental managers that someone filled in the event helper and
// needs a quote. Best-effort fan-out: one failed address must not stop the
// others, and no mail failure may fail the request.

import { ffEmailShell, ffEsc, ffEyebrow, ffHeading, ffList, ffParagraph } from "./ff-email-shell";
import { sendTransactional } from "./send-transactional";
import { createAdminClient } from "@/lib/supabase/admin";
import type { HelperSummary } from "@/lib/equipment/helper";
import { getEquipmentManagerEmails } from "@/services/equipment-helper";

export async function notifyHireQuoteRequest(opts: {
  orderId: string;
  orderNumber: string;
  customerName: string;
  customerEmail: string;
  whenLabel: string;
  summary: HelperSummary;
  /** "helper": answered the questions. "picked": chose the gear themselves. */
  source?: "helper" | "picked";
}) {
  const picked = opts.source === "picked";
  try {
    const admin = createAdminClient();
    const recipients = await getEquipmentManagerEmails(admin);
    if (recipients.length === 0) {
      console.warn("[hire-helper] request saved but nobody holds equipment.manage to hear about it");
      return;
    }

    const { flags, counts, sections } = opts.summary;
    const html = ffEmailShell({
      previewText: `${opts.customerName} needs gear for ${opts.whenLabel}`,
      content: [
        ffEyebrow(`Equipment hire · ${opts.orderNumber}`),
        ffHeading(picked ? "A customer picked some gear" : "A customer needs a quote"),
        ffParagraph(
          picked
            ? `${ffEsc(opts.customerName)} chose gear from the store for <strong>${ffEsc(opts.whenLabel)}</strong>. It was free when they sent it, but a quote holds nothing, so confirm it soon and reply to them directly.`
            : `${ffEsc(opts.customerName)} filled in the event helper for <strong>${ffEsc(opts.whenLabel)}</strong>. Work out the gear from their answers and reply to them directly.`
        ),
        ...(flags.length > 0 ? [ffParagraph("<strong>Look at first</strong>"), ffList(flags)] : []),
        ...(counts.length > 0
          ? [ffParagraph(`<strong>${picked ? "Totals" : "From their answers"}</strong>`), ffList(counts)]
          : []),
        ...sections.flatMap((s) => [
          ffParagraph(`<strong>${ffEsc(s.title)}</strong>`),
          ffList(s.rows.map(([k, v]) => `${k}: ${v}`)),
        ]),
      ].join(""),
    });

    await Promise.all(
      recipients.map((to) =>
        sendTransactional({
          to,
          subject: `${picked ? "Gear request" : "Quote needed"}: ${opts.customerName}, ${opts.whenLabel}`,
          html,
          replyTo: opts.customerEmail,
          category: "hire_quote_request",
          sourceType: "equipment_order",
          sourceId: opts.orderId,
          reason: "They manage equipment hire",
        }).catch(() => null)
      )
    );
  } catch {
    console.error("[hire-helper] quote notification failed");
  }
}
