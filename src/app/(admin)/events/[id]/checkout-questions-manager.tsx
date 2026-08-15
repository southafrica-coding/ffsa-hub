"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { type FormField } from "@/lib/forms/schema";
import { QuestionsBuilder } from "./questions-builder";

// Admin manager for an event's custom checkout questions (asked once per
// order, after the buyer's contact details). The question-editing UI is
// the shared QuestionsBuilder; this wrapper owns persistence — dirty
// tracking, save via PATCH, and discard.

export function CheckoutQuestionsManager({
  eventId,
  initialQuestions,
}: {
  eventId: string;
  initialQuestions: FormField[];
}) {
  const router = useRouter();
  const [questions, setQuestions] = useState<FormField[]>(initialQuestions);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const dirty = useMemo(
    () => JSON.stringify(questions) !== JSON.stringify(initialQuestions),
    [questions, initialQuestions]
  );

  async function save() {
    setBusy(true);
    setErr(null);
    setMsg(null);
    const res = await fetch(`/api/events/${eventId}/checkout-questions`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ checkout_questions: questions }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setErr(data.error ?? "Couldn't save questions. Please try again.");
      return;
    }
    setMsg("Saved.");
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Checkout questions</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Extra questions asked once per order at checkout, after the buyer&apos;s
          name and email. Use these to collect what this event needs — group or
          church, dietary requirements, emergency contact, etc. Leave empty to
          collect nothing extra. For questions about each individual ticket (e.g.
          a child&apos;s name and age on a kids ticket), use a ticket tier&apos;s
          own questions above instead.
        </p>

        <QuestionsBuilder
          questions={questions}
          onChange={(next) => {
            setMsg(null);
            setQuestions(next);
          }}
          emptyHint="No custom questions yet — buyers just provide name, email, and phone."
        />

        {err && <p className="text-xs text-destructive">{err}</p>}
        {msg && !dirty && <p className="text-xs text-grass-text">{msg}</p>}

        {dirty && (
          <div className="flex items-center gap-2 border-t pt-3">
            <Button onClick={save} disabled={busy} size="sm">
              {busy ? "Saving…" : "Save questions"}
            </Button>
            <Button
              onClick={() => {
                setQuestions(initialQuestions);
                setErr(null);
                setMsg(null);
              }}
              disabled={busy}
              size="sm"
              variant="outline"
            >
              Discard
            </Button>
            <span className="text-xs text-muted-foreground">Unsaved changes</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
