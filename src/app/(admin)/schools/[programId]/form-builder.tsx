"use client";

/**
 * Frame 15a — application form builder.
 *
 * One readable list, top to bottom. No canvas, no drag-from-palette panel.
 * A conditional follow-up is indented 26px on #F7F5EE and carries a yellow
 * SHOWS WHEN pill, so the branching is visible in the SHAPE of the list rather
 * than hidden behind a settings dialog — that is the whole idea of the frame.
 *
 * The frame puts the field-type chips in a left panel. In the built Hub that
 * space is the app's own nav rail, so the chips sit above the list instead;
 * everything else follows the frame.
 */

import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { QUESTION_TYPE_LABELS, type TreeQuestion } from "@/components/admin/question-tree";
import { SectionBar } from "@/components/ffsa";
import { cn } from "@/lib/utils/cn";
import {
  MIN_REQUIRED_REFERENCE_SLOTS,
  countRequiredSlots,
} from "@/lib/references/minimum-slots";

export type BuilderSlot = {
  id: string;
  label: string;
  description: string | null;
  is_required: boolean;
};

/** The chips that append a question. Frame order, frame labels. */
export const FIELD_TYPES: Array<[type: string, label: string]> = [
  ["short_answer", "SHORT TEXT"],
  ["long_answer", "LONG TEXT"],
  ["multiple_choice", "CHOICE"],
  ["yes_no", "YES / NO"],
  ["checkbox_group", "MULTI"],
  ["date", "DATE"],
  ["country", "COUNTRY"],
  ["file", "FILE"],
  ["section_header", "SECTION"],
];

function typePill(type: string) {
  return (QUESTION_TYPE_LABELS[type] ?? type).toUpperCase();
}

function showWhenLabel(answer: string | null): string {
  if (!answer) return "SHOWS WHEN";
  return `SHOWS WHEN · ${answer.toUpperCase()}`;
}

/* ── One row ──────────────────────────────────────────────── */

function QuestionRow({
  question,
  depth,
  followUpCount,
  onEdit,
  onDelete,
  onAddFollowUp,
}: {
  question: TreeQuestion;
  depth: number;
  followUpCount: number;
  onEdit: (q: TreeQuestion) => void;
  onDelete: (id: string) => void;
  onAddFollowUp: (parent: TreeQuestion) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: question.id });

  const isSection = question.type === "section_header";
  const isConditional = depth > 0;
  const canBranch = question.type === "yes_no" || question.type === "multiple_choice";

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
        // 26px per level of nesting — the indent IS the branching.
        marginLeft: depth * 26,
      }}
      className={cn(
        "mb-[5px] flex items-center gap-3.5 border px-3.5 py-2.5 hover:border-ink",
        isSection && "border-ink bg-ink",
        !isSection && isConditional && "border-rule bg-[#F7F5EE]",
        !isSection && !isConditional && "border-[#E7E4D9] bg-white"
      )}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label={`Reorder ${question.label}`}
        className={cn(
          "shrink-0 cursor-grab font-mono text-[12px] active:cursor-grabbing",
          isSection ? "text-[#8E8B82]" : "text-[#B4B0A2]"
        )}
      >
        ⠿
      </button>

      <button
        type="button"
        onClick={() => onEdit(question)}
        className={cn(
          "min-w-0 flex-1 truncate text-left tracking-normal",
          isSection
            ? "!font-display text-[17px] !font-black uppercase text-white"
            : "!font-sans text-[14.5px] !font-semibold normal-case text-ink"
        )}
        title={question.description ?? undefined}
      >
        {question.label}
      </button>

      {isConditional && (
        <span className="shrink-0 bg-yellow px-1.5 py-1 font-mono text-[8.5px] font-bold tracking-[0.1em] text-ink">
          {showWhenLabel(question.show_when_answer)}
        </span>
      )}

      {followUpCount > 0 && (
        <span className="shrink-0 font-mono text-[8.5px] font-bold tracking-[0.1em] text-[color:var(--amber)]">
          {followUpCount} FOLLOW-UP{followUpCount === 1 ? "" : "S"}
        </span>
      )}

      {!isSection && (
        <span className="w-[52px] shrink-0 text-right font-mono text-[8.5px] font-bold tracking-[0.1em] text-[color:var(--text-tertiary)]">
          {question.is_required ? "REQUIRED" : ""}
        </span>
      )}

      {!isSection && (
        <span className="w-[84px] shrink-0 border border-rule px-1.5 py-1 text-center font-mono text-[8.5px] font-bold tracking-[0.1em] text-[color:var(--text-secondary)]">
          {typePill(question.type)}
        </span>
      )}

      <span className="flex shrink-0 items-center gap-2">
        {canBranch && (
          <button
            type="button"
            onClick={() => onAddFollowUp(question)}
            title="Add a follow-up question revealed by this answer"
            className={cn(
              "font-mono text-[8.5px] font-bold tracking-[0.1em]",
              isSection ? "text-white/70 hover:text-white" : "text-[color:var(--text-tertiary)] hover:text-ink"
            )}
          >
            + FOLLOW-UP
          </button>
        )}
        {!question.is_system && (
          <button
            type="button"
            onClick={() => onDelete(question.id)}
            aria-label={`Delete ${question.label}`}
            className={cn(
              "font-mono text-[11px]",
              isSection ? "text-white/70 hover:text-white" : "text-[color:var(--text-tertiary)] hover:text-destructive"
            )}
          >
            ✕
          </button>
        )}
        {question.is_system && (
          <span
            title="Built-in question — reorder freely, but it can't be deleted or made optional"
            className={cn(
              "font-mono text-[8.5px] font-bold tracking-[0.1em]",
              isSection ? "text-white/70" : "text-[color:var(--text-tertiary)]"
            )}
          >
            LOCKED
          </span>
        )}
      </span>
    </div>
  );
}

