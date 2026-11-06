"use client";

import { useState } from "react";
import {
  COURSE_DESIGN_VERSION,
  type CourseDesign,
  type DesignItem,
  type DesignModule,
} from "@/lib/schools/lms-api";
import { Field, SquareButton, fieldClass } from "./fields";

type KeyedItem = DesignItem & { key: string };
type KeyedModule = { key: string; title: string; summary: string; items: KeyedItem[] };

function uid() {
  return crypto.randomUUID();
}

function withKeys(design: CourseDesign): KeyedModule[] {
  return design.modules.map((section) => ({
    key: uid(),
    title: section.title,
    summary: section.summary ?? "",
    items: section.items.map((item) => ({ ...item, key: uid() })),
  }));
}

function toDesign(summary: string, modules: KeyedModule[]): CourseDesign {
  return {
    schema_version: COURSE_DESIGN_VERSION,
    summary,
    modules: modules.map((section) => {
      const next: DesignModule = {
        title: section.title,
        items: section.items.map((item) => {
          if (item.kind === "page") return { kind: "page" as const, title: item.title, body: item.body };
          if (item.kind === "discussion") {
            return { kind: "discussion" as const, title: item.title, prompt: item.prompt };
          }
          return {
            kind: "assignment" as const,
            title: item.title,
            brief: item.brief,
            points: item.points,
            ...(item.due_offset_days != null ? { due_offset_days: item.due_offset_days } : {}),
          };
        }),
      };
      if (section.summary.trim()) next.summary = section.summary;
      return next;
    }),
  };
}

function blankItem(kind: DesignItem["kind"]): DesignItem {
  if (kind === "page") return { kind: "page", title: "New page", body: "" };
  if (kind === "discussion") return { kind: "discussion", title: "New discussion", prompt: "" };
  return { kind: "assignment", title: "New assignment", brief: "", points: 10 };
}

