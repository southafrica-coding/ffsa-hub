"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  type BuyerFieldConfig,
  BUYER_FIELD_LABELS,
  LOCKED_FIELDS,
  requiredApplies,
  resolveBuyerFields,
} from "@/lib/ticketing/buyer-fields";

// Admin manager for the standard "Your details" checkout fields
// (events.buyer_fields, migration 140). Each field has an on/off + a
// required toggle; email is locked on+required. Separate from the custom
// checkout questions and per-tier questions — this is only the built-in
// buyer fields collected once per order.

export function BuyerFieldsManager({
  eventId,
  initialFields,
}: {
  eventId: string;
  initialFields: unknown;
}) {
  const router = useRouter();
  // Always resolve to the full canonical list so the UI is stable even
  // for events saved before this feature (empty array → defaults).
  const initial = useMemo(
    () => resolveBuyerFields(initialFields),
    [initialFields]
  );
  const [fields, setFields] = useState<BuyerFieldConfig[]>(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const dirty = useMemo(
    () => JSON.stringify(fields) !== JSON.stringify(initial),
    [fields, initial]
  );

  function update(key: string, patch: Partial<BuyerFieldConfig>) {
    setMsg(null);
    setFields((fs) =>
      fs.map((f) => {
        if (f.key !== key) return f;
        const next = { ...f, ...patch };
        // A hidden field can't be required.
        if (!next.enabled) next.required = false;
        return next;
      })
    );
  }

  async function save() {
    setBusy(true);
    setErr(null);
    setMsg(null);
    const res = await fetch(`/api/events/${eventId}/buyer-fields`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ buyer_fields: fields }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setErr(data.error ?? "Couldn't save. Please try again.");
      return;
    }
    setMsg("Saved.");
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Buyer details</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          The standard fields collected once per order at checkout (the
          &ldquo;Your details&rdquo; section). Turn each on or off and mark it
          required. Email is always collected — the ticket confirmation is sent
          there. For extra questions, use the checkout questions or a ticket
          tier&apos;s own questions below.
        </p>

        <div className="divide-y border ">
          {fields.map((f) => {
            const locked = LOCKED_FIELDS.includes(f.key);
            const showRequired = requiredApplies(f.key);
            return (
              <div
                key={f.key}
                className="flex items-center justify-between gap-4 px-3 py-2.5"
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">
                    {BUYER_FIELD_LABELS[f.key]}
                  </span>
                  {locked && (
                    <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 bg-muted text-muted-foreground">
                      always on
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-5">
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={f.enabled}
                      disabled={locked}
                      onChange={(e) => update(f.key, { enabled: e.target.checked })}
                    />
                    Show
                  </label>
                  {showRequired ? (
                    <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={f.required}
                        disabled={locked || !f.enabled}
                        onChange={(e) =>
                          update(f.key, { required: e.target.checked })
                        }
                      />
                      Required
                    </label>
                  ) : (
                    <span className="text-xs text-muted-foreground/60 w-[68px]">
                      —
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {err && <p className="text-xs text-destructive">{err}</p>}
        {msg && !dirty && <p className="text-xs text-grass-text">{msg}</p>}

        {dirty && (
          <div className="flex items-center gap-2 border-t pt-3">
            <Button onClick={save} disabled={busy} size="sm">
              {busy ? "Saving…" : "Save buyer details"}
            </Button>
            <Button
              onClick={() => {
                setFields(initial);
                setErr(null);
                setMsg(null);
              }}
              disabled={busy}
              size="sm"
              variant="outline"
            >
              Discard
            </Button>
            <span className="text-xs text-muted-foreground">Unsaved changes</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
