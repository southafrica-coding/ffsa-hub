"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Plus, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { StatusPill } from "@/components/ffsa";
import { fillPlaceholders, placeholderValues, renderInvoiceEmail } from "@/lib/finance/invoice-email";

export interface EditorTemplate {
  id: string;
  name: string;
  xero_region: "za" | "us";
  subject: string;
  body: string;
  include_online_action: boolean;
  is_default: boolean;
  updated_at: string;
}

const PLACEHOLDERS = Object.keys(
  placeholderValues({
    contactFirstName: "",
    contactName: "",
    tradingName: "",
    invoiceNumber: "",
    currencyCode: "",
    invoiceTotal: 0,
    amountDue: 0,
    dueDate: "2027-01-01",
    onlineInvoiceUrl: null,
  })
);

const SAMPLE = {
  contactFirstName: "Sample",
  contactName: "Sample Person 202",
  tradingName: "Fire & Fragrance SA NPC",
  invoiceNumber: "INV-12345",
  currencyCode: "ZAR",
  invoiceTotal: 51000,
  amountDue: 45000,
  dueDate: "2027-03-04",
  onlineInvoiceUrl: "https://in.xero.com/sample",
};

export function InvoiceEmailTemplatesEditor({
  templates,
  usedBy,
  canEdit,
}: {
  templates: EditorTemplate[];
  usedBy: Record<string, string[]>;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | "new-za" | "new-us">(templates[0]?.id ?? "new-za");
  const selected = templates.find((t) => t.id === selectedId);
  const blank = (region: "za" | "us"): EditorTemplate => ({
    id: "",
    name: "",
    xero_region: region,
    subject: "Invoice [Invoice Number] from [Trading Name] for [Contact Name]",
    body: "Hi [Contact First Name],\n\n",
    include_online_action: true,
    is_default: false,
    updated_at: "",
  });
  const [draft, setDraft] = useState<EditorTemplate>(selected ?? blank("za"));
  const [busy, setBusy] = useState<string | null>(null);

  const pick = (id: string) => {
    setSelectedId(id as typeof selectedId);
    const t = templates.find((x) => x.id === id);
    setDraft(t ?? blank(id === "new-us" ? "us" : "za"));
  };

  const preview = useMemo(
    () => renderInvoiceEmail(draft, { ...SAMPLE, tradingName: draft.xero_region === "us" ? "FF SA USA, Inc" : SAMPLE.tradingName }),
    [draft]
  );
  const unknown = useMemo(() => {
    const v = placeholderValues(SAMPLE);
    return [...new Set([...fillPlaceholders(draft.subject, v).unknown, ...fillPlaceholders(draft.body, v).unknown])];
  }, [draft]);
  const dirty =
    !selected ||
    selected.name !== draft.name ||
    selected.subject !== draft.subject ||
    selected.body !== draft.body ||
    selected.include_online_action !== draft.include_online_action;

  async function save() {
    setBusy("save");
    try {
      const res = await fetch("/api/finance/school-fees/invoice-email-templates", {
        method: selected ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(selected ? { ...draft, id: selected.id } : draft),
      });
      const j = await res.json();
      if (!res.ok) return toast.error(j.error || "Couldn't save");
      toast.success("Template saved");
      setSelectedId(j.template.id);
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function sendTest() {
    if (!selected) return;
    setBusy("test");
    try {
      const res = await fetch("/api/finance/school-fees/invoice-email-templates/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId: selected.id }),
      });
      const j = await res.json();
      if (!res.ok) return toast.error(j.error || "Couldn't send");
      toast.success(`Test sent to ${j.to}`);
    } finally {
      setBusy(null);
    }
  }

  const group = (region: "za" | "us") => templates.filter((t) => t.xero_region === region);

  return (
    <div className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
      <nav className="space-y-5">
        {(["za", "us"] as const).map((region) => (
          <div key={region}>
            <p className="mb-1 font-mono text-[10px] font-bold uppercase tracking-[0.14em]">
              {region === "za" ? "SA · Fire & Fragrance SA NPC" : "US · FF SA USA, Inc"}
            </p>
            <ul className="border border-rule-strong bg-white">
              {group(region).map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => pick(t.id)}
                    className={`flex w-full items-center justify-between gap-2 border-b border-rule px-3 py-2 text-left text-[13px] last:border-0 ${
                      selectedId === t.id ? "bg-ink text-white" : "hover:bg-bone"
                    }`}
                  >
                    <span className="truncate">{t.name}</span>
                    {t.is_default && <span className="font-mono text-[9px] uppercase opacity-70">default</span>}
                  </button>
                </li>
              ))}
            </ul>
            {canEdit && (
              <button
                type="button"
                onClick={() => pick(region === "za" ? "new-za" : "new-us")}
                className="mt-1 inline-flex items-center gap-1 text-xs underline"
              >
                <Plus className="h-3 w-3" /> New {region === "za" ? "SA" : "US"} template
              </button>
            )}
          </div>
        ))}
      </nav>

      <div className="grid gap-6 xl:grid-cols-2">
        <div className="space-y-3 border border-ink bg-white p-4">
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill tone="quiet">{draft.xero_region === "za" ? "SA" : "US"}</StatusPill>
            {selected && (usedBy[selected.id]?.length ?? 0) > 0 && (
              <span className="text-xs text-[color:var(--text-secondary)]">Used by {usedBy[selected.id].join(", ")}</span>
            )}
          </div>
          <label className="block text-xs font-semibold">
            Name
            <Input value={draft.name} disabled={!canEdit} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </label>
          <label className="block text-xs font-semibold">
            Subject
            <Input value={draft.subject} disabled={!canEdit} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} />
          </label>
          <label className="block text-xs font-semibold">
            Message
            <Textarea
              rows={18}
              className="font-mono text-[12px]"
              value={draft.body}
              disabled={!canEdit}
              onChange={(e) => setDraft({ ...draft, body: e.target.value })}
            />
          </label>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={draft.include_online_action}
              disabled={!canEdit}
              onChange={(e) => setDraft({ ...draft, include_online_action: e.target.checked })}
            />
            Include action to online invoice and detail summary
          </label>
          <p className="text-[11px] text-[color:var(--text-secondary)]">
            Placeholders: {PLACEHOLDERS.map((p) => `[${p}]`).join(" ")}
          </p>
          {unknown.length > 0 && (
            <p className="text-xs text-destructive">Not a placeholder: {unknown.map((u) => `[${u}]`).join(", ")}</p>
          )}
          {canEdit && (
            <div className="flex flex-wrap gap-2">
              <Button disabled={!dirty || unknown.length > 0 || !draft.name.trim() || busy !== null} onClick={save}>
                {busy === "save" && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
                {selected ? "Save template" : "Create template"}
              </Button>
              {selected && (
                <Button variant="outline" disabled={busy !== null || dirty} onClick={sendTest} title={dirty ? "Save first" : undefined}>
                  {busy === "test" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Send className="mr-1 h-3.5 w-3.5" />}
                  Send test to me
                </Button>
              )}
            </div>
          )}
        </div>

        <div className="space-y-2">
          <p className="font-mono text-[10px] font-bold uppercase tracking-[0.14em]">Preview · sample invoice</p>
          <div className="border border-rule-strong bg-white">
            <div className="border-b border-rule px-3 py-2 text-xs">
              <div>
                <span className="text-[color:var(--text-secondary)]">From:</span> Finance office &lt;finance@ffsouthafrica.com&gt;
              </div>
              <div>
                <span className="text-[color:var(--text-secondary)]">Subject:</span> {preview.subject}
              </div>
              <div>
                <span className="text-[color:var(--text-secondary)]">Attached:</span> Invoice {SAMPLE.invoiceNumber}.pdf
              </div>
            </div>
            <iframe title="Email preview" className="h-[640px] w-full" srcDoc={preview.html} sandbox="" />
          </div>
        </div>
      </div>
    </div>
  );
}
