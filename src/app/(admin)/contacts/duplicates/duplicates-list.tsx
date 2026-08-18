"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  GitMerge,
  Phone,
  User as UserIcon,
  Mail,
  AlertTriangle,
  Check,
  ExternalLink,
  ShieldCheck,
} from "lucide-react";


type DuplicateContact = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
  email: string | null;
  phone: string | null;
  phone_normalized: string | null;
  created_at: string;
  status: string | null;
};

type Cluster = {
  key: string;
  reasons: string[];
  signals: { name: boolean; phone: boolean };
  contacts: DuplicateContact[];
};

function displayName(c: DuplicateContact): string {
  const n = [c.first_name, c.last_name].filter(Boolean).join(" ").trim();
  return n || c.preferred_name || c.email || "Unnamed contact";
}

export function DuplicatesList({ clusters }: { clusters: Cluster[] }) {
  const [merged, setMerged] = useState<Set<string>>(new Set());
  const visible = clusters.filter((c) => !merged.has(c.key));

  if (clusters.length === 0 || visible.length === 0) {
    return (
      <div className="border border-ink bg-white px-5 py-10 text-center">
        <ShieldCheck className="mx-auto mb-3 h-7 w-7 text-[color:var(--text-tertiary)]" />
        <p className="mono-label">No possible duplicates</p>
        <p className="mt-2 text-xs text-[color:var(--text-secondary)]">
          {clusters.length === 0
            ? "Every contact looks distinct by name and phone."
            : "You've reviewed all of them. Nice work."}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {visible.length} possible duplicate{visible.length === 1 ? "" : "s"} to
        review
      </p>
      {visible.map((c) => (
        <ClusterCard
          key={c.key}
          cluster={c}
          onMerged={() =>
            setMerged((prev) => {
              const next = new Set(prev);
              next.add(c.key);
              return next;
            })
          }
        />
      ))}
    </div>
  );
}

function ClusterCard({
  cluster,
  onMerged,
}: {
  cluster: Cluster;
  onMerged: () => void;
}) {
  const router = useRouter();
  const [survivorId, setSurvivorId] = useState(cluster.contacts[0].id);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const survivor =
    cluster.contacts.find((c) => c.id === survivorId) ?? cluster.contacts[0];
  const others = cluster.contacts.filter((c) => c.id !== survivorId);

  async function doMerge() {
    setBusy(true);
    setError(null);
    let count = 0;
    for (const src of others) {
      count += 1;
      setProgress(`Merging ${count}/${others.length}…`);
      const res = await fetch(`/api/contacts/${src.id}/merge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetId: survivorId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(
          body.error ?? `Failed to merge ${displayName(src)}. Nothing further changed.`
        );
        setBusy(false);
        setProgress(null);
        router.refresh();
        return;
      }
    }
    setBusy(false);
    setProgress(null);
    onMerged();
    router.refresh();
  }

  return (
    <div className="rounded-lg border bg-card p-4 sm:p-5">
      {/* Signals / reasons */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        {cluster.signals.phone && (
          <SignalChip icon={<Phone className="h-3 w-3" />} label="Shared phone" />
        )}
        {cluster.signals.name && (
          <SignalChip icon={<UserIcon className="h-3 w-3" />} label="Same name" />
        )}
        {cluster.reasons.map((r) => (
          <span
            key={r}
            className="text-[11px] text-muted-foreground font-mono px-2 py-0.5 rounded bg-muted/40"
          >
            {r}
          </span>
        ))}
        <span className="ml-auto text-xs text-muted-foreground">
          {cluster.contacts.length} contacts
        </span>
      </div>

      {/* Contacts — pick which one survives */}
      <div className="grid gap-3 sm:grid-cols-2">
        {cluster.contacts.map((c) => {
          const selected = c.id === survivorId;
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => !busy && setSurvivorId(c.id)}
              disabled={busy}
              className={`border p-3 text-left transition-colors disabled:opacity-60 ${
                selected ? "border-ink bg-yellow-dim" : "border-rule-strong bg-white"
              }`}
            >
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className={`inline-flex h-4 w-4 shrink-0 items-center justify-center border ${
                      selected ? "border-ink bg-ink" : "border-rule-strong"
                    }`}
                  >
                    {selected && <Check className="h-3 w-3 text-yellow" />}
                  </span>
                  <span className="text-sm font-medium truncate">
                    {displayName(c)}
                  </span>
                </div>
                {selected ? (
                  <span
                    className="bg-ink px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-yellow"
                  >
                    Keep
                  </span>
                ) : (
                  <span className="mono-label">will merge</span>
                )}
              </div>

              {c.preferred_name &&
                c.preferred_name !==
                  [c.first_name, c.last_name].filter(Boolean).join(" ") && (
                  <p className="text-xs text-muted-foreground mb-1">
                    “{c.preferred_name}”
                  </p>
                )}

              <p className="text-xs text-muted-foreground flex items-center gap-1.5 truncate">
                <Mail className="h-3 w-3 shrink-0" />
                {c.email || <span className="italic">no email</span>}
              </p>
              <p className="text-xs text-muted-foreground flex items-center gap-1.5 truncate mt-0.5">
                <Phone className="h-3 w-3 shrink-0" />
                {c.phone || c.phone_normalized || (
                  <span className="italic">no phone</span>
                )}
              </p>

              <div className="flex items-center justify-between mt-2">
                <span className="text-[11px] text-muted-foreground">
                  Added {c.created_at.slice(0, 10)}
                </span>
                <a
                  href={`/contacts/${c.id}`}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="text-[11px] inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
                >
                  View <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            </button>
          );
        })}
      </div>

      {/* Action */}
      <div className="mt-4">
        {!confirming ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setConfirming(true)}
          >
            <GitMerge className="h-3.5 w-3.5 mr-1.5" />
            Merge {others.length} into {displayName(survivor)}
          </Button>
        ) : (
          <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3">
            <p className="text-sm flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-red-400" />
              <span>
                Merge{" "}
                <span className="font-medium">
                  {others.map(displayName).join(", ")}
                </span>{" "}
                into{" "}
                <span className="font-medium">{displayName(survivor)}</span> and
                delete{" "}
                {others.length === 1 ? "that contact" : "those contacts"}? All
                their history moves to the kept contact. This can&apos;t be
                undone.
              </span>
            </p>
            <div className="mt-3 flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                onClick={doMerge}
                disabled={busy}
                className="bg-red-500/15 border border-red-500/30 text-red-400 hover:bg-red-500/25"
              >
                {busy ? progress ?? "Merging…" : "Confirm merge"}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setConfirming(false)}
                disabled={busy}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </div>

      {error && <p className="text-sm text-red-400 mt-3">{error}</p>}
    </div>
  );
}

function SignalChip({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 border border-rule-strong px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-[#55524A]"
    >
      {icon}
      {label}
    </span>
  );
}
