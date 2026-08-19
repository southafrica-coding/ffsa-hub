"use client";

// ────────────────────────────────────────────────────────────
// Contacts directory — frame 35a
// ────────────────────────────────────────────────────────────
// "A directory that answers in one keystroke." Three things carry the frame,
// and none of them are decoration:
//
//   1. The search field IS the screen. Focused on load, set in the condensed
//      display face at 24px, and it reports what it matched on — including
//      when the hit was an address or number the person no longer uses.
//   2. The whole directory is a real table. Five columns, black header, hairline
//      rules. Not a card grid, not a 12-column spreadsheet.
//   3. Labels down the left with live counts, because a filtered list is
//      already an audience — it hands straight to Communications.
//
// Everything the old list did still works: the quick-view panel, multi-select
// with bulk add-to-list, debounced URL-driven search, status filter, sort and
// pagination. This is a recomposition, not a rewrite of the behaviour.
// ────────────────────────────────────────────────────────────

import { useState, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { PersonQuickView } from "@/components/people/person-quick-view";
import type { PersonRef } from "@/services/person-quick-view";
import { Search } from "lucide-react";
import { getLabelColors } from "@/lib/label-color";
import type { ContactSort } from "@/services/contacts";
import { BulkAddToList } from "./bulk-add-to-list";

const SORT_LABELS: Record<ContactSort, string> = {
  newest: "NEWEST",
  oldest: "OLDEST",
  name_asc: "NAME A–Z",
  name_desc: "NAME Z–A",
  recent: "RECENTLY HEARD",
};

const STATUSES = ["active", "inactive", "archived"] as const;

export type DirectoryContact = {
  id: string;
  first_name: string;
  last_name: string;
  preferred_name: string | null;
  email: string | null;
  phone: string | null;
  status: string;
  marketing_status?: string | null;
  source?: string | null;
  created_at?: string | null;
  last_interaction_at?: string | null;
  contact_labels?: Array<{
    labels: { id: string; slug: string; name: string; color: string | null } | null;
  }>;
  // Counts of every identifier on file, for the "reach" line under the name.
  emailCount?: number;
  phoneCount?: number;
};

export type DirectoryLabel = {
  id: string;
  name: string;
  color: string | null;
  count: number;
};

export type MatchNote = {
  contactId: string;
  name: string;
  kind: "email" | "phone";
  position: number;
  isPrimary: boolean;
  reach: string;
};

/* ── how long ago, in the frame's terse voice ───────── */
function heardLabel(iso: string | null | undefined): { text: string; stale: boolean } {
  if (!iso) return { text: "NEVER", stale: true };
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return { text: "TODAY", stale: false };
  if (days === 1) return { text: "YESTERDAY", stale: false };
  if (days < 30) return { text: `${days} DAYS`, stale: false };
  if (days < 365) return { text: `${Math.floor(days / 30)} MTH`, stale: days > 180 };
  return { text: `${Math.floor(days / 365)} YR`, stale: true };
}

/* ── may we mail her ─────────────────────────────────
   Read-only here on purpose: consent is set from the ledger, never from a
   directory row. Until consent_events exists (session G) this reflects
   contacts.marketing_status, which is the only truth there is today. */
const CONSENT: Record<string, { text: string; cls: string }> = {
  subscribed: { text: "YES", cls: "border-grass text-grass-text" },
  pending: { text: "NOT YET", cls: "border-amber-border text-amber" },
  unsubscribed_all: { text: "NO", cls: "border-rule-strong text-[#7C786C]" },
  bounced: { text: "BOUNCING", cls: "border-destructive text-destructive" },
};

export function ContactsDirectory({
  contacts,
  labels,
  lists,
  totalCount,
  activeCount,
  currentPage,
  pageSize,
  searchQuery,
  statusFilter,
  labelFilter,
  sort,
  matchNote,
  matchCapped,
}: {
  contacts: DirectoryContact[];
  labels: DirectoryLabel[];
  lists: Array<{ id: string; name: string }>;
  totalCount: number;
  activeCount: number;
  currentPage: number;
  pageSize: number;
  searchQuery?: string;
  statusFilter: string;
  labelFilter?: string;
  sort: ContactSort;
  matchNote: MatchNote | null;
  matchCapped: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [search, setSearch] = useState(searchQuery ?? "");
  const [quickPerson, setQuickPerson] = useState<PersonRef | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const searchRef = useRef<HTMLInputElement>(null);

  const pageIds = contacts.map((c) => c.id);
  const allSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));

  // "Focused on load" — the frame's first claim about this screen.
  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) => (pageIds.every((id) => prev.has(id)) ? new Set() : new Set(pageIds)));
  }

  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const timer = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString());
      if (search) params.set("search", search);
      else params.delete("search");
      params.delete("page");
      router.replace(`/contacts?${params.toString()}`);
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  function setParam(key: string, value: string | null) {
    const params = new URLSearchParams(searchParams.toString());
    if (value === null) params.delete(key);
    else params.set(key, value);
    params.delete("page");
    router.push(`/contacts?${params.toString()}`);
  }

  function displayName(c: DirectoryContact) {
    return c.preferred_name
      ? `${c.preferred_name} ${c.last_name}`
      : `${c.first_name} ${c.last_name}`;
  }

  // The button that hands this exact filter to Communications, rather than
  // making someone rebuild it there.
  const audienceHref = (() => {
    const params = new URLSearchParams();
    if (labelFilter) params.set("label", labelFilter);
    if (searchQuery) params.set("search", searchQuery);
    if (statusFilter) params.set("status", statusFilter);
    const qs = params.toString();
    return `/communications/campaigns/new${qs ? `?${qs}` : ""}`;
  })();

  const totalPages = Math.ceil(totalCount / pageSize);
  const shown = Math.min(currentPage * pageSize, totalCount);
  const activeLabel = labels.find((l) => l.id === labelFilter);

  return (
    <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
      {/* ══ labels aside — 250px bone, the only filter that matters ══ */}
      <aside className="flex shrink-0 flex-col border-b border-ink bg-bone lg:w-[250px] lg:border-b-0 lg:border-r">
        <div className="border-b border-ink px-[18px] pb-4 pt-5">
          <button
            type="button"
            onClick={() => setParam("label", null)}
            className="block text-left font-display text-[24px] font-black uppercase leading-none text-ink"
          >
            {activeLabel ? activeLabel.name : "Everyone"}
          </button>
          <div className="mt-[5px] flex items-baseline gap-2">
            <span className="numeral text-[26px] leading-none">
              {(activeLabel ? activeLabel.count : activeCount).toLocaleString("en-ZA").replace(/,/g, " ")}
            </span>
            <span className="font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-[#7C786C]">
              Contacts
            </span>
          </div>
        </div>

        {/* HOW THEY ARRIVED is deferred: it needs labels.kind, which is schema
            (handoff/13 delta 1, session G). Until then there is one label group,
            not two, and saying so beats inventing a split the data can't back. */}
        <div className="px-[18px] pb-2.5 pt-3.5">
          <div className="font-mono text-[8.5px] font-bold uppercase tracking-[0.18em] text-[#7C786C]">
            What they are to us
          </div>
          <div className="mt-[3px] font-mono text-[8px] uppercase tracking-[0.06em] text-[#9A9689]">
            Put on by hand
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {labels.length === 0 && (
            <div className="px-[18px] py-2 text-[12.5px] text-[#7C786C]">No labels yet</div>
          )}
          {labels.map((l) => {
            const active = l.id === labelFilter;
            const colors = getLabelColors({ color: l.color });
            return (
              <button
                key={l.id}
                type="button"
                onClick={() => setParam("label", active ? null : l.id)}
                className="flex w-full items-center justify-between gap-2.5 px-[18px] py-2 text-left normal-case tracking-normal hover:bg-bone-3 data-[active=true]:bg-bone-3"
                data-active={active ? "true" : undefined}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    className="h-2 w-2 shrink-0"
                    style={{ background: colors.bg }}
                    aria-hidden
                  />
                  <span className="truncate text-[12.5px] text-[#2A2822]">{l.name}</span>
                </span>
                <span className="numeral shrink-0 font-mono text-[9.5px] font-bold text-[#45423B]">
                  {l.count}
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex flex-col gap-[7px] border-t border-ink px-[18px] py-3.5">
          <Link
            href="/contacts/import"
            className="border border-ink px-2.5 py-2 text-center font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-ink hover:bg-ink hover:text-white"
          >
            Import a spreadsheet
          </Link>
          <Link
            href="/contacts/labels"
            className="px-1 py-1 text-center font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-[#7C786C] hover:text-ink"
          >
            Manage labels
          </Link>
        </div>
      </aside>

      {/* ══ main ══ */}
      <main className="flex min-w-0 flex-1 flex-col">
        {/* ── the search field is the screen ── */}
        <div className="border-b border-ink px-5 pb-4 pt-5 md:px-7 md:pt-[22px]">
          <div className="flex items-center gap-3.5 border-2 border-ink px-4 py-3 md:px-[18px] md:py-3.5">
            <Search className="h-[19px] w-[19px] shrink-0 text-ink" aria-hidden />
            <input
              ref={searchRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search"
              aria-label="Search contacts by name, any email, or any phone"
              className="min-w-0 flex-1 border-0 bg-transparent p-0 font-display text-[20px] font-black leading-none text-ink outline-none placeholder:text-[#C7C3B5] md:text-[24px]"
            />
            <span className="hidden shrink-0 font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-[#7C786C] lg:inline">
              Name · Any email · Any phone
            </span>
          </div>

          {searchQuery && (
            <div className="mt-3 flex flex-wrap items-center gap-2.5">
              <span className="font-mono text-[9.5px] font-bold uppercase tracking-[0.14em] text-ink">
                {totalCount === 1 ? "1 person" : `${totalCount.toLocaleString("en-ZA")} people`}
              </span>
              {matchNote && (
                <span className="font-mono text-[9.5px] uppercase tracking-[0.1em] text-[#7C786C]">
                  {matchNote.isPrimary
                    ? `Matched on her ${matchNote.kind}`
                    : `Matched on ${matchNote.kind === "phone" ? "an old phone" : "an old address"} she no longer uses`}
                </span>
              )}
              {matchCapped && (
                <span className="font-mono text-[9.5px] uppercase tracking-[0.1em] text-amber">
                  Too many identifier matches to list them all — narrow the search
                </span>
              )}
            </div>
          )}
        </div>

        {/* ── the person the search actually found ── */}
        {matchNote && (
          <div className="flex items-center gap-5 border-b border-ink bg-bone px-5 py-3 md:px-7">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-[11px]">
                <span className="text-[15px] font-bold text-ink">{matchNote.name}</span>
                <span className="bg-ink px-1.5 py-[3px] font-mono text-[8px] font-bold uppercase tracking-[0.1em] text-white">
                  Matched · {matchNote.kind} {matchNote.position}
                </span>
              </div>
              <div className="mt-[3px] font-mono text-[9.5px] tracking-[0.06em] text-[#55524A]">
                {matchNote.reach}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setQuickPerson({ contactId: matchNote.contactId, name: matchNote.name })}
              className="shrink-0 bg-ink px-[15px] py-[9px] font-mono text-[9.5px] font-bold uppercase tracking-[0.12em] text-white"
            >
              Open {matchNote.name.split(" ")[0]}
            </button>
          </div>
        )}

        {/* ── toolbar ── */}
        <div className="flex flex-wrap items-center justify-between gap-4 px-5 pb-3 pt-4 md:px-7">
          <div className="flex flex-wrap items-center gap-[11px]">
            <span className="font-mono text-[9.5px] font-bold uppercase tracking-[0.14em] text-ink">
              {activeLabel ? activeLabel.name : "Everyone"}, {SORT_LABELS[sort].toLowerCase()} first
            </span>
            <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-[#7C786C]">
              {totalCount.toLocaleString("en-ZA").replace(/,/g, " ")} people
            </span>
            {STATUSES.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setParam("status", s)}
                data-active={statusFilter === s ? "true" : undefined}
                className="font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-[#9A9689] data-[active=true]:text-ink data-[active=true]:underline data-[active=true]:underline-offset-4"
              >
                {s}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <select
              value={sort}
              onChange={(e) => setParam("sort", e.target.value === "newest" ? null : e.target.value)}
              aria-label="Sort contacts"
              className="h-[31px] border border-rule-strong bg-transparent px-3 font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-[#45423B]"
            >
              {(Object.keys(SORT_LABELS) as ContactSort[]).map((k) => (
                <option key={k} value={k}>
                  Sort · {SORT_LABELS[k]}
                </option>
              ))}
            </select>
            <Link
              href={audienceHref}
              className="border border-ink px-3 py-2 font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-ink hover:bg-ink hover:text-white"
            >
              Mail these {totalCount.toLocaleString("en-ZA").replace(/,/g, " ")} →
            </Link>
          </div>
        </div>

        {selected.size > 0 && (
          <div className="px-5 pb-3 md:px-7">
            <BulkAddToList
              lists={lists}
              selectedIds={Array.from(selected)}
              onClear={() => setSelected(new Set())}
              onDone={() => {
                setSelected(new Set());
                router.refresh();
              }}
            />
          </div>
        )}

        {/* ── the whole directory as a real table ── */}
        <div className="min-w-0 overflow-x-auto">
          <div className="min-w-[860px]">
            <div className="grid grid-cols-[34px_1fr_210px_168px_128px_108px] items-center bg-ink px-5 py-[9px] md:px-7">
              <span>
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  aria-label="Select all on this page"
                  className="align-middle accent-yellow"
                />
              </span>
              {["Name", "How she arrived", "Labels", "May we mail her", "Last heard"].map((h, i) => (
                <span
                  key={h}
                  className={`font-mono text-[8.5px] font-bold uppercase tracking-[0.16em] ${
                    i === 0 ? "text-white" : "text-[#8E8A7C]"
                  } ${i === 4 ? "text-right" : ""}`}
                >
                  {h}
                </span>
              ))}
            </div>

            {contacts.length === 0 && (
              <div className="border-b border-rule px-5 py-10 text-center font-mono text-[10px] uppercase tracking-[0.14em] text-[#7C786C] md:px-7">
                {searchQuery ? "Nobody matches that" : "No contacts yet"}
              </div>
            )}

            {contacts.map((c) => {
              const name = displayName(c);
              const heard = heardLabel(c.last_interaction_at);
              const consent = CONSENT[c.marketing_status ?? "subscribed"] ?? CONSENT.subscribed;
              const rowLabels = (c.contact_labels ?? [])
                .map((cl) => cl.labels)
                .filter((l): l is NonNullable<typeof l> => Boolean(l));
              const emails = c.emailCount ?? (c.email ? 1 : 0);
              const phones = c.phoneCount ?? (c.phone ? 1 : 0);
              const reach = [
                c.email ?? c.phone ?? "No way to reach her",
                emails + phones > 1
                  ? `${emails} email${emails === 1 ? "" : "s"}, ${phones} phone${phones === 1 ? "" : "s"} on file`
                  : null,
              ]
                .filter(Boolean)
                .join(" · ");

              return (
                <div
                  key={c.id}
                  data-selected={selected.has(c.id) ? "true" : undefined}
                  className="grid grid-cols-[34px_1fr_210px_168px_128px_108px] items-center border-b border-rule px-5 py-[11px] hover:bg-[#FBFAF6] data-[selected=true]:bg-bone md:px-7"
                >
                  <span>
                    <input
                      type="checkbox"
                      checked={selected.has(c.id)}
                      onChange={() => toggleOne(c.id)}
                      aria-label={`Select ${name}`}
                      className="align-middle accent-yellow"
                    />
                  </span>

                  <div className="min-w-0 pr-4">
                    <button
                      type="button"
                      onClick={() => setQuickPerson({ contactId: c.id, name })}
                      // normal-case + tracking-normal beat the global
                      // `button { text-transform: uppercase }` chrome rule, so
                      // real names render as stored.
                      className="block max-w-full truncate text-left text-[14px] font-bold normal-case tracking-normal text-ink hover:underline"
                    >
                      {name}
                    </button>
                    <div className="mt-[2px] truncate font-mono text-[9px] tracking-[0.04em] text-[#7C786C]">
                      {reach}
                    </div>
                  </div>

                  <div className="min-w-0 pr-3">
                    <div className="truncate text-[12px] text-[#45423B]">
                      {c.source ?? "—"}
                    </div>
                    <div className="mt-[2px] font-mono text-[8.5px] uppercase tracking-[0.06em] text-[#9A9689]">
                      {c.created_at
                        ? new Date(c.created_at).toLocaleDateString("en-ZA", {
                            day: "numeric",
                            month: "short",
                            year: "numeric",
                          })
                        : ""}
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-1 pr-3">
                    {rowLabels.slice(0, 2).map((l) => {
                      const colors = getLabelColors({ color: l.color });
                      return (
                        <span
                          key={l.id}
                          className="flex items-center gap-[5px] whitespace-nowrap border border-rule px-1.5 py-[3px] text-[10.5px] text-[#45423B]"
                        >
                          <span
                            className="h-[7px] w-[7px] shrink-0"
                            style={{ background: colors.bg }}
                            aria-hidden
                          />
                          {l.name}
                        </span>
                      );
                    })}
                    {rowLabels.length > 2 && (
                      <span className="font-mono text-[9px] text-[#9A9689]">
                        +{rowLabels.length - 2}
                      </span>
                    )}
                  </div>

                  <div>
                    <span
                      className={`inline-block border px-[7px] py-1 font-mono text-[8.5px] font-bold uppercase tracking-[0.1em] ${consent.cls}`}
                    >
                      {consent.text}
                    </span>
                  </div>

                  <div className="text-right">
                    <span
                      className={`numeral font-mono text-[9.5px] font-bold tracking-[0.04em] ${
                        heard.stale ? "text-[#9A9689]" : "text-[#45423B]"
                      }`}
                    >
                      {heard.text}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── footer ── */}
        {totalCount > 0 && (
          <div className="flex items-center justify-between gap-4 border-t border-rule bg-[#FBFAF6] px-5 py-4 md:px-7">
            <span className="font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-[#7C786C]">
              Showing {shown.toLocaleString("en-ZA").replace(/,/g, " ")} of{" "}
              {totalCount.toLocaleString("en-ZA").replace(/,/g, " ")}
            </span>
            <div className="flex items-center gap-4">
              {currentPage > 1 && (
                <button
                  type="button"
                  onClick={() => setParam("page", String(currentPage - 1))}
                  className="font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-ink"
                >
                  ← Back
                </button>
              )}
              {currentPage < totalPages && (
                <button
                  type="button"
                  onClick={() => {
                    const params = new URLSearchParams(searchParams.toString());
                    params.set("page", String(currentPage + 1));
                    router.push(`/contacts?${params.toString()}`);
                  }}
                  className="font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-ink"
                >
                  Load more
                </button>
              )}
            </div>
          </div>
        )}
      </main>

      {quickPerson && (
        <PersonQuickView personRef={quickPerson} onClose={() => setQuickPerson(null)} />
      )}
    </div>
  );
}
