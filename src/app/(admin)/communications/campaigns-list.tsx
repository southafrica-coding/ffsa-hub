"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Plus, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { getLabelColors } from "@/lib/label-color";
import { CAMPAIGN_TEMPLATES } from "@/lib/campaigns/templates";

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

const STATUS_CLASS: Record<string, string> = {
  draft: "status-grey",
  scheduled: "status-yellow",
  sending: "status-yellow",
  sent: "status-green",
  failed: "status-red",
  cancelled: "status-grey",
};

export function CampaignsList({
  campaigns,
  labels,
  identities,
}: {
  campaigns: Campaign[];
  labels: Label[];
  identities: Identity[];
}) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [labelIds, setLabelIds] = useState<string[]>([]);
  const [identityId, setIdentityId] = useState(identities[0]?.id ?? "");
  const [templateId, setTemplateId] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

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
    if (labelIds.length === 0) return setErr("Pick at least one audience label.");
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

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">Emails</CardTitle>
        {!creating && (
          <Button size="sm" className="gap-1" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" />
            New email
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {creating && (
          <div className="rounded-lg border bg-muted/30 p-4 space-y-4">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">
                Start from
              </p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-1.5">
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
              <label className="block">
                <span className="block text-muted-foreground mb-1 text-xs">
                  Audience labels (OR — anyone with ANY)
                </span>
                <div className="space-y-2">
                  {selectedLabels.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {selectedLabels.map((l) => (
                        <span
                          key={l.id}
                          className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border bg-card"
                        >
                          {l.name}
                          <button
                            type="button"
                            onClick={() => removeLabel(l.id)}
                            className="hover:text-red-400"
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
              </label>
              <label className="block">
                <span className="block text-muted-foreground mb-1 text-xs">
                  Send from
                </span>
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
            {err && <p className="text-xs text-red-400">{err}</p>}
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
          <p className="text-sm text-muted-foreground italic">No emails yet.</p>
        ) : (
          <div className="rounded-lg border bg-card overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Audience</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>When</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {campaigns.map((c) => {
                  const cLabels = (c.campaign_labels ?? [])
                    .map((cl) => cl.labels)
                    .filter(
                      (l): l is { id: string; slug: string; name: string; color: string | null } =>
                        !!l
                    );
                  return (
                    <TableRow key={c.id}>
                      <TableCell>
                        <Link
                          href={`/communications/campaigns/${c.id}`}
                          className="font-medium text-foreground hover:underline"
                        >
                          {c.name}
                        </Link>
                        {c.subject && (
                          <div className="text-xs text-muted-foreground">
                            {c.subject}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        {cLabels.length === 0 ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {cLabels.map((l) => {
                              const col = getLabelColors(l);
                              return (
                                <span
                                  key={l.id}
                                  className="inline-flex items-center text-xs px-2 py-0.5 rounded-full border font-medium"
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
                        )}
                      </TableCell>
                      <TableCell>
                        <span
                          className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium capitalize ${
                            STATUS_CLASS[c.status] ?? "status-grey"
                          }`}
                        >
                          {c.status}
                        </span>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-xs">
                        {c.sent_at
                          ? `Sent ${new Date(c.sent_at).toLocaleString()}`
                          : c.scheduled_at
                          ? `Scheduled ${new Date(c.scheduled_at).toLocaleString()}`
                          : "—"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
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
      className={`text-left rounded-lg border p-2.5 transition-colors ${
        active
          ? "border-foreground bg-foreground/5"
          : "border-border hover:bg-muted/50"
      }`}
    >
      <div className="font-semibold text-xs">{name}</div>
      <div className="text-[10px] text-muted-foreground leading-snug mt-0.5 line-clamp-2">
        {tagline}
      </div>
    </button>
  );
}
