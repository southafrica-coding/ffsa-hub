"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Plus, X, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SectionBar, StatusPill, type Tone } from "@/components/ffsa";
import { CAMPAIGN_TEMPLATES } from "@/lib/campaigns/templates";
import { getLabelColors } from "@/lib/label-color";
import type { CampaignStats } from "@/services/campaigns";

type Label = { id: string; slug: string; name: string; color: string | null };
type Identity = { id: string; display_name: string; from_email: string };

type Campaign = {
  id: string;
  name: string;
  subject: string;
  status: string;
  scheduled_at: string | null;
  sent_at: string | null;
  campaign_labels: {
    labels: { id: string; slug: string; name: string; color: string | null } | null;
  }[] | null;
};


/**
 * Rate as a whole percent of a base, matching CampaignAnalytics on the detail
 * page exactly. An em dash whenever the base is zero — an email that hasn't
 * been delivered to anyone has no rate, and "0%" would read as a failure.
 * This is also what every row shows until migration 164 creates
 * v_campaign_stats and the stats map starts coming back populated.
 */
function pct(n: number, d: number): string {
  if (!d || d <= 0) return "—";
  return `${Math.round((n / d) * 100)}%`;
}

const STATUS_TONE: Record<string, Tone> = {
  draft: "quiet",
  scheduled: "warn",
  sending: "warn",
  sent: "good",
  failed: "bad",
  cancelled: "quiet",
};

type CampaignLabel = {
  id: string;
  slug: string;
  name: string;
  color: string | null;
};

function campaignLabels(c: Campaign): CampaignLabel[] {
  return (c.campaign_labels ?? [])
    .map((cl) => cl.labels)
    .filter((l): l is CampaignLabel => !!l);
}

// Same clock as the composer banner (formatSast in campaign-composer.tsx):
// Africa/Johannesburg, labelled SAST, so a laptop in another zone cannot
// show a different send time from the one the composer promised.
function formatScheduledSast(when: Date): string {
  return `${when.toLocaleString("en-ZA", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Africa/Johannesburg",
  })} SAST`;
}

function campaignWhen(c: Campaign): string {
  if (c.sent_at) return `Sent ${new Date(c.sent_at).toLocaleString()}`;
  if (c.scheduled_at) {
    const when = new Date(c.scheduled_at);
    if (!Number.isNaN(when.getTime())) return `Scheduled ${formatScheduledSast(when)}`;
  }
  return "—";
}

function AudienceChips({ labels }: { labels: CampaignLabel[] }) {
  if (labels.length === 0) {
    return <span className="text-[color:var(--text-tertiary)]">—</span>;
  }
  return (
    <div className="flex flex-wrap gap-1">
      {labels.map((l) => {
        const col = getLabelColors(l);
        return (
          <span
            key={l.id}
            className="inline-flex items-center border px-2 py-0.5 text-xs font-medium"
            style={{
              backgroundColor: col.bg,
              color: col.text,
              borderColor: col.border,
            }}
          >
            {l.name}
          </span>
        );
      })}
    </div>
  );
}

