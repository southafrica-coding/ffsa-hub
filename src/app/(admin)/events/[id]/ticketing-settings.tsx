"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Check, Copy, ExternalLink } from "lucide-react";
import { EVENT_CURRENCIES, providersForCurrency } from "@/lib/currencies";
import { ShareLinkQr, ticketShareQrUrl } from "@/components/share/share-link-qr";

export function TicketingSettings({
  eventId,
  ticketingEnabled,
  publicSlug,
  currency: savedCurrency,
  currencyLocked,
}: {
  eventId: string;
  ticketingEnabled: boolean;
  publicSlug: string | null;
  currency: string;
  currencyLocked: boolean;
}) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(ticketingEnabled);
  const [slug, setSlug] = useState(publicSlug ?? "");
  const [currency, setCurrency] = useState(savedCurrency);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [savedHint, setSavedHint] = useState<string | null>(null);
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState(false);

  // Resolve the absolute origin on the client so the shareable link is
  // correct in every environment (localhost in dev, ffsahub.com in prod).
  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const dirty =
    enabled !== ticketingEnabled ||
    (slug.trim() || null) !== publicSlug ||
    currency !== savedCurrency;

  const trimmedSlug = slug.trim();
  const fullUrl = trimmedSlug ? `${origin}/e/${trimmedSlug}` : "";
  // The link is actually reachable once ticketing is on and the slug is saved.
  const liveUrl =
    publicSlug && ticketingEnabled ? `${origin}/e/${publicSlug}` : "";
  // QR only for the saved slug, and only while ticketing is on. A typed-but-unsaved
  // slug, a blank slug, or ticketing switched off would print a code for a link
  // that does not open.
  const ticketingOn = enabled && ticketingEnabled;
  const qrReady = Boolean(publicSlug) && trimmedSlug === publicSlug && ticketingOn;
  const qrUrl =
    ticketShareQrUrl({
      origin,
      draftSlug: slug,
      savedSlug: publicSlug,
      ticketingOn,
    }) ?? "";

  async function copyLink() {
    const toCopy = fullUrl || `/e/${trimmedSlug}`;
    try {
      await navigator.clipboard.writeText(toCopy);
    } catch {
      // Fallback for older/insecure contexts.
      const ta = document.createElement("textarea");
      ta.value = toCopy;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  async function save() {
    setBusy(true);
    setErr(null);
    setSavedHint(null);

    const res = await fetch(`/api/events/${eventId}/ticketing`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ticketing_enabled: enabled,
        public_slug: slug.trim() || null,
        currency,
      }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setErr(data.error ?? "Failed to save");
      return;
    }
    setSavedHint("Saved.");
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Ticketing settings</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          When ticketing is enabled, this event has a public storefront at{" "}
          <code className="text-xs">/e/&lt;slug&gt;</code>.
        </p>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            disabled={busy}
          />
          Enable ticketing on this event
        </label>
        <div>
          <label className="block text-xs text-muted-foreground mb-1">
            Public URL slug
          </label>
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">/e/</span>
            <input
              type="text"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="holy-spirit-conference-2026"
              className="flex-1 border px-2 py-1.5"
              disabled={busy}
            />
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Lowercase letters, digits and dashes. Must be unique across events.
          </p>
        </div>

        <div>
          <label className="block text-xs text-muted-foreground mb-1">
            Selling currency
          </label>
          <select
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
            disabled={busy || currencyLocked}
            className="border px-2 py-1.5 text-sm disabled:bg-muted disabled:text-muted-foreground"
          >
            {EVENT_CURRENCIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code} — {c.name}
              </option>
            ))}
          </select>
          {currencyLocked ? (
            <p className="text-xs text-muted-foreground mt-1">
              Locked: this event already has orders. Create a new event to sell
              in a different currency.
            </p>
          ) : (
            <p className="text-xs text-muted-foreground mt-1">
              Ticket prices, promo amounts and orders all use this currency.
              {!providersForCurrency(currency).includes("payfast") &&
                " PayFast can't take this currency, so buyers will pay by card via Stripe only."}
              {currency !== savedCurrency &&
                " Saving re-calculates the display price of every fixed-price tier."}
            </p>
          )}
        </div>

        {/* Shareable storefront link — appears as soon as a slug is typed. */}
        {trimmedSlug && (
          <div className="border border-border bg-muted/40 p-3 space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Shareable ticket link
            </p>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                <input
                  readOnly
                  value={fullUrl || `/e/${trimmedSlug}`}
                  onFocus={(e) => e.currentTarget.select()}
                  className="min-w-0 w-full flex-1 border px-2 py-1.5 text-xs font-mono sm:w-auto"
                  aria-label="Public ticket link"
                />
                <button
                  type="button"
                  onClick={copyLink}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-ink text-white text-xs hover:bg-[#262622] shrink-0"
                >
                  {copied ? (
                    <>
                      <Check className="h-3.5 w-3.5" /> Copied
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5" /> Copy
                    </>
                  )}
                </button>
                <a
                  href={fullUrl || `/e/${trimmedSlug}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 border border-border text-xs hover:bg-muted shrink-0"
                >
                  <ExternalLink className="h-3.5 w-3.5" /> Open
                </a>
              </div>
              {qrReady ? (
                <ShareLinkQr
                  url={qrUrl}
                  filename={publicSlug || trimmedSlug}
                  label="QR code for the public ticket link"
                  showCopy={false}
                />
              ) : (
                <p className="text-xs text-muted-foreground">
                  Save the link to get a QR code.
                </p>
              )}
            </div>
            {(!enabled || dirty) && (
              <p className="text-[11px] text-amber">
                {!enabled
                  ? "Enable ticketing and Save to make this link live."
                  : "Save your changes to update the live link."}
              </p>
            )}
            {!dirty && enabled && liveUrl && (
              <p className="text-[11px] text-grass-text">Live now.</p>
            )}
          </div>
        )}

        {err && <p className="text-xs text-destructive">{err}</p>}
        {savedHint && <p className="text-xs text-grass-text">{savedHint}</p>}
        <div>
          <button
            type="button"
            onClick={save}
            disabled={busy || !dirty}
            className="px-3 py-1 bg-ink text-white text-xs hover:bg-[#262622] disabled:bg-[color:var(--surface-4)]"
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </CardContent>
    </Card>
  );
}
