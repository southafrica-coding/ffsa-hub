"use client";

/**
 * The Hub feedback board — the dev team's view of everything staff send.
 * Tabs are pipeline stages; the drawer holds the item and, for triage,
 * the controls. Data arrives from the server page; changes refresh it.
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Drawer,
  Kpi,
  KpiStrip,
  Masthead,
  ModuleTabs,
  NeedsYou,
  StatusPill,
} from "@/components/ffsa";
import { FeedbackDetailPanel } from "@/components/hub-feedback/feedback-detail";
import {
  BOARD_TABS,
  FEEDBACK_KINDS,
  KIND_META,
  SEVERITY_META,
  STATUS_META,
  fmtFeedbackDate,
  isFeedbackKind,
  isFeedbackSeverity,
  isFeedbackStatus,
  type FeedbackKind,
} from "@/lib/hub-feedback/constants";
import type { FeedbackListItem } from "@/lib/hub-feedback/types";

const SEVERITY_ORDER: Record<string, number> = { blocking: 0, annoying: 1, minor: 2 };
const DAY = 24 * 60 * 60 * 1000;

export function FeedbackBoard({
  items,
  assignees,
  canTriage,
  userId,
  initialOpenId,
}: {
  items: FeedbackListItem[];
  assignees: { id: string; name: string }[];
  canTriage: boolean;
  userId: string;
  initialOpenId: string | null;
}) {
  const router = useRouter();
  const [tab, setTab] = useState("inbox");
  const [kind, setKind] = useState<FeedbackKind | null>(null);
  const [moduleId, setModuleId] = useState("");
  const [mine, setMine] = useState(false);
  const [openId, setOpenId] = useState<string | null>(
    initialOpenId && items.some((i) => i.id === initialOpenId) ? initialOpenId : null
  );

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const t of BOARD_TABS) {
      c[t.key] = items.filter((i) => (t.statuses as string[]).includes(i.status)).length;
    }
    return c;
  }, [items]);

  const since = Date.now() - 30 * DAY;
  const shipped30 = items.filter((i) => i.status === "shipped" && new Date(i.status_changed_at).getTime() >= since).length;
  const inFlight = items.filter((i) => ["accepted", "planned", "in_progress"].includes(i.status)).length;
  const blockingNew = items.filter((i) => i.status === "new" && i.severity === "blocking").length;

  const modules = useMemo(() => {
    const m = new Map<string, string>();
    for (const i of items) if (i.module_id) m.set(i.module_id, i.module_label ?? i.module_id);
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [items]);

  const statuses = BOARD_TABS.find((t) => t.key === tab)?.statuses ?? [];
  const rows = items
    .filter((i) => (statuses as string[]).includes(i.status))
    .filter((i) => !kind || i.kind === kind)
    .filter((i) => !moduleId || i.module_id === moduleId)
    .filter((i) => !mine || i.assigned_to === userId)
    .sort((a, b) => {
      // The inbox leads with what's blocking people, then the most-reported.
      if (tab === "inbox") {
        const s = (SEVERITY_ORDER[a.severity ?? ""] ?? 3) - (SEVERITY_ORDER[b.severity ?? ""] ?? 3);
        if (s) return s;
      }
      if (b.duplicate_count !== a.duplicate_count) return b.duplicate_count - a.duplicate_count;
      return b.created_at.localeCompare(a.created_at);
    });

  const mergeTargets = items
    .filter((i) => i.status !== "duplicate")
    .map((i) => ({ id: i.id, ref: i.ref, title: i.title }));

  const visibleIds = rows.map((r) => r.id);
  const openIndex = openId ? visibleIds.indexOf(openId) : -1;

  return (
    <div className="ffsa-screen">
      <Masthead context={`System · ${items.length} items · ${canTriage ? "you triage" : "read only"}`} title="Hub feedback" />

      {counts.inbox > 0 && canTriage && (
        <NeedsYou
          action={
            tab !== "inbox" ? (
              <button
                type="button"
                onClick={() => setTab("inbox")}
                className="shrink-0 border border-ink bg-ink px-3 py-2 font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-yellow hover:bg-[#262622]"
              >
                Open inbox
              </button>
            ) : undefined
          }
        >
          {counts.inbox} new {counts.inbox === 1 ? "item is" : "items are"} waiting to be triaged
          {blockingNew > 0 ? ` — ${blockingNew} blocking someone's work` : ""}
        </NeedsYou>
      )}

      <KpiStrip>
        <Kpi label="New" value={String(counts.inbox)} lead tick={false} />
        <Kpi label="Waiting on sender" value={String(counts.needs_info)} />
        <Kpi label="In flight" value={String(inFlight)} foot="Accepted · planned · building" />
        <Kpi label="Shipped" value={String(shipped30)} foot="Last 30 days" />
      </KpiStrip>

      <ModuleTabs
        tabs={BOARD_TABS.map((t) => ({ key: t.key, label: `${t.label} ${counts[t.key] ?? 0}` }))}
        active={tab}
        onChange={setTab}
        trailing={
          <>
            {FEEDBACK_KINDS.map((k) => (
              <button
                key={k}
                type="button"
                className="chip"
                data-active={kind === k ? "true" : undefined}
                onClick={() => setKind(kind === k ? null : k)}
              >
                {KIND_META[k].label}
              </button>
            ))}
            <button
              type="button"
              className="chip"
              data-active={mine ? "true" : undefined}
              onClick={() => setMine(!mine)}
            >
              Assigned to me
            </button>
            {modules.length > 0 && (
              <select
                value={moduleId}
                onChange={(e) => setModuleId(e.target.value)}
                className="h-[26px] border border-rule-strong bg-white px-1.5 font-mono text-[10px] uppercase tracking-[0.08em]"
              >
                <option value="">All modules</option>
                {modules.map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            )}
          </>
        }
      />

      {rows.length === 0 ? (
        <div className="px-5 py-12 text-center md:px-8">
          <p className="mono-label">Nothing here{kind || moduleId || mine ? " with these filters" : ""}</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-[13px]">
            <thead>
              <tr className="border-b border-ink">
                {["#", "Item", "Type", "Module", "From", "Assigned", "Sent"].map((h) => (
                  <th key={h} className="mono-label px-3 py-2.5 first:pl-5 md:first:pl-8">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const sev = isFeedbackSeverity(r.severity) ? SEVERITY_META[r.severity] : null;
                const status = isFeedbackStatus(r.status) ? STATUS_META[r.status] : null;
                return (
                  <tr
                    key={r.id}
                    onClick={() => setOpenId(r.id)}
                    className={`cursor-pointer border-b border-rule hover:bg-bone ${openId === r.id ? "bg-bone" : ""}`}
                  >
                    <td className="px-3 py-3 pl-5 font-mono text-[11px] text-[#7C786C] md:pl-8">{r.ref}</td>
                    <td className="max-w-[360px] px-3 py-3">
                      <div className="font-semibold text-ink">{r.title}</div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {sev && <StatusPill tone={sev.tone}>{sev.label}</StatusPill>}
                        {r.duplicate_count > 0 && <StatusPill tone="warn">+{r.duplicate_count} reporters</StatusPill>}
                        {tab === "closed" && status && <StatusPill tone={status.tone}>{status.label}</StatusPill>}
                        {r.source === "slack" && <StatusPill>Slack</StatusPill>}
                      </div>
                    </td>
                    <td className="px-3 py-3">{isFeedbackKind(r.kind) ? KIND_META[r.kind].label : r.kind}</td>
                    <td className="px-3 py-3 text-[color:var(--text-secondary)]">{r.module_label ?? "—"}</td>
                    <td className="px-3 py-3">{r.submitter_name}</td>
                    <td className="px-3 py-3 text-[color:var(--text-secondary)]">{r.assignee_name ?? "—"}</td>
                    <td className="px-3 py-3 font-mono text-[11px] text-[#7C786C]">{fmtFeedbackDate(r.created_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Drawer
        open={!!openId}
        onClose={() => setOpenId(null)}
        label="Hub feedback"
        onPrev={openIndex > 0 ? () => setOpenId(visibleIds[openIndex - 1]) : undefined}
        onNext={openIndex >= 0 && openIndex < visibleIds.length - 1 ? () => setOpenId(visibleIds[openIndex + 1]) : undefined}
      >
        {openId && (
          <FeedbackDetailPanel
            id={openId}
            assignees={assignees}
            mergeTargets={mergeTargets}
            onChanged={() => router.refresh()}
          />
        )}
      </Drawer>
    </div>
  );
}
