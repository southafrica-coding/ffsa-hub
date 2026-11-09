import type { Metadata } from "next";

// The link preview says what this link IS. It deliberately names no
// person: a preview card renders in whatever chat the link was pasted
// into, so pulling the applicant's or recipient's name in here would
// leak them to everyone in the room.
export const metadata: Metadata = {
  title: "Your application status",
  description: "Check where your Fire & Fragrance South Africa application has got to.",
  openGraph: {
    title: "Your application status",
    description: "Check where your Fire & Fragrance South Africa application has got to.",
    type: "website",
  },
  // Personal link — never index it.
  robots: { index: false, follow: false },
};

import { createAdminClient } from "@/lib/supabase/admin";
import { notFound } from "next/navigation";
import {
  PublicFormShell,
  PUBLIC_SHELL_TOKENS,
} from "@/components/public-form-shell";
import { ReferenceEditor, type EditableReference } from "./reference-editor";
import { ReferenceStatusBanner } from "./reference-status-banner";
import { annotateReferenceDelivery } from "@/lib/references/reference-delivery";

const T = PUBLIC_SHELL_TOKENS;

// Once a decision has been made — or an interview is booked — the file has
// clearly moved past its references, so the completeness banner would only
// confuse. The terminal statusMessages box speaks for these instead.
/**
 * hsl() colours can't take the `#RRGGBBAA` alpha suffix — appending "1a" to one
 * yields invalid CSS, which is why the decision boxes below were rendering with
 * no background or border. Inject the alpha into the colour instead.
 */
function withAlpha(color: string, alpha: number): string {
  return color.replace(/\)$/, ` / ${alpha})`);
}

const SUPPRESS_REFERENCE_BANNER = new Set([
  "interview_scheduled",
  "accepted",
  "rejected",
  "waitlisted",
  "cancelled",
]);

const STATUS_STEPS = [
  { key: "submitted", label: "Submitted" },
  { key: "references_received", label: "References" },
  { key: "interview_scheduled", label: "Interview" },
  { key: "decision", label: "Decision" },
];

const STATUS_ORDER: Record<string, number> = {
  submitted: 0,
  waiting_for_references: 1,
  references_received: 1,
  interview_scheduled: 2,
  accepted: 3,
  rejected: 3,
  waitlisted: 3,
  cancelled: 3,
};

