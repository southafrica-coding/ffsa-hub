"use client";

import { useEffect, useState } from "react";
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
import { GripVertical, X, Loader2 } from "lucide-react";

type CatalogueEntry = {
  key: string;
  title: string;
  description: string;
  category: string;
};

type Row = CatalogueEntry & { enabled: boolean };

// Lets a user choose which widgets appear on their dashboard and in what
// order. The catalogue comes from the server already filtered to what this
// user may use, so anything listed here is something they can actually see.
export function DashboardCustomizePanel({ onClose }: { onClose: () => void }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/dashboard/layout", { cache: "no-store" });
        if (!res.ok) {
          setError("Could not load your dashboard settings.");
          setRows([]);
          return;
        }
        const json = (await res.json()) as {
          layout: { key: string; enabled: boolean }[];
          catalogue: CatalogueEntry[];
        };
        const byKey = new Map(json.catalogue.map((c) => [c.key, c]));
        // Layout order drives the list; the catalogue supplies the labels.
        setRows(
          json.layout
            .map((entry) => {
              const meta = byKey.get(entry.key);
              return meta ? { ...meta, enabled: entry.enabled } : null;
            })
            .filter((r): r is Row => r !== null)
        );
      } catch {
        setError("Could not load your dashboard settings.");
        setRows([]);
      }
    })();
  }, []);

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id || !rows) return;
    const from = rows.findIndex((r) => r.key === active.id);
    const to = rows.findIndex((r) => r.key === over.id);
    if (from === -1 || to === -1) return;
    setRows(arrayMove(rows, from, to));
  }

  function toggle(key: string) {
    setRows((current) =>
      current
        ? current.map((r) => (r.key === key ? { ...r, enabled: !r.enabled } : r))
        : current
    );
  }

  async function save() {
    if (!rows) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/dashboard/layout", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          layout: rows.map((r) => ({ key: r.key, enabled: r.enabled })),
        }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setError((json as { error?: string }).error ?? "Could not save.");
        setSaving(false);
        return;
      }
      // The page is server-rendered from the stored layout, so a reload is
      // the honest way to show the result — no risk of the client drifting
      // from what was actually persisted.
      window.location.reload();
    } catch {
      setError("Could not save.");
      setSaving(false);
    }
  }

  async function reset() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/dashboard/layout", { method: "DELETE" });
      if (!res.ok) {
        setError("Could not reset.");
        setSaving(false);
        return;
      }
      window.location.reload();
    } catch {
      setError("Could not reset.");
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "hsl(22 10% 4% / 0.75)", padding: "1rem" }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "hsl(22 10% 8%)",
          border: "1px solid hsl(22 8% 16%)",
          borderRadius: "16px",
          width: "100%",
          maxWidth: "560px",
          maxHeight: "85vh",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <div
          className="flex items-start justify-between"
          style={{
            padding: "1.25rem 1.5rem",
            borderBottom: "1px solid hsl(22 8% 14%)",
          }}
        >
          <div>
            <p
              style={{
                fontFamily: "var(--font-condensed)", fontWeight: 900, textTransform: "uppercase",
                fontSize: "1.3rem",
                letterSpacing: "0.07em",
                color: "#F0EBE3",
              }}
            >
              Customise Dashboard
            </p>
            <p style={{ fontSize: "11px", color: "hsl(30 8% 45%)", marginTop: "2px" }}>
              Drag to reorder. Toggle to show or hide.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{ color: "hsl(30 8% 45%)", padding: "4px" }}
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div style={{ overflowY: "auto", padding: "0.75rem", flex: 1 }}>
          {rows === null ? (
            <p
              style={{
                padding: "2rem",
                textAlign: "center",
                fontSize: "12px",
                color: "hsl(30 8% 40%)",
              }}
            >
              Loading…
            </p>
          ) : rows.length === 0 ? (
            <p
              style={{
                padding: "2rem",
                textAlign: "center",
                fontSize: "12px",
                color: "hsl(30 8% 40%)",
              }}
            >
              No widgets available for your account.
            </p>
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={rows.map((r) => r.key)}
                strategy={verticalListSortingStrategy}
              >
                <div style={{ display: "grid", gap: "6px" }}>
                  {rows.map((row) => (
                    <SortableWidgetRow
                      key={row.key}
                      row={row}
                      onToggle={() => toggle(row.key)}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          )}
        </div>

        {error && (
          <p
            style={{
              padding: "0 1.5rem 0.5rem",
              fontSize: "11px",
              color: "hsl(0 70% 60%)",
            }}
          >
            {error}
          </p>
        )}

        <div
          className="flex items-center justify-between"
          style={{
            padding: "1rem 1.5rem",
            borderTop: "1px solid hsl(22 8% 14%)",
            gap: "0.75rem",
          }}
        >
          <button
            type="button"
            onClick={reset}
            disabled={saving}
            style={{
              fontSize: "9px",
              letterSpacing: "0.18em",
              fontWeight: 700,
              textTransform: "uppercase",
              color: "hsl(30 8% 45%)",
            }}
          >
            Reset to default
          </button>
          <div className="flex items-center" style={{ gap: "0.5rem" }}>
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              style={{
                padding: "8px 14px",
                borderRadius: "8px",
                border: "1px solid hsl(22 8% 18%)",
                fontSize: "9px",
                letterSpacing: "0.18em",
                fontWeight: 700,
                textTransform: "uppercase",
                color: "hsl(30 8% 55%)",
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving || !rows || rows.length === 0}
              className="flex items-center"
              style={{
                gap: "6px",
                padding: "8px 16px",
                borderRadius: "8px",
                background: "hsl(42 95% 55%)",
                fontSize: "9px",
                letterSpacing: "0.18em",
                fontWeight: 700,
                textTransform: "uppercase",
                color: "hsl(22 30% 10%)",
                opacity: saving ? 0.6 : 1,
              }}
            >
              {saving && <Loader2 className="h-3 w-3 animate-spin" />}
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function SortableWidgetRow({
  row,
  onToggle,
}: {
  row: Row;
  onToggle: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: row.key });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
        display: "flex",
        alignItems: "flex-start",
        gap: "0.6rem",
        padding: "0.7rem 0.75rem",
        borderRadius: "10px",
        border: "1px solid hsl(22 8% 14%)",
        background: row.enabled ? "hsl(22 10% 10%)" : "hsl(22 10% 8%)",
      }}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label={`Reorder ${row.title}`}
        className="cursor-grab active:cursor-grabbing"
        style={{ color: "hsl(30 8% 35%)", paddingTop: "2px" }}
      >
        <GripVertical className="h-4 w-4" />
      </button>

      <div style={{ flex: 1, minWidth: 0, opacity: row.enabled ? 1 : 0.5 }}>
        <div className="flex items-center" style={{ gap: "0.5rem" }}>
          <p style={{ fontSize: "13px", fontWeight: 500, color: "#F0EBE3" }}>
            {row.title}
          </p>
          <span
            style={{
              fontSize: "8px",
              letterSpacing: "0.14em",
              fontWeight: 700,
              textTransform: "uppercase",
              color: "hsl(42 95% 55%)",
              background: "hsl(42 95% 55% / 0.1)",
              padding: "2px 6px",
              borderRadius: "4px",
            }}
          >
            {row.category}
          </span>
        </div>
        <p
          style={{
            fontSize: "11px",
            color: "hsl(30 8% 45%)",
            marginTop: "3px",
            lineHeight: 1.4,
          }}
        >
          {row.description}
        </p>
      </div>

      {/* Show/hide toggle */}
      <button
        type="button"
        onClick={onToggle}
        role="switch"
        aria-checked={row.enabled}
        aria-label={`${row.enabled ? "Hide" : "Show"} ${row.title}`}
        style={{
          width: "36px",
          height: "20px",
          borderRadius: "10px",
          background: row.enabled ? "hsl(42 95% 55%)" : "hsl(22 8% 18%)",
          position: "relative",
          flexShrink: 0,
          transition: "background 150ms",
          marginTop: "2px",
        }}
      >
        <span
          style={{
            position: "absolute",
            top: "2px",
            left: row.enabled ? "18px" : "2px",
            width: "16px",
            height: "16px",
            borderRadius: "50%",
            background: row.enabled ? "hsl(22 30% 10%)" : "hsl(30 8% 45%)",
            transition: "left 150ms",
          }}
        />
      </button>
    </div>
  );
}
