// The photo of an identity document (licence or passport page): view it
// through a fresh signed URL, photograph or choose a new one, or remove it.
// Uploads go straight to /api/profile/<kind> (multipart, bearer); the local
// copy is deleted afterwards whatever happens (see doc-capture.ts).

import { useState } from "react";
import { ActivityIndicator, Linking, View } from "react-native";

import { Button, PhotoSlot, Sheet, Text } from "@/components";
import { announce } from "@/lib/a11y";
import { ApiError } from "@/lib/api";
import { space } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

import { chooseDocPhoto, takeDocPhoto, type CapturePrompts, type DocPhoto } from "../doc-capture";
import { removeDocFile, uploadDocPhoto, type DocKind } from "../docs-api";
import { isPdfName } from "../docs-logic";
import { profileFetch } from "../http";
import { meStrings } from "../strings";

import { confirmDestructive, errorText, openSignedFile, successTap } from "./docs-ui";
import { BlockLabel } from "./me-kit";

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
  // The "Use the camera?" sheet: our reason before the phone's own prompt, or
  // "access is off" with Open Settings. What it says stays put while it closes.
  const [ask, setAsk] = useState<{ kind: "explain"; answer: (ok: boolean) => void } | { kind: "off"; message: string } | null>(null);
  const [askOpen, setAskOpen] = useState(false);

  const prompts: CapturePrompts = {
    explainCamera: () =>
      new Promise((resolve) => {
        setAsk({ kind: "explain", answer: resolve });
        setAskOpen(true);
      }),
    accessOff: (message) => {
      setAsk({ kind: "off", message });
      setAskOpen(true);
    },
  };

  function closeAsk(ok = false) {
    if (!askOpen) return;
    if (ask?.kind === "explain") ask.answer(ok);
    setAskOpen(false);
  }

  async function pick(source: "camera" | "library") {
    setError(null);
    let photo: DocPhoto | null = null;
    try {
      photo = source === "camera" ? await takeDocPhoto(uploadName, prompts) : await chooseDocPhoto(uploadName, prompts);
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

  const onFile = meta ? `${f.onFile}. ${meta}` : f.onFile;

  return (
    <View testID="file-block">
      <BlockLabel>{label}</BlockLabel>
      {/* Never a preview of an identity document: a locked "On file" tile, opened on purpose with View. */}
      <PhotoSlot
        hasPhoto={file.hasFile}
        emptyLabel={f.none}
        onFileLabel={onFile}
        labels={{ view: f.view, take: file.hasFile ? `${f.replace}: ${f.takePhoto.toLowerCase()}` : f.takePhoto, choose: f.choosePhoto, remove: f.remove }}
        busy={busy !== null}
        onView={() => void view()}
        onTake={() => void pick("camera")}
        onChoose={() => void pick("library")}
        onRemove={() => void remove()}
      />
      {busy ? (
        <View
          accessible
          accessibilityRole="progressbar"
          accessibilityLabel={busy === "upload" ? f.uploading : f.removing}
          style={{ flexDirection: "row", alignItems: "center", gap: space.sm, marginTop: space.sm }}
        >
          <ActivityIndicator color={colors.text} />
          <Text variant="caption" tone="secondary">
            {busy === "upload" ? f.uploading : f.removing}
          </Text>
        </View>
      ) : null}
      {file.hasFile && isPdfName(file.fileName) ? (
        <Text variant="caption" tone="secondary" style={{ marginTop: space.sm }}>
          {f.pdfOnFile}
        </Text>
      ) : null}
      {error ? (
        <Text variant="caption" tone="danger" accessibilityRole="alert" accessibilityLiveRegion="polite" style={{ marginTop: space.sm }}>
          {error}
        </Text>
      ) : null}

      <Sheet visible={askOpen} title={f.cameraTitle} onClose={() => closeAsk(false)} testID="camera-ask">
        <Text tone="secondary">{ask?.kind === "off" ? ask.message : f.cameraRationale}</Text>
        <View style={{ gap: space.sm }}>
          {ask?.kind === "off" ? (
            <Button
              label={f.openSettings}
              onPress={() => {
                closeAsk();
                void Linking.openSettings();
              }}
            />
          ) : (
            <Button label={f.continue} onPress={() => closeAsk(true)} />
          )}
          <Button label={f.notNow} variant="secondary" onPress={() => closeAsk(false)} />
        </View>
      </Sheet>
    </View>
  );
}
