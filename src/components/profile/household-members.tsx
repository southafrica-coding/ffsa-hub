"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { FieldControl, seedOtherActive } from "@/components/profile/field-control";
import {
  HOUSEHOLD_CORE_FIELDS,
  HOUSEHOLD_PASSPORT_FIELDS,
  HOUSEHOLD_VISA_BASE_FIELDS,
  HOUSEHOLD_VISA_LONG_TERM_FIELDS,
  HOUSEHOLD_INSURANCE_FIELDS,
  HOUSEHOLD_RELATIONSHIP_OPTIONS,
  isChildComplete,
  type FieldConfig,
} from "@/lib/users/profile-fields";

// A member as stored (subset of columns we render).
export type HouseholdMember = {
  id: string;
  relationship: string;
  full_name: string;
  date_of_birth: string | null;
  gender: string | null;
  passport_country: string | null;
  passport_number: string | null;
  passport_expiry_date: string | null;
  is_international: boolean;
  visa_category: string | null;
  visa_type: string | null;
  visa_expiry_date: string | null;
  health_insurance_provider: string | null;
  health_insurance_policy_number: string | null;
  health_insurance_expiry_date: string | null;
};

const relationshipLabel = (value: string) =>
  HOUSEHOLD_RELATIONSHIP_OPTIONS.find((o) => o.value === value)?.label ?? value;

// Turn a stored member into the string map FieldControl expects.
function memberToValues(m: Partial<HouseholdMember>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of [
    ...HOUSEHOLD_CORE_FIELDS,
    ...HOUSEHOLD_PASSPORT_FIELDS,
    ...HOUSEHOLD_VISA_BASE_FIELDS,
    ...HOUSEHOLD_VISA_LONG_TERM_FIELDS,
    ...HOUSEHOLD_INSURANCE_FIELDS,
  ]) {
    const raw = (m as Record<string, unknown>)[f.field];
    if (raw === null || raw === undefined) out[f.field] = "";
    else if (f.type === "date") out[f.field] = String(raw).slice(0, 10);
    else out[f.field] = String(raw);
  }
  return out;
}

const EMPTY_VALUES = memberToValues({ relationship: "", full_name: "" });

