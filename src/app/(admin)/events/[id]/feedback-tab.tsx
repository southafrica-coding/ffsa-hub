"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusPill, type Tone } from "@/components/ffsa";

export type FeedbackFormRow = {
  id: string;
  slug: string;
  title: string;
  status: "draft" | "open" | "closed";
  is_anonymous: boolean;
  created_at: string;
};

const STATUS_TONE: Record<FeedbackFormRow["status"], Tone> = {
  draft: "quiet",
  open: "good",
  closed: "warn",
};

const STATUS_LABEL: Record<FeedbackFormRow["status"], string> = {
  draft: "Draft",
  open: "Open",
  closed: "Closed",
};

export function FeedbackTab({
  eventId,
  forms,
  responseCounts,
  canEdit = false,
}: {
  eventId: string;
  forms: FeedbackFormRow[];
  responseCounts: Record<string, number>;
  canEdit?: boolean;
}) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("Team debrief");
  const [useTemplate, setUseTemplate] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function createForm() {
    if (!title.trim()) {
      setErr("Give the form a name.");
      return;
    }
    setBusy(true);
    setErr(null);
    const res = await fetch(`/api/events/${eventId}/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: title.trim(), useTemplate }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setErr(data.error ?? "Failed to create the feedback form");
      return;
    }
    const { form } = (await res.json()) as { form: { id: string } };
    router.push(`/events/${eventId}/feedback/${form.id}`);
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">Feedback</CardTitle>
        {canEdit && !creating && (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="text-xs text-ink hover:underline"
          >
            + New feedback form
          </button>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          A survey for the people who worked this event. Build the questions, open
          the form, then share one link (or its QR) with the team. Answers are
          collected here as a summary you can act on — they never touch contacts
          or the CRM.
        </p>

        {forms.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">
            No feedback form yet. The template gives you a working debrief in one
            click.
          </p>
        ) : (
          <ul className="space-y-2">
            {forms.map((f) => {
              const count = responseCounts[f.id] ?? 0;
              return (
                <li
                  key={f.id}
                  className="flex items-center justify-between gap-3 border p-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{f.title}</p>
                    <p className="text-xs text-muted-foreground">
                      /fb/{f.slug}
                      {f.is_anonymous ? " · anonymous" : ""}
                      {` · ${count} response${count === 1 ? "" : "s"}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <StatusPill tone={STATUS_TONE[f.status]}>
                      {STATUS_LABEL[f.status]}
                    </StatusPill>
                    <Link
                      href={`/events/${eventId}/feedback/${f.id}/responses`}
                      className="text-xs text-ink hover:underline"
                    >
                      Results
                    </Link>
                    {canEdit && (
                    <Link
                      href={`/events/${eventId}/feedback/${f.id}`}
                      className="text-xs text-ink hover:underline"
                    >
                      Edit
                    </Link>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {canEdit && creating && (
          <div className="border-t pt-3 space-y-2">
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Form name (e.g. Team debrief)"
              className="w-full border px-2 py-1.5 text-sm"
              disabled={busy}
            />
            <label className="flex items-start gap-2 text-xs">
              <input
                type="checkbox"
                checked={useTemplate}
                onChange={(e) => setUseTemplate(e.target.checked)}
                disabled={busy}
                className="mt-0.5"
              />
              <span>
                Start from the post-event debrief template
                <span className="block text-muted-foreground">
                  Four scored questions, then what to keep and what to change.
                  Edit anything you like afterwards.
                </span>
              </span>
            </label>
            {err && <p className="text-xs text-destructive">{err}</p>}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={createForm}
                disabled={busy}
                className="px-3 py-1 bg-ink text-white text-xs hover:bg-[var(--ink-bg-hover)] disabled:bg-[color:var(--surface-4)]"
              >
                Create &amp; open builder
              </button>
              <button
                type="button"
                onClick={() => {
                  setCreating(false);
                  setErr(null);
                }}
                disabled={busy}
                className="px-3 py-1 border text-xs hover:bg-[color:var(--surface-2)]"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
