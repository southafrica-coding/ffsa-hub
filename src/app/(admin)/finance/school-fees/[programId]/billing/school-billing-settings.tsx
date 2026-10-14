"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import { StatusPill } from "@/components/ffsa";

// Per-school billing switches (migration 172). The invoice run reads the same
// three values through src/lib/finance/invoice-run-policy.ts, and the summary
// line under the switches is written from the same rules so it can't promise
// something the run won't do.

export interface SchoolBillingSettingsValue {
  billing_mode: "external" | "hub_scheduled";
  billing_emails_enabled: boolean;
  schedule_start_date: string | null;
}

const fmtDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-ZA", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

function summary(s: SchoolBillingSettingsValue): string {
  if (s.billing_mode === "external") {
    return "The Hub creates no invoices for this school. Xero is the only record, and nothing is scheduled, generated or emailed.";
  }
  const from = s.schedule_start_date
    ? ` for charges due on or after ${fmtDate(s.schedule_start_date)}`
    : "";
  return s.billing_emails_enabled
    ? `Each morning the Hub creates due invoices in Xero${from}, approves them and emails each student.`
    : `Each morning the Hub creates due invoices in Xero${from} as drafts. Nothing is approved and no student is emailed until you turn sending on.`;
}

export function SchoolBillingSettings({
  programId,
  schoolName,
  initial,
  pendingCharges,
  canEdit,
}: {
  programId: string;
  schoolName: string;
  initial: SchoolBillingSettingsValue;
  pendingCharges: number;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [settings, setSettings] = useState(initial);
  const [startDraft, setStartDraft] = useState(initial.schedule_start_date ?? "");
  const [saving, setSaving] = useState<string | null>(null);

  async function save(
    key: string,
    patch: Partial<SchoolBillingSettingsValue>,
    confirmPending = false
  ): Promise<void> {
    setSaving(key);
    try {
      const res = await fetch("/api/finance/school-fees/program-billing-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ programId, ...patch, confirmPending }),
      });
      const json = await res.json();
      if (res.status === 409 && json.needsConfirm) {
        const ok = confirm(
          `${json.error}\n\nThey will be kept, not deleted, but no invoice will be created for them while ${schoolName} is billed outside the Hub. If you switch the Hub back on, they become due again (set a start date to leave the older ones behind).\n\nSwitch to outside the Hub?`
        );
        setSaving(null);
        if (ok) await save(key, patch, true);
        return;
      }
      if (!res.ok) {
        toast.error(json.error || "Couldn't save");
        return;
      }
      setSettings(json.settings);
      setStartDraft(json.settings.schedule_start_date ?? "");
      toast.success("Billing settings saved");
      router.refresh();
    } catch {
      toast.error("Network error");
    } finally {
      setSaving((cur) => (cur === key ? null : cur));
    }
  }

  function setMode(mode: SchoolBillingSettingsValue["billing_mode"]) {
    if (mode === settings.billing_mode) return;
    if (
      mode === "hub_scheduled" &&
      !confirm(
        `Bill ${schoolName} through the Hub?\n\nNewly accepted students get a payment schedule and the daily run starts creating their invoices in Xero.${
          settings.billing_emails_enabled ? "" : " Sending stays held, so they will be drafts until you turn sending on."
        }`
      )
    ) {
      return;
    }
    void save("mode", { billing_mode: mode });
  }

  function setSending(on: boolean) {
    if (on === settings.billing_emails_enabled) return;
    if (
      on &&
      !confirm(
        `Turn on invoice emails for ${schoolName}?\n\nFrom the next run, new invoices are approved in Xero and emailed to students straight away. Invoices already created as drafts stay drafts. Approve those in Xero yourself.`
      )
    ) {
      return;
    }
    void save("send", { billing_emails_enabled: on });
  }

  const hub = settings.billing_mode === "hub_scheduled";
  const startDirty = (startDraft || null) !== settings.schedule_start_date;

  return (
    <section className="border border-rule-strong">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-rule-strong px-4 py-3">
        <h2 className="font-mono text-[11px] font-bold uppercase tracking-[0.14em]">Billing</h2>
        {hub ? (
          <StatusPill tone={settings.billing_emails_enabled ? "good" : "warn"}>
            {settings.billing_emails_enabled ? "Hub scheduled · sending" : "Hub scheduled · sending held"}
          </StatusPill>
        ) : (
          <StatusPill tone="quiet">Outside the Hub</StatusPill>
        )}
      </div>

      <div className="divide-y divide-rule">
        <Row
          label="Who bills this school"
          hint="Outside the Hub means invoices are handled directly in Xero."
        >
          <Segmented
            value={settings.billing_mode}
            disabled={!canEdit || saving !== null}
            busy={saving === "mode"}
            onChange={setMode}
            options={[
              { value: "external", label: "Outside the Hub" },
              { value: "hub_scheduled", label: "Hub scheduled" },
            ]}
          />
        </Row>

        <Row
          label="Invoice emails"
          hint="When held, invoices are created in Xero as drafts and nobody is emailed."
          muted={!hub}
        >
          <Segmented
            value={settings.billing_emails_enabled ? "on" : "off"}
            disabled={!canEdit || !hub || saving !== null}
            busy={saving === "send"}
            onChange={(v) => setSending(v === "on")}
            options={[
              { value: "off", label: "Held" },
              { value: "on", label: "Send" },
            ]}
          />
        </Row>

        <Row
          label="Billing starts on"
          hint="Charges due before this date are treated as already billed and never invoiced. Leave empty for a school starting fresh."
          muted={!hub}
        >
          <div className="flex items-start gap-2">
            <div className="w-[150px]">
              <DateInput
                value={startDraft}
                onChange={setStartDraft}
                disabled={!canEdit || !hub || saving !== null}
                aria-label="Billing start date"
              />
            </div>
            {startDirty && (
              <Button
                size="sm"
                disabled={saving !== null}
                onClick={() => save("start", { schedule_start_date: startDraft || null })}
              >
                {saving === "start" && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
                Save
              </Button>
            )}
            {!startDirty && settings.schedule_start_date && canEdit && hub && (
              <Button
                size="sm"
                variant="outline"
                disabled={saving !== null}
                onClick={() => save("start", { schedule_start_date: null })}
              >
                Clear
              </Button>
            )}
          </div>
        </Row>
      </div>

      <div className="border-t border-rule-strong bg-bone px-4 py-3 text-[13px]">
        <p>{summary(settings)}</p>
        {pendingCharges > 0 && (
          <p className="mt-1 text-[color:var(--text-secondary)]">
            {pendingCharges} charge{pendingCharges === 1 ? " is" : "s are"} scheduled and not yet invoiced.
          </p>
        )}
        {!canEdit && (
          <p className="mt-1 text-[color:var(--text-secondary)]">
            Only finance admins can change these settings.
          </p>
        )}
      </div>
    </section>
  );
}

function Row({
  label,
  hint,
  muted,
  children,
}: {
  label: string;
  hint: string;
  muted?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between ${
        muted ? "opacity-50" : ""
      }`}
    >
      <div className="max-w-md">
        <p className="text-[13px] font-semibold">{label}</p>
        <p className="text-xs text-[color:var(--text-secondary)]">{hint}</p>
      </div>
      {children}
    </div>
  );
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
  disabled,
  busy,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (v: T) => void;
  disabled?: boolean;
  busy?: boolean;
}) {
  return (
    <div className="flex shrink-0 items-center gap-2">
      {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
      <div role="radiogroup" className="inline-flex border border-ink">
        {options.map((o) => {
          const active = o.value === value;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={disabled}
              onClick={() => onChange(o.value)}
              className={`px-3 py-2 font-mono text-[9px] font-bold uppercase tracking-[0.14em] disabled:cursor-not-allowed ${
                active ? "bg-ink text-white" : "bg-transparent text-ink hover:bg-bone"
              }`}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