export function HouseholdMembers({
  initialMembers,
  className,
  loadOnMount = false,
  refreshRouterOnChange = true,
  requireComplete = false,
  defaultRelationship,
}: {
  initialMembers: HouseholdMember[];
  className?: string;
  // Fetch the current list from the API on mount — used where the component
  // remounts (e.g. the onboarding step) and can't rely on server-passed data.
  loadOnMount?: boolean;
  // Call router.refresh() after mutations — wanted on the profile page (to
  // re-sync server data), skipped in onboarding (no server data to refresh).
  refreshRouterOnChange?: boolean;
  // Gate mode: require the FULL child field set (isChildComplete) before a
  // save is allowed, so every saved record clears the children gate. The
  // normal profile usage leaves this off (partial saves allowed).
  requireComplete?: boolean;
  // Pre-select the relationship for a new member (e.g. "child" in the gate).
  defaultRelationship?: string;
}) {
  const router = useRouter();
  const [members, setMembers] = useState<HouseholdMember[]>(initialMembers);

  useEffect(() => {
    if (!loadOnMount) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/profile/household");
        if (!res.ok) return;
        const json = await res.json();
        if (!cancelled && Array.isArray(json.members)) setMembers(json.members);
      } catch {
        // Keep whatever we have on any failure.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadOnMount]);
  // `null` = not editing; "new" = adding; otherwise the member id being edited.
  const [editing, setEditing] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>(EMPTY_VALUES);
  const [isInternational, setIsInternational] = useState(false);
  const [otherActive, setOtherActive] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const beginAdd = () => {
    const start = defaultRelationship
      ? { ...EMPTY_VALUES, relationship: defaultRelationship }
      : EMPTY_VALUES;
    setEditing("new");
    setValues(start);
    setIsInternational(false);
    setOtherActive(seedOtherActive(HOUSEHOLD_INSURANCE_FIELDS, start));
    setError(null);
  };

  const beginEdit = (m: HouseholdMember) => {
    const v = memberToValues(m);
    setEditing(m.id);
    setValues(v);
    setIsInternational(Boolean(m.is_international));
    setOtherActive(seedOtherActive(HOUSEHOLD_INSURANCE_FIELDS, v));
    setError(null);
  };

  const cancel = () => {
    setEditing(null);
    setError(null);
  };

  const setValue = (field: string, v: string) =>
    setValues((prev) => ({ ...prev, [field]: v }));

  const visaFields: FieldConfig[] = isInternational
    ? [
        ...HOUSEHOLD_VISA_BASE_FIELDS,
        ...(values.visa_category === "long_term"
          ? HOUSEHOLD_VISA_LONG_TERM_FIELDS
          : []),
      ]
    : [];

  const renderField = (f: FieldConfig) => (
    <FieldControl
      key={f.field}
      field={f}
      value={values[f.field] ?? ""}
      otherActive={otherActive[f.field] ?? false}
      onValueChange={(v) => setValue(f.field, v)}
      onOtherActiveChange={(active) =>
        setOtherActive((prev) => ({ ...prev, [f.field]: active }))
      }
      required={false}
      idPrefix="household"
    />
  );

  const save = async () => {
    if (!values.relationship) {
      setError("Please choose a relationship.");
      return;
    }
    if (!values.full_name.trim()) {
      setError("Please enter the family member's full name.");
      return;
    }

    // Gate mode: every field is mandatory before the record counts toward
    // clearing the children gate. Validate against the same rule the gate uses.
    if (
      requireComplete &&
      !isChildComplete({ ...values, is_international: isInternational })
    ) {
      setError(
        "Please fill in every field for this child" +
          (isInternational ? " (including visa details)" : "") +
          " before saving."
      );
      return;
    }
    setSaving(true);
    setError(null);

    // Only send visa fields when the member is international; otherwise clear
    // them so a toggle-off doesn't leave stale visa data behind.
    const payload: Record<string, unknown> = {
      ...values,
      is_international: isInternational,
    };
    if (!isInternational) {
      payload.visa_category = "";
      payload.visa_type = "";
      payload.visa_expiry_date = "";
    } else if (values.visa_category !== "long_term") {
      payload.visa_type = "";
      payload.visa_expiry_date = "";
    }

    const isNew = editing === "new";
    const res = await fetch(
      isNew ? "/api/profile/household" : `/api/profile/household/${editing}`,
      {
        method: isNew ? "POST" : "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );
    const json = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) {
      setError(json.error ?? "Could not save. Please try again.");
      return;
    }
    const saved = json.member as HouseholdMember;
    setMembers((prev) =>
      isNew
        ? [...prev, saved]
        : prev.map((m) => (m.id === saved.id ? saved : m))
    );
    setEditing(null);
    if (refreshRouterOnChange) router.refresh();
  };

  const remove = async (id: string) => {
    setError(null);
    const res = await fetch(`/api/profile/household/${id}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      setError(json.error ?? "Could not remove this family member.");
      return;
    }
    setMembers((prev) => prev.filter((m) => m.id !== id));
    if (refreshRouterOnChange) router.refresh();
  };

  return (
    <div className={className}>
      {members.length === 0 && editing === null && (
        <p className="text-sm text-muted-foreground">
          No family members added yet. Add your spouse, children or dependents
          so we have their details on record.
        </p>
      )}

      {members.length > 0 && (
        <ul className="space-y-2">
          {members.map((m) => (
            <li
              key={m.id}
              className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm"
            >
              <div className="min-w-0">
                <span className="font-medium break-words">{m.full_name}</span>
                <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {relationshipLabel(m.relationship)}
                </span>
              </div>
              {editing === null && (
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => beginEdit(m)}
                  >
                    Edit
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => remove(m.id)}
                  >
                    Remove
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {editing !== null && (
        <div className="mt-3 space-y-4 rounded-lg border p-4">
          <div className="grid gap-4 sm:grid-cols-2">
            {HOUSEHOLD_CORE_FIELDS.map(renderField)}
          </div>

          <div>
            <p className="mb-2 text-[11px] uppercase tracking-wide text-muted-foreground">
              Passport
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              {HOUSEHOLD_PASSPORT_FIELDS.map(renderField)}
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={isInternational}
              onChange={(e) => setIsInternational(e.target.checked)}
              className="h-4 w-4"
            />
            This family member is an international (non-South African) citizen
          </label>

          {isInternational && (
            <div>
              <p className="mb-2 text-[11px] uppercase tracking-wide text-muted-foreground">
                Visa
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                {visaFields.map(renderField)}
              </div>
            </div>
          )}

          <div>
            <p className="mb-2 text-[11px] uppercase tracking-wide text-muted-foreground">
              Health insurance
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              {HOUSEHOLD_INSURANCE_FIELDS.map(renderField)}
            </div>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex items-center gap-2">
            <Button type="button" onClick={save} disabled={saving}>
              {saving ? "Saving…" : editing === "new" ? "Add member" : "Save"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={cancel}
              disabled={saving}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {editing === null && (
        <div className="mt-3">
          <Button type="button" variant="outline" size="sm" onClick={beginAdd}>
            + Add family member
          </Button>
          {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
        </div>
      )}
    </div>
  );
}
