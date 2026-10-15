"use client";

import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Loader2, Check } from "lucide-react";
import {
  oneMonthBefore,
  formatInviteDate,
} from "@/lib/schools/setup-invite-schedule";
import {
  PROGRAM_EMAIL_TYPES,
  type ProgramEmailType,
} from "@/lib/email/program-email-types";
import { EmailDocuments, EmailDocumentsProvider } from "./email-documents";

type TemplateRow = {
  email_type: string;
  enabled: boolean;
  subject: string | null;
  body: string | null;
  reminder_after_days: number | null;
};

export function EmailsTab({
  programId,
  templates,
  acceptanceSubject,
  acceptanceBody,
  setupInviteDate,
  schoolStartDate,
}: {
  programId: string;
  templates: TemplateRow[];
  /** programs.setup_invite_date — null means "a month before the start". */
  setupInviteDate: string | null;
  /** Earliest course start, which the default is counted back from. */
  schoolStartDate: string | null;
  /** Acceptance wording. Stored on `programs`, not `program_email_templates` —
   *  see <AcceptanceEmailEditor> for why it is special-cased rather than moved. */
  acceptanceSubject: string | null;
  acceptanceBody: string | null;
}) {
  const byType = new Map(templates.map((t) => [t.email_type, t]));

  return (
    <EmailDocumentsProvider programId={programId}>
    <div className="space-y-5">
      <div className="border bg-muted/30 px-4 py-3">
        <p className="text-sm text-muted-foreground">
          Control the emails sent to applicants during this school&apos;s
          process. Each field below shows the <strong>wording that&apos;s
          sent today</strong> — edit it to make it your own, or clear a field
          to fall back to the FFSA default. Your text is automatically wrapped
          in FFSA branding, and any required buttons (status link, reference
          link) are always included. Documents you add to an email are
          attached every time it goes out for this school.
        </p>
      </div>

      {PROGRAM_EMAIL_TYPES.map((type) => (
        <Fragment key={type.key}>
          {/* Accepted sits with the other two decision outcomes, so the three
              things you can tell an applicant read together. */}
          {type.key === "application_rejected" && (
            <>
              <AcceptanceEmailEditor
                programId={programId}
                initialSubject={acceptanceSubject}
                initialBody={acceptanceBody}
              />
              <SetupInviteDateEditor
                programId={programId}
                initialDate={setupInviteDate}
                schoolStartDate={schoolStartDate}
              />
            </>
          )}
          <EmailTypeEditor
            programId={programId}
            type={type}
            initial={byType.get(type.key)}
          />
        </Fragment>
      ))}
    </div>
    </EmailDocumentsProvider>
  );
}

