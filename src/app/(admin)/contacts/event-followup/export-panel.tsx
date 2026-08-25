"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Download, ChevronDown } from "lucide-react";
import {
  EXPORT_COLUMN_GROUPS,
  EXPORT_COLUMN_LABELS,
  EXPORT_COLUMN_ORDER,
  type ExportColumnKey,
} from "@/lib/event-followup/export-columns";

const STORAGE_KEY = "ef-export-columns";

function loadSavedColumns(): ExportColumnKey[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const keys = (JSON.parse(raw) as string[]).filter((k): k is ExportColumnKey =>
        (EXPORT_COLUMN_ORDER as string[]).includes(k)
      );
      if (keys.length) return keys;
    }
  } catch {
    /* ignore */
  }
  return [...EXPORT_COLUMN_ORDER];
}

function buildExportHref(
  eventId: string,
  outcomeId: string | null,
  cols: ExportColumnKey[]
): string {
  const params = new URLSearchParams({ event_id: eventId });
  if (outcomeId) params.set("outcome_id", outcomeId);
  // Only send columns for a partial set, so the default stays byte-for-byte.
  if (cols.length !== EXPORT_COLUMN_ORDER.length) {
    params.set(
      "columns",
      EXPORT_COLUMN_ORDER.filter((k) => cols.includes(k)).join(",")
    );
  }
  return `/api/contacts/event-followup/export?${params.toString()}`;
}

