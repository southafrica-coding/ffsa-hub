"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Loader2, Check } from "lucide-react";
import {
  PROGRAM_EMAIL_TYPES,
  type ProgramEmailType,
} from "@/lib/email/program-email-types";

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
}: {
  programId: string;
  templates: TemplateRow[];
}) {
  const byType = new Map(templates.map((t) => [t.email_type, t]));

  return (
    <div className="space-y-5">
      <div className="rounded-md border bg-muted/30 px-4 py-3">
        <p className="text-sm text-muted-foreground">
          Control the emails sent to applicants during this school&apos;s
          process. Leave a field blank to use the FFSA default. Your text is
          automatically wrapped in FFSA branding, and any required buttons
          (status link, reference link) are always included.
        </p>
        <p className="text-xs text-muted-foreground mt-2">
          The <strong>acceptance email</strong> is edited under the{" "}
          <strong>Application</strong> tab.
        </p>
      </div>

      {PROGRAM_EMAIL_TYPES.map((type) => (
        <EmailTypeEditor
          key={type.key}
          programId={programId}
          type={type}
          initial={byType.get(type.key)}
        />
      ))}
    </div>
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
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [subject, setSubject] = useState(initial?.subject ?? "");
  const [body, setBody] = useState(initial?.body ?? "");
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
    subject !== (initial?.subject ?? "") ||
    body !== (initial?.body ?? "") ||
    reminderDays !== initialReminder;

  async function save() {
    setSaving(true);
    setError(null);
    const res = await fetch(
      `/api/schools/programs/${programId}/email-templates`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          emailType: type.key,
          enabled,
          subject,
          body,
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
            placeholder="Leave blank to use the default subject"
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
            placeholder="Leave blank to use the default message. Type here to write your own — plain text, one idea per paragraph."
            rows={5}
            disabled={!enabled}
          />
          <p className="text-xs text-muted-foreground">
            Merge fields:{" "}
            {type.mergeFields.map((f) => (
              <code
                key={f}
                className="mx-0.5 rounded bg-muted px-1 py-0.5 text-[11px]"
              >
                {f}
              </code>
            ))}
          </p>
        </div>
        {type.autoReminder && (
          <div className="rounded-md border bg-muted/30 px-3 py-2.5 space-y-1.5">
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
          {error && <span className="text-xs text-red-600">{error}</span>}
        </div>
      </CardContent>
    </Card>
  );
}