function EmailTypeEditor({
  programId,
  type,
  initial,
}: {
  programId: string;
  type: ProgramEmailType;
  initial?: TemplateRow;
}) {
  const router = useRouter();
  // Fields start on the current wording: a saved override if there is one,
  // otherwise the built-in FFSA default so the leader sees exactly what's
  // sent today and edits from there.
  const baseSubject = initial?.subject ?? type.defaultSubject;
  const baseBody = initial?.body ?? type.defaultBody;

  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [subject, setSubject] = useState(baseSubject);
  const [body, setBody] = useState(baseBody);
  const [reminderDays, setReminderDays] = useState(
    initial?.reminder_after_days != null ? String(initial.reminder_after_days) : ""
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const initialReminder =
    initial?.reminder_after_days != null
      ? String(initial.reminder_after_days)
      : "";
  const dirty =
    enabled !== (initial?.enabled ?? true) ||
    subject !== baseSubject ||
    body !== baseBody ||
    reminderDays !== initialReminder;

  async function save() {
    setSaving(true);
    setError(null);
    // Text left exactly on the FFSA default is stored as "no override" so
    // the polished default template keeps sending — only genuine edits
    // become a custom template.
    const res = await fetch(
      `/api/schools/programs/${programId}/email-templates`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          emailType: type.key,
          enabled,
          subject: subject === type.defaultSubject ? "" : subject,
          body: body === type.defaultBody ? "" : body,
          reminderAfterDays: reminderDays.trim()
            ? Number(reminderDays)
            : null,
        }),
      }
    );
    setSaving(false);
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setError(data.error ?? "Could not save");
      return;
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
    router.refresh();
  }

  return (
    <Card className={enabled ? "" : "opacity-70"}>
      <CardHeader className="flex flex-row items-start justify-between space-y-0 gap-3">
        <div>
          <CardTitle className="text-base flex items-center gap-2">
            {type.label}
            <Badge variant="outline" className="font-normal capitalize">
              to {type.audience}
            </Badge>
          </CardTitle>
          <p className="text-sm text-muted-foreground mt-1">
            {type.description}
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm shrink-0 cursor-pointer select-none">
          <input
            type="checkbox"
            className="h-4 w-4 accent-current"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          Send this email
        </label>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">
            Subject
          </label>
          <Input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Cleared — the FFSA default subject will be used"
            disabled={!enabled}
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">
            Message
          </label>
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Cleared — the FFSA default message will be used. Type here to write your own; plain text, one idea per paragraph."
            rows={5}
            disabled={!enabled}
          />
          <p className="text-xs text-muted-foreground">
            Merge fields:{" "}
            {type.mergeFields.map((f) => (
              <code
                key={f}
                className="mx-0.5 bg-muted px-1 py-0.5 text-[11px]"
              >
                {f}
              </code>
            ))}
          </p>
        </div>
        {type.autoReminder && (
          <div className="border bg-muted/30 px-3 py-2.5 space-y-1.5">
            <label className="text-xs font-medium">Automatic reminder</label>
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Auto-send after</span>
              <Input
                type="number"
                min={1}
                max={90}
                value={reminderDays}
                onChange={(e) => setReminderDays(e.target.value)}
                placeholder="—"
                className="w-20"
                disabled={!enabled}
              />
              <span className="text-muted-foreground">
                days from when {type.autoReminder.trigger}.
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              Leave blank to only send this reminder manually. It never sends
              once the reference is in.
            </p>
          </div>
        )}
        <EmailDocuments emailType={type.key} disabled={!enabled} />

        <div className="flex items-center gap-3">
          <Button type="button" onClick={save} disabled={!dirty || saving} size="sm">
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 mr-1 animate-spin" /> Saving…
              </>
            ) : saved ? (
              <>
                <Check className="h-4 w-4 mr-1" /> Saved
              </>
            ) : (
              "Save"
            )}
          </Button>
          {error && <span className="text-xs text-destructive">{error}</span>}
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * The acceptance email — the one that tells someone they're in.
 *
 * It is special-cased rather than listed with the rest because it is stored
 * differently: `programs.acceptance_email_subject` / `_body`, not the
 * `program_email_templates` table the other six use. It predates that table
 * and was never migrated across, which is exactly why it used to be invisible
 * here and edited under the Application tab instead.
 *
 * This editor changes NOTHING about the email — same two columns, same save
 * endpoint, same "blank means the FFSA default" behaviour, same merge fields.
 * It only puts the controls where the other emails already are. Note there is
 * deliberately no "Send this email" toggle: acceptance always sends when you
 * accept someone, and offering an off switch here would be a behaviour change,
 * not a relocation.
 */
