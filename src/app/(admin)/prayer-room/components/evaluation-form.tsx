"use client";

/**
 * Recording an evaluation — design frames 12a/12b.
 *
 * The two notes are deliberately not symmetrical, on screen or in the database:
 *
 *   feedback     — yellow left rule, labelled with the person's name. They
 *                  read this.
 *   private_note — black panel. Evaluators only, and the person is never told
 *                  it exists.
 *
 * They are styled to look like different KINDS of thing, because the cost of
 * an evaluator typing the wrong one into the wrong box is that a candid remark
 * reaches the person it is about.
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { cn } from "@/lib/utils/cn";

type Outcome = "not_yet" | "in_training" | "signed_off";

const OUTCOMES: { key: Outcome; label: string; hint: string }[] = [
  { key: "signed_off", label: "Sign off", hint: "Ready to hold this seat unsupervised" },
  { key: "in_training", label: "In training", hint: "Can be rostered with support" },
  { key: "not_yet", label: "Not yet", hint: "Looked at, not ready" },
];

export default function EvaluationForm({
  userId,
  personName,
  seatTypeId,
  seatLabel,
  observedSetId,
  onSaved,
  onCancel,
}: {
  userId: string;
  personName: string;
  seatTypeId: string;
  seatLabel: string;
  observedSetId?: string | null;
  onSaved?: () => void;
  onCancel?: () => void;
}) {
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [feedback, setFeedback] = useState("");
  const [privateNote, setPrivateNote] = useState("");
  const [saving, setSaving] = useState(false);

  const firstName = personName.split(" ")[0] || personName;

  async function save() {
    if (!outcome) {
      toast.error("Choose an outcome first");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/prayer-room/evaluations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: userId,
          seat_type_id: seatTypeId,
          outcome,
          feedback: feedback.trim() || null,
          private_note: privateNote.trim() || null,
          observed_set_id: observedSetId ?? null,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        toast.error(d.error || "Could not save the evaluation");
        return;
      }
      toast.success(`Saved · ${seatLabel}`);
      onSaved?.();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <div className="mono-label">Evaluating</div>
        <div className="font-display text-[22px] font-black uppercase leading-none">
          {personName}
        </div>
        <div className="mono-label mt-1">{seatLabel}</div>
      </div>

      <div>
        <Label>Outcome</Label>
        <div className="mt-1.5 grid gap-1.5 sm:grid-cols-3">
          {OUTCOMES.map((o) => (
            <button
              key={o.key}
              type="button"
              onClick={() => setOutcome(o.key)}
              className={cn(
                "border px-3 py-2 text-left transition-colors",
                outcome === o.key
                  ? "border-ink bg-ink text-white"
                  : "border-rule-strong bg-white hover:bg-bone"
              )}
            >
              <div className="font-mono text-[10px] font-bold uppercase tracking-[0.12em]">
                {o.label}
              </div>
              <div
                className={cn(
                  "mt-0.5 text-[11px]",
                  outcome === o.key ? "text-[#C5C2AE]" : "text-[color:var(--text-tertiary)]"
                )}
              >
                {o.hint}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* ── the note they read ── */}
      <div className="border-l-4 border-yellow bg-[color:var(--yellow-dim)] p-3.5">
        <Label htmlFor="pr-feedback">Feedback · {firstName} reads this</Label>
        <textarea
          id="pr-feedback"
          rows={4}
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          placeholder={`What ${firstName} should know — what went well, what to work on.`}
          className="mt-1.5 w-full resize-y"
        />
      </div>

      {/* ── the note they never see ── */}
      <div className="border border-ink bg-ink p-3.5">
        <Label htmlFor="pr-private" className="!text-[#C5C2AE]">
          Evaluators only · {firstName} cannot see this
        </Label>
        <textarea
          id="pr-private"
          rows={4}
          value={privateNote}
          onChange={(e) => setPrivateNote(e.target.value)}
          placeholder="For the other evaluators. Never shown to them, and they are not told it exists."
          className="mt-1.5 w-full resize-y !border-[#3A3A36] !bg-[#141412] !text-white"
        />
      </div>

      <div className="flex justify-end gap-2">
        {onCancel && (
          <Button variant="outline" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
        )}
        <Button onClick={save} disabled={saving || !outcome}>
          {saving ? "Saving…" : "Save evaluation"}
        </Button>
      </div>
    </div>
  );
}
