"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PhoneInputNative } from "@/components/ui/phone-input-native";
import { normalizePhoneE164 } from "@/lib/phone";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { AlertTriangle } from "lucide-react";
import { getLabelColors } from "@/lib/label-color";
import { Masthead, MastheadAction } from "@/components/ffsa";

interface DuplicateMatch {
  id: string;
  first_name: string;
  last_name: string;
  preferred_name: string | null;
  email: string | null;
  phone: string | null;
  status: string;
}

interface PickerLabel {
  id: string;
  slug: string;
  name: string;
  category: string | null;
  color: string | null;
}

export default function NewContactPage() {
  const router = useRouter();
  const supabase = createClient();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duplicates, setDuplicates] = useState<DuplicateMatch[]>([]);
  const [skipDuplicateCheck, setSkipDuplicateCheck] = useState(false);

  const [form, setForm] = useState({
    first_name: "",
    last_name: "",
    preferred_name: "",
    email: "",
    phone: "",
  });

  const [allLabels, setAllLabels] = useState<PickerLabel[]>([]);
  const [selectedLabelIds, setSelectedLabelIds] = useState<string[]>([]);

  useEffect(() => {
    let active = true;
    (async () => {
      const { data } = await supabase
        .from("labels")
        .select("id, slug, name, category, color")
        .eq("is_active", true)
        .order("name");
      if (active) setAllLabels((data ?? []) as PickerLabel[]);
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggleLabel(id: string) {
    setSelectedLabelIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  function updateField(field: string, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
    setDuplicates([]);
    setSkipDuplicateCheck(false);
  }

  async function checkDuplicates() {
    if (!form.first_name || !form.last_name) return [];

    const { data } = await supabase
      .from("contacts")
      .select("id, first_name, last_name, preferred_name, email, phone, status")
      .eq("status", "active")
      .or(
        [
          form.email ? `email.ilike.${form.email.trim().toLowerCase()}` : null,
          `and(first_name.ilike.${form.first_name.trim()},last_name.ilike.${form.last_name.trim()})`,
        ]
          .filter(Boolean)
          .join(",")
      )
      .limit(10);

    return data ?? [];
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    if (!skipDuplicateCheck) {
      const matches = await checkDuplicates();
      if (matches.length > 0) {
        setDuplicates(matches);
        setLoading(false);
        return;
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: created, error: insertError } = await (supabase.from("contacts") as any)
      .insert({
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        preferred_name: form.preferred_name.trim() || null,
        email: form.email.trim().toLowerCase() || null,
        phone: form.phone.trim() || null,
      })
      .select("id")
      .single();

    if (insertError) {
      setError(insertError.message);
      setLoading(false);
      return;
    }

    // Mirror email + phone into the join tables so future dedup
    // queries find the new contact (the DB trigger only keeps
    // contacts.email/phone in sync FROM the join tables, not the
    // other direction).
    if (created?.id) {
      const newId = created.id as string;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sb = supabase as any;
      if (form.email.trim()) {
        await sb.from("contact_emails").insert({
          contact_id: newId,
          email: form.email.trim(),
          label: "primary",
          is_primary: true,
          source: "manual",
        });
      }
      if (form.phone.trim()) {
        await sb.from("contact_phones").insert({
          contact_id: newId,
          phone: form.phone.trim(),
          // The input now carries a country code, so E.164 normalization is
          // reliable (no ZA-default guessing). Feeds search/dedup; the DB
          // trigger mirrors it up to contacts.phone_normalized.
          phone_normalized: normalizePhoneE164(form.phone.trim()),
          label: "primary",
          is_primary: true,
          source: "manual",
        });
      }

      // Attach any labels the user picked. Reuses the same endpoint the
      // contact detail page uses, so activity logging and label_added
      // workflows fire consistently. Best-effort: a label hiccup never
      // discards the already-created contact.
      for (const labelId of selectedLabelIds) {
        await fetch(`/api/contacts/${newId}/labels`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ labelId }),
        });
      }

      if (selectedLabelIds.length > 0) {
        // Land on the new contact so the applied labels are visible.
        router.push(`/contacts/${newId}`);
        router.refresh();
        return;
      }
    }

    router.push("/contacts");
    router.refresh();
  }

  function handleUseExisting(id: string) {
    router.push(`/contacts/${id}`);
  }

  async function handleAddToExisting(id: string) {
    setLoading(true);
    setError(null);
    const res = await fetch(`/api/contacts/${id}/identifiers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        label: "other",
      }),
    });
    setLoading(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Failed to add to existing contact");
      return;
    }
    router.push(`/contacts/${id}`);
    router.refresh();
  }

  function handleCreateAnyway() {
    setSkipDuplicateCheck(true);
    setDuplicates([]);
  }

  const hasNewIdentifiers = !!(form.email.trim() || form.phone.trim());

  return (
    <div className="ffsa-screen">
      <Masthead
        context="People & relationships"
        title="Add contact"
        actions={<MastheadAction href="/contacts">All contacts</MastheadAction>}
      />

      <div className="max-w-2xl space-y-6 px-5 py-6 md:px-8 md:py-7">

      {duplicates.length > 0 && (
        <Card style={{ borderColor: 'var(--yellow-border)', background: 'rgba(245,197,24,0.06)' }}>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base" style={{ color: 'var(--yellow)' }}>
              <AlertTriangle className="h-5 w-5" />
              Potential Duplicates Found
            </CardTitle>
            <CardDescription>
              The following existing records may match. Use an existing record or create a new one.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {duplicates.map((dup) => (
              <div
                key={dup.id}
                className="flex flex-col gap-2 rounded-md border border-white/10 bg-white/5 p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p className="font-medium">
                    {dup.first_name} {dup.last_name}
                    {dup.preferred_name && (
                      <span className="text-muted-foreground"> ({dup.preferred_name})</span>
                    )}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {[dup.email, dup.phone].filter(Boolean).join(" · ") || "No contact info"}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {hasNewIdentifiers && (
                    <Button
                      variant="default"
                      size="sm"
                      onClick={() => handleAddToExisting(dup.id)}
                      disabled={loading}
                    >
                      Add this info to {dup.first_name}&apos;s record
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleUseExisting(dup.id)}
                    disabled={loading}
                  >
                    Use as-is
                  </Button>
                </div>
              </div>
            ))}
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCreateAnyway}
              disabled={loading}
              className="text-muted-foreground hover:text-foreground"
            >
              Create new contact anyway
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="pt-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="first_name">First Name *</Label>
                <Input
                  id="first_name"
                  value={form.first_name}
                  onChange={(e) => updateField("first_name", e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="last_name">Last Name *</Label>
                <Input
                  id="last_name"
                  value={form.last_name}
                  onChange={(e) => updateField("last_name", e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="preferred_name">Preferred Name</Label>
              <Input
                id="preferred_name"
                value={form.preferred_name}
                onChange={(e) => updateField("preferred_name", e.target.value)}
                placeholder="Optional"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email *</Label>
                <Input
                  id="email"
                  type="email"
                  value={form.email}
                  onChange={(e) => updateField("email", e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone">Phone</Label>
                <PhoneInputNative
                  id="phone"
                  value={form.phone}
                  onChange={(v) => updateField("phone", v)}
                  inputClassName="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs"
                  selectClassName="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
                />
              </div>
            </div>

            {allLabels.length > 0 && (
              <div className="space-y-2">
                <Label>Labels</Label>
                <p className="text-xs text-muted-foreground">
                  Optional. Tap to tag this contact — adding a label may enrol
                  them in that label&apos;s email workflows.
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {allLabels.map((l) => {
                    const selected = selectedLabelIds.includes(l.id);
                    const colors = getLabelColors(l);
                    return (
                      <button
                        key={l.id}
                        type="button"
                        onClick={() => toggleLabel(l.id)}
                        aria-pressed={selected}
                        className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium transition-opacity"
                        style={{
                          backgroundColor: colors.bg,
                          color: colors.text,
                          borderColor: selected ? colors.text : colors.border,
                          opacity: selected ? 1 : 0.5,
                        }}
                      >
                        {selected && <span aria-hidden>✓</span>}
                        {l.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {error && <p className="text-sm text-destructive">{error}</p>}

            <div className="flex gap-3 pt-2">
              <Button type="submit" disabled={loading}>
                {loading ? "Creating..." : "Create Contact"}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => router.back()}
              >
                Cancel
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
      </div>
    </div>
  );
}
