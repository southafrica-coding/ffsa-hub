"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type XeroItem = {
  code: string;
  name: string | null;
  salesAccountCode: string | null;
};

type OrgState = {
  region: "za" | "us";
  item: XeroItem | null;
  match: XeroItem | null;
  xero_error: string | null;
};

type State = {
  enabled: boolean;
  due_date: string | null;
  item_code: string | null;
  orgs: OrgState[];
  suggested_code: string;
  held_orders: number;
};

const ORG_LABEL = {
  za: { name: "SA · Fire & Fragrance SA NPC", who: "South Africans and every other country" },
  us: { name: "US · FF SA USA, Inc", who: "Buyers from the USA" },
} as const;

// "Invoice me, pay later" for one event. Buyers who pick it get a Xero
// invoice by email; their seats are held and the tickets go out once the
// invoice is fully paid. Each buyer is invoiced in their country's Xero org
// (USA → US, everyone else → SA, as in Training), on the event's Xero Item —
// one code, linked or created in both orgs (Event Registration Revenue,
// tax exempt).
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
    // A code already linked in one org is the one to add to the other.
    setNewCode(data.item_code ?? data.suggested_code);
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
    const r = data.retried as { tried: number; invoiced: number; stillHeld: unknown[] } | null | undefined;
    setHint(
      r && r.tried > 0
        ? `${done} ${r.invoiced} of ${r.tried} held invoice${r.tried === 1 ? "" : "s"} created and emailed${r.stillHeld.length ? ` — ${r.stillHeld.length} still on hold` : ""}.`
        : done
    );
    await load();
    router.refresh();
    return true;
  }

  const linkedEverywhere = !!state && state.orgs.every((o) => !!o.item);
  const matches = state?.orgs.filter((o) => !o.item && o.match) ?? [];
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
            {state.enabled && !linkedEverywhere && (
              <div className="border-2 border-destructive bg-destructive/5 p-3 text-sm">
                <p className="font-semibold text-destructive">
                  Buyers from {state.orgs.filter((o) => !o.item).map((o) => (o.region === "us" ? "the USA" : "outside the USA")).join(" and ")} can&apos;t be invoiced right now
                </p>
                <p className="text-xs">
                  &ldquo;Invoice me&rdquo; is on, but the item isn&apos;t in{" "}
                  {state.orgs.filter((o) => !o.item).map((o) => (o.region === "us" ? "US" : "SA")).join(" + ")} Xero. Their
                  orders are held (seats kept) until it is — use Link or create in both below. If Xero says the Hub
                  isn&apos;t allowed, reconnect that org under Finance first.
                </p>
              </div>
            )}
            {state.held_orders > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-2 border border-amber bg-amber/10 p-3 text-sm">
                <span>
                  <strong>{state.held_orders}</strong> order{state.held_orders === 1 ? " is" : "s are"} waiting for an
                  invoice (seats held).
                </span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => patch({ retry_held: true }, "Retried.")}
                  className="px-2.5 py-1 bg-ink text-white text-xs hover:bg-[#262622] disabled:opacity-50"
                >
                  Retry held invoices
                </button>
              </div>
            )}
            <div className="border border-border bg-muted/40 p-3 space-y-2 text-sm">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Xero sales item · invoiced by the buyer&apos;s country
              </p>
              <div className="divide-y divide-border border border-border bg-white">
                {state.orgs.map((o) => (
                  <div key={o.region} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-3 py-2">
                    <div>
                      <p className="text-xs font-semibold">{ORG_LABEL[o.region].name}</p>
                      <p className="text-[11px] text-muted-foreground">{ORG_LABEL[o.region].who}</p>
                    </div>
                    <div className="text-xs">
                      {o.xero_error ? (
                        <span className="text-destructive">Xero: {o.xero_error}</span>
                      ) : o.item ? (
                        <span>
                          <code>{o.item.code}</code> — {o.item.name}
                          {o.item.salesAccountCode && (
                            <span className="text-muted-foreground"> · account {o.item.salesAccountCode}</span>
                          )}
                        </span>
                      ) : state.item_code ? (
                        <span className="text-amber">No item &quot;{state.item_code}&quot; here yet</span>
                      ) : (
                        <span className="text-muted-foreground">Not linked</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {!linkedEverywhere && (
                <>
                  {!state.item_code && matches.length > 0 && (
                    <div className="flex flex-wrap items-center gap-2">
                      <span>
                        Found <code className="text-xs">{matches[0].match!.code}</code> — {matches[0].match!.name} in{" "}
                        {matches[0].region === "us" ? "US" : "SA"} Xero
                      </span>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          patch({ item_code: matches[0].match!.code, create_item: true }, "Linked in both orgs.")
                        }
                        className="px-2.5 py-1 bg-ink text-white text-xs hover:bg-[#262622] disabled:bg-[color:var(--surface-4)]"
                      >
                        Use this code in both
                      </button>
                    </div>
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
                        patch({ item_code: newCode.trim(), create_item: true }, "Xero item linked in both orgs.")
                      }
                      className="px-2.5 py-1 border border-border text-xs hover:bg-muted disabled:opacity-50"
                    >
                      Link or create in both
                    </button>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    In each org, an existing item with this code is linked; otherwise one is created
                    there: named after the event, posting to Event Registration Revenue, tax exempt.
                  </p>
                </>
              )}
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
                disabled={busy || (!linkedEverywhere && !state.enabled)}
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
