"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { DateField } from "@/components/ui/date-field";
import { createClient } from "@/lib/supabase/client";
import { OUTCOMES, OUTCOME_LABELS, PHOTO_MAX_BYTES, checkPhoto, type Outcome } from "@/lib/evangelism/validation";
import type { PresentedTestimony } from "@/services/evangelism";

export type MinistryOption = { id: string; name: string };

type Form = {
  title: string;
  body: string;
  occurred_on: string;
  location_label: string;
  staff_ministry_id: string;
  people_reached: string;
  decisions: string;
  outcome: Outcome | "";
  consent_to_share: boolean;
};

function blank(): Form {
  return {
    title: "",
    body: "",
    occurred_on: "",
    location_label: "",
    staff_ministry_id: "",
    people_reached: "0",
    decisions: "0",
    outcome: "",
    consent_to_share: false,
  };
}

function fromStory(s: PresentedTestimony): Form {
  return {
    title: s.title,
    body: s.body,
    occurred_on: s.occurred_on,
    location_label: s.location_label,
    staff_ministry_id: s.staff_ministry_id ?? "",
    people_reached: String(s.people_reached),
    decisions: String(s.decisions),
    outcome: s.outcome,
    consent_to_share: s.consent_to_share,
  };
}

const field = "min-h-11 text-base md:text-sm";

/** Upload a photo through a signed URL; returns the `photo` payload. */
async function uploadPhoto(file: File) {
  const sign = await fetch("/api/evangelism/media/sign", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content_type: file.type, size: file.size }),
  });
  const signed = await sign.json().catch(() => ({}));
  if (!sign.ok) throw new Error(signed.error ?? "Couldn't prepare the photo upload.");
  const { error } = await createClient()
    .storage.from("evangelism-media")
    .uploadToSignedUrl(signed.path, signed.token, file, { contentType: signed.content_type });
  if (error) throw new Error("The photo didn't upload. Try a smaller file.");
  return { path: signed.path as string, content_type: signed.content_type as string, size: file.size };
}

