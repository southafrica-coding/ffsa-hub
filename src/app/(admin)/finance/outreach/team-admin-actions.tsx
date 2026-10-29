"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Archive, ArchiveRestore, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Prompt = "archive" | "unarchive" | "delete" | null;

/**
 * Archive / unarchive / delete for one outreach team (migration 272).
 * Render it only for outreach administrators — the API and database refuse
 * everyone else anyway.
 *
 * `deleteBlockers` is what a delete would destroy, worded for people
 * ("12 expenses"). Empty means safe; when it isn't, Delete explains why and
 * offers Archive instead.
 */
export function TeamAdminActions({
  teamId,
  teamName,
  archived,
  deleteBlockers,
  afterDelete,
  size = "sm",
}: {
  teamId: string;
  teamName: string;
  archived: boolean;
  deleteBlockers: string[];
  /** Where to go once the team is gone (it may be the page we're on). */
  afterDelete?: string;
  size?: "sm" | "default";
}) {
  const router = useRouter();
  const [prompt, setPrompt] = useState<Prompt>(null);
  const [busy, setBusy] = useState(false);
  // The server's answer wins over the page's: something may have been
  // linked since the page loaded.
  const [blockers, setBlockers] = useState<string[]>(deleteBlockers);
  const canDelete = blockers.length === 0;

  async function setArchived(next: boolean) {
    setBusy(true);
    try {
      const res = await fetch("/api/finance/outreach/teams/archive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: teamId, archived: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || "Could not update this team.");
        return;
      }
      toast.success(next ? `${teamName} archived` : `${teamName} is back in the outreach list`);
      setPrompt(null);
      router.refresh();
    } catch {
      toast.error("Could not update this team.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      const res = await fetch("/api/finance/outreach/teams", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: teamId }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409) {
        setBlockers(data.blockers?.length ? data.blockers : ["linked records"]);
        return;
      }
      if (!res.ok) {
        toast.error(data.error || "Could not delete this team.");
        return;
      }
      toast.success(`${teamName} deleted`);
      setPrompt(null);
      if (afterDelete) router.push(afterDelete);
      router.refresh();
    } catch {
      toast.error("Could not delete this team.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="flex items-center gap-1.5">
        {archived ? (
          <Button variant="outline" size={size} onClick={() => setPrompt("unarchive")}>
            <ArchiveRestore className="mr-1.5 h-3.5 w-3.5" />
            Unarchive
          </Button>
        ) : (
          <Button variant="outline" size={size} onClick={() => setPrompt("archive")}>
            <Archive className="mr-1.5 h-3.5 w-3.5" />
            Archive
          </Button>
        )}
        <Button variant="outline" size={size} onClick={() => setPrompt("delete")}>
          <Trash2 className="mr-1.5 h-3.5 w-3.5" />
          Delete
        </Button>
      </div>

      <Dialog open={prompt !== null} onOpenChange={(o) => !o && !busy && setPrompt(null)}>
        <DialogContent className="max-w-md">
          {prompt === "archive" && (
            <>
              <DialogHeader>
                <DialogTitle>Archive {teamName}?</DialogTitle>
                <DialogDescription>
                  Are you sure? The team disappears from the outreach lists, but
                  nothing is deleted. Admins and finance staff can unarchive it
                  at any time.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setPrompt(null)} disabled={busy}>
                  Cancel
                </Button>
                <Button onClick={() => setArchived(true)} disabled={busy}>
                  {busy ? "Archiving…" : "Archive team"}
                </Button>
              </DialogFooter>
            </>
          )}

          {prompt === "unarchive" && (
            <>
              <DialogHeader>
                <DialogTitle>Unarchive {teamName}?</DialogTitle>
                <DialogDescription>
                  Are you sure? The team goes back into the outreach lists for
                  everyone on it.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setPrompt(null)} disabled={busy}>
                  Cancel
                </Button>
                <Button onClick={() => setArchived(false)} disabled={busy}>
                  {busy ? "Restoring…" : "Unarchive team"}
                </Button>
              </DialogFooter>
            </>
          )}

          {prompt === "delete" && canDelete && (
            <>
              <DialogHeader>
                <DialogTitle>Delete {teamName}?</DialogTitle>
                <DialogDescription>
                  Are you sure? Nothing has been recorded against this team yet,
                  so it can be deleted. This can&apos;t be undone.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setPrompt(null)} disabled={busy}>
                  Cancel
                </Button>
                <Button variant="destructive" onClick={remove} disabled={busy}>
                  {busy ? "Deleting…" : "Delete team"}
                </Button>
              </DialogFooter>
            </>
          )}

          {prompt === "delete" && !canDelete && (
            <>
              <DialogHeader>
                <DialogTitle>{teamName} can&apos;t be deleted</DialogTitle>
                <DialogDescription>
                  Deleting it would also delete:
                </DialogDescription>
              </DialogHeader>
              <ul className="list-disc space-y-0.5 pl-5 text-sm">
                {blockers.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
              <p className="text-sm text-muted-foreground">
                {archived
                  ? "It's already archived, so it's out of the lists and its records are kept."
                  : "Archive it instead: it leaves the lists and every record is kept."}
              </p>
              <DialogFooter>
                <Button variant="outline" onClick={() => setPrompt(null)} disabled={busy}>
                  {archived ? "Close" : "Cancel"}
                </Button>
                {!archived && (
                  <Button onClick={() => setPrompt("archive")} disabled={busy}>
                    Archive instead
                  </Button>
                )}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
