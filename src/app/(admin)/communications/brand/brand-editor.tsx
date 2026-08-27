"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, X, Upload, Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  BRAND_DEFAULTS,
  mergeBrand,
  type BrandKitRow,
  type EffectiveBrand,
  type SocialLink,
  type SocialPlatform,
} from "@/services/brand";
import { renderCampaignHtml } from "@/lib/campaigns/blocks";

type Identity = {
  id: string;
  slug: string;
  display_name: string;
  from_email: string;
  from_name: string;
  provider: string;
};

// Curated Google Fonts. All look strong in email when the client supports
// web fonts; all degrade gracefully to system fallbacks otherwise.
const DISPLAY_FONTS = [
  "Fraunces",
  "Playfair Display",
  "DM Serif Display",
  "Cormorant Garamond",
  "Source Serif 4",
  "Bricolage Grotesque",
  "Inter",
];
const BODY_FONTS = [
  "Inter",
  "Public Sans",
  "DM Sans",
  "Manrope",
  "Source Sans 3",
  "Nunito Sans",
  "Georgia",
];

// FFSA-feeling palettes — picked so the (primary, accent) pair always
// reads as bold+editorial.
const COLOR_PRESETS: { name: string; primary: string; accent: string }[] = [
  { name: "Ember", primary: "#0F172A", accent: "#C2410C" },
  { name: "Indigo & Flame", primary: "#1E1B4B", accent: "#EA580C" },
  { name: "Charcoal Rose", primary: "#1C1917", accent: "#BE123C" },
  { name: "Deep Ocean", primary: "#0C4A6E", accent: "#F59E0B" },
  { name: "Forest", primary: "#14532D", accent: "#CA8A04" },
  { name: "Mono Editorial", primary: "#0A0A0A", accent: "#525252" },
];

const SOCIAL_PLATFORMS: SocialPlatform[] = [
  "instagram",
  "facebook",
  "youtube",
  "x",
  "tiktok",
  "web",
];

const SOCIAL_LABEL: Record<SocialPlatform, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  youtube: "YouTube",
  x: "X",
  tiktok: "TikTok",
  web: "Website",
};

type FormState = {
  logo_url: string | null;
  primary_color: string;
  accent_color: string;
  text_color: string;
  bg_color: string;
  display_font: string;
  body_font: string;
  org_name: string;
  org_address: string;
  footer_tagline: string;
  social_links: SocialLink[];
};

function rowToForm(row: BrandKitRow | null, fallback: EffectiveBrand): FormState {
  return {
    logo_url: row?.logo_url ?? null,
    primary_color: row?.primary_color || fallback.primary_color,
    accent_color: row?.accent_color || fallback.accent_color,
    text_color: row?.text_color || fallback.text_color,
    bg_color: row?.bg_color || fallback.bg_color,
    display_font: row?.display_font || fallback.display_font,
    body_font: row?.body_font || fallback.body_font,
    org_name: row?.org_name || fallback.org_name,
    org_address: row?.org_address || "",
    footer_tagline: row?.footer_tagline || "",
    social_links: row?.social_links ?? [],
  };
}

