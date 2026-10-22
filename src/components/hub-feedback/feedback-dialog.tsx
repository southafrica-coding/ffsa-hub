"use client";

/**
 * The "send Hub feedback" form, opened from the rail button on any page.
 *
 * It records where the person was (page, module, device) so nobody has to
 * ask "where were you when it broke?". Screenshots can be picked or pasted
 * straight in (⌘V). Phase 2 puts the Claude interviewer in front of this;
 * the fields it fills are the same ones.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import { ImagePlus, X } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils/cn";
import {
  DETAILS_MAX,
  FEEDBACK_KINDS,
  KIND_META,
  SEVERITIES,
  SEVERITY_META,
  TITLE_MAX,
  type FeedbackKind,
  type FeedbackSeverity,
} from "@/lib/hub-feedback/constants";
import { feedbackModuleOptions, moduleForPath } from "@/lib/hub-feedback/context";

const MAX_SHOTS = 5;

export function FeedbackDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const detected = useMemo(() => moduleForPath(pathname), [pathname]);
  const moduleOptions = useMemo(() => feedbackModuleOptions(), []);

  const [kind, setKind] = useState<FeedbackKind>("problem");
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [severity, setSeverity] = useState<FeedbackSeverity | null>(null);
  const [moduleId, setModuleId] = useState<string>("");
  const [shots, setShots] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [sentRef, setSentRef] = useState<number | null>(null);

  // Each time it opens, file it under the page they're on.
  useEffect(() => {
    if (open) setModuleId(detected?.id ?? "");
  }, [open, detected]);

  const previews = useMemo(() => shots.map((f) => URL.createObjectURL(f)), [shots]);
  useEffect(() => () => previews.forEach((u) => URL.revokeObjectURL(u)), [previews]);

  function reset() {
    setKind("problem");
    setTitle("");
    setDetails("");
    setSeverity(null);
    setShots([]);
    setSentRef(null);
  }

  function addShots(files: File[]) {
    const images = files.filter((f) => f.type.startsWith("image/"));
    if (images.length === 0) return;
    setShots((prev) => [...prev, ...images].slice(0, MAX_SHOTS));
  }

  async function submit() {
    if (!title.trim()) return;
    setBusy(true);
    const label = moduleOptions.find((m) => m.id === moduleId)?.label ?? null;
    const res = await fetch("/api/hub-feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind,
        title: title.trim(),
        details: details.trim() || null,
        severity: kind === "problem" ? severity : null,
        page_path: pathname,
        module_id: moduleId || null,
        module_label: label,
        user_agent: navigator.userAgent,
        viewport: `${window.innerWidth}x${window.innerHeight}`,
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setBusy(false);
      toast.error(body.error ?? "Couldn't send that — try again");
      return;
    }

    // Screenshots go up after the item exists. One failing doesn't lose
    // the feedback itself.
    let failed = 0;
    for (const file of shots) {
      const form = new FormData();
      form.append("file", file);
      const up = await fetch(`/api/hub-feedback/${body.feedback.id}/files`, { method: "POST", body: form });
      if (!up.ok) failed++;
    }
    setBusy(false);
    if (failed) toast.error(`${failed} screenshot${failed === 1 ? "" : "s"} didn't upload`);
    setSentRef(body.feedback.ref);
    router.refresh();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) reset();
      }}
    >
      <DialogContent
        className="max-h-[92dvh] overflow-y-auto sm:max-w-[560px]"
        onPaste={(e) => addShots(Array.from(e.clipboardData.files))}
      >
        {sentRef !== null ? (
          <>
            <DialogHeader>
              <DialogTitle>Sent — #{sentRef}</DialogTitle>
              <DialogDescription>
                It&rsquo;s in front of the Hub team now. Not everything gets built, but everything gets read.
                You&rsquo;ll get a notification when it moves.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => reset()}>
                Send another
              </Button>
              <Button asChild onClick={() => onOpenChange(false)}>
                <Link href="/my-feedback">See my feedback</Link>
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Hub feedback</DialogTitle>
              <DialogDescription>
                Something broken, an idea, or where the Hub should go next. It goes straight to the team
                that builds the Hub.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              {/* Radios, not <button>s: the global button rule would set the hints in mono caps. */}
              <div role="radiogroup" aria-label="What is it?" className="grid grid-cols-3 border border-ink">
                {FEEDBACK_KINDS.map((k, i) => (
                  <div
                    key={k}
                    role="radio"
                    aria-checked={kind === k}
                    tabIndex={0}
                    onClick={() => setKind(k)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setKind(k);
                      }
                    }}
                    className={cn(
                      "cursor-pointer px-2 py-2.5 text-left",
                      i > 0 && "border-l border-ink",
                      kind === k ? "bg-ink text-white" : "bg-white text-ink hover:bg-bone"
                    )}
                  >
                    <div className="font-mono text-[10px] font-bold uppercase tracking-[0.14em]">
                      {KIND_META[k].label}
                    </div>
                    <div className={cn("mt-0.5 text-[11.5px] leading-snug", kind === k ? "text-[#C9C5B8]" : "text-[#7C786C]")}>
                      {KIND_META[k].hint}
                    </div>
                  </div>
                ))}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="hub-fb-title">In one line</Label>
                <Input
                  id="hub-fb-title"
                  value={title}
                  maxLength={TITLE_MAX}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={kind === "problem" ? "e.g. Vehicle calendar doesn't show the driver" : "e.g. Bulk-approve vehicle requests"}
                  autoFocus
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="hub-fb-details">Tell us more</Label>
                <Textarea
                  id="hub-fb-details"
                  value={details}
                  maxLength={DETAILS_MAX}
                  onChange={(e) => setDetails(e.target.value)}
                  placeholder={KIND_META[kind].placeholder}
                  rows={5}
                />
              </div>

              {kind === "problem" && (
                <div className="space-y-1.5">
                  <Label>How bad is it?</Label>
                  <div className="flex flex-wrap gap-1.5">
                    {SEVERITIES.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setSeverity(severity === s ? null : s)}
                        className="chip"
                        data-active={severity === s ? "true" : undefined}
                        aria-pressed={severity === s}
                      >
                        {SEVERITY_META[s].label}
                      </button>
                    ))}
                  </div>
                  {severity && (
                    <p className="text-[12px] text-[color:var(--text-secondary)]">{SEVERITY_META[severity].hint}</p>
                  )}
                </div>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="hub-fb-module">Which part of the Hub?</Label>
                <select
                  id="hub-fb-module"
                  value={moduleId}
                  onChange={(e) => setModuleId(e.target.value)}
                  className="h-9 w-full border border-input bg-white px-2 text-sm"
                >
                  <option value="">Not sure / the whole Hub</option>
                  {moduleOptions.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <Label>Screenshots (optional)</Label>
                <div className="flex flex-wrap gap-2">
                  {previews.map((src, i) => (
                    <div key={src} className="relative h-16 w-16 border border-rule-strong">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={src} alt="" className="h-full w-full object-cover" />
                      <button
                        type="button"
                        aria-label="Remove screenshot"
                        onClick={() => setShots((prev) => prev.filter((_, j) => j !== i))}
                        className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center bg-ink text-white"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                  {shots.length < MAX_SHOTS && (
                    <label className="flex h-16 w-16 cursor-pointer flex-col items-center justify-center border border-dashed border-rule-strong text-[#7C786C] hover:border-ink hover:text-ink">
                      <ImagePlus className="h-4 w-4" />
                      <span className="mt-1 font-mono text-[8px] font-bold uppercase tracking-[0.12em]">Add</span>
                      <input
                        type="file"
                        accept="image/*"
                        multiple
                        className="sr-only"
                        onChange={(e) => {
                          addShots(Array.from(e.target.files ?? []));
                          e.target.value = "";
                        }}
                      />
                    </label>
                  )}
                </div>
                <p className="text-[12px] text-[color:var(--text-secondary)]">
                  Tip: take a screenshot and paste it here with ⌘V / Ctrl+V.
                </p>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
                Cancel
              </Button>
              <Button onClick={submit} disabled={busy || !title.trim()}>
                {busy ? "Sending…" : "Send"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
