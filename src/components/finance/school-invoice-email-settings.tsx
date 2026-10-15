"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

// Which Xero email template and branding theme a school's invoices use, per
// Xero organisation (migration 237). SA and US invoices word the same school
// differently, and each theme prints that school's bank details.

type Region = "za" | "us";
export interface TemplateOption {
  id: string;
  name: string;
  xero_region: Region;
  is_default: boolean;
}

const LABEL: Record<Region, { title: string; hint: string }> = {
  za: { title: "SA invoices", hint: "South African and international students (Fire & Fragrance SA NPC)" },
  us: { title: "US invoices", hint: "USA students (FF SA USA, Inc) — paid by Stripe on the Xero invoice" },
};

const selectCls =
  "h-9 w-full rounded-md border border-input bg-background px-2 text-sm disabled:cursor-not-allowed disabled:opacity-50";

export function SchoolInvoiceEmailSettings({
  programId,
  canEdit,
  templates,
  initial,
}: {
  programId: string;
  canEdit: boolean;
  templates: TemplateOption[];
  initial: Record<Region, { templateId: string | null; theme: string | null }>;
}) {
  const router = useRouter();
  const [values, setValues] = useState(initial);
  const [themes, setThemes] = useState<Record<Region, string[] | null> | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch("/api/integrations/xero/branding-themes")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => live && setThemes(j ? { za: j.za, us: j.us } : { za: null, us: null }))
      .catch(() => live && setThemes({ za: null, us: null }));
    return () => {
      live = false;
    };
  }, []);

  async function save(region: Region, field: "templateId" | "theme", value: string | null) {
    const key = field === "templateId" ? `email_template_${region}_id` : `xero_branding_theme_${region}`;
    setSaving(`${region}.${field}`);
    try {
      const res = await fetch("/api/finance/school-fees/program-billing-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ programId, [key]: value }),
      });
      const j = await res.json();
      if (!res.ok) {
        toast.error(j.error || "Couldn't save");
        return;
      }
      setValues((v) => ({ ...v, [region]: { ...v[region], [field]: value } }));
      toast.success("Saved");
      router.refresh();
    } finally {
      setSaving(null);
    }
  }

  return (
    <section className="border border-rule-strong bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-rule-strong px-4 py-3">
        <h2 className="font-mono text-[11px] font-bold uppercase tracking-[0.14em]">Invoice emails</h2>
        <Link href="/finance/school-fees/email-templates" className="font-mono text-[10px] font-bold uppercase tracking-[0.12em] underline">
          Edit templates →
        </Link>
      </div>
      <p className="border-b border-rule px-4 py-2 text-xs text-[color:var(--text-secondary)]">
        The Hub emails each invoice from the school&apos;s Xero template — same wording, bank details, SnapScan or
        Stripe links — sent as &ldquo;Finance office&rdquo; with replies to finance@ffsouthafrica.com, the Xero
        PDF attached. The branding theme is what Xero prints on the invoice itself.
      </p>
      <div className="divide-y divide-rule">
        {(["za", "us"] as Region[]).map((region) => {
          const list = templates.filter((t) => t.xero_region === region);
          const fallback = list.find((t) => t.is_default)?.name ?? "Basic";
          const themeList = themes?.[region];
          const current = values[region];
          return (
            <div key={region} className="grid gap-3 px-4 py-3 md:grid-cols-[1fr_1fr_1fr] md:items-end">
              <div>
                <p className="text-[13px] font-semibold">{LABEL[region].title}</p>
                <p className="text-xs text-[color:var(--text-secondary)]">{LABEL[region].hint}</p>
              </div>
              <label className="text-xs">
                Email template
                <div className="flex items-center gap-2">
                  <select
                    className={selectCls}
                    disabled={!canEdit || saving !== null}
                    value={current.templateId ?? ""}
                    onChange={(e) => save(region, "templateId", e.target.value || null)}
                  >
                    <option value="">Xero default ({fallback})</option>
                    {list.filter((t) => !t.is_default).map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                  {saving === `${region}.templateId` && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                </div>
              </label>
              <label className="text-xs">
                Xero branding theme
                <div className="flex items-center gap-2">
                  <select
                    className={selectCls}
                    disabled={!canEdit || saving !== null || themeList === undefined}
                    value={current.theme ?? ""}
                    onChange={(e) => save(region, "theme", e.target.value || null)}
                  >
                    <option value="">Xero default{region === "us" ? " (Standard)" : ""}</option>
                    {(themeList ?? (current.theme ? [current.theme] : [])).map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                  {saving === `${region}.theme` && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                </div>
                {themes && themeList === null && (
                  <span className="text-[10px] text-amber">Couldn&apos;t read Xero&apos;s themes right now</span>
                )}
              </label>
            </div>
          );
        })}
      </div>
    </section>
  );
}
