"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus } from "lucide-react";
import {
  QuestionTree,
  type TreeQuestion,
} from "@/components/admin/question-tree";

type RefQuestion = TreeQuestion;

export function ReferenceQuestionsBuilder({
  programId,
  questions,
}: {
  programId: string;
  questions: RefQuestion[];
}) {
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<RefQuestion | null>(null);
  const [qLabel, setQLabel] = useState("");
  const [qDescription, setQDescription] = useState("");
  const [qType, setQType] = useState("short_answer");
  const [qOptions, setQOptions] = useState("");
  const [qRequired, setQRequired] = useState(true);
  const [qParentId, setQParentId] = useState<string>("");
  const [qShowWhenAnswer, setQShowWhenAnswer] = useState<string>("");
  const [qLoading, setQLoading] = useState(false);
  const [qError, setQError] = useState<string | null>(null);

  const parentCandidates = questions.filter(
    (q) =>
      (q.type === "yes_no" || q.type === "multiple_choice") &&
      q.id !== editing?.id
  );
  const selectedParent = parentCandidates.find((q) => q.id === qParentId) ?? null;
  const parentAnswerOptions: string[] = selectedParent
    ? selectedParent.type === "yes_no"
      ? ["yes", "no"]
      : selectedParent.options ?? []
    : [];

  function resetForm() {
    setQLabel("");
    setQDescription("");
    setQType("short_answer");
    setQOptions("");
    setQRequired(true);
    setQParentId("");
    setQShowWhenAnswer("");
    setQError(null);
    setEditing(null);
    setShowForm(false);
  }

  function startEdit(q: RefQuestion) {
    setEditing(q);
    setQLabel(q.label);
    setQDescription(q.description ?? "");
    setQType(q.type);
    setQOptions(q.options?.join("\n") ?? "");
    setQRequired(q.is_required);
    setQParentId(q.parent_question_id ?? "");
    setQShowWhenAnswer(q.show_when_answer ?? "");
    setShowForm(true);
  }

  function startAddFollowUp(parent: RefQuestion) {
    setEditing(null);
    setQLabel("");
    setQDescription("");
    setQType("short_answer");
    setQOptions("");
    setQRequired(true);
    setQParentId(parent.id);
    setQShowWhenAnswer(
      parent.type === "yes_no" ? "yes" : parent.options?.[0] ?? ""
    );
    setQError(null);
    setShowForm(true);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setQLoading(true);
    setQError(null);

    const hasParent = !!qParentId;
    if (hasParent && !qShowWhenAnswer) {
      setQError("Please choose which answer should trigger this follow-up.");
      setQLoading(false);
      return;
    }
    const followUpPayload = hasParent
      ? { parent_question_id: qParentId, show_when_answer: qShowWhenAnswer }
      : { parent_question_id: null, show_when_answer: null };

    try {
      if (editing) {
        const res = await fetch("/api/schools/references/questions", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: editing.id,
            label: qLabel,
            description: qDescription || null,
            type: qType,
            is_required: qRequired,
            options:
              qType === "multiple_choice" || qType === "checkbox_group"
                ? qOptions.split("\n").map((o) => o.trim()).filter(Boolean)
                : [],
            ...followUpPayload,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          setQError(data.error || "Failed to update question");
          return;
        }
      } else {
        const res = await fetch("/api/schools/references/questions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            program_id: programId,
            label: qLabel,
            description: qDescription || null,
            type: qType,
            is_required: qRequired,
            sort_order: questions.length,
            options:
              qType === "multiple_choice" || qType === "checkbox_group"
                ? qOptions.split("\n").map((o) => o.trim()).filter(Boolean)
                : [],
            ...followUpPayload,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          setQError(data.error || "Failed to add question");
          return;
        }
      }

      resetForm();
      router.refresh();
    } catch {
      setQError("Network error");
    } finally {
      setQLoading(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this question?")) return;
    try {
      const res = await fetch(
        `/api/schools/references/questions?id=${id}`,
        { method: "DELETE" }
      );
      if (res.ok) router.refresh();
    } catch {
      alert("Failed to delete question");
    }
  }

  async function handleReorder(orderedIds: string[]) {
    const items = orderedIds.map((id, idx) => ({ id, sort_order: idx }));
    await fetch("/api/schools/references/questions/reorder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items }),
    });
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-medium">Reference Questions ({questions.length})</h3>
          <p className="text-xs text-muted-foreground mt-1">
            Questions referees answer when they fill out the reference form for
            applicants to this program. Drag rows to reorder.
          </p>
        </div>
        {!showForm && (
          <Button size="sm" variant="outline" onClick={() => setShowForm(true)}>
            <Plus className="mr-1 h-3 w-3" /> Add Question
          </Button>
        )}
      </div>

      {showForm && (
        <div className="border p-4">
          <form onSubmit={handleSave} className="space-y-3">
            <div>
              <Label>
                {qType === "section_header" ? "Header Title *" : "Question Label *"}
              </Label>
              <Input
                required
                value={qLabel}
                onChange={(e) => setQLabel(e.target.value)}
                placeholder={
                  qType === "section_header"
                    ? "e.g. Character Assessment"
                    : "e.g. How long have you known the applicant?"
                }
              />
            </div>
            <div>
              <Label>
                {qType === "section_header"
                  ? "Description Text"
                  : "Help Text / Description"}
              </Label>
              <Input
                value={qDescription}
                onChange={(e) => setQDescription(e.target.value)}
                placeholder={
                  qType === "section_header"
                    ? "Optional text shown below the header"
                    : "Optional instructions for the referee"
                }
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Answer Type</Label>
                <Select value={qType} onValueChange={setQType}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="short_answer">Short Answer</SelectItem>
                    <SelectItem value="long_answer">Long Answer (Essay)</SelectItem>
                    <SelectItem value="multiple_choice">Multiple Choice</SelectItem>
                    <SelectItem value="yes_no">Yes / No</SelectItem>
                    <SelectItem value="checkbox_group">Checkbox Group</SelectItem>
                    <SelectItem value="phone">Phone Number</SelectItem>
                    <SelectItem value="email">Email</SelectItem>
                    <SelectItem value="date">Date</SelectItem>
                    <SelectItem value="section_header">Section Header</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {qType !== "section_header" && (
                <div className="flex items-center gap-2 pt-6">
                  <input
                    type="checkbox"
                    id="ref-q-required"
                    checked={qRequired}
                    onChange={(e) => setQRequired(e.target.checked)}
                  />
                  <Label htmlFor="ref-q-required" className="mb-0">
                    Required
                  </Label>
                </div>
              )}
            </div>
            {(qType === "multiple_choice" || qType === "checkbox_group") && (
              <div>
                <Label>Options (one per line) *</Label>
                <Textarea
                  value={qOptions}
                  onChange={(e) => setQOptions(e.target.value)}
                  placeholder={"Option 1\nOption 2\nOption 3"}
                  rows={4}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Enter each choice on a new line.
                </p>
              </div>
            )}
            {qType !== "section_header" && (
              <div className="border bg-muted/30 p-3 space-y-3">
                <div>
                  <Label>Show this question only as a follow-up to…</Label>
                  <Select
                    value={qParentId || "none"}
                    onValueChange={(v) => {
                      const nextId = v === "none" ? "" : v;
                      setQParentId(nextId);
                      if (!nextId) {
                        setQShowWhenAnswer("");
                        return;
                      }
                      const parent = parentCandidates.find((q) => q.id === nextId);
                      if (parent) {
                        setQShowWhenAnswer(
                          parent.type === "yes_no"
                            ? "yes"
                            : parent.options?.[0] ?? ""
                        );
                      }
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="No — show this question always" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">
                        No — show this question always
                      </SelectItem>
                      {parentCandidates.map((q) => (
                        <SelectItem key={q.id} value={q.id}>
                          {q.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground mt-1">
                    Optional. Only yes/no and multiple-choice questions can
                    trigger follow-ups.
                  </p>
                </div>
                {qParentId && parentAnswerOptions.length > 0 && (
                  <div>
                    <Label>Show when answer is</Label>
                    <Select value={qShowWhenAnswer} onValueChange={setQShowWhenAnswer}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select an answer" />
                      </SelectTrigger>
                      <SelectContent>
                        {parentAnswerOptions.map((opt) => (
                          <SelectItem key={opt} value={opt}>
                            {opt === "yes" ? "Yes" : opt === "no" ? "No" : opt}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
            )}
            {qError && <p className="text-sm text-destructive">{qError}</p>}
            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={qLoading}>
                {qLoading
                  ? "Saving..."
                  : editing
                    ? "Update Question"
                    : "Add Question"}
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={resetForm}>
                Cancel
              </Button>
            </div>
          </form>
        </div>
      )}

      {questions.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-6">
          No reference questions yet. Add some so referees know what to answer.
        </p>
      ) : (
        <div className="space-y-2">
          <QuestionTree
            questions={questions}
            onEdit={startEdit}
            onDelete={handleDelete}
            onReorder={handleReorder}
            onAddFollowUp={startAddFollowUp}
          />
        </div>
      )}
    </div>
  );
}