export function BrandEditor({
  identities,
  selectedIdentityId,
  initialBrand,
  initialEffective,
}: {
  identities: Identity[];
  selectedIdentityId: string;
  initialBrand: BrandKitRow | null;
  initialEffective: EffectiveBrand;
}) {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(() =>
    rowToForm(initialBrand, initialEffective)
  );
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const effective = useMemo(() => mergeBrand({ ...form } as BrandKitRow), [form]);

  // Sample body for preview — exercises the full editorial vocabulary so
  // designers see how their kit lands across eyebrow / heading / quote /
  // image-text / CTA card, not just plain stacks.
  const previewHtml = useMemo(() => {
    const body = {
      version: 1 as const,
      blocks: [
        {
          id: "p1",
          type: "heading" as const,
          eyebrow: "FROM THE FIELD",
          text: "A weekend that changed everything",
        },
        {
          id: "p2",
          type: "text" as const,
          dropCap: true,
          text:
            "Eighty young leaders gathered for a single, focused day. The room was quiet at first — and then it wasn't. What unfolded over the next eight hours is hard to summarise, but worth trying.",
        },
        { id: "p3", type: "divider" as const, style: "rule" as const },
        {
          id: "p4",
          type: "quote" as const,
          text: "The room was quiet at first. Then it wasn't.",
          attribution: "Team leader, Saturday session",
        },
        { id: "p5", type: "spacer" as const, size: "md" as const },
        {
          id: "p6",
          type: "heading" as const,
          text: "Three things we learned",
        },
        {
          id: "p7",
          type: "text" as const,
          text:
            "First, the morning sessions were deeper than we'd planned. Second, lunch became its own kind of teaching. Third, no one left the same.",
        },
        {
          id: "p8",
          type: "cta" as const,
          heading: "Read the full recap",
          text: "Photos, takeaways, and what's next for the team — straight from the leaders who were there.",
          buttonText: "Open the recap",
          buttonUrl: "https://www.ffsahub.com",
        },
      ],
    };
    return renderCampaignHtml(body, {
      previewText: "What happened on Saturday — and what's next.",
      brand: effective,
    });
  }, [effective]);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function applyPreset(p: { primary: string; accent: string }) {
    setForm((f) => ({ ...f, primary_color: p.primary, accent_color: p.accent }));
  }

  function resetToDefaults() {
    setForm({
      logo_url: form.logo_url, // keep logo upload
      primary_color: BRAND_DEFAULTS.primary_color,
      accent_color: BRAND_DEFAULTS.accent_color,
      text_color: BRAND_DEFAULTS.text_color,
      bg_color: BRAND_DEFAULTS.bg_color,
      display_font: BRAND_DEFAULTS.display_font,
      body_font: BRAND_DEFAULTS.body_font,
      org_name: BRAND_DEFAULTS.org_name,
      org_address: "",
      footer_tagline: "",
      social_links: [],
    });
  }

  function addSocial() {
    setForm((f) => ({
      ...f,
      social_links: [...f.social_links, { platform: "instagram", url: "" }],
    }));
  }
  function updateSocial(i: number, patch: Partial<SocialLink>) {
    setForm((f) => ({
      ...f,
      social_links: f.social_links.map((s, idx) =>
        idx === i ? { ...s, ...patch } : s
      ),
    }));
  }
  function removeSocial(i: number) {
    setForm((f) => ({
      ...f,
      social_links: f.social_links.filter((_, idx) => idx !== i),
    }));
  }

  async function uploadLogo(file: File) {
    setErr(null);
    setMsg(null);
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch(`/api/brand/${selectedIdentityId}/logo`, {
      method: "POST",
      body: fd,
    });
    if (!res.ok) {
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      setErr(d.error ?? "Logo upload failed");
      return;
    }
    const data = (await res.json()) as { logoUrl: string };
    update("logo_url", data.logoUrl);
    // Persist immediately: an uploaded logo that only lives in form state is
    // silently lost the moment the user navigates away.
    await persistLogo(data.logoUrl, "Logo uploaded and saved.");
  }

  async function clearLogo() {
    update("logo_url", null);
    await persistLogo(null, "Logo removed.");
  }

  // Writes just logo_url so the upload/remove sticks without a full Save.
  async function persistLogo(logoUrl: string | null, okMsg: string) {
    setBusy(true);
    const res = await fetch(`/api/brand/${selectedIdentityId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ logo_url: logoUrl }),
    });
    setBusy(false);
    if (!res.ok) {
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      setErr(d.error ?? "Could not save the logo — press Save to retry.");
      return;
    }
    setMsg(okMsg);
    router.refresh();
  }

  async function save() {
    setBusy(true);
    setErr(null);
    setMsg(null);
    const res = await fetch(`/api/brand/${selectedIdentityId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        logo_url: form.logo_url,
        primary_color: form.primary_color,
        accent_color: form.accent_color,
        text_color: form.text_color,
        bg_color: form.bg_color,
        display_font: form.display_font,
        body_font: form.body_font,
        org_name: form.org_name,
        org_address: form.org_address,
        footer_tagline: form.footer_tagline,
        social_links: form.social_links.filter((s) => s.url.trim()),
      }),
    });
    setBusy(false);
    if (!res.ok) {
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      setErr(d.error ?? "Save failed");
      return;
    }
    setMsg("Brand kit saved.");
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {/* Identity picker */}
      <div className="flex flex-wrap gap-1.5">
        {identities.map((i) => {
          const active = i.id === selectedIdentityId;
          return (
            <a
              key={i.id}
              href={`/communications/brand?identity=${i.id}`}
              className={`text-sm px-3 py-1.5 rounded-full border transition-colors ${
                active
                  ? "bg-foreground text-background border-foreground"
                  : "bg-background hover:bg-muted"
              }`}
            >
              {i.display_name}
            </a>
          );
        })}
      </div>

      {err && <p className="text-sm text-red-400">{err}</p>}
      {msg && <p className="text-sm text-emerald-400">{msg}</p>}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Form */}
        <div className="space-y-4">
          {/* Logo */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Logo</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {form.logo_url ? (
                <div className="flex items-center gap-3 p-3 border rounded bg-muted/30">
                  <img
                    src={form.logo_url}
                    alt="Logo preview"
                    className="h-12 w-auto max-w-[160px] object-contain bg-white rounded p-1"
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={clearLogo}
                    className="text-red-400"
                  >
                    <Trash2 className="h-3.5 w-3.5 mr-1" />
                    Remove
                  </Button>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground italic">
                  No logo set. Emails from this identity will show the
                  organization name in the footer only.
                </p>
              )}
              <div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/svg+xml"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) uploadLogo(f);
                    e.target.value = "";
                  }}
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload className="h-3.5 w-3.5 mr-1.5" />
                  {form.logo_url ? "Replace logo" : "Upload logo"}
                </Button>
                <span className="text-xs text-muted-foreground ml-3">
                  PNG, JPG, WEBP, or SVG · 3 MB max
                </span>
              </div>
            </CardContent>
          </Card>

          {/* Colors */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">Colors</CardTitle>
              <button
                type="button"
                onClick={resetToDefaults}
                className="text-xs text-muted-foreground hover:text-foreground underline"
              >
                Reset to editorial defaults
              </button>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <p className="text-xs text-muted-foreground mb-2">Presets</p>
                <div className="flex flex-wrap gap-1.5">
                  {COLOR_PRESETS.map((p) => (
                    <button
                      key={p.name}
                      type="button"
                      onClick={() => applyPreset(p)}
                      className="flex items-center gap-1.5 px-2 py-1 rounded-full border hover:border-foreground transition-colors text-xs"
                    >
                      <span
                        className="inline-block w-3 h-3 rounded-full"
                        style={{ background: p.primary }}
                      />
                      <span
                        className="inline-block w-3 h-3 rounded-full"
                        style={{ background: p.accent }}
                      />
                      {p.name}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <ColorField
                  label="Primary (headlines, header band)"
                  value={form.primary_color}
                  onChange={(v) => update("primary_color", v)}
                />
                <ColorField
                  label="Accent (buttons, links)"
                  value={form.accent_color}
                  onChange={(v) => update("accent_color", v)}
                />
                <ColorField
                  label="Body text"
                  value={form.text_color}
                  onChange={(v) => update("text_color", v)}
                />
                <ColorField
                  label="Background"
                  value={form.bg_color}
                  onChange={(v) => update("bg_color", v)}
                />
              </div>
            </CardContent>
          </Card>

          {/* Typography */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Typography</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Field label="Display font (headlines)">
                <select
                  value={form.display_font}
                  onChange={(e) => update("display_font", e.target.value)}
                  className="w-full border rounded px-2 py-1.5 text-sm"
                >
                  {DISPLAY_FONTS.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Body font (paragraphs)">
                <select
                  value={form.body_font}
                  onChange={(e) => update("body_font", e.target.value)}
                  className="w-full border rounded px-2 py-1.5 text-sm"
                >
                  {BODY_FONTS.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
              </Field>
              <p className="text-xs text-muted-foreground">
                Web fonts may be stripped by some email clients (notably
                Outlook on Windows). The renderer falls back to Georgia and
                Helvetica there — still polished, just less distinctive.
              </p>
            </CardContent>
          </Card>

          {/* Footer / signature */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Footer &amp; signature</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Field label="Organization name (as shown in footer)">
                <Input
                  value={form.org_name}
                  onChange={(e) => update("org_name", e.target.value)}
                />
              </Field>
              <Field label="Tagline (italic, above org name)">
                <Input
                  value={form.footer_tagline}
                  onChange={(e) => update("footer_tagline", e.target.value)}
                  placeholder="e.g. Carrying His presence across the nations"
                />
              </Field>
              <Field label="Physical address (CAN-SPAM best practice)">
                <Textarea
                  value={form.org_address}
                  onChange={(e) => update("org_address", e.target.value)}
                  rows={2}
                  placeholder="Street, City, Country"
                  className="resize-none"
                />
              </Field>

              <div>
                <p className="text-muted-foreground mb-1 text-xs">
                  Social links
                </p>
                <div className="space-y-1.5">
                  {form.social_links.map((s, i) => (
                    <div key={i} className="flex gap-1.5">
                      <select
                        value={s.platform}
                        onChange={(e) =>
                          updateSocial(i, {
                            platform: e.target.value as SocialPlatform,
                          })
                        }
                        className="border rounded px-2 py-1.5 text-sm w-32"
                      >
                        {SOCIAL_PLATFORMS.map((p) => (
                          <option key={p} value={p}>
                            {SOCIAL_LABEL[p]}
                          </option>
                        ))}
                      </select>
                      <Input
                        value={s.url}
                        onChange={(e) =>
                          updateSocial(i, { url: e.target.value })
                        }
                        placeholder="https://…"
                        className="flex-1"
                      />
                      <button
                        type="button"
                        onClick={() => removeSocial(i)}
                        className="text-muted-foreground hover:text-red-400 px-2"
                        aria-label="Remove"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={addSocial}
                    className="gap-1"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add social link
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="flex justify-end">
            <Button onClick={save} disabled={busy}>
              {busy ? "Saving…" : "Save brand kit"}
            </Button>
          </div>
        </div>

        {/* Live preview */}
        <Card className="lg:sticky lg:top-4 self-start">
          <CardHeader>
            <CardTitle className="text-base">Live preview</CardTitle>
          </CardHeader>
          <CardContent>
            <iframe
              title="Brand preview"
              srcDoc={previewHtml}
              className="w-full rounded border"
              style={{ height: 680, background: "#fff" }}
            />
            <p className="text-xs text-muted-foreground mt-2">
              Sample content — every campaign sent via{" "}
              <span className="font-medium">
                {identities.find((i) => i.id === selectedIdentityId)
                  ?.display_name}
              </span>{" "}
              will inherit this header, footer, and color/typography.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block text-sm">
      <span className="block text-muted-foreground mb-1 text-xs">{label}</span>
      {children}
    </label>
  );
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block text-sm">
      <span className="block text-muted-foreground mb-1 text-xs">{label}</span>
      <div className="flex gap-1.5 items-center">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 w-12 cursor-pointer rounded border bg-background"
        />
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="flex-1 font-mono text-xs"
        />
      </div>
    </label>
  );
}

