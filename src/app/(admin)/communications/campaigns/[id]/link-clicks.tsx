"use client";

import { Fragment, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SectionBar } from "@/components/ffsa";
import type { CampaignLinkStat } from "@/services/campaigns";

/**
 * Which links in the campaign were clicked, how often, and by whom.
 * One row per destination; expand a row to see each person and their count.
 */
export function CampaignLinkClicks({
  links,
  labels,
}: {
  links: CampaignLinkStat[];
  /** href → what the reader saw (button / link text), from the campaign HTML. */
  labels: Record<string, string>;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const totalClicks = links.reduce((n, l) => n + l.clicks, 0);

  return (
    <div className="border border-ink bg-white">
      <SectionBar
        title="Clicks by link"
        meta={`${totalClicks.toLocaleString()} click${totalClicks === 1 ? "" : "s"} · ${links.length} link${links.length === 1 ? "" : "s"}`}
      />
      {links.length === 0 ? (
        <p className="px-5 py-4 text-sm text-[color:var(--text-tertiary)]">
          No link clicks yet. Clicks appear here a few seconds after someone
          clicks a link in the email.
        </p>
      ) : (
        <div className="max-h-[28rem] overflow-x-auto overflow-y-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Link</TableHead>
                <TableHead className="text-right">Clicks</TableHead>
                <TableHead className="text-right">People</TableHead>
                <TableHead className="text-right">Share</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {links.map((l) => {
                const isOpen = open === l.url;
                const label =
                  l.url === "preferences"
                    ? "Manage email preferences"
                    : labels[l.url] ?? null;
                return (
                  <Fragment key={l.url}>
                    <TableRow
                      className="cursor-pointer"
                      onClick={() => setOpen(isOpen ? null : l.url)}
                    >
                      <TableCell className="max-w-[28rem]">
                        <div className="flex items-start gap-1.5">
                          {isOpen ? (
                            <ChevronDown className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                          ) : (
                            <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                          )}
                          <div className="min-w-0">
                            <div className="font-medium">
                              {label ?? "Link"}
                            </div>
                            {l.url !== "preferences" && (
                              <div className="truncate text-xs text-[color:var(--text-tertiary)]">
                                {l.url}
                              </div>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="tabular text-right">
                        {l.clicks.toLocaleString()}
                      </TableCell>
                      <TableCell className="tabular text-right">
                        {l.uniqueClickers.toLocaleString()}
                      </TableCell>
                      <TableCell className="tabular text-right text-xs text-[color:var(--text-tertiary)]">
                        {totalClicks > 0
                          ? `${Math.round((l.clicks / totalClicks) * 100)}%`
                          : "—"}
                      </TableCell>
                    </TableRow>
                    {isOpen &&
                      l.clickers.map((p) => (
                        <TableRow
                          key={`${l.url}:${p.contactId ?? "unknown"}`}
                          className="bg-[color:var(--surface-2)]"
                        >
                          <TableCell className="pl-9">
                            <div className="text-sm">{p.name}</div>
                            {p.email && p.email !== p.name && (
                              <div className="text-xs text-[color:var(--text-tertiary)]">
                                {p.email}
                              </div>
                            )}
                          </TableCell>
                          <TableCell className="tabular text-right text-sm">
                            {p.clicks.toLocaleString()}
                          </TableCell>
                          <TableCell
                            colSpan={2}
                            className="tabular text-right text-xs text-[color:var(--text-tertiary)]"
                          >
                            last {new Date(p.lastClickedAt).toLocaleString()}
                          </TableCell>
                        </TableRow>
                      ))}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
