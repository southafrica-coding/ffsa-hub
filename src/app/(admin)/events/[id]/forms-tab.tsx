"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type FormRow = {
  id: string;
  slug: string;
  name: string;
  is_active: boolean;
  records_attendance: boolean;
};

export function FormsTab({
  eventId,
  forms,
  canEdit = false,
}: {
  eventId: string;
  forms: FormRow[];
  canEdit?: boolean;
}) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function createForm() {
    if (!name.trim()) {
      setErr("Form name is required.");
      return;
    }
    setBusy(true);
    setErr(null);
    const res = await fetch(`/api/events/${eventId}/forms`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim() }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setErr(data.error ?? "Failed to create form");
      return;
    }
    const { form } = (await res.json()) as { form: { id: string } };
    router.push(`/events/${eventId}/forms/${form.id}`);
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">Forms</CardTitle>
        {canEdit && !creating && (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="text-xs text-ink hover:underline"
          >
            + New form
          </button>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Multi-step forms collected via a QR code. A submission creates/updates a
          contact, applies the event label, and records any outcome responses.
        </p>

        {forms.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">No forms yet.</p>
        ) : (
          <ul className="space-y-2">
            {forms.map((f) => (
              <li
                key={f.id}
                className="flex items-center justify-between gap-3 border p-3"
              >
                <div>
                  <p className="text-sm font-medium">{f.name}</p>
                  <p className="text-xs text-muted-foreground">
                    /f/{f.slug}
                    {f.records_attendance ? " · records attendance" : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`text-xs px-2 py-0.5 ${
                      f.is_active
                        ? "border border-grass text-grass-text"
                        : "bg-[color:var(--surface-3)] text-[color:var(--text-secondary)]"
                    }`}
                  >
                    {f.is_active ? "Published" : "Draft"}
                  </span>
                  {canEdit && (
                  <Link
                    href={`/events/${eventId}/forms/${f.id}`}
                    className="text-xs text-ink hover:underline"
                  >
                    Edit
                  </Link>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        {canEdit && creating && (
          <div className="border-t pt-3 space-y-2">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Form name (e.g. Send Night 2026 — Take Action)"
              className="w-full border px-2 py-1.5 text-sm"
              disabled={busy}
            />
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
