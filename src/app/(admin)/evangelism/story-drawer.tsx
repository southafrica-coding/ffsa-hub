"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Drawer, StatusPill, type Tone } from "@/components/ffsa";
import { deleteTestimony, updateTestimony, type ApiFailure } from "./api";
import {
  authorName,
  formatBytes,
  formatStoryDate,
  outcomeLabel,
  statusLabel,
  storyFromTestimony,
  validateStory,
  validateWithheldReason,
  type FieldError,
  type StoryInput,
  type Testimony,
} from "./logic";
import { StoryFields } from "./story-fields";

const TONE: Record<string, Tone> = {
  draft: "quiet",
  submitted: "warn",
  published: "good",
  withheld: "quiet",
};

export function StoryDrawer({
  story,
  userId,
  canPublish,
  onClose,
  onPrev,
  onNext,
  onChanged,
}: {
  story: Testimony | null;
  userId: string;
  /** Explicit API flag. Absent means this viewer is not shown publisher controls. */
  canPublish: boolean;
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<StoryInput | null>(null);
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [withholding, setWithholding] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    setEditing(false);
    setDraft(null);
    setErrors([]);
    setWithholding(false);
    setReason("");
    setBanner(null);
    setConfirmDelete(false);
  }, [story?.id]);

  function close() {
    setEditing(false);
    setWithholding(false);
    setConfirmDelete(false);
    setBanner(null);
    setErrors([]);
    onClose();
  }

  if (!story) {
    return (
      <Drawer open={false} onClose={close} label="Story">
        {null}
      </Drawer>
    );
  }

  const mine = story.author_user_id === userId;
  const canEdit = canPublish || (mine && (story.status === "draft" || story.status === "submitted"));
  const canDelete = canPublish || (mine && story.status === "draft");
  const showPublish = canPublish && story.status !== "published" && story.consent_to_share;
  const canWithhold = canPublish && story.status !== "withheld";

  async function run(label: string, action: () => Promise<ApiFailure | { ok: true }>, success: string) {
    setBusy(label);
    setBanner(null);
    const result = await action();
    setBusy(null);
    if (!result.ok) {
      setErrors(result.fields ?? []);
      setBanner(result.message);
      return;
    }
    toast.success(success);
    setEditing(false);
    setWithholding(false);
    setConfirmDelete(false);
    onChanged();
  }

  function saveEdits() {
    if (!story || !draft) return;
    const id = story.id;
    const intent = story.status === "submitted" || story.status === "published" ? "submit" : "draft";
    const parsed = validateStory(draft, { intent });
    if (!parsed.ok) {
      setErrors(parsed.errors);
      setBanner(null);
      return;
    }
    const next = parsed.value;
    void run(
      "save",
      () =>
        updateTestimony(id, {
          title: next.title,
          body: next.body,
          occurred_on: next.occurred_on,
          location_label: next.location_label,
          people_reached: next.people_reached,
          decisions: next.decisions,
          outcome: next.outcome,
          consent_to_share: next.consent_to_share,
        }),
      "Story updated."
    );
  }

  return (
    <Drawer open onClose={close} label="Story" onPrev={onPrev} onNext={onNext}>
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
          <div className="flex items-center gap-2">
            <StatusPill tone={TONE[story.status] ?? "quiet"}>{statusLabel(story.status)}</StatusPill>
            <span className="mono-label">{outcomeLabel(story.outcome)}</span>
          </div>
          <h2 className="font-display text-[34px] font-black uppercase leading-[0.95]">{story.title}</h2>
          <p className="text-[13px] leading-relaxed text-[color:var(--text-secondary)]">
            {formatStoryDate(story.occurred_on)} · {story.location_label}
            <br />
            {authorName(story)} · {story.people_reached} reached · {story.decisions} decisions
          </p>

          {editing && draft ? (
            <>
              <p className="text-[13px] leading-relaxed text-[color:var(--text-secondary)]">
                Photos and video stay as they were uploaded.
              </p>
              <StoryFields idPrefix={`edit-${story.id}`} value={draft} onChange={setDraft} errors={errors} />
            </>
          ) : (
            <p className="whitespace-pre-wrap text-[15px] leading-relaxed">{story.body}</p>
          )}

          {!editing && story.media.length > 0 && (
            <div className="space-y-3">
              <div className="mono-label">Files</div>
              {story.media.map((item) => (
                <figure key={item.id} className="border border-ink bg-bone">
                  {item.url && item.kind === "photo" ? (
                    // Signed URL from the API, refreshed on each load. next/image
                    // would need the storage host on the allow-list.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={item.url} alt="" className="max-h-[360px] w-full object-contain bg-ink" />
                  ) : item.url && item.kind === "video" ? (
                    <video src={item.url} controls playsInline className="max-h-[360px] w-full bg-ink" />
                  ) : (
                    <p className="px-3 py-6 text-[13px] text-[color:var(--text-secondary)]">
                      This file isn&apos;t available right now.
                    </p>
                  )}
                  <figcaption className="mono-label px-3 py-2">
                    {item.kind} · {formatBytes(item.size_bytes)}
                  </figcaption>
                </figure>
              ))}
            </div>
          )}

          {canPublish && story.withheld_reason && (
            <div className="border border-ink bg-ink px-4 py-3 text-white">
              <div className="mono-label mb-1 text-yellow">Publishers only</div>
              <p className="text-[14px] leading-relaxed">{story.withheld_reason}</p>
              <p className="mt-2 text-[12px] text-[#C5C2AE]">The author doesn&apos;t see this note.</p>
            </div>
          )}

          {canPublish && !story.consent_to_share && story.status !== "published" && (
            <p className="text-[13px] leading-relaxed text-amber">
              This story can&apos;t be published until the author agrees it can be shared.
            </p>
          )}

          {withholding && (
            <div className="space-y-2">
              <label htmlFor="withhold-reason" className="mono-label">
                Why this stays off the TV
              </label>
              <textarea
                id="withhold-reason"
                value={reason}
                rows={4}
                maxLength={500}
                onChange={(event) => setReason(event.target.value)}
                className="flex w-full"
              />
              <p className="text-[12px] text-[color:var(--text-secondary)]">
                The author doesn&apos;t see this note. It stays with publishers.
              </p>
            </div>
          )}

          {banner && (
            <p className="border border-ink bg-bone px-3 py-2 text-[13px]" role="status">
              {banner}
            </p>
          )}
        </div>

        <div className="flex flex-wrap gap-2 border-t border-ink px-6 py-4">
          {editing ? (
            <>
              <Button type="button" disabled={busy !== null} onClick={saveEdits}>
                {busy === "save" ? "Saving" : "Save changes"}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={busy !== null}
                onClick={() => {
                  setEditing(false);
                  setErrors([]);
                }}
              >
                Cancel
              </Button>
            </>
          ) : (
            <>
              {showPublish && (
                <Button
                  type="button"
                  disabled={busy !== null}
                  onClick={() =>
                    void run(
                      "publish",
                      () => updateTestimony(story.id, { status: "published", confirm_consent: true }),
                      "Published. It will show on the TV within a few seconds."
                    )
                  }
                >
                  {busy === "publish" ? "Publishing" : "Publish"}
                </Button>
              )}
              {canWithhold && !withholding && (
                <Button type="button" variant="outline" disabled={busy !== null} onClick={() => setWithholding(true)}>
                  Withhold
                </Button>
              )}
              {withholding && (
                <Button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => {
                    const problem = validateWithheldReason(reason);
                    if (problem) {
                      setBanner(problem.message);
                      return;
                    }
                    void run(
                      "withhold",
                      () => updateTestimony(story.id, { status: "withheld", withheld_reason: reason.trim() }),
                      "Withheld. It stays off the TV."
                    );
                  }}
                >
                  {busy === "withhold" ? "Holding back" : "Withhold story"}
                </Button>
              )}
              {canEdit && !withholding && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy !== null}
                  onClick={() => {
                    setDraft(storyFromTestimony(story));
                    setErrors([]);
                    setEditing(true);
                  }}
                >
                  Edit
                </Button>
              )}
              {canDelete && !withholding && (
                <Button
                  type="button"
                  variant="destructive"
                  disabled={busy !== null}
                  onClick={() => {
                    if (!confirmDelete) {
                      setConfirmDelete(true);
                      return;
                    }
                    void run(
                      "delete",
                      async () => {
                        const result = await deleteTestimony(story.id);
                        if (!result.ok) return result;
                        return { ok: true as const };
                      },
                      "Story deleted."
                    );
                  }}
                >
                  {busy === "delete" ? "Deleting" : confirmDelete ? "Delete now" : "Delete"}
                </Button>
              )}
            </>
          )}
        </div>
      </div>
    </Drawer>
  );
}
