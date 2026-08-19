"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

type UpdatedBy = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
  email: string | null;
} | null;

export function NotesSection({
  enrollmentId,
  initialNotes,
  updatedAt,
  updatedBy,
  onSaved,
}: {
  enrollmentId: string;
  initialNotes: string | null;
  updatedAt: string | null;
  updatedBy: UpdatedBy;
  onSaved: () => void;
}) {
  const [value, setValue] = useState(initialNotes ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset local edit state whenever the selected enrollment changes.
  useEffect(() => {
    setValue(initialNotes ?? "");
    setError(null);
  }, [enrollmentId, initialNotes]);

  const dirty = (initialNotes ?? "") !== value;

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/contacts/event-followup/${enrollmentId}/notes`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ notes: value }),
        }
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Failed to save notes");
        return;
      }
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="flex items-baseline justify-between">
        <p
          style={{
            fontSize: "9px",
            letterSpacing: "0.25em",
            fontWeight: 700,
            color: "#0A0A0A",
            textTransform: "uppercase",
          }}
        >
          Notes
        </p>
        {updatedAt && updatedBy && (
          <span style={{ fontSize: "10px", color: "#45423B" }}>
            edited by {personLabel(updatedBy)} ·{" "}
            {new Date(updatedAt).toLocaleString()}
          </span>
        )}
      </div>

      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Track important things as the follow-up progresses — conversations, next steps, blockers…"
        rows={4}
        style={{
          marginTop: "8px",
          width: "100%",
          background: "#FFFFFF",
          border: "1px solid hsl(22 8% 14%)",
          borderRadius: 0,
          padding: "10px 12px",
          color: "#F0EBE3",
          fontSize: "13px",
          lineHeight: 1.5,
          fontFamily: "inherit",
          resize: "vertical",
        }}
        disabled={saving}
      />

      <div className="mt-2 flex items-center justify-between gap-2">
        <span style={{ fontSize: "11px", color: "hsl(0 75% 65%)" }}>
          {error ?? ""}
        </span>
        <Button
          onClick={handleSave}
          disabled={!dirty || saving}
          size="sm"
          style={{
            background: dirty ? "#FFB801" : "#0A0A0A",
            color: dirty ? "#0A0A0A" : "#45423B",
            fontWeight: 700,
            fontSize: "12px",
            cursor: dirty && !saving ? "pointer" : "default",
          }}
        >
          {saving ? "Saving…" : dirty ? "Save notes" : "Saved"}
        </Button>
      </div>
    </>
  );
}

function personLabel(p: {
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
  email: string | null;
}): string {
  const first = p.preferred_name || p.first_name || "";
  const last = p.last_name || "";
  const name = `${first} ${last}`.trim();
  return name || p.email || "Someone";
}
