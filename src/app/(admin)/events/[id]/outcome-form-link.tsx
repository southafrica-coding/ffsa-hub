"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";

type FormOpt = { id: string; name: string };

// Shows the form linked to an outcome (1:1 via event_outcomes.form_id) and
// lets staff attach / change / detach it. The dropdown is pre-filtered to
// this event's forms that aren't already linked to a different outcome.
export function OutcomeFormLink({
  eventId,
  outcomeId,
  currentFormId,
  currentFormName,
  forms,
}: {
  eventId: string;
  outcomeId: string;
  currentFormId: string | null;
  currentFormName: string | null;
  forms: FormOpt[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);

  async function setForm(formId: string | null) {
    setBusy(true);
    const res = await fetch(`/api/events/${eventId}/outcomes/${outcomeId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ form_id: formId }),
    });
    setBusy(false);
    if (res.ok) {
      setEditing(false);
      toast.success(formId ? "Form linked" : "Form detached");
      router.refresh();
    } else {
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      toast.error(d.error ?? "Failed to update form link");
    }
  }

  if (editing) {
    return (
      <div className="flex items-center gap-2">
        <select
          defaultValue={currentFormId ?? ""}
          disabled={busy}
          onChange={(e) => setForm(e.target.value || null)}
          className="h-9 border border-input bg-transparent px-2 text-sm"
        >
          <option value="">— no form —</option>
          {forms.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => setEditing(false)}
          disabled={busy}
          className="text-xs text-muted-foreground hover:underline"
        >
          cancel
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 text-sm">
      {currentFormId ? (
        <>
          <Link
            href={`/events/${eventId}/forms/${currentFormId}`}
            className="text-ink hover:underline"
          >
            Form: {currentFormName ?? "Untitled"} →
          </Link>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-xs text-muted-foreground hover:text-foreground underline"
          >
            change
          </button>
        </>
      ) : (
        <>
          <span className="text-amber">No form linked</span>
          {forms.length > 0 ? (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="text-xs text-ink hover:underline"
            >
              link a form
            </button>
          ) : (
            <span className="text-xs text-muted-foreground">
              (create one on the Forms tab first)
            </span>
          )}
        </>
      )}
    </div>
  );
}
