"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type XeroItem = {
  code: string;
  name: string | null;
  salesAccountCode: string | null;
};

type State = {
  enabled: boolean;
  due_date: string | null;
  item_code: string | null;
  region: "za" | "us";
  item: XeroItem | null;
  match: XeroItem | null;
  suggested_code: string;
  xero_error: string | null;
};

// "Invoice me, pay later" for one event. Buyers who pick it get a Xero
// invoice by email; their seats are held and the tickets go out once the
// invoice is fully paid. Invoice lines post to the event's Xero Item —
// found here, or created (Event Registration Revenue, tax exempt).
export function PayLaterSettings({
  eventId,
  startDate,
}: {
  eventId: string;
  startDate: string | null;
}) {
  const router = useRouter();
  const [state, setState] = useState<State | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [dueDate, setDueDate] = useState("");
  const [newCode, setNewCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/events/${eventId}/pay-later`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setLoadErr(data.error ?? "Couldn't load");
      return;
    }
    setState(data);
    setEnabled(data.enabled);
    setDueDate(data.due_date ?? "");
    setNewCode(data.suggested_code);
  }, [eventId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function patch(body: Record<string, unknown>, done: string) {
    setBusy(true);
    setErr(null);
    setHint(null);
    const res = await fetch(`/api/events/${eventId}/pay-later`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setErr(data.error ?? "Failed to save");
      return false;
    }
    setHint(done);
    await load();
    router.refresh();
    return true;
  }

  const orgLabel = state?.region === "us" ? "US (FF SA USA, Inc)" : "SA (Fire & Fragrance SA NPC)";
  const hasItem = !!state?.item;
  const dirty =
    !!state && (enabled !== state.enabled || (dueDate || null) !== state.due_date);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Pay later (invoice)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Lets buyers choose <strong>Invoice me, pay later</strong> next to the
          card buttons. They&apos;re emailed a Xero invoice they can pay in full
          or in parts. Their seats are held, and the tickets are sent once the
          invoice is fully paid.
        </p>

        {loadErr && <p className="text-xs text-destructive">{loadErr}</p>}
        {!state && !loadErr && <p className="text-xs text-muted-foreground">Checking Xero…</p>}

        {state && (
          <>
            <div className="border border-border bg-muted/40 p-3 space-y-2 text-sm">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Xero sales item · {orgLabel}
              </p>
              {state.xero_error && (
                <p className="text-xs text-destructive">Xero: {state.xero_error}</p>
              )}
              {hasItem ? (
                <p>
                  <code className="text-xs">{state.item!.code}</code> — {state.item!.name}
                  {state.item!.salesAccountCode && (
                    <span className="text-muted-foreground"> · sales account {state.item!.salesAccountCode}</span>
                  )}
                </p>
              ) : (
                <>
                  {state.item_code && (
                    <p className="text-xs text-amber">
                      The saved code &quot;{state.item_code}&quot; isn&apos;t an item in this Xero org.
                    </p>
                  )}
                  {state.match ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <span>
                        Found <code className="text-xs">{state.match.code}</code> — {state.match.name}
                        {state.match.salesAccountCode && ` (account ${state.match.salesAccountCode})`}
                      </span>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => patch({ item_code: state.match!.code }, "Linked.")}
                        className="px-2.5 py-1 bg-ink text-white text-xs hover:bg-[#262622] disabled:bg-[color:var(--surface-4)]"
                      >
                        Use this item
                      </button>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">No Xero item matches this event yet.</p>
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-muted-foreground">Item code</span>
                    <input
                      value={newCode}
                      onChange={(e) => setNewCode(e.target.value.toUpperCase())}
                      maxLength={30}
                      className="border px-2 py-1 text-xs font-mono w-40"
                      disabled={busy}
                    />
                    <button
                      type="button"
                      disabled={busy || !newCode.trim()}
                      onClick={() =>
                        patch({ item_code: newCode.trim(), create_item: true }, "Xero item linked.")
                      }
                      className="px-2.5 py-1 border border-border text-xs hover:bg-muted disabled:opacity-50"
                    >
                      Link or create
                    </button>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    An existing Xero item with this code is linked. Otherwise a new one is
                    created: named after the event, posting to Event Registration Revenue,
                    tax exempt.
                  </p>
                </>
              )}
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
                disabled={busy || (!hasItem && !state.enabled)}
              />
              Offer &quot;Invoice me, pay later&quot; at checkout
            </label>

            <div>
              <label className="block text-xs text-muted-foreground mb-1">Invoice due date</label>
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="border px-2 py-1.5 text-sm"
                disabled={busy}
              />
              <p className="text-xs text-muted-foreground mt-1">
                Leave empty to use the event start date{startDate ? ` (${startDate})` : ""}. Never
                earlier than the day the invoice is sent.
              </p>
            </div>

            {err && <p className="text-xs text-destructive">{err}</p>}
            {hint && <p className="text-xs text-grass-text">{hint}</p>}
            <button
              type="button"
              disabled={busy || !dirty}
              onClick={() => patch({ enabled, due_date: dueDate || null }, "Saved.")}
              className="px-3 py-1 bg-ink text-white text-xs hover:bg-[#262622] disabled:bg-[color:var(--surface-4)]"
            >
              {busy ? "Saving…" : "Save"}
            </button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