function AcceptanceEmailEditor({
  programId,
  initialSubject,
  initialBody,
}: {
  programId: string;
  initialSubject: string | null;
  initialBody: string | null;
}) {
  const router = useRouter();
  const [subject, setSubject] = useState(initialSubject ?? "");
  const [body, setBody] = useState(initialBody ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = subject !== (initialSubject ?? "") || body !== (initialBody ?? "");

  async function save() {
    setSaving(true);
    setError(null);
    // Identical to what the Application tab sent: empty becomes null, and null
    // is what makes the send path fall back to the FFSA default.
    const res = await fetch("/api/schools/programs", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: programId,
        acceptance_email_subject: subject.trim() || null,
        acceptance_email_body: body.trim() || null,
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setError(data.error ?? "Could not save");
      return;
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
    router.refresh();
  }

  return (
    <Card>
      <CardHeader className="space-y-0">
        <CardTitle className="text-base flex items-center gap-2">
          Accepted
          <Badge variant="outline" className="font-normal capitalize">
            to applicant
          </Badge>
        </CardTitle>
        <p className="text-sm text-muted-foreground mt-1">
          Sent the moment you accept someone, along with creating their
          enrolment. This one always sends — there is no off switch. Its
          documents also go to accepted applicants who already have a HUB
          account (they get an enrolment confirmation instead).
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">
            Subject
          </label>
          <Input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Blank — the FFSA default subject will be used"
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">
            Message
          </label>
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Blank — the FFSA default message will be used. Type here to write your own; plain text, one idea per paragraph."
            rows={5}
          />
          <p className="text-xs text-muted-foreground">
            Merge fields:{" "}
            {["{{first_name}}", "{{program_name}}"].map((f) => (
              <code key={f} className="mx-0.5 bg-muted px-1 py-0.5 text-[11px]">
                {f}
              </code>
            ))}
            <span className="ml-1">
              Common variants like <code className="bg-muted px-1 py-0.5 text-[11px]">{"{{name}}"}</code>{" "}
              and <code className="bg-muted px-1 py-0.5 text-[11px]">[Your Name]</code> work too.
            </span>
          </p>
        </div>
        <EmailDocuments emailType="application_accepted" />

        <div className="flex items-center gap-3">
          <Button type="button" onClick={save} disabled={!dirty || saving} size="sm">
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 mr-1 animate-spin" /> Saving…
              </>
            ) : saved ? (
              <>
                <Check className="h-4 w-4 mr-1" /> Saved
              </>
            ) : (
              "Save"
            )}
          </Button>
          {(subject || body) && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={saving}
              onClick={() => {
                setSubject("");
                setBody("");
              }}
            >
              Clear to FFSA default
            </Button>
          )}
          {error && <span className="text-xs text-destructive">{error}</span>}
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * When accepted applicants get their HUB setup link (migration 230).
 *
 * New accounts no longer get the link in the acceptance email; it's held until
 * a month before the school starts, or the date set here. Accounts that
 * already exist are unaffected — those people can already sign in.
 */
function SetupInviteDateEditor({
  programId,
  initialDate,
  schoolStartDate,
}: {
  programId: string;
  initialDate: string | null;
  schoolStartDate: string | null;
}) {
  const router = useRouter();
  const [date, setDate] = useState(initialDate ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = date !== (initialDate ?? "");
  const defaultDate = schoolStartDate ? oneMonthBefore(schoolStartDate) : null;
  const effective = date || defaultDate;

  async function save() {
    setSaving(true);
    setError(null);
    const res = await fetch("/api/schools/programs", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: programId, setup_invite_date: date || null }),
    });
    setSaving(false);
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setError(data.error ?? "Could not save");
      return;
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
    router.refresh();
  }

  return (
    <Card>
      <CardHeader className="space-y-0">
        <CardTitle className="text-base flex items-center gap-2">
          HUB setup link
          <Badge variant="outline" className="font-normal capitalize">
            to new students
          </Badge>
        </CardTitle>
        <p className="text-sm text-muted-foreground mt-1">
          Accepted students without a HUB account get their account setup link
          on this date, not with the acceptance email — which tells them when to
          expect it. Leave blank for one month before the school starts.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">
            Send setup links on
          </label>
          <Input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-[200px]"
          />
          <p className="text-xs text-muted-foreground">
            {effective
              ? `Setup links go out on ${formatInviteDate(effective)}${
                  date ? "" : " (one month before the start)"
                }. If that date has passed, they're sent straight away.`
              : "This school has no start date yet, so setup links are sent straight away with the acceptance email."}
          </p>
        </div>
        <EmailDocuments emailType="account_setup_link" />

        <div className="flex items-center gap-3">
          <Button type="button" onClick={save} disabled={!dirty || saving} size="sm">
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 mr-1 animate-spin" /> Saving…
              </>
            ) : saved ? (
              <>
                <Check className="h-4 w-4 mr-1" /> Saved
              </>
            ) : (
              "Save"
            )}
          </Button>
          {date && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={saving}
              onClick={() => setDate("")}
            >
              Use one month before start
            </Button>
          )}
          {error && <span className="text-xs text-destructive">{error}</span>}
        </div>
      </CardContent>
    </Card>
  );
}
