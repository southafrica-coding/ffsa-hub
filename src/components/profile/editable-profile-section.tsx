"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  FieldControl,
  OTHER_SENTINEL,
  seedOtherActive,
} from "@/components/profile/field-control";
import { type ProfileSectionDef } from "@/lib/users/profile-sections";

// One profile card: a read-only view of its fields with an "Edit" button
// that swaps in a form and saves only this section's fields to
// /api/profile/update. Scoped saves keep each section independent and the
// blast radius of a failed save small.
export function EditableProfileSection({
  section,
  values: initial,
  // Extra rows shown above the fields in both view and edit modes, but never
  // editable (e.g. the auth-managed email address).
  readOnlyRows,
}: {
  section: ProfileSectionDef;
  values: Record<string, string>;
  readOnlyRows?: { label: string; value: string; hint?: string }[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState<Record<string, string>>(initial);
  const [draft, setDraft] = useState<Record<string, string>>(initial);
  const [otherActive, setOtherActive] = useState<Record<string, boolean>>(() =>
    seedOtherActive(section.fields, initial)
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function startEdit() {
    setDraft(values);
    setOtherActive(seedOtherActive(section.fields, values));
    setError(null);
    setEditing(true);
  }

  function cancel() {
    setEditing(false);
    setError(null);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    // Required fields must be filled; optional ones may be left blank.
    for (const f of section.fields) {
      const v = draft[f.field]?.trim() ?? "";
      if (!f.optional && (!v || v === OTHER_SENTINEL)) {
        setError(`Please fill in: ${f.label}`);
        return;
      }
    }

    // Only this section's fields go up.
    const payload: Record<string, string> = {};
    for (const f of section.fields) payload[f.field] = draft[f.field] ?? "";

    setLoading(true);
    try {
      const res = await fetch("/api/profile/update", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to save changes");
        return;
      }
      setValues(draft);
      setEditing(false);
      // Pull fresh server state so derived surfaces (header name, insurance
      // banner, completion badge) update too.
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-xl border p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
            {section.title}
          </h3>
          {section.description && (
            <p className="text-xs text-muted-foreground mt-1">
              {section.description}
            </p>
          )}
        </div>
        {!editing && (
          <Button variant="ghost" size="sm" onClick={startEdit}>
            Edit
          </Button>
        )}
      </div>

      {editing ? (
        <form onSubmit={save} className="space-y-4">
          {readOnlyRows?.map((r) => (
            <ReadOnlyRow key={r.label} {...r} />
          ))}
          {section.fields.map((f) => (
            <FieldControl
              key={f.field}
              field={f}
              idPrefix={`profile-${section.id}`}
              required={!f.optional}
              value={draft[f.field] ?? ""}
              otherActive={!!otherActive[f.field]}
              onValueChange={(v) =>
                setDraft((prev) => ({ ...prev, [f.field]: v }))
              }
              onOtherActiveChange={(active) =>
                setOtherActive((prev) => ({ ...prev, [f.field]: active }))
              }
            />
          ))}

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={loading}>
              {loading ? "Saving..." : "Save"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={loading}
              onClick={cancel}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <div className="space-y-2">
          {readOnlyRows?.map((r) => (
            <ViewRow key={r.label} label={r.label} value={r.value} hint={r.hint} />
          ))}
          {section.fields.map((f) => (
            <ViewRow
              key={f.field}
              label={f.label}
              value={displayValue(f, values[f.field])}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// Map a stored value to its human label (e.g. "media" → "Media"). For
// `select-with-other` a custom off-list value is shown as-is. Empty → em dash.
function displayValue(
  field: ProfileSectionDef["fields"][number],
  raw: string | undefined
): string {
  const value = (raw ?? "").trim();
  if (!value) return "—";
  if (field.options) {
    const match = field.options.find((o) => o.value === value);
    if (match) return match.label;
  }
  if (field.type === "date") return value.slice(0, 10);
  return value;
}

function ViewRow({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="text-sm mt-0.5 break-words">{value}</div>
      {hint && <div className="text-[11px] text-muted-foreground mt-0.5">{hint}</div>}
    </div>
  );
}

function ReadOnlyRow({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="space-y-1">
      <div className="text-sm font-medium">{label}</div>
      <div className="rounded-md border border-input bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
        {value}
      </div>
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}
