"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SectionBar } from "@/components/ffsa";
import type { DonorStatementSettings } from "@/lib/finance/donor-statements-server";

// The organisation details printed on every statement and email, plus the
// import rules. Stored once (migration 245) so a change is made in one place.

const TEXT_FIELDS: { key: keyof DonorStatementSettings; label: string }[] = [
  { key: "org_name", label: "Organisation name" },
  { key: "tax_id", label: "Tax ID / EIN" },
  { key: "address_line1", label: "Address line 1" },
  { key: "address_line2", label: "Address line 2" },
  { key: "address_city_line", label: "City, state, ZIP" },
  { key: "signer_name", label: "Signer name" },
  { key: "signer_title", label: "Signer title" },
];

const LIST_FIELDS: { key: keyof DonorStatementSettings; label: string; help: string }[] = [
  { key: "account_codes", label: "Donation account codes", help: "Only lines on these Xero accounts count." },
  { key: "excluded_item_codes", label: "Item codes to drop", help: "e.g. STRIPE — card fees, not gifts." },
  { key: "excluded_line_phrases", label: "Line descriptions to drop", help: "A line whose description contains one of these is left out." },
  { key: "review_line_phrases", label: "Flag lines containing", help: "Events and fundraisers where the donor may have received something." },
  { key: "organisation_phrases", label: "Flag donor names containing", help: "Words that suggest an organisation rather than a person." },
];

export function SettingsCard({
  settings,
  onSaved,
}: {
  settings: DonorStatementSettings;
  onSaved: (s: DonorStatementSettings) => void;
}) {
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries([
      ...TEXT_FIELDS.map((f) => [f.key, String(settings[f.key] ?? "")]),
      ...LIST_FIELDS.map((f) => [f.key, ((settings[f.key] as string[]) ?? []).join(", ")]),
    ])
  );
  const [saving, setSaving] = useState(false);
  const [imgVersion, setImgVersion] = useState(Date.now());

  const dirty =
    TEXT_FIELDS.some((f) => draft[f.key] !== String(settings[f.key] ?? "")) ||
    LIST_FIELDS.some((f) => draft[f.key] !== ((settings[f.key] as string[]) ?? []).join(", "));

  async function save() {
    setSaving(true);
    const body: Record<string, unknown> = {};
    for (const f of TEXT_FIELDS) body[f.key] = draft[f.key];
    for (const f of LIST_FIELDS) body[f.key] = draft[f.key];
    const res = await fetch("/api/finance/donor-statements/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) return toast.error(json.error ?? "Save failed");
    toast.success("Settings saved");
    onSaved(json.settings);
  }

  async function upload(kind: "logo" | "signature", file: File) {
    const form = new FormData();
    form.set("kind", kind);
    form.set("file", file);
    const res = await fetch("/api/finance/donor-statements/settings", { method: "POST", body: form });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return toast.error(json.error ?? "Upload failed");
    toast.success(kind === "logo" ? "Logo saved" : "Signature saved");
    setImgVersion(Date.now());
    onSaved(json.settings);
  }

  return (
    <div className="border border-ink">
      <SectionBar title="Statement settings" meta="Printed on every PDF and email" />
      <div className="grid gap-6 p-5 md:grid-cols-2">
        <div className="space-y-3">
          {TEXT_FIELDS.map((f) => (
            <label key={f.key} className="block">
              <span className="mono-label mb-1 block">{f.label}</span>
              <Input value={draft[f.key]} onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))} />
            </label>
          ))}
          <div className="grid grid-cols-2 gap-4 pt-2">
            <ImageSlot
              label="Logo"
              hint="Square PNG · shown 100 × 100"
              has={!!settings.logo_path}
              src={`/api/finance/donor-statements/settings?image=logo&v=${imgVersion}`}
              box="h-[100px] w-[100px]"
              onFile={(f) => upload("logo", f)}
            />
            <ImageSlot
              label="Signature"
              hint="PNG, transparent if possible · shown 150 × 70"
              has={!!settings.signature_path}
              src={`/api/finance/donor-statements/settings?image=signature&v=${imgVersion}`}
              box="h-[70px] w-[150px]"
              onFile={(f) => upload("signature", f)}
            />
          </div>
        </div>
        <div className="space-y-3">
          {LIST_FIELDS.map((f) => (
            <label key={f.key} className="block">
              <span className="mono-label mb-1 block">{f.label}</span>
              <Textarea
                rows={2}
                value={draft[f.key]}
                onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
              />
              <span className="mt-1 block text-xs text-[color:var(--text-tertiary)]">{f.help} Separate with commas.</span>
            </label>
          ))}
        </div>
      </div>
      <div className="flex items-center justify-end gap-3 border-t border-rule px-5 py-3">
        {dirty && <span className="text-xs text-[color:var(--text-tertiary)]">Unsaved changes</span>}
        <Button size="sm" onClick={save} disabled={!dirty || saving}>
          {saving ? "Saving…" : "Save settings"}
        </Button>
      </div>
    </div>
  );
}

function ImageSlot({
  label,
  hint,
  has,
  src,
  box,
  onFile,
}: {
  label: string;
  hint: string;
  has: boolean;
  src: string;
  box: string;
  onFile: (f: File) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div>
      <span className="mono-label mb-1 block">{label}</span>
      <div className={`${box} flex items-center justify-center border border-dashed border-rule-strong bg-bone`}>
        {has ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt={label} className="h-full w-full object-contain" />
        ) : (
          <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-[#7C786C]">None yet</span>
        )}
      </div>
      <p className="mt-1 text-xs text-[color:var(--text-tertiary)]">{hint}</p>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = "";
        }}
      />
      <Button type="button" size="sm" variant="outline" className="mt-2" onClick={() => input.current?.click()}>
        {has ? "Replace" : "Upload"}
      </Button>
    </div>
  );
}
