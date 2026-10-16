"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Check, Copy, Loader2, Plus, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ffsa";
import { domainState, fullHost, normalizeDomain } from "@/lib/email/sending-domain-rules";
import type { SendingDomainRow } from "@/services/sending-domains";

// Add a domain → copy each record into DNS → "Check now". Each record shows
// its own status, so it's clear which line in the DNS still isn't right.

const fmt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-ZA", { dateStyle: "medium", timeStyle: "short" }) : "never";

function CopyButton({ value }: { value: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      aria-label="Copy"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setDone(true);
          setTimeout(() => setDone(false), 1200);
        } catch {
          toast.error("Couldn't copy — select it and copy by hand");
        }
      }}
      className="shrink-0 border border-border p-1 hover:bg-muted"
    >
      {done ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
    </button>
  );
}

export function DomainsAdmin() {
  const [rows, setRows] = useState<SendingDomainRow[] | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/communications/domains");
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      setSyncError(j.error ?? "Couldn't load domains");
      setRows([]);
      return;
    }
    setRows(j.domains);
    setSyncError(j.error ?? null);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function add() {
    const n = normalizeDomain(input);
    if ("error" in n) return void toast.error(n.error);
    setBusy("add");
    try {
      const res = await fetch("/api/communications/domains", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain: n.domain }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) return void toast.error(j.error ?? "Couldn't add the domain");
      toast.success(`${n.domain} added — now paste its DNS records`);
      setInput("");
      setOpen(j.domain.id);
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function verify(row: SendingDomainRow) {
    setBusy(row.id);
    try {
      const res = await fetch("/api/communications/domains", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: row.id, action: "verify" }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) return void toast.error(j.error ?? "Couldn't check the domain");
      const st = domainState(j.domain.resend_status);
      if (j.domain.resend_status === "verified") toast.success(`${row.domain} is verified and can send`);
      else toast.message(`${row.domain}: ${st.label}. DNS changes can take a few minutes to an hour — check again soon.`);
      await load();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-5">
      <section className="border border-ink bg-white">
        <div className="flex flex-wrap items-end gap-2 px-4 py-3">
          <label className="min-w-[240px] flex-1 text-xs">
            <span className="mb-1 block font-mono text-[10px] font-bold uppercase tracking-[0.12em]">Add a domain</span>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && add()}
              placeholder="e.g. ffglobal.org"
              className="h-9 w-full border border-input px-2 text-sm"
              disabled={busy !== null}
            />
          </label>
          <Button size="sm" onClick={add} disabled={busy !== null || !input.trim()}>
            {busy === "add" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Plus className="mr-1 h-3.5 w-3.5" />}
            Add domain
          </Button>
        </div>
        <p className="border-t border-rule bg-bone px-4 py-2 text-xs text-[color:var(--text-secondary)]">
          Use a domain FFSA owns and can edit the DNS for. Adding it changes nothing until its records are in place.
        </p>
      </section>

      {syncError && <p className="text-xs text-destructive">Resend: {syncError}</p>}
      {!rows && <p className="text-sm text-muted-foreground">Reading Resend…</p>}

      {rows && (
        <section className="border border-ink bg-white">
          {rows.length === 0 && <p className="px-4 py-6 text-sm text-muted-foreground">No domains yet.</p>}
          <div className="divide-y divide-rule">
            {rows.map((d) => {
              const st = domainState(d.resend_status);
              const isOpen = open === d.id;
              const records = d.resend_records ?? [];
              return (
                <div key={d.id}>
                  <div className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <div className="min-w-[180px] flex-1">
                      <p className="font-mono text-sm font-bold">{d.domain}</p>
                      <p className="text-[11px] text-[color:var(--text-secondary)]">
                        {d.can_receive ? "Sends + receives (Hub inbox)" : "Sends only"}
                        {d.resend_region ? ` · ${d.resend_region}` : ""} · checked {fmt(d.resend_checked_at)}
                      </p>
                    </div>
                    <StatusPill tone={st.tone}>{st.label}</StatusPill>
                    {records.length > 0 && (
                      <Button size="sm" variant="outline" onClick={() => setOpen(isOpen ? null : d.id)}>
                        {isOpen ? "Hide" : "DNS records"}
                      </Button>
                    )}
                    <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => verify(d)}>
                      {busy === d.id ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1 h-3.5 w-3.5" />}
                      {d.resend_domain_id ? "Check now" : "Add to Resend"}
                    </Button>
                  </div>

                  {isOpen && (
                    <div className="border-t border-rule bg-bone/60 px-4 py-3">
                      <p className="mb-2 text-xs text-[color:var(--text-secondary)]">
                        Add each record in {d.domain}&rsquo;s DNS settings. Most providers add the domain to the end of
                        the name for you — if yours doesn&rsquo;t, use the full name shown underneath.
                      </p>
                      <div className="overflow-x-auto">
                        <table className="w-full min-w-[640px] text-left text-[12px]">
                          <thead>
                            <tr className="font-mono text-[9px] uppercase tracking-[0.12em] text-[color:var(--text-secondary)]">
                              <th className="py-1 pr-2">For</th>
                              <th className="py-1 pr-2">Type</th>
                              <th className="py-1 pr-2">Name</th>
                              <th className="py-1 pr-2">Value</th>
                              <th className="py-1 pr-2">Priority</th>
                              <th className="py-1">Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {records.map((r, i) => {
                              const rs = domainState(r.status);
                              return (
                                <tr key={i} className="border-t border-rule align-top">
                                  <td className="py-2 pr-2">{r.record}</td>
                                  <td className="py-2 pr-2 font-mono">{r.type}</td>
                                  <td className="py-2 pr-2">
                                    <div className="flex items-center gap-1">
                                      <code className="break-all">{r.name}</code>
                                      <CopyButton value={r.name} />
                                    </div>
                                    <span className="block text-[10px] text-[color:var(--text-tertiary)]">
                                      {fullHost(r.name, d.domain)}
                                    </span>
                                  </td>
                                  <td className="max-w-[320px] py-2 pr-2">
                                    <div className="flex items-start gap-1">
                                      <code className="break-all">{r.value}</code>
                                      <CopyButton value={r.value} />
                                    </div>
                                  </td>
                                  <td className="py-2 pr-2 font-mono">{r.priority ?? "—"}</td>
                                  <td className="py-2">
                                    <StatusPill tone={rs.tone}>{r.status === "verified" ? "OK" : rs.label}</StatusPill>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                      {d.dmarc_ok !== true && (
                        <p className="mt-3 text-xs text-[color:var(--text-secondary)]">
                          Recommended too (helps inbox placement): a TXT record named <code>_dmarc</code> with the value{" "}
                          <code>v=DMARC1; p=none;</code>
                        </p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