function triggerDownload(href: string) {
  const a = document.createElement("a");
  a.href = href;
  a.download = "";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function ExportPanel({
  eventId,
  outcomes,
}: {
  eventId: string;
  outcomes: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [outcomeId, setOutcomeId] = useState("");
  const [selected, setSelected] = useState<Set<ExportColumnKey>>(
    () => new Set(EXPORT_COLUMN_ORDER)
  );
  const ref = useRef<HTMLDivElement>(null);

  // Restore the saved column choice (client-only, after hydration).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const keys = (JSON.parse(raw) as string[]).filter((k): k is ExportColumnKey =>
        (EXPORT_COLUMN_ORDER as string[]).includes(k)
      );
      if (keys.length) setSelected(new Set(keys));
    } catch {
      /* ignore bad storage */
    }
  }, []);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  function persist(next: Set<ExportColumnKey>) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
    } catch {
      /* ignore */
    }
  }

  function toggle(key: ExportColumnKey) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      persist(next);
      return next;
    });
  }

  function setAll(on: boolean) {
    const next = on ? new Set(EXPORT_COLUMN_ORDER) : new Set<ExportColumnKey>();
    setSelected(next);
    persist(next);
  }

  const href = useMemo(
    () =>
      buildExportHref(
        eventId,
        outcomeId || null,
        EXPORT_COLUMN_ORDER.filter((k) => selected.has(k))
      ),
    [eventId, outcomeId, selected]
  );

  function download() {
    if (selected.size === 0) return;
    triggerDownload(href);
    setOpen(false);
  }

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        type="button"
        style={pill}
        onClick={() => setOpen((o) => !o)}
        title="Download a CSV of this event's follow-ups — choose an outcome and which columns to include."
      >
        <Download className="h-3.5 w-3.5" />
        Download CSV
        <ChevronDown className="h-3 w-3" />
      </button>

      {open && (
        <div style={panel}>
          <label style={labelStyle}>Outcome</label>
          <select
            value={outcomeId}
            onChange={(e) => setOutcomeId(e.target.value)}
            style={selectStyle}
          >
            <option value="">All outcomes</option>
            {outcomes.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>

          <div
            className="flex items-center justify-between"
            style={{ margin: "12px 0 6px" }}
          >
            <span style={labelStyle}>Columns</span>
            <span style={{ fontSize: "11px" }}>
              <button type="button" onClick={() => setAll(true)} style={linkBtn}>
                All
              </button>
              <span style={{ color: "#2A2822" }}> · </span>
              <button type="button" onClick={() => setAll(false)} style={linkBtn}>
                None
              </button>
            </span>
          </div>

          <div style={{ maxHeight: "240px", overflowY: "auto", paddingRight: "4px" }}>
            {EXPORT_COLUMN_GROUPS.map((g) => (
              <div key={g.group} style={{ marginBottom: "8px" }}>
                <p style={groupStyle}>{g.group}</p>
                {g.keys.map((key) => (
                  <label key={key} style={checkRow}>
                    <input
                      type="checkbox"
                      checked={selected.has(key)}
                      onChange={() => toggle(key)}
                      style={{ accentColor: "#0A0A0A" }}
                    />
                    <span>{EXPORT_COLUMN_LABELS[key]}</span>
                  </label>
                ))}
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={download}
            disabled={selected.size === 0}
            style={{
              ...pill,
              width: "100%",
              justifyContent: "center",
              marginTop: "10px",
              background:
                selected.size === 0 ? "#F4F2EA" : "#0A0A0A",
              color: selected.size === 0 ? "#45423B" : "#0A0A0A",
              border:
                "1px solid " +
                (selected.size === 0 ? "var(--rule-strong)" : "#0A0A0A"),
              cursor: selected.size === 0 ? "not-allowed" : "pointer",
            }}
          >
            <Download className="h-3.5 w-3.5" />
            Download CSV
          </button>
          {selected.size === 0 && (
            <p
              style={{
                fontSize: "11px",
                color: "hsl(var(--destructive))",
                marginTop: "6px",
                textAlign: "center",
              }}
            >
              Pick at least one column.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// One-click per-outcome download chips — each pulls just that outcome, using
// whatever column selection the user last saved in the "Download ▾" panel.
export function OutcomeDownloadButtons({
  eventId,
  outcomes,
}: {
  eventId: string;
  outcomes: { id: string; name: string }[];
}) {
  if (outcomes.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span style={perOutcomeLabel}>Download outcome</span>
      {outcomes.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() =>
            triggerDownload(buildExportHref(eventId, o.id, loadSavedColumns()))
          }
          style={outcomeChip}
          title={`Download ${o.name} follow-ups as a CSV (uses your saved column choice).`}
        >
          <Download className="h-3 w-3" />
          {o.name}
        </button>
      ))}
    </div>
  );
}

const perOutcomeLabel: CSSProperties = {
  fontSize: "10px",
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  fontWeight: 700,
  color: "#45423B",
  marginRight: "2px",
};
const outcomeChip: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "5px",
  fontSize: "11px",
  fontWeight: 600,
  padding: "4px 9px",
  border: "1px solid var(--rule-strong)",
  background: "#F4F2EA",
  color: "#C7C3B5",
  cursor: "pointer",
};

const pill: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "6px",
  fontSize: "12px",
  fontWeight: 600,
  padding: "6px 12px",
  border: "1px solid var(--rule-strong)",
  background: "#F4F2EA",
  color: "#9A9689",
  cursor: "pointer",
};
const panel: CSSProperties = {
  position: "absolute",
  right: 0,
  top: "calc(100% + 6px)",
  zIndex: 50,
  width: "280px",
  background: "#FFFFFF",
  border: "1px solid var(--rule)",
  boxShadow: "0 16px 40px rgba(0,0,0,0.5)",
  padding: "14px",
};
const labelStyle: CSSProperties = {
  fontSize: "11px",
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  fontWeight: 700,
  color: "#7C786C",
};
const selectStyle: CSSProperties = {
  width: "100%",
  marginTop: "5px",
  fontSize: "12px",
  padding: "7px 9px",
  border: "1px solid var(--rule-strong)",
  background: "#F4F2EA",
  color: "var(--text-primary)",
};
const groupStyle: CSSProperties = {
  fontSize: "10px",
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  fontWeight: 700,
  color: "#45423B",
  margin: "0 0 3px",
};
const checkRow: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "8px",
  fontSize: "12.5px",
  color: "#E8E2D8",
  padding: "3px 2px",
  cursor: "pointer",
};
const linkBtn: CSSProperties = {
  fontSize: "11px",
  color: "#0A0A0A",
  background: "none",
  border: "none",
  cursor: "pointer",
  padding: 0,
};