function StatusBadge({ status }: { status: string }) {
  // Palette tuned for the dark shell.
  const palettes: Record<string, { bg: string; fg: string; border: string }> = {
    submitted: { bg: "hsl(42 80% 14%)", fg: "hsl(42 95% 65%)", border: "hsl(42 80% 30%)" },
    waiting_for_references: { bg: "hsl(42 80% 14%)", fg: "hsl(42 95% 65%)", border: "hsl(42 80% 30%)" },
    references_received: { bg: "hsl(210 60% 14%)", fg: "hsl(210 80% 70%)", border: "hsl(210 60% 30%)" },
    interview_scheduled: { bg: "hsl(280 50% 14%)", fg: "hsl(280 80% 75%)", border: "hsl(280 50% 30%)" },
    accepted: { bg: "hsl(142 40% 14%)", fg: "hsl(142 60% 65%)", border: "hsl(142 40% 30%)" },
    rejected: { bg: "hsl(0 50% 14%)", fg: "hsl(0 75% 70%)", border: "hsl(0 50% 30%)" },
    waitlisted: { bg: "hsl(28 60% 14%)", fg: "hsl(28 95% 70%)", border: "hsl(28 60% 30%)" },
    cancelled: { bg: "hsl(215 15% 16%)", fg: "hsl(215 15% 70%)", border: "hsl(215 15% 32%)" },
  };
  const p = palettes[status] ?? palettes.submitted;
  return (
    <span
      style={{
        display: "inline-block",
        padding: "5px 12px",
        fontSize: 11,
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: "0.1em",
        borderRadius: 999,
        border: `1px solid ${p.border}`,
        background: p.bg,
        color: p.fg,
      }}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}

export default async function ApplicationStatusPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const supabase = createAdminClient();

  const { data: response } = await supabase
    .from("application_responses")
    .select(
      "id, program_id, status, submitted_at, applicant_info, applicant_email, programs(name)"
    )
    .eq("status_token", token)
    .single();

  if (!response) {
    notFound();
  }

  type RawRef = {
    id: string;
    slot_id: string;
    status: string;
    referee_name: string | null;
    referee_email: string | null;
    email_sent_at: string | null;
    reference_slots: { label: string } | null;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: refData } = await (supabase as any)
    .from("reference_requests")
    .select("id, slot_id, status, referee_name, referee_email, email_sent_at, reference_slots(label)")
    .eq("application_id", response.id);
  const refs = (refData ?? []) as RawRef[];

  const deliveryRows = refs.map((r) => ({
    id: r.id,
    status: r.status,
    referee_email: r.referee_email ?? "",
    email_sent_at: r.email_sent_at ?? null,
    application_id: response.id,
    slot_label: r.reference_slots?.label ?? "Reference",
    referee_name: r.referee_name ?? "",
  }));

  // Slots and delivery state don't depend on each other.
  const [{ data: slotData }, annotatedRefs] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any)
      .from("reference_slots")
      .select("id, label, is_required, sort_order")
      .eq("program_id", response.program_id)
      .order("sort_order", { ascending: true }),
    annotateReferenceDelivery(supabase, response.id, deliveryRows),
  ]);
  const slots = (slotData ?? []) as Array<{
    id: string;
    label: string;
    is_required: boolean;
  }>;

  const totalRefs = refs.length;
  const submittedRefs = refs.filter((r) => r.status === "submitted").length;

  const filledSlotIds = new Set(refs.map((r) => r.slot_id));
  const missingRequiredSlots: { id: string; label: string }[] = slots
    .filter((s) => s.is_required && !filledSlotIds.has(s.id))
    .map((s) => ({ id: s.id, label: s.label }));
  const editableRefs: EditableReference[] = annotatedRefs.map((r) => ({
    id: r.id,
    status: r.status,
    referee_name: r.referee_name,
    referee_email: r.referee_email,
    slot_label: r.slot_label,
    email_problem: r.email_problem,
  }));

  // Nothing advances `status` when references arrive (staff set it by hand), so
  // light up the References step as soon as they're actually all in.
  const allReferencesIn = totalRefs > 0 && submittedRefs === totalRefs;
  const currentStep = Math.max(
    STATUS_ORDER[response.status] ?? 0,
    allReferencesIn ? 1 : 0
  );
  const programName =
    (response.programs as { name: string } | null)?.name ?? "Program";
  const firstName =
    (response.applicant_info as Record<string, string> | null)?.first_name ??
    "Applicant";

  const statusMessages: Record<string, { tone: "green" | "red" | "orange" | "purple" | "grey"; title: string; body: string }> = {
    accepted: {
      tone: "green",
      title: "Congratulations! Your application has been accepted.",
      body: "Check your email for next steps and account setup instructions.",
    },
    rejected: {
      tone: "red",
      title: "We appreciate your interest, but we are unable to offer a place at this time.",
      body: "We wish you all the best in your future endeavours.",
    },
    waitlisted: {
      tone: "orange",
      title: "You are on the waitlist for this program.",
      body: "We'll contact you if a spot becomes available.",
    },
    interview_scheduled: {
      tone: "purple",
      title: "Your interview has been scheduled!",
      body: "Check your email for details about your upcoming interview.",
    },
    cancelled: {
      tone: "grey",
      title: "This application has been cancelled.",
      body: "If you believe this is a mistake, please contact us.",
    },
  };
  const msg = statusMessages[response.status];
  const toneColor: Record<string, string> = {
    green: "hsl(142 60% 60%)",
    red: "hsl(0 75% 70%)",
    orange: "hsl(28 95% 65%)",
    purple: "hsl(280 80% 75%)",
    grey: "hsl(215 15% 70%)",
  };

  return (
    <PublicFormShell
      eyebrow="Application Status"
      heading={`Hi ${firstName}`}
      subheading={`Your application to ${programName}`}
      maxWidth={520}
    >
      <div className="flex justify-center mb-6">
        <StatusBadge status={response.status} />
      </div>

      {!SUPPRESS_REFERENCE_BANNER.has(response.status) && (
        <ReferenceStatusBanner
          total={totalRefs}
          submitted={submittedRefs}
          missingLabels={missingRequiredSlots.map((s) => s.label)}
        />
      )}

      {/* Progress steps */}
      <div className="mb-6">
        <div className="flex items-start justify-between px-2">
          {STATUS_STEPS.map((step, idx) => {
            const isActive = idx <= currentStep;
            const isCurrent = idx === currentStep;
            return (
              <div
                key={step.key}
                style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}
              >
                <div
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 999,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 12,
                    fontWeight: 700,
                    border: `2px solid ${isActive ? T.yellow : T.border}`,
                    background: isCurrent
                      ? `${T.yellow}33`
                      : isActive
                      ? T.yellow
                      : "transparent",
                    color: isCurrent
                      ? T.yellow
                      : isActive
                      ? T.bg
                      : T.textFaint,
                    transition: "all .15s ease",
                  }}
                >
                  {isActive && idx < currentStep ? "✓" : idx + 1}
                </div>
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: "0.1em",
                    textTransform: "uppercase",
                    color: isActive ? T.yellow : T.textFaint,
                  }}
                >
                  {step.label}
                </span>
              </div>
            );
          })}
        </div>
        <div
          style={{
            margin: "8px 24px 0",
            height: 4,
            borderRadius: 999,
            background: T.border,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              height: "100%",
              width: `${(currentStep / (STATUS_STEPS.length - 1)) * 100}%`,
              background: T.yellow,
              transition: "width .3s ease",
            }}
          />
        </div>
      </div>

      <div className="space-y-1 mb-4">
        <div
          className="flex justify-between items-center py-2.5"
          style={{ borderBottom: `1px solid ${T.border}`, fontSize: 14 }}
        >
          <span style={{ color: T.textDim }}>Submitted</span>
          <span style={{ color: T.text }}>
            {new Date(response.submitted_at).toLocaleDateString("en-ZA", {
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
          </span>
        </div>
        {totalRefs > 0 && (
          <div
            className="flex justify-between items-center py-2.5"
            style={{ borderBottom: `1px solid ${T.border}`, fontSize: 14 }}
          >
            <span style={{ color: T.textDim }}>References</span>
            <span
              style={{
                color:
                  submittedRefs === totalRefs
                    ? T.green
                    : "hsl(42 95% 65%)",
              }}
            >
              {submittedRefs} of {totalRefs} received
            </span>
          </div>
        )}
      </div>

      {(totalRefs > 0 || missingRequiredSlots.length > 0) && (
        <ReferenceEditor
          statusToken={token}
          references={editableRefs}
          missingSlots={missingRequiredSlots}
        />
      )}

      {msg && (
        <div
          className="rounded-lg p-4 text-center"
          style={{
            background: withAlpha(toneColor[msg.tone], 0.1),
            border: `1px solid ${withAlpha(toneColor[msg.tone], 0.28)}`,
          }}
        >
          <p
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: toneColor[msg.tone],
            }}
          >
            {msg.title}
          </p>
          <p style={{ fontSize: 12, color: T.textDim, marginTop: 4 }}>
            {msg.body}
          </p>
        </div>
      )}
    </PublicFormShell>
  );
}