export function UploadForm({
  ministries,
  editing,
  onDone,
}: {
  ministries: MinistryOption[];
  editing?: PresentedTestimony | null;
  onDone?: () => void;
}) {
  const router = useRouter();
  const [form, setForm] = useState<Form>(() => (editing ? fromStory(editing) : blank()));
  const [file, setFile] = useState<File | null>(null);
  const [removePhoto, setRemovePhoto] = useState(false);
  const [busy, setBusy] = useState<"draft" | "submit" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => ({ ...f, [key]: value }));

  function pickFile(f: File | null) {
    setError(null);
    if (f) {
      const checked = checkPhoto(f.type, f.size);
      if (!checked.ok) {
        setError(checked.error);
        return;
      }
    }
    setFile(f);
  }

  async function save(intent: "draft" | "submit") {
    setError(null);
    if (intent === "submit" && !form.consent_to_share) {
      setError("Tick the consent box before submitting.");
      return;
    }
    setBusy(intent);
    try {
      const photo = file ? await uploadPhoto(file) : undefined;
      const payload = {
        ...form,
        people_reached: Number(form.people_reached || 0),
        decisions: Number(form.decisions || 0),
        intent,
        ...(photo ? { photo } : {}),
        ...(editing && removePhoto && !photo ? { remove_photo: true } : {}),
      };
      const res = await fetch(editing ? `/api/evangelism/testimonies/${editing.id}` : "/api/evangelism/testimonies", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(out.error ?? "Couldn't save the story.");
        return;
      }
      if (out.photo_error) toast.warning(out.photo_error);
      toast.success(intent === "submit" ? "Sent for review — thank you!" : "Draft saved");
      setForm(blank());
      setFile(null);
      setRemovePhoto(false);
      onDone?.();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save the story.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <form
      className="space-y-5 px-5 py-6 md:px-8"
      onSubmit={(e) => {
        e.preventDefault();
        save("submit");
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor="ev-title">Title</Label>
        <Input
          id="ev-title"
          className={field}
          value={form.title}
          maxLength={140}
          placeholder="A conversation at the taxi rank"
          onChange={(e) => set("title", e.target.value)}
          required
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="ev-body">What happened?</Label>
        <Textarea
          id="ev-body"
          className="min-h-40 text-base md:text-sm"
          value={form.body}
          maxLength={20000}
          placeholder="Tell the story — who you met, what was said, what God did."
          onChange={(e) => set("body", e.target.value)}
          required
        />
        <p className="text-xs text-[color:var(--text-secondary)]">At least 40 characters.</p>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="ev-date">Date</Label>
          <DateField id="ev-date" value={form.occurred_on} onChange={(v) => set("occurred_on", v)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ev-location">Where</Label>
          <Input
            id="ev-location"
            className={field}
            value={form.location_label}
            maxLength={80}
            placeholder="Durban beachfront"
            onChange={(e) => set("location_label", e.target.value)}
            required
          />
        </div>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="ev-outcome">Outcome</Label>
          <select
            id="ev-outcome"
            className="flex min-h-11 w-full rounded-md border border-input bg-background px-3 text-base md:text-sm"
            value={form.outcome}
            onChange={(e) => set("outcome", e.target.value as Outcome)}
            required
          >
            <option value="">Choose…</option>
            {OUTCOMES.map((o) => (
              <option key={o} value={o}>
                {OUTCOME_LABELS[o]}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ev-ministry">Ministry (optional)</Label>
          <select
            id="ev-ministry"
            className="flex min-h-11 w-full rounded-md border border-input bg-background px-3 text-base md:text-sm"
            value={form.staff_ministry_id}
            onChange={(e) => set("staff_ministry_id", e.target.value)}
          >
            <option value="">None</option>
            {ministries.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-5">
        <div className="space-y-1.5">
          <Label htmlFor="ev-people">People reached</Label>
          <Input
            id="ev-people"
            className={field}
            type="number"
            inputMode="numeric"
            min={0}
            value={form.people_reached}
            onChange={(e) => set("people_reached", e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ev-decisions">Decisions</Label>
          <Input
            id="ev-decisions"
            className={field}
            type="number"
            inputMode="numeric"
            min={0}
            value={form.decisions}
            onChange={(e) => set("decisions", e.target.value)}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="ev-photo">Photo (optional, one)</Label>
        {editing?.photo && !removePhoto && !file && (
          <div className="flex items-center gap-3 text-sm">
            <span>A photo is attached.</span>
            <Button type="button" variant="outline" className="min-h-11" onClick={() => setRemovePhoto(true)}>
              Remove photo
            </Button>
          </div>
        )}
        <Input
          id="ev-photo"
          className={field}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
          onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
        />
        <p className="text-xs text-[color:var(--text-secondary)]">
          JPEG, PNG, WebP or HEIC, up to {Math.round(PHOTO_MAX_BYTES / 1024 / 1024)} MB. Kept private — only shown
          inside the Hub.
        </p>
      </div>

      <label className="flex min-h-11 cursor-pointer items-start gap-3 border border-rule p-3">
        <input
          type="checkbox"
          className="mt-1 h-5 w-5 shrink-0"
          checked={form.consent_to_share}
          onChange={(e) => set("consent_to_share", e.target.checked)}
        />
        <span className="text-sm leading-relaxed">
          The people in this story (and the story as told) are OK to be shared <strong>inside the Hub</strong> with
          staff who can view evangelism stories. Required to submit.
        </span>
      </label>

      {error && (
        <p role="alert" className="text-sm font-medium text-red-700">
          {error}
        </p>
      )}

      <div className="flex flex-col gap-3 sm:flex-row">
        <Button type="submit" className="min-h-11" disabled={busy !== null}>
          {busy === "submit" ? "Sending…" : "Submit for review"}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="min-h-11"
          disabled={busy !== null}
          onClick={() => save("draft")}
        >
          {busy === "draft" ? "Saving…" : "Save draft"}
        </Button>
        {editing && onDone && (
          <Button type="button" variant="ghost" className="min-h-11" onClick={onDone} disabled={busy !== null}>
            Cancel edit
          </Button>
        )}
      </div>
    </form>
  );
}
