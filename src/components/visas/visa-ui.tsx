"use client";

// Small controls shared by the visa screens: a black/outline button that
// posts to a visa API route, and the note box that goes with it. Every
// action ends in router.refresh() so the server page re-reads the case.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils/cn";

export function VisaButton({
  tone = "solid",
  disabled,
  onClick,
  children,
}: {
  tone?: "solid" | "outline";
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex min-h-11 items-center justify-center border px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-[0.14em] disabled:opacity-50",
        tone === "solid" ? "border-ink bg-ink text-white hover:bg-[#262622]" : "border-ink bg-white text-ink hover:bg-bone"
      )}
    >
      {children}
    </button>
  );
}

export function NoteBox({
  value,
  onChange,
  placeholder,
  rows = 3,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  rows?: number;
}) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      rows={rows}
      maxLength={2000}
      className="w-full border border-rule-strong bg-white px-3 py-2 text-[14px] outline-none focus:border-ink"
    />
  );
}

/** POST JSON to a visa route; returns the error text, or null on success. */
export function useVisaPost() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function post(url: string, body: unknown): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.message ?? json.error ?? "Something went wrong");
        return false;
      }
      router.refresh();
      return true;
    } catch {
      setError("Couldn't reach the Hub. Check your connection and try again.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  return { post, busy, error, setError, refresh: () => router.refresh() };
}

export function ErrorLine({ error }: { error: string | null }) {
  if (!error) return null;
  return <p className="mt-2 text-[13px] text-destructive">{error}</p>;
}

/** Opens a document through the checked route (signed, logged, 5 minutes). */
export async function openVisaDocument(documentId: string) {
  const win = window.open("", "_blank");
  const res = await fetch(`/api/visas/documents/${documentId}`);
  const json = await res.json().catch(() => ({}));
  if (res.ok && json.url) {
    if (win) win.location.href = json.url;
    else window.location.href = json.url;
  } else {
    win?.close();
    alert(json.error ?? "That file isn't available.");
  }
}
