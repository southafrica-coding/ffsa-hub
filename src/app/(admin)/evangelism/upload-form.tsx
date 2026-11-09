"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { SectionBar } from "@/components/ffsa";
import { createTestimony, isOffline, putSignedUpload, signMedia, type ApiFailure } from "./api";
import {
  LIMITS,
  classifyFile,
  emptyStory,
  formatBytes,
  mediaLimitMessage,
  validateStory,
  type FieldError,
  type StoryInput,
} from "./logic";
import { StoryFields } from "./story-fields";

type LocalFile = {
  key: string;
  file: File;
  kind: "photo" | "video";
  contentType: string;
};

const ACCEPT =
  ".jpg,.jpeg,.png,.webp,.heic,.heif,.mp4,.mov,.webm,image/jpeg,image/png,image/webp,image/heic,image/heif,video/mp4,video/quicktime,video/webm";

export function UploadForm({ today, onSaved }: { today: string; onSaved: () => void }) {
  const [value, setValue] = useState<StoryInput>(() => emptyStory(today));
  const [files, setFiles] = useState<LocalFile[]>([]);
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [banner, setBanner] = useState<string | null>(null);
  const [fileNote, setFileNote] = useState<string | null>(null);
  const [pending, setPending] = useState<"draft" | "submit" | null>(null);
  const intent = useRef<"draft" | "submit">("submit");
  const lock = useRef(false);
  const picker = useRef<HTMLInputElement>(null);

  function addFiles(list: FileList | null) {
    if (!list?.length) return;
    const next = files.slice();
    let note: string | null = null;
    for (const file of Array.from(list)) {
      const classified = classifyFile(file);
      if (!classified.ok) {
        note = classified.message;
        continue;
      }
      const candidate = [...next, { kind: classified.kind }];
      const limit = mediaLimitMessage(candidate);
      if (limit) {
        note = limit;
        continue;
      }
      next.push({
        key: `${file.name}-${file.size}-${file.lastModified}-${next.length}`,
        file,
        kind: classified.kind,
        contentType: classified.contentType,
      });
    }
    setFiles(next);
    setFileNote(note);
    if (picker.current) picker.current.value = "";
  }

  function removeFile(key: string) {
    setFiles((current) => current.filter((file) => file.key !== key));
    setFileNote(null);
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (lock.current) return;
    lock.current = true;
    const mode = intent.current;
    try {
      const parsed = validateStory(value, { intent: mode, today });
      if (!parsed.ok) {
        setErrors(parsed.errors);
        setBanner(null);
        return;
      }
      setErrors([]);
      setBanner(null);
      setPending(mode);

      const media: Array<{ path: string; kind: "photo" | "video"; content_type: string }> = [];
      for (let index = 0; index < files.length; index += 1) {
        const item = files[index];
        setBanner(`Uploading ${index + 1} of ${files.length}`);
        const signed = await signMedia({
          kind: item.kind,
          content_type: item.contentType,
          size: item.file.size,
        });
        if (!signed.ok) {
          fail(signed, mode);
          return;
        }
        const uploaded = await putSignedUpload(signed.data, item.file, item.contentType);
        if (!uploaded.ok) {
          fail(uploaded, mode);
          return;
        }
        media.push({
          path: signed.data.path,
          kind: item.kind,
          content_type: signed.data.content_type || item.contentType,
        });
      }

      setBanner(mode === "submit" ? "Submitting the story" : "Saving the draft");
      const saved = await createTestimony({ ...parsed.value, ...(media.length ? { media } : {}) });
      if (!saved.ok) {
        fail(saved, mode);
        return;
      }

      setPending(null);
      setBanner(null);
      setValue(emptyStory(today));
      setFiles([]);
      toast.success(
        mode === "submit" ? "Submitted. A publisher will read it before it goes on the TV." : "Draft saved."
      );
      onSaved();
    } finally {
      lock.current = false;
    }
  }

  function fail(failure: ApiFailure, mode: "draft" | "submit") {
    setPending(null);
    setErrors(failure.fields ?? []);
    if (failure.fields?.length && failure.message === "Check the story fields.") {
      setBanner(null);
      return;
    }
    setBanner(
      isOffline(failure)
        ? failure.message
        : failure.message || (mode === "submit" ? "Couldn't submit the story." : "Couldn't save the draft.")
    );
  }

  return (
    <form onSubmit={onSubmit} className="border border-ink bg-white">
      <SectionBar title="Tell the story" meta="Draft or submit" />
      <div className="space-y-6 p-5 md:p-6">
        <StoryFields idPrefix="upload" value={value} onChange={setValue} errors={errors} />

        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <span className="mono-label">Photos and video</span>
            <span className="h-px flex-1 bg-rule" />
          </div>
          <p className="text-[13px] leading-relaxed text-[color:var(--text-secondary)]">
            Optional. Up to {LIMITS.maxMedia} files, including {LIMITS.maxVideos} videos. Photos{" "}
            {Math.round(LIMITS.photoBytes / (1024 * 1024))} MB, videos{" "}
            {Math.round(LIMITS.videoBytes / (1024 * 1024))} MB. JPG, PNG, WEBP, HEIC, MP4, MOV, or WEBM.
            Files are attached when you first save. They can&apos;t be added later.
          </p>
          <label className="inline-flex min-h-11 cursor-pointer items-center border border-ink bg-bone px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-[0.14em] hover:bg-white">
            Add a photo or video
            <input
              ref={picker}
              type="file"
              accept={ACCEPT}
              multiple
              className="hidden"
              onChange={(event) => addFiles(event.target.files)}
            />
          </label>
          {fileNote && <p className="text-xs text-destructive">{fileNote}</p>}
          {files.length > 0 && (
            <ul className="border border-rule">
              {files.map((item) => (
                <li
                  key={item.key}
                  className="flex items-center justify-between gap-3 border-b border-rule px-3 py-2 last:border-b-0"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[14px]">{item.file.name}</span>
                    <span className="mono-label">
                      {item.kind} · {formatBytes(item.file.size)}
                    </span>
                  </span>
                  <button
                    type="button"
                    className="shrink-0 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-[color:var(--text-secondary)] hover:text-ink"
                    onClick={() => removeFile(item.key)}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {banner && (
          <p className="border border-ink bg-bone px-3 py-2 text-[13px] leading-relaxed" role="status">
            {banner}
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          <Button
            type="submit"
            disabled={pending !== null}
            onClick={() => {
              intent.current = "submit";
            }}
          >
            {pending === "submit" ? "Submitting" : "Submit for review"}
          </Button>
          <Button
            type="submit"
            variant="outline"
            disabled={pending !== null}
            onClick={() => {
              intent.current = "draft";
            }}
          >
            {pending === "draft" ? "Saving" : "Save draft"}
          </Button>
        </div>
      </div>
    </form>
  );
}