/* ── The builder ──────────────────────────────────────────── */

export function FormBuilder({
  questions,
  slots,
  onEdit,
  onDelete,
  onReorder,
  onAddFollowUp,
  onAddOfType,
  onAddSlot,
  onEditSlot,
  onMoveSlot,
  onDeleteSlot,
  preview,
}: {
  questions: TreeQuestion[];
  slots: BuilderSlot[];
  onEdit: (q: TreeQuestion) => void;
  onDelete: (id: string) => void;
  onReorder: (orderedIds: string[]) => void;
  onAddFollowUp: (parent: TreeQuestion) => void;
  onAddOfType: (type: string) => void;
  onAddSlot: () => void;
  onEditSlot: (slot: BuilderSlot) => void;
  onMoveSlot: (id: string, direction: "up" | "down") => void;
  onDeleteSlot: (id: string) => void;
  /** The public form as an applicant sees it, rendered by the parent. */
  preview: React.ReactNode;
}) {
  // The same floor the API enforces, stated ahead of time so a leader sees the
  // shortfall here instead of hitting a 409 (or shipping an apply link that
  // won't open).
  const MIN_REQUIRED_SLOTS = MIN_REQUIRED_REFERENCE_SLOTS;
  const requiredSlotCount = countRequiredSlots(slots);

  const childrenByParent = new Map<string, TreeQuestion[]>();
  for (const q of questions) {
    if (!q.parent_question_id) continue;
    const list = childrenByParent.get(q.parent_question_id) ?? [];
    list.push(q);
    childrenByParent.set(q.parent_question_id, list);
  }
  for (const list of childrenByParent.values()) list.sort((a, b) => a.sort_order - b.sort_order);

  const topLevel = questions
    .filter((q) => !q.parent_question_id)
    .sort((a, b) => a.sort_order - b.sort_order);

  const byId = new Map(questions.map((q) => [q.id, q]));

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const a = byId.get(String(active.id));
    const b = byId.get(String(over.id));
    if (!a || !b) return;
    // Reordering only ever happens within one parent — a follow-up dragged out
    // of its branch would lose the answer that reveals it.
    const parent = a.parent_question_id ?? null;
    if (parent !== (b.parent_question_id ?? null)) return;
    const siblings = parent ? (childrenByParent.get(parent) ?? []) : topLevel;
    const from = siblings.findIndex((q) => q.id === active.id);
    const to = siblings.findIndex((q) => q.id === over.id);
    if (from === -1 || to === -1) return;
    onReorder(arrayMove(siblings, from, to).map((q) => q.id));
  }

  function renderBranch(q: TreeQuestion, depth: number): React.ReactNode {
    const children = childrenByParent.get(q.id) ?? [];
    return (
      <div key={q.id}>
        <QuestionRow
          question={q}
          depth={depth}
          followUpCount={depth === 0 ? children.length : 0}
          onEdit={onEdit}
          onDelete={onDelete}
          onAddFollowUp={onAddFollowUp}
        />
        {children.length > 0 && (
          <SortableContext items={children.map((c) => c.id)} strategy={verticalListSortingStrategy}>
            {children.map((c) => renderBranch(c, depth + 1))}
          </SortableContext>
        )}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 items-start gap-0 xl:grid-cols-[minmax(0,1fr)_420px]">
      <div className="min-w-0 border-ink xl:border-r">
        <div className="flex flex-wrap items-center gap-1.5 border-b border-rule bg-bone px-5 py-3 md:px-6">
          <span className="mono-label mr-1">Add a question</span>
          {FIELD_TYPES.map(([type, label]) => (
            <button
              key={type}
              type="button"
              onClick={() => onAddOfType(type)}
              className="border border-rule-strong bg-white px-1.5 py-1.5 font-mono text-[8.5px] font-bold tracking-[0.08em] text-[color:var(--text-secondary)] hover:border-ink hover:bg-yellow hover:text-ink"
            >
              {label}
            </button>
          ))}
        </div>

        <div className="px-5 py-4 md:px-6">
          {topLevel.length === 0 ? (
            <p className="mono-label py-8 text-center">
              Nothing on the form yet — pick a field type above
            </p>
          ) : (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={topLevel.map((q) => q.id)} strategy={verticalListSortingStrategy}>
                {topLevel.map((q) => renderBranch(q, 0))}
              </SortableContext>
            </DndContext>
          )}

          <button
            type="button"
            onClick={() => onAddOfType("short_answer")}
            className="mt-1.5 w-full border border-dashed border-[#B4B0A2] px-3 py-3 font-mono text-[10px] font-bold tracking-[0.14em] text-[color:var(--text-tertiary)] hover:border-ink hover:text-ink"
          >
            + ADD QUESTION
          </button>
        </div>

        {/* References get their own black-barred block, below the questions. */}
        <div className="border-t border-ink">
          <SectionBar
            title="References we ask for"
            meta={
              <button type="button" onClick={onAddSlot} className="hover:text-white">
                + ADD SLOT
              </button>
            }
          />
          {/* Every FFSA school asks for two references, so anything short of
              that is a problem to fix rather than a neutral state. Shown above
              the list, since one slot is as wrong as none. */}
          {requiredSlotCount < MIN_REQUIRED_SLOTS && (
            <div className="border-b border-rule px-6 py-5 text-center">
              <p className="text-sm font-semibold text-[#8A6400]">
                {slots.length === 0
                  ? "This school is asking for no references"
                  : `This school is only asking for ${requiredSlotCount} of ${MIN_REQUIRED_SLOTS} references`}
              </p>
              <p className="mt-1 text-xs text-[color:var(--text-tertiary)]">
                Applications will come in short, and the confirmation email
                promises a wait for references nobody was asked for. Add{" "}
                {MIN_REQUIRED_SLOTS - requiredSlotCount === 1
                  ? "another reference"
                  : `${MIN_REQUIRED_SLOTS - requiredSlotCount} more references`}{" "}
                before sharing the apply link.
              </p>
            </div>
          )}
          {slots.length > 0 &&
            slots.map((slot, i) => (
              <div
                key={slot.id}
                className="group/slot flex items-center gap-3.5 border-b border-rule px-5 py-3 hover:bg-[#F7F5EE] md:px-6"
              >
                <button
                  type="button"
                  onClick={() => onEditSlot(slot)}
                  className="w-[170px] shrink-0 !font-sans text-left text-[14px] !font-bold normal-case tracking-normal text-ink"
                >
                  {slot.label}
                </button>
                <button
                  type="button"
                  onClick={() => onEditSlot(slot)}
                  className="min-w-0 flex-1 truncate !font-sans text-left text-[13px] !font-normal normal-case tracking-normal text-[color:var(--text-secondary)]"
                >
                  {slot.description ?? "No help text"}
                </button>
                <span
                  className={cn(
                    "shrink-0 font-mono text-[9px] font-bold tracking-[0.12em]",
                    slot.is_required ? "text-ink" : "text-[color:var(--text-tertiary)]"
                  )}
                >
                  {slot.is_required ? "REQUIRED" : "OPTIONAL"}
                </span>
                {/* Order and removal, in the same mono language as the rows
                    above — the frame doesn't draw them, but a slot you can't
                    reorder or remove is a slot you're stuck with. */}
                <span className="flex shrink-0 items-center gap-1.5 opacity-0 focus-within:opacity-100 group-hover/slot:opacity-100">
                  <button
                    type="button"
                    disabled={i === 0}
                    onClick={() => onMoveSlot(slot.id, "up")}
                    aria-label={`Move ${slot.label} up`}
                    className="font-mono text-[11px] text-[color:var(--text-tertiary)] hover:text-ink disabled:opacity-30"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    disabled={i === slots.length - 1}
                    onClick={() => onMoveSlot(slot.id, "down")}
                    aria-label={`Move ${slot.label} down`}
                    className="font-mono text-[11px] text-[color:var(--text-tertiary)] hover:text-ink disabled:opacity-30"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    onClick={() => onDeleteSlot(slot.id)}
                    aria-label={`Delete ${slot.label}`}
                    className="font-mono text-[11px] text-[color:var(--text-tertiary)] hover:text-destructive"
                  >
                    ✕
                  </button>
                </span>
              </div>
            ))}
        </div>
      </div>

      {/* ── Live public preview ── */}
      <div className="flex min-w-0 flex-col bg-bone">
        <div className="flex items-center justify-between gap-2 border-b border-rule px-5 py-3">
          <span className="mono-label">Live preview · what she sees</span>
        </div>
        <div className="p-5">{preview}</div>
      </div>
    </div>
  );
}

