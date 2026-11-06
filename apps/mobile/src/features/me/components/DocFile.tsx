// The photo of an identity document (licence or passport page): view it
// through a fresh signed URL, photograph or choose a new one, or remove it.
// Uploads go straight to /api/profile/<kind> (multipart, bearer); the local
// copy is deleted afterwards whatever happens (see doc-capture.ts).

import { useState } from "react";

import { announce } from "@/lib/a11y";
import { ApiError } from "@/lib/api";
import { useTheme } from "@/theme/use-theme";

import { chooseDocPhoto, takeDocPhoto, type DocPhoto } from "../doc-capture";
import { removeDocFile, uploadDocPhoto, type DocKind } from "../docs-api";
import { profileFetch } from "../http";
import { meStrings } from "../strings";

import { confirmDestructive, errorText, FileBlock, openSignedFile, successTap } from "./docs-ui";

const f = meStrings.docs.file;

export type FileState = { hasFile: boolean; fileName: string | null; signedUrl: string | null };

export function DocFile({
  kind,
  label,
  uploadName,
  file,
  meta,
  onChange,
}: {
  kind: DocKind;
  label: string;
  /** Generic name sent with the upload (never the phone's own file name). */
  uploadName: string;
  file: FileState;
  meta?: string;
  onChange: (next: FileState) => void;
}) {
  const { colors } = useTheme();
  const [busy, setBusy] = useState<"upload" | "remove" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function pick(source: "camera" | "library") {
    setError(null);
    let photo: DocPhoto | null = null;
    try {
      photo = source === "camera" ? await takeDocPhoto(uploadName) : await chooseDocPhoto(uploadName);
    } catch {
      setError(f.uploadError);
      return;
    }
    if (!photo) return;
    setBusy("upload");
    try {
      const res = await uploadDocPhoto(profileFetch, kind, photo);
      onChange({ hasFile: true, fileName: res.file_name ?? uploadName, signedUrl: res.signed_url });
      successTap();
      announce(f.uploaded);
    } catch (err) {
      if (err instanceof ApiError && (err.kind === "unauthenticated" || err.kind === "deactivated")) return;
      const msg = errorText(err, f.uploadError);
      setError(msg);
      announce(msg);
    } finally {
      photo.cleanup();
      setBusy(null);
    }
  }

  async function remove() {
    if (!(await confirmDestructive(f.removeConfirmTitle, f.removeConfirmBody, f.remove))) return;
    setError(null);
    setBusy("remove");
    try {
      await removeDocFile(profileFetch, kind);
      onChange({ hasFile: false, fileName: null, signedUrl: null });
      announce(f.removed);
    } catch (err) {
      if (err instanceof ApiError && (err.kind === "unauthenticated" || err.kind === "deactivated")) return;
      setError(errorText(err, f.removeError));
    } finally {
      setBusy(null);
    }
  }

  async function view() {
    setError(null);
    if (!(await openSignedFile(file.signedUrl, colors))) setError(f.openError);
  }

  return (
    <FileBlock
      label={label}
      hasFile={file.hasFile}
      fileName={file.fileName}
      meta={meta}
      busy={busy}
      error={error}
      onView={() => void view()}
      onTake={() => void pick("camera")}
      onChoose={() => void pick("library")}
      onRemove={() => void remove()}
    />
  );
}
