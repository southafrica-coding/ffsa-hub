"use client";

import { useState, useRef, useCallback } from "react";
import { useController, type Control } from "react-hook-form";
import { Upload, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FieldWrapper } from "./field-wrapper";
import type { FormQuestion, FileValue } from "@/lib/form-types";
import { compressImageToMaxBytes, detectImageType } from "@/lib/image";
import { buildApplicationUploadPath, UPLOAD_BUCKET } from "@/lib/upload-paths";

const MAX_SIZE = 25 * 1024 * 1024; // 25MB raw — we'll compress before upload
const COMPRESS_THRESHOLD = 2 * 1024 * 1024; // 2MB — compress anything bigger than this

export function FileUpload({
  question,
  control,
  applicationId,
}: {
  question: FormQuestion;
  control: Control<any>;
  applicationId?: string;
}) {
  const { field, fieldState } = useController({
    name: question.id,
    control,
  });

  const [preview, setPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    async (rawFile: File) => {
      setUploadError(null);

      const detectedType = detectImageType(rawFile);
      if (!detectedType) {
        setUploadError(
          "Please choose an image file (JPG, PNG, HEIC, or WebP)"
        );
        return;
      }

      if (rawFile.size > MAX_SIZE) {
        setUploadError(
          `Photo is ${(rawFile.size / 1024 / 1024).toFixed(1)}MB — please choose one under 25MB`
        );
        return;
      }

      setPreview(URL.createObjectURL(rawFile));
      setUploading(true);

      try {
        // Compress large images down to ~1600px before upload (shared helper
        // with the avatar uploader). HEIC is decoded to JPEG inside the helper;
        // the generous maxBytes keeps it a one-shot resize at this quality.
        let file = rawFile;
        if (rawFile.size > COMPRESS_THRESHOLD) {
          file = await compressImageToMaxBytes(rawFile, {
            maxDimension: 1600,
            maxBytes: MAX_SIZE,
            startQuality: 0.85,
          });
        }

        const contentType = detectImageType(file) || "image/jpeg";
        // Built by the same module /api/upload/sign validates with.
        const path = buildApplicationUploadPath({
          applicationId: applicationId || "draft",
          questionId: question.id,
          uuid: crypto.randomUUID(),
          fileName: file.name,
          contentType,
        });

        const signRes = await fetch("/api/upload/sign", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            bucket: UPLOAD_BUCKET,
            path,
            contentType,
          }),
        });

        if (!signRes.ok) {
          let serverMsg = "Failed to get upload URL";
          try {
            const errData = await signRes.json();
            if (errData.error) serverMsg = errData.error;
          } catch {
            /* ignore */
          }
          throw new Error(serverMsg);
        }

        const { signedUrl } = await signRes.json();

        const uploadRes = await fetch(signedUrl, {
          method: "PUT",
          headers: {
            "Content-Type": contentType,
            "x-upsert": "true",
          },
          body: file,
        });

        if (!uploadRes.ok) {
          let uploadMsg = `Upload failed (${uploadRes.status})`;
          try {
            const errText = await uploadRes.text();
            if (errText) uploadMsg = `Upload failed: ${errText.slice(0, 100)}`;
          } catch {
            /* ignore */
          }
          throw new Error(uploadMsg);
        }

        const value: FileValue = {
          storagePath: path,
          mimeType: contentType,
          size: file.size,
          originalName: rawFile.name,
        };

        field.onChange(value);
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : "Upload failed. Please try again.";
        setUploadError(msg);
        setPreview(null);
        field.onChange(null);
        // Help us debug mobile failures
        console.error("Photo upload error:", err);
      } finally {
        setUploading(false);
      }
    },
    [applicationId, question.id, field]
  );

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  }

  function handleRemove() {
    setPreview(null);
    setUploadError(null);
    field.onChange(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  const hasValue =
    field.value && typeof field.value === "object" && field.value.storagePath;

  return (
    <FieldWrapper
      id={question.id}
      label={question.label}
      required={question.required}
      helpText={question.helpText}
      error={fieldState.error?.message || uploadError || undefined}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        onChange={handleInputChange}
        className="hidden"
        id={question.id}
      />

      {hasValue && preview ? (
        <div className="relative inline-block">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={preview}
            alt="Upload preview"
            className="h-32 w-32 rounded-lg object-cover border"
          />
          <Button
            type="button"
            variant="destructive"
            size="icon"
            className="absolute -top-2 -right-2 h-6 w-6 rounded-full"
            onClick={handleRemove}
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      ) : (
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
          className="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-muted-foreground/25 p-6 cursor-pointer hover:border-muted-foreground/50 transition-colors"
        >
          {uploading ? (
            <>
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Uploading photo…</p>
            </>
          ) : (
            <>
              <Upload className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground text-center">
                Tap to choose a photo
              </p>
              <p className="text-xs text-muted-foreground text-center">
                JPG, PNG, or HEIC — up to 25MB
              </p>
            </>
          )}
        </div>
      )}
    </FieldWrapper>
  );
}