/* ── Live public preview ──────────────────────────────────── */

/**
 * The real form as an applicant sees it. Rendered from the same question rows
 * the list above is editing, so the preview cannot drift from the form — and a
 * conditional block is drawn under its parent behind a yellow rule, which is
 * how it will actually appear once she answers Yes.
 */
export function FormPreview({
  schoolName,
  programCode,
  questions,
}: {
  schoolName: string;
  programCode: string;
  questions: TreeQuestion[];
}) {
  const childrenByParent = new Map<string, TreeQuestion[]>();
  for (const q of questions) {
    if (!q.parent_question_id) continue;
    const list = childrenByParent.get(q.parent_question_id) ?? [];
    list.push(q);
    childrenByParent.set(q.parent_question_id, list);
  }
  for (const list of childrenByParent.values()) list.sort((a, b) => a.sort_order - b.sort_order);

  const topLevel = questions
    .filter((q) => !q.parent_question_id)
    .sort((a, b) => a.sort_order - b.sort_order);

  function Field({ q }: { q: TreeQuestion }) {
    return (
      <div className="mb-4">
        <div className="mb-1.5 text-[13px] font-semibold text-ink">
          {q.label}
          {q.is_required && <span className="text-[color:var(--amber)]"> *</span>}
        </div>
        {q.type === "long_answer" ? (
          <div className="h-[78px] border border-rule-strong bg-[#FDFCF8]" />
        ) : q.type === "yes_no" ? (
          <div className="flex gap-2">
            <span className="flex-1 border border-ink bg-ink py-2 text-center text-[13px] font-semibold text-white">
              Yes
            </span>
            <span className="flex-1 border border-rule-strong py-2 text-center text-[13px] font-semibold text-[color:var(--text-secondary)]">
              No
            </span>
          </div>
        ) : q.type === "multiple_choice" || q.type === "checkbox_group" ? (
          <div className="flex flex-wrap gap-2">
            {(q.options ?? ["Option"]).slice(0, 4).map((o, i) => (
              <span
                key={`${o}-${i}`}
                className="border border-rule-strong px-2.5 py-1.5 text-[13px] text-[color:var(--text-secondary)]"
              >
                {o}
              </span>
            ))}
          </div>
        ) : q.type === "file" ? (
          <div className="border border-dashed border-[#B4B0A2] px-3 py-3.5 text-center font-mono text-[9.5px] font-bold tracking-[0.1em] text-[color:var(--text-tertiary)]">
            DROP A FILE
          </div>
        ) : (
          <div className="h-[38px] border border-rule-strong bg-[#FDFCF8]" />
        )}
      </div>
    );
  }

  return (
    <div className="border border-ink bg-white px-5 py-6">
      <div className="mono-label">{schoolName}</div>
      <div className="mt-2 font-display text-[34px] font-black uppercase leading-[0.95] text-ink">
        Apply · {programCode}
      </div>
      <div className="my-4 h-px bg-ink" />

      {topLevel.length === 0 ? (
        <p className="py-6 text-center text-[13px] text-[color:var(--text-tertiary)]">
          Nothing to preview yet.
        </p>
      ) : (
        topLevel.map((q) => {
          const children = childrenByParent.get(q.id) ?? [];
          if (q.type === "section_header") {
            return (
              <div
                key={q.id}
                className="mb-3 mt-5 font-display text-[15px] font-black uppercase text-ink first:mt-0"
              >
                {q.label}
              </div>
            );
          }
          return (
            <div key={q.id}>
              <Field q={q} />
              {children.length > 0 && (
                // The yellow rule marks everything that only appears once she
                // has answered the question above it.
                <div className="mb-4 border-l-[3px] border-yellow pl-3.5">
                  {children.map((c) => (
                    <Field key={c.id} q={c} />
                  ))}
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
