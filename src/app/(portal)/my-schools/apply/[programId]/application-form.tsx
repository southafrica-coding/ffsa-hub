"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { CheckCircle } from "lucide-react";
import { orderQuestionsForRender } from "@/lib/form-types";

type Question = {
  id: string;
  label: string;
  description: string | null;
  type: string;
  is_required: boolean;
  options: string[] | null;
  parent_question_id?: string | null;
  show_when_answer?: string | null;
  system_key?: string | null;
};

function isVisible(
  question: Question,
  questionsById: Map<string, Question>,
  answers: Record<string, string>
): boolean {
  let current = question;
  const seen = new Set<string>();
  while (current.parent_question_id) {
    if (seen.has(current.id)) return false;
    seen.add(current.id);
    const parent = questionsById.get(current.parent_question_id);
    if (!parent) return false;
    if ((answers[parent.id] ?? "") !== current.show_when_answer) return false;
    current = parent;
  }
  return true;
}

type ReferenceSlot = {
  id: string;
  label: string;
  description: string | null;
  is_required: boolean;
};

export function ApplicationForm({
  programId,
  questions,
  referenceSlots = [],
  countries = [],
  initialNationality = "",
}: {
  programId: string;
  questions: Question[];
  referenceSlots?: ReferenceSlot[];
  countries?: string[];
  initialNationality?: string;
}) {
  const router = useRouter();
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [refNames, setRefNames] = useState<Record<string, string>>({});
  const [refEmails, setRefEmails] = useState<Record<string, string>>({});
  // Nationality (prefilled from profile) drives the fee tier; home country is
  // kept for records. Both render as country dropdowns and are required.
  const [nationality, setNationality] = useState(
    // Only prefill when the stored value exactly matches a dropdown option, so
    // the selected value always reflects what's shown (never a hidden mismatch).
    initialNationality && countries.includes(initialNationality)
      ? initialNationality
      : ""
  );
  const [homeCountry, setHomeCountry] = useState("");

  const isSystemCountry = (q: Question) =>
    q.system_key === "nationality" || q.system_key === "home_country";

  const questionsById = useMemo(
    () => new Map(questions.map((q) => [q.id, q])),
    [questions]
  );

  // Reorder so follow-ups render directly under their parent (and indent
  // them via depthById) instead of falling to the bottom by sort_order.
  const { orderedQuestions, depthById } = useMemo<{
    orderedQuestions: Question[];
    depthById: Map<string, number>;
  }>(() => {
    const { ordered, depthById } = orderQuestionsForRender(
      questions,
      (q) => q.parent_question_id
    );
    return { orderedQuestions: ordered, depthById };
  }, [questions]);

  const visibleQuestions = orderedQuestions.filter((q) =>
    isVisible(q, questionsById, answers)
  );
  const visibleIds = new Set(visibleQuestions.map((q) => q.id));

  function setAnswer(questionId: string, value: string) {
    setAnswers((prev) => ({ ...prev, [questionId]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    // Validate required fields (only those currently visible). System country
    // fields are validated separately below — they live in their own state, not
    // the answers map.
    for (const q of visibleQuestions) {
      if (isSystemCountry(q)) continue;
      if (q.is_required && !answers[q.id]?.trim()) {
        setError(`Please answer: "${q.label}"`);
        return;
      }
    }

    // Nationality / home country are required whenever the program includes the
    // system question (it is seeded for every program).
    const hasNationalityQ = visibleQuestions.some(
      (q) => q.system_key === "nationality"
    );
    const hasHomeCountryQ = visibleQuestions.some(
      (q) => q.system_key === "home_country"
    );
    if (hasNationalityQ && !nationality) {
      setError("Please select your nationality.");
      return;
    }
    if (hasHomeCountryQ && !homeCountry) {
      setError("Please select your home country.");
      return;
    }

    for (const slot of referenceSlots) {
      if (slot.is_required && (!refNames[slot.id]?.trim() || !refEmails[slot.id]?.trim())) {
        setError(`Please provide referee details for: "${slot.label}"`);
        return;
      }
    }

    setLoading(true);

    const formattedAnswers = questions
      .filter((q) => visibleIds.has(q.id) && !isSystemCountry(q))
      .map((q) => ({
        question_id: q.id,
        question_label: q.label,
        answer: answers[q.id]?.trim() ?? "",
      }));

    try {
      const res = await fetch("/api/schools/applications/responses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          program_id: programId,
          answers: formattedAnswers,
          nationality: nationality.trim(),
          home_country: homeCountry.trim(),
          references: referenceSlots
            .filter((slot) => refNames[slot.id]?.trim() && refEmails[slot.id]?.trim())
            .map((slot) => ({
              slot_id: slot.id,
              referee_name: refNames[slot.id].trim(),
              referee_email: refEmails[slot.id].trim(),
            })),
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to submit application");
        return;
      }

      setSubmitted(true);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  if (submitted) {
    return (
      <Card>
        <CardContent className="py-8 text-center space-y-4">
          <CheckCircle className="h-12 w-12 text-green-600 mx-auto" />
          <h2 className="text-lg font-semibold">Application Submitted!</h2>
          <p className="text-sm text-muted-foreground">
            Your application has been received and is under review. You will be
            notified when a decision has been made.
          </p>
          <Button variant="outline" onClick={() => router.push("/my-schools")}>
            Back to My Training
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {visibleQuestions.map((q, idx) => {
        const depth = depthById.get(q.id) ?? 0;

        // System country fields (Nationality / Home Country) render as country
        // dropdowns bound to their own state, matching the public apply form.
        if (isSystemCountry(q)) {
          const isNat = q.system_key === "nationality";
          const value = isNat ? nationality : homeCountry;
          const setter = isNat ? setNationality : setHomeCountry;
          return (
            <div
              key={q.id}
              className="space-y-2"
              style={depth > 0 ? { marginLeft: `${depth * 16}px` } : undefined}
            >
              <Label className="text-sm font-medium">
                {idx + 1}. {q.label}
                <span className="text-destructive ml-1">*</span>
              </Label>
              {q.description && (
                <p className="text-xs text-muted-foreground">{q.description}</p>
              )}
              <select
                value={value}
                onChange={(e) => setter(e.target.value)}
                required
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="" disabled>
                  Select…
                </option>
                {countries.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          );
        }

        return (
          <div
            key={q.id}
            className="space-y-2"
            style={depth > 0 ? { marginLeft: `${depth * 16}px` } : undefined}
          >
            <Label className="text-sm font-medium">
              {idx + 1}. {q.label}
              {q.is_required && <span className="text-destructive ml-1">*</span>}
            </Label>
            {q.description && (
              <p className="text-xs text-muted-foreground">{q.description}</p>
            )}
            {q.type === "multiple_choice" && q.options && q.options.length > 0 ? (
              <div className="flex flex-col gap-2 pt-1">
                {q.options.map((option) => (
                  <label key={option} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name={`q-${q.id}`}
                      value={option}
                      checked={answers[q.id] === option}
                      onChange={() => setAnswer(q.id, option)}
                    />
                    <span className="text-sm">{option}</span>
                  </label>
                ))}
              </div>
            ) : q.type === "yes_no" ? (
              <div className="flex gap-4 pt-1">
                {["yes", "no"].map((option) => (
                  <label key={option} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name={`q-${q.id}`}
                      value={option}
                      checked={answers[q.id] === option}
                      onChange={() => setAnswer(q.id, option)}
                    />
                    <span className="text-sm capitalize">{option}</span>
                  </label>
                ))}
              </div>
            ) : q.type === "long_answer" ? (
              <Textarea
                value={answers[q.id] ?? ""}
                onChange={(e) => setAnswer(q.id, e.target.value)}
                placeholder="Your answer..."
                rows={5}
                required={q.is_required}
              />
            ) : (
              <Input
                value={answers[q.id] ?? ""}
                onChange={(e) => setAnswer(q.id, e.target.value)}
                placeholder="Your answer..."
                required={q.is_required}
              />
            )}
          </div>
        );
      })}

      {/* References */}
      {referenceSlots.length > 0 && (
        <div className="space-y-4 rounded-lg border bg-card p-5">
          <div>
            <h3 className="text-sm font-semibold">References</h3>
            <p className="text-xs text-muted-foreground mt-1">
              Your referees will receive an email with a link to submit their reference.
            </p>
          </div>
          {referenceSlots.map((slot) => (
            <div key={slot.id} className="space-y-3 rounded-md border p-4">
              <p className="text-sm font-medium">
                {slot.label}
                {slot.is_required && <span className="text-destructive ml-1">*</span>}
              </p>
              {slot.description && (
                <p className="text-xs text-muted-foreground">{slot.description}</p>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label>Referee Name {slot.is_required && <span className="text-destructive">*</span>}</Label>
                  <Input
                    placeholder="Full name"
                    value={refNames[slot.id] ?? ""}
                    onChange={(e) => setRefNames((prev) => ({ ...prev, [slot.id]: e.target.value }))}
                    required={slot.is_required}
                  />
                </div>
                <div>
                  <Label>Referee Email {slot.is_required && <span className="text-destructive">*</span>}</Label>
                  <Input
                    type="email"
                    placeholder="referee@email.com"
                    value={refEmails[slot.id] ?? ""}
                    onChange={(e) => setRefEmails((prev) => ({ ...prev, [slot.id]: e.target.value }))}
                    required={slot.is_required}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}

      <div className="flex gap-3">
        <Button type="submit" disabled={loading}>
          {loading ? "Submitting..." : "Submit Application"}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => router.push("/my-schools")}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
