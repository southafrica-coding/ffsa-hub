"use client";

import { useState } from "react";

type Segment = {
  id: string;
  code: string;
  name: string;
  start_date: string | null;
  end_date: string | null;
};

type Intent = { whole_program: boolean; segments?: string[] } | null;

function formatRange(start: string | null, end: string | null): string | null {
  if (!start || !end) return null;
  const fmt = (d: string) =>
    new Date(d).toLocaleDateString("en-ZA", { month: "short", year: "numeric" });
  return `${fmt(start)} – ${fmt(end)}`;
}

export function TrackIntentForm({
  token,
  segments,
  initialIntent,
  alreadySubmitted,
}: {
  token: string;
  segments: Segment[];
  initialIntent: Intent;
  alreadySubmitted: boolean;
}) {
  const [mode, setMode] = useState<"whole_program" | "segments">(
    initialIntent?.whole_program === false ? "segments" : "whole_program"
  );
  const [selectedCodes, setSelectedCodes] = useState<string[]>(
    initialIntent?.segments ?? []
  );
  const [submitted, setSubmitted] = useState(alreadySubmitted);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit() {
    if (mode === "segments" && selectedCodes.length === 0) {
      setError("Please choose at least one section, or the whole programme.");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/public/track-intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          whole_program: mode === "whole_program",
          segment_codes: mode === "whole_program" ? [] : selectedCodes,
        }),
      });
      const result = await res.json();
      if (!res.ok) {
        setError(result.error || "Something went wrong. Please try again.");
        return;
      }
      setSubmitted(true);
      setEditing(false);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  if (submitted && !editing) {
    const summary =
      mode === "whole_program"
        ? "the whole programme"
        : selectedCodes.map((c) => segmentLabel(c, segments)).join(", ") ||
          "your selection";
    return (
      <div className="space-y-4 text-sm" style={{ color: "#F0EBE3" }}>
        <p>Thanks — we&apos;ve got you down for {summary}.</p>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="text-sm underline"
          style={{ color: "#F5C518" }}
        >
          That&apos;s changed — let me update it
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <label className="flex items-start gap-2.5 text-sm" style={{ color: "#F0EBE3" }}>
          <input
            type="radio"
            name="track_mode"
            checked={mode === "whole_program"}
            onChange={() => {
              setMode("whole_program");
              setError(null);
            }}
            className="mt-0.5"
          />
          <span>The whole programme (all sections)</span>
        </label>
        <label className="flex items-start gap-2.5 text-sm" style={{ color: "#F0EBE3" }}>
          <input
            type="radio"
            name="track_mode"
            checked={mode === "segments"}
            onChange={() => {
              setMode("segments");
              setError(null);
            }}
            className="mt-0.5"
          />
          <span>One or more specific sections</span>
        </label>
      </div>

      {mode === "segments" && (
        <div className="ml-6 space-y-2 border-l pl-4" style={{ borderColor: "#2a2420" }}>
          {segments.map((s) => {
            const range = formatRange(s.start_date, s.end_date);
            return (
              <label
                key={s.id}
                className="flex items-start gap-2.5 text-sm"
                style={{ color: "#F0EBE3" }}
              >
                <input
                  type="checkbox"
                  checked={selectedCodes.includes(s.code)}
                  onChange={(e) => {
                    setSelectedCodes((prev) =>
                      e.target.checked
                        ? [...prev, s.code]
                        : prev.filter((c) => c !== s.code)
                    );
                    setError(null);
                  }}
                  className="mt-0.5"
                />
                <span>
                  {s.name}
                  {range ? ` (${range})` : ""}
                </span>
              </label>
            );
          })}
        </div>
      )}

      {error && (
        <p className="text-sm" style={{ color: "#e0796b" }}>
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={handleSubmit}
        disabled={loading}
        className="rounded-md px-5 py-2.5 text-sm font-semibold"
        style={{ background: "#F5C518", color: "#14110D" }}
      >
        {loading ? "Saving…" : "Confirm my plans"}
      </button>
    </div>
  );
}

function segmentLabel(code: string, segments: Segment[]): string {
  return segments.find((s) => s.code === code)?.name ?? code;
}
