"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  FieldControl,
  OTHER_SENTINEL,
  seedOtherActive,
} from "@/components/profile/field-control";
import { isExpiryDatePast } from "@/lib/users/profile-fields";
import { providerAllowsNoExpiry } from "@/lib/profile/options";
import { formatDateDMY } from "@/lib/utils/date";
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
  // Extra content shown below the fields in view mode only (e.g. the
  // health-insurance policy history under the Insurance card).
  footer,
}: {
  section: ProfileSectionDef;
  values: Record<string, string>;
  readOnlyRows?: { label: string; value: string; hint?: string }[];
  footer?: React.ReactNode;
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
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Health insurance is self-attested coverage data, so we make the staff
  // member explicitly confirm accuracy before it's saved.
  const requiresConfirm = section.id === "insurance";

  // Editing insurance REPLACES the current policy immediately. If the change
  // looks like a *future* policy — a different policy number that expires later,
  // while the current one is still valid — replacing now would drop still-valid
  // cover. Detect that so the confirm step can nudge them to "Add next policy"
  // instead (which keeps the current active until it expires, then auto-switches).
  // Open-ended policy. It rides inside the values/draft maps as "true"/""
  // so startEdit, cancel and the post-save commit all carry it for free;
  // it is converted to a real boolean on the way to the API.
  const NO_EXPIRY = "health_insurance_no_expiry";
  const providerField = section.fields.find(
    (f) => f.field === "health_insurance_provider"
  );
  const noExpiryAllowed =
    !!providerField &&
    !otherActive["health_insurance_provider"] &&
    providerAllowsNoExpiry(
      draft["health_insurance_provider"],
      providerField.options
    );
  // Switching to an ineligible provider retires the flag, so the date
  // field comes back and stays required.
  const draftNoExpiry = draft[NO_EXPIRY] === "true" && noExpiryAllowed;
  const savedNoExpiry = values[NO_EXPIRY] === "true";

  const YMD = /^\d{4}-\d{2}-\d{2}$/;
  const curPolicyNo = (values["health_insurance_policy_number"] ?? "").trim();
  const draftPolicyNo = (draft["health_insurance_policy_number"] ?? "").trim();
  const curExpiry = (values["health_insurance_expiry_date"] ?? "").slice(0, 10);
  const draftExpiry = (draft["health_insurance_expiry_date"] ?? "").slice(0, 10);
  const looksLikeSuccessor =
    requiresConfirm &&
    // An open-ended policy on either side has no dates to compare, so the
    // successor heuristic can't apply.
    !savedNoExpiry &&
    !draftNoExpiry &&
    YMD.test(curExpiry) &&
    !isExpiryDatePast(curExpiry) && // current cover still valid
    !!draftPolicyNo &&
    draftPolicyNo !== curPolicyNo && // a different policy
    YMD.test(draftExpiry) &&
    draftExpiry > curExpiry; // …that expires later — i.e. a successor

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

  function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    // Required fields must be filled; optional ones may be left blank.
    for (const f of section.fields) {
      // An open-ended policy has no expiry date to give.
      if (f.field === "health_insurance_expiry_date" && draftNoExpiry) continue;
      const v = draft[f.field]?.trim() ?? "";
      if (!f.optional && (!v || v === OTHER_SENTINEL)) {
        setError(`Please fill in: ${f.label}`);
        return;
      }
      if (f.field === "health_insurance_expiry_date" && v && isExpiryDatePast(v)) {
        setError(
          "Your health insurance expiry date can't be in the past. Please enter the date your current policy expires."
        );
        return;
      }
    }

    // Insurance is self-attested — confirm accuracy before persisting.
    if (requiresConfirm) {
      setConfirmOpen(true);
      return;
    }
    void persist();
  }

  async function persist() {
    setError(null);
    // Only this section's fields go up.
    const payload: Record<string, unknown> = {};
    for (const f of section.fields) payload[f.field] = draft[f.field] ?? "";
    // The flag must travel with the section's insurance fields — a date
    // arriving beside a stale flag is rejected by the DB constraint.
    if (providerField) {
      payload[NO_EXPIRY] = draftNoExpiry;
      if (draftNoExpiry) payload["health_insurance_expiry_date"] = null;
    }

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
      setValues({
        ...draft,
        [NO_EXPIRY]: draftNoExpiry ? "true" : "",
        ...(draftNoExpiry ? { health_insurance_expiry_date: "" } : {}),
      });
      setEditing(false);
      // Pull fresh server state so derived surfaces (header name, insurance
      // banner, completion badge) update too.
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
      setConfirmOpen(false);
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
              noExpiry={draftNoExpiry}
              noExpiryAllowed={noExpiryAllowed}
              onNoExpiryChange={(v) =>
                setDraft((prev) => ({ ...prev, [NO_EXPIRY]: v ? "true" : "" }))
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
              value={
                f.field === "health_insurance_expiry_date" && savedNoExpiry
                  ? "No expiry"
                  : displayValue(f, values[f.field])
              }
              hint={
                f.field === "health_insurance_expiry_date" && savedNoExpiry
                  ? confirmedHint(values["health_insurance_confirmed_at"])
                  : undefined
              }
            />
          ))}
          {footer && <div className="pt-1">{footer}</div>}
        </div>
      )}

      {requiresConfirm && (
        <Dialog open={confirmOpen} onOpenChange={(o) => !loading && setConfirmOpen(o)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {looksLikeSuccessor
                  ? "Replace your current policy?"
                  : "Confirm your health insurance details"}
              </DialogTitle>
              <DialogDescription>
                By continuing, you confirm that the health insurance information
                you&apos;ve provided is correct and reflects your current coverage.
              </DialogDescription>
            </DialogHeader>

            {looksLikeSuccessor && (
              <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
                <p className="font-medium">This looks like a future policy.</p>
                <p className="mt-1 text-[13px] leading-snug">
                  Your current policy{curPolicyNo ? ` (no. ${curPolicyNo})` : ""} is
                  still valid until {curExpiry}, and this new one expires later.
                  Saving here <strong>replaces your current policy right now</strong>.
                  If it&apos;s meant to take over <em>later</em>, cancel and use{" "}
                  <strong>&ldquo;Add next policy&rdquo;</strong> under Policies on
                  record — that keeps your current cover active until it expires,
                  then switches automatically.
                </p>
              </div>
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={loading}
                onClick={() => setConfirmOpen(false)}
              >
                Cancel
              </Button>
              <Button type="button" size="sm" disabled={loading} onClick={() => void persist()}>
                {loading
                  ? "Saving..."
                  : looksLikeSuccessor
                    ? "Replace current policy"
                    : "Confirm & save"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

// When the policy is open-ended, the expiry row carries the annual
// re-confirmation date instead of a date that doesn't exist.
function confirmedHint(confirmedAt: string | undefined): string {
  const ymd = (confirmedAt ?? "").slice(0, 10);
  return ymd
    ? `Confirmed ${formatDateDMY(ymd)} — we'll ask again in a year`
    : "We'll ask you once a year to confirm it's still active";
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
  if (field.type === "date") return formatDateDMY(value);
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
