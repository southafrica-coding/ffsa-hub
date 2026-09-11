"use client";

import { useEffect, useState } from "react";
import { Scanner } from "@/components/ticket-scanner";

const NAME_KEY = "ffsa.door-scanner.name";

/**
 * The door as a welcome-team volunteer sees it.
 *
 * No Hub account, no login, no nav — just the event name, who they are, and
 * the scanner. The one thing asked before scanning starts is a first name,
 * kept on the device so it is asked once per phone and never again. It is
 * unverified by design: the point is an organiser being able to see which of
 * their team worked which door, not identity.
 */
export function PublicDoorScanner({
  token,
  eventTitle,
}: {
  token: string;
  eventTitle: string;
}) {
  const [name, setName] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [ready, setReady] = useState(false);

  // localStorage is read in an effect, not during render: this page is
  // server-rendered and the stored name would mismatch on hydration.
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(NAME_KEY);
      if (stored) setName(stored);
    } catch {
      /* Private browsing — just ask for the name again. */
    }
    setReady(true);
  }, []);

  function saveName(e: React.FormEvent) {
    e.preventDefault();
    const value = draft.trim().slice(0, 60);
    if (!value) return;
    try {
      window.localStorage.setItem(NAME_KEY, value);
    } catch {
      /* Not fatal — the name still travels with this session's scans. */
    }
    setName(value);
  }

  function forget() {
    try {
      window.localStorage.removeItem(NAME_KEY);
    } catch {
      /* ignore */
    }
    setName(null);
    setDraft("");
  }

  if (!ready) return null;

  return (
    <div className="min-h-screen bg-bone">
      <header className="border-b border-rule bg-ink px-4 py-3">
        <p className="font-mono text-[9px] font-bold uppercase tracking-chip text-white/60">
          Door scanner
        </p>
        <p className="mt-0.5 truncate font-display text-[20px] leading-none text-white">
          {eventTitle}
        </p>
      </header>

      <div className="mx-auto max-w-2xl px-3 py-4 md:px-8 md:py-7">
        {!name ? (
          <form onSubmit={saveName} className="border border-rule bg-white p-5">
            <h1 className="font-display text-[24px] leading-tight text-ink">
              Who&apos;s on the door?
            </h1>
            <p className="mt-1.5 text-sm text-[var(--text-secondary)]">
              Your first name, so the organiser knows who scanned what. We
              remember it on this phone — you&apos;ll only be asked once.
            </p>
            <input
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="First name"
              autoCapitalize="words"
              autoCorrect="off"
              maxLength={60}
              className="mt-4 w-full border border-rule-strong bg-white px-3 py-3 text-sm text-ink placeholder:text-[var(--text-tertiary)] focus:border-ink focus:outline-none"
            />
            <button
              type="submit"
              disabled={!draft.trim()}
              className="mt-3 w-full border border-ink bg-ink px-4 py-3.5 font-mono text-[11px] font-bold uppercase tracking-chip text-white transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              Start scanning
            </button>
          </form>
        ) : (
          <>
            <div className="mb-3 flex items-center justify-between gap-3 border border-rule bg-white px-3 py-2">
              <p className="truncate text-xs text-[var(--text-secondary)]">
                Scanning as <span className="text-ink">{name}</span>
              </p>
              <button
                type="button"
                onClick={forget}
                className="shrink-0 font-mono text-[9px] font-bold uppercase tracking-chip text-[var(--text-tertiary)] underline hover:text-ink"
              >
                Not you?
              </button>
            </div>
            <Scanner endpoint={`/api/scan/${token}`} scannerName={name} />
          </>
        )}
      </div>
    </div>
  );
}