export function CampaignsList({
  campaigns,
  labels,
  identities,
  stats,
}: {
  campaigns: Campaign[];
  labels: Label[];
  identities: Identity[];
  /** Delivery counters keyed by campaign id. Absent/empty = no rates yet. */
  stats?: Record<string, CampaignStats>;
}) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [labelIds, setLabelIds] = useState<string[]>([]);
  const [identityId, setIdentityId] = useState(identities[0]?.id ?? "");
  const [templateId, setTemplateId] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Delete a draft email (only drafts can be deleted from here).
  async function deleteEmail(id: string, emailName: string) {
    if (!confirm(`Delete draft "${emailName}"? This can't be undone.`)) return;
    setDeletingId(id);
    const res = await fetch(`/api/campaigns/${id}`, { method: "DELETE" });
    setDeletingId(null);
    if (res.ok) {
      router.refresh();
    } else {
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      alert(d.error ?? "Could not delete this email.");
    }
  }

  const labelById = useMemo(() => {
    const map = new Map<string, Label>();
    for (const l of labels) map.set(l.id, l);
    return map;
  }, [labels]);

  const selectedLabels = labelIds
    .map((id) => labelById.get(id))
    .filter((l): l is Label => !!l);
  const availableLabels = labels.filter((l) => !labelIds.includes(l.id));

  function addLabel(id: string) {
    if (!id || labelIds.includes(id)) return;
    setLabelIds((ids) => [...ids, id]);
  }
  function removeLabel(id: string) {
    setLabelIds((ids) => ids.filter((x) => x !== id));
  }

  async function create() {
    if (!name.trim()) return setErr("Email name is required.");
    if (!identityId) return setErr("Pick a sending identity.");
    setBusy(true);
    setErr(null);
    const res = await fetch("/api/campaigns", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name.trim(),
        labelIds,
        sendingIdentityId: identityId,
        templateId: templateId || undefined,
      }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setErr(data.error ?? "Failed to create email");
      return;
    }
    const { campaign } = (await res.json()) as { campaign: { id: string } };
    router.push(`/communications/campaigns/${campaign.id}`);
  }

  const draftCount = campaigns.filter((c) => c.status === "draft").length;

  return (
    <div className="border border-ink bg-white">
      <SectionBar
        title="Emails"
        meta={`${campaigns.length} total · ${draftCount} draft`}
      />

      <div className="flex items-center justify-between gap-3 border-b border-rule bg-bone px-5 py-3">
        <span className="mono-label">Sent to your contact labels</span>
        {!creating && (
          <Button size="sm" className="gap-1" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" />
            New email
          </Button>
        )}
      </div>

      <div>
        {creating && (
          <div className="space-y-4 border-b border-rule bg-bone px-5 py-4">
            <div>
              <p className="mono-label mb-2">Start from</p>
              <div className="grid grid-cols-1 gap-1.5 min-[480px]:grid-cols-2 lg:grid-cols-4">
                <TemplateChip
                  active={templateId === ""}
                  name="Blank"
                  tagline="An empty canvas with a single starter block."
                  onClick={() => setTemplateId("")}
                />
                {CAMPAIGN_TEMPLATES.map((t) => (
                  <TemplateChip
                    key={t.id}
                    active={templateId === t.id}
                    name={t.name}
                    tagline={t.tagline}
                    onClick={() => setTemplateId(t.id)}
                  />
                ))}
              </div>
            </div>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Email name (internal)"
              disabled={busy}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              {/* div, not label: a click inside a <label> is forwarded to its
                  first button — a chip's ✕ — so clicking a name removed it. */}
              <div className="block">
                <span className="mono-label mb-1 block">
                  Audience labels (OR — anyone with ANY; optional — you can hand-pick contacts in the editor)
                </span>
                <div className="space-y-2">
                  {selectedLabels.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {selectedLabels.map((l) => (
                        <span
                          key={l.id}
                          className="inline-flex items-center gap-1 border border-rule-strong bg-white px-2 py-0.5 text-xs"
                        >
                          {l.name}
                          <button
                            type="button"
                            onClick={() => removeLabel(l.id)}
                            className="hover:text-destructive"
                            aria-label={`Remove ${l.name}`}
                            disabled={busy}
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                  {availableLabels.length > 0 && (
                    <select
                      value=""
                      onChange={(e) => {
                        addLabel(e.target.value);
                        e.target.value = "";
                      }}
                      disabled={busy}
                      className="w-full px-2 py-1.5"
                    >
                      <option value="">+ Add a label…</option>
                      {availableLabels.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.name}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              </div>
              <label className="block">
                <span className="mono-label mb-1 block">Send from</span>
                <select
                  value={identityId}
                  onChange={(e) => setIdentityId(e.target.value)}
                  className="w-full px-2 py-1.5"
                  disabled={busy}
                >
                  <option value="">— pick an identity —</option>
                  {identities.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.display_name} ({i.from_email})
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {err && <p className="text-xs text-destructive">{err}</p>}
            <div className="flex gap-2">
              <Button size="sm" onClick={create} disabled={busy}>
                Create &amp; open composer
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setCreating(false);
                  setErr(null);
                }}
                disabled={busy}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

        {campaigns.length === 0 ? (
          <p className="px-5 py-10 text-center text-xs tracking-[0.05em] text-[color:var(--text-tertiary)]">
            No emails yet.
          </p>
        ) : (
          <>
            <div className="md:hidden">
              {campaigns.map((c) => {
                const s = stats?.[c.id];
                const delivered = s?.delivered ?? 0;
                const quiet = delivered > 0 ? "" : "text-[color:var(--text-tertiary)]";
                return (
                  <div
                    key={c.id}
                    className="border-b border-rule px-4 py-3.5 last:border-b-0"
                  >
                    <div className="flex items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <Link
                          href={`/communications/campaigns/${c.id}`}
                          className="block break-words font-display text-[20px] font-black uppercase leading-none text-[color:var(--text-primary)]"
                        >
                          {c.name}
                        </Link>
                        {c.subject && (
                          <p className="mt-1 text-[12px] text-[color:var(--text-tertiary)]">
                            {c.subject}
                          </p>
                        )}
                      </div>
                      {c.status === "draft" && (
                        <button
                          type="button"
                          onClick={() => deleteEmail(c.id, c.name)}
                          disabled={deletingId === c.id}
                          title="Delete draft"
                          aria-label={`Delete draft ${c.name}`}
                          className="inline-flex h-11 w-11 shrink-0 items-center justify-center text-[color:var(--text-tertiary)] hover:text-destructive disabled:opacity-40"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <AudienceChips labels={campaignLabels(c)} />
                      <StatusPill tone={STATUS_TONE[c.status] ?? "quiet"}>
                        {c.status}
                      </StatusPill>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px]">
                      <span className={`tabular ${quiet}`}>
                        Opened {pct(s?.opened ?? 0, delivered)}
                      </span>
                      <span className={`tabular ${quiet}`}>
                        Clicked {pct(s?.clicked ?? 0, delivered)}
                      </span>
                      <span className="tabular text-[color:var(--text-tertiary)]">
                        {campaignWhen(c)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Audience</TableHead>
                  <TableHead>Status</TableHead>
                  {/* Percentages of DELIVERED, same base as the detail page. */}
                  <TableHead className="text-right">Opened</TableHead>
                  <TableHead className="text-right">Clicked</TableHead>
                  <TableHead>When</TableHead>
                  <TableHead className="w-10 text-right"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {campaigns.map((c) => {
                  const cLabels = campaignLabels(c);
                  const s = stats?.[c.id];
                  const delivered = s?.delivered ?? 0;
                  return (
                    <TableRow key={c.id}>
                      <TableCell>
                        <Link
                          href={`/communications/campaigns/${c.id}`}
                          className="font-medium text-[color:var(--text-primary)] hover:underline"
                        >
                          {c.name}
                        </Link>
                        {c.subject && (
                          <div className="text-xs text-[color:var(--text-tertiary)]">
                            {c.subject}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <AudienceChips labels={cLabels} />
                      </TableCell>
                      <TableCell>
                        <StatusPill tone={STATUS_TONE[c.status] ?? "quiet"}>
                          {c.status}
                        </StatusPill>
                      </TableCell>
                      <TableCell
                        className={`tabular text-right text-sm ${
                          delivered > 0
                            ? ""
                            : "text-[color:var(--text-tertiary)]"
                        }`}
                      >
                        {pct(s?.opened ?? 0, delivered)}
                      </TableCell>
                      <TableCell
                        className={`tabular text-right text-sm ${
                          delivered > 0
                            ? ""
                            : "text-[color:var(--text-tertiary)]"
                        }`}
                      >
                        {pct(s?.clicked ?? 0, delivered)}
                      </TableCell>
                      <TableCell className="tabular text-xs text-[color:var(--text-tertiary)]">
                        {campaignWhen(c)}
                      </TableCell>
                      <TableCell className="text-right">
                        {c.status === "draft" && (
                          <button
                            type="button"
                            onClick={() => deleteEmail(c.id, c.name)}
                            disabled={deletingId === c.id}
                            title="Delete draft"
                            aria-label={`Delete draft ${c.name}`}
                            className="inline-flex h-7 w-7 items-center justify-center text-[color:var(--text-tertiary)] hover:text-destructive disabled:opacity-40"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function TemplateChip({
  active,
  name,
  tagline,
  onClick,
}: {
  active: boolean;
  name: string;
  tagline: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`border p-2.5 text-left transition-colors ${
        active ? "border-ink bg-white" : "border-rule bg-white hover:border-ink"
      }`}
    >
      <div className="mono-label !text-[color:var(--text-primary)]">{name}</div>
      <div className="mt-1 line-clamp-2 text-[11px] normal-case leading-snug tracking-normal text-[color:var(--text-tertiary)]">
        {tagline}
      </div>
    </button>
  );
}
