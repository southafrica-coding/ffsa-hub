/**
 * Channel dispatch for event ticketing-analytics digests.
 *
 * Shared by the in-app "Send test now" route and the /api/cron/event-reports
 * dispatcher so both render and deliver identically. Each channel resolves to
 * an independent outcome; a disabled or unconfigured channel is "skipped"
 * (never an error), so a WhatsApp channel awaiting Twilio/Meta approval never
 * fails an otherwise-successful email digest.
 */

import { Resend } from "resend";
import type { EventTicketReport } from "./event-ticket-report";
import { renderEventReportEmail } from "./render-email";
import { renderEventReportWhatsApp } from "./render-whatsapp";
import { sendWhatsApp } from "@/lib/whatsapp/client";

export type ChannelStatus = "sent" | "skipped" | "error";
export type ChannelOutcome = { status: ChannelStatus; detail?: string };
export type OverallStatus = "sent" | "partial" | "failed" | "skipped";

export type SubscriptionChannels = {
  email_enabled: boolean;
  whatsapp_enabled: boolean;
  dest_email: string | null;
  dest_whatsapp: string | null;
};

export async function sendEventReport(
  report: EventTicketReport,
  sub: SubscriptionChannels
): Promise<{ email: ChannelOutcome; whatsapp: ChannelOutcome }> {
  const [email, whatsapp] = await Promise.all([
    sendEmailChannel(report, sub),
    sendWhatsAppChannel(report, sub),
  ]);
  return { email, whatsapp };
}

/** Roll the two channel outcomes up into a single row status. */
export function overallStatus(o: {
  email: ChannelOutcome;
  whatsapp: ChannelOutcome;
}): OverallStatus {
  const outs = [o.email, o.whatsapp];
  const attempted = outs.filter((x) => x.status !== "skipped");
  if (attempted.length === 0) return "skipped";
  const sent = attempted.filter((x) => x.status === "sent").length;
  const errored = attempted.filter((x) => x.status === "error").length;
  if (errored === 0) return "sent";
  if (sent > 0) return "partial";
  return "failed";
}

async function sendEmailChannel(
  report: EventTicketReport,
  sub: SubscriptionChannels
): Promise<ChannelOutcome> {
  if (!sub.email_enabled) return { status: "skipped", detail: "disabled" };
  if (!sub.dest_email) return { status: "skipped", detail: "no email address" };
  if (!process.env.RESEND_API_KEY) {
    return { status: "skipped", detail: "RESEND_API_KEY not set" };
  }
  try {
    const { subject, html } = renderEventReportEmail(report);
    const resend = new Resend(process.env.RESEND_API_KEY);
    const fromEmail = process.env.RESEND_FROM_EMAIL || "noreply@ffsahub.com";
    const { error } = await resend.emails.send({
      from: `Fire & Fragrance SA <${fromEmail}>`,
      to: sub.dest_email,
      subject,
      html,
    });
    if (error) return { status: "error", detail: error.message };
    return { status: "sent" };
  } catch (err) {
    return {
      status: "error",
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

async function sendWhatsAppChannel(
  report: EventTicketReport,
  sub: SubscriptionChannels
): Promise<ChannelOutcome> {
  if (!sub.whatsapp_enabled) return { status: "skipped", detail: "disabled" };
  if (!sub.dest_whatsapp) {
    return { status: "skipped", detail: "no WhatsApp number" };
  }
  const { contentVariables, fallbackText } = renderEventReportWhatsApp(report);
  const res = await sendWhatsApp({
    to: sub.dest_whatsapp,
    contentSid: process.env.TWILIO_WA_REPORT_CONTENT_SID,
    contentVariables,
    body: fallbackText,
  });
  if (res.ok) return { status: "sent" };
  if (res.skipped) return { status: "skipped", detail: res.reason };
  return { status: "error", detail: res.error };
}