export function DesignEditor({
  initial,
  onChange,
}: {
  initial: CourseDesign;
  onChange: (design: CourseDesign) => void;
}) {
  const [summary, setSummary] = useState(initial.summary ?? "");
  const [modules, setModules] = useState<KeyedModule[]>(() => withKeys(initial));

  function commit(nextSummary: string, nextModules: KeyedModule[]) {
    setSummary(nextSummary);
    setModules(nextModules);
    onChange(toDesign(nextSummary, nextModules));
  }

  function updateModule(index: number, patch: Partial<KeyedModule>) {
    const next = modules.map((section, i) => (i === index ? { ...section, ...patch } : section));
    commit(summary, next);
  }

  function moveModule(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= modules.length) return;
    const next = [...modules];
    const [row] = next.splice(index, 1);
    next.splice(target, 0, row);
    commit(summary, next);
  }

  function updateItem(moduleIndex: number, itemIndex: number, patch: Partial<DesignItem>) {
    const next = modules.map((section, i) => {
      if (i !== moduleIndex) return section;
      return {
        ...section,
        items: section.items.map((item, j) => (j === itemIndex ? ({ ...item, ...patch } as KeyedItem) : item)),
      };
    });
    commit(summary, next);
  }

  return (
    <div className="space-y-6">
      <Field label="Course summary" hint="Students see this at the top of the course. Leave it blank if the modules speak for themselves.">
        <textarea
          className={fieldClass}
          rows={3}
          value={summary}
          onChange={(event) => commit(event.target.value, modules)}
        />
      </Field>

      {modules.map((section, index) => (
        <section key={section.key} className="border border-ink">
          <div className="flex flex-wrap items-center justify-between gap-2 bg-ink px-4 py-2.5">
            <span className="font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-yellow">
              Module {index + 1}
            </span>
            <div className="flex flex-wrap gap-1">
              <SquareButton tone="outline" disabled={index === 0} onClick={() => moveModule(index, -1)}>
                Up
              </SquareButton>
              <SquareButton
                tone="outline"
                disabled={index === modules.length - 1}
                onClick={() => moveModule(index, 1)}
              >
                Down
              </SquareButton>
              <SquareButton
                tone="outline"
                disabled={modules.length === 1}
                onClick={() => commit(summary, modules.filter((_, i) => i !== index))}
              >
                Remove
              </SquareButton>
            </div>
          </div>
          <div className="space-y-4 bg-bone px-4 py-4">
            <Field label="Title">
              <input
                className={fieldClass}
                value={section.title}
                onChange={(event) => updateModule(index, { title: event.target.value })}
              />
            </Field>
            <Field label="Summary" hint="Optional. One or two lines on what this module is for.">
              <input
                className={fieldClass}
                value={section.summary}
                onChange={(event) => updateModule(index, { summary: event.target.value })}
              />
            </Field>

            <ol className="space-y-3">
              {section.items.map((item, itemIndex) => (
                <li key={item.key} className="border border-rule bg-white">
                  <div className="flex items-center justify-between gap-3 border-b border-rule px-3 py-2">
                    <span className="mono-label">{item.kind}</span>
                    <SquareButton
                      tone="quiet"
                      onClick={() =>
                        updateModule(index, {
                          items: section.items.filter((_, j) => j !== itemIndex),
                        })
                      }
                    >
                      Remove
                    </SquareButton>
                  </div>
                  <div className="space-y-3 px-3 py-3">
                    <Field label="Title">
                      <input
                        className={fieldClass}
                        value={item.title}
                        onChange={(event) => updateItem(index, itemIndex, { title: event.target.value })}
                      />
                    </Field>
                    {item.kind === "page" && (
                      <Field label="Page">
                        <textarea
                          className={fieldClass}
                          rows={6}
                          value={item.body}
                          onChange={(event) => updateItem(index, itemIndex, { body: event.target.value })}
                        />
                      </Field>
                    )}
                    {item.kind === "assignment" && (
                      <>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <Field label="Points">
                            <input
                              className={fieldClass}
                              type="number"
                              min={0}
                              max={1000}
                              value={item.points}
                              onChange={(event) =>
                                updateItem(index, itemIndex, { points: Number(event.target.value) })
                              }
                            />
                          </Field>
                          <Field label="Due" hint="Days after the course starts. Leave blank if there is no due date.">
                            <input
                              className={fieldClass}
                              type="number"
                              min={0}
                              max={365}
                              value={item.due_offset_days ?? ""}
                              onChange={(event) => {
                                const raw = event.target.value;
                                updateItem(index, itemIndex, {
                                  due_offset_days: raw === "" ? undefined : Number(raw),
                                });
                              }}
                            />
                          </Field>
                        </div>
                        <Field label="Brief">
                          <textarea
                            className={fieldClass}
                            rows={5}
                            value={item.brief}
                            onChange={(event) => updateItem(index, itemIndex, { brief: event.target.value })}
                          />
                        </Field>
                      </>
                    )}
                    {item.kind === "discussion" && (
                      <Field label="Prompt">
                        <textarea
                          className={fieldClass}
                          rows={4}
                          value={item.prompt}
                          onChange={(event) => updateItem(index, itemIndex, { prompt: event.target.value })}
                        />
                      </Field>
                    )}
                  </div>
                </li>
              ))}
            </ol>

            <div className="flex flex-wrap gap-2">
              {(["page", "assignment", "discussion"] as const).map((kind) => (
                <SquareButton
                  key={kind}
                  tone="outline"
                  onClick={() =>
                    updateModule(index, {
                      items: [...section.items, { ...blankItem(kind), key: uid() }],
                    })
                  }
                >
                  Add a {kind}
                </SquareButton>
              ))}
            </div>
          </div>
        </section>
      ))}

      <SquareButton
        tone="outline"
        onClick={() =>
          commit(summary, [
            ...modules,
            { key: uid(), title: `Module ${modules.length + 1}`, summary: "", items: [] },
          ])
        }
      >
        Add a module
      </SquareButton>
    </div>
  );
}
