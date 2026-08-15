"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Upload,
  FileText,
  Trash2,
  X,
  Download,
  Loader2,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type Receipt = {
  id: string;
  expense_id: string;
  file_path: string;
  file_name: string;
  file_size: number;
  mime_type: string;
  uploaded_at: string;
  signed_url: string | null;
};

export function ReceiptGallery({
  expenseId,
  teamId,
  receiptCount,
  readOnly = false,
}: {
  expenseId: string;
  teamId: string;
  receiptCount: number;
  readOnly?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const fetchReceipts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/finance/outreach/receipts?expense_id=${expenseId}`
      );
      if (res.ok) {
        const { data } = await res.json();
        setReceipts(data ?? []);
      }
    } catch {
      toast.error("Failed to load receipts");
    } finally {
      setLoading(false);
    }
  }, [expenseId]);

  function handleOpen() {
    setOpen(true);
    fetchReceipts();
  }

  async function uploadFiles(files: FileList | File[]) {
    setUploading(true);
    const supabase = createClient();
    let successCount = 0;

    for (const file of Array.from(files)) {
      const filePath = `${teamId}/${expenseId}/${Date.now()}_${file.name}`;

      const { error: uploadError } = await supabase.storage
        .from("outreach-receipts")
        .upload(filePath, file, { upsert: true });

      if (uploadError) {
        toast.error(`Upload failed: ${file.name}`);
        continue;
      }

      const res = await fetch("/api/finance/outreach/receipts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expense_id: expenseId,
          file_path: filePath,
          file_name: file.name,
          file_size: file.size,
          mime_type: file.type,
        }),
      });

      if (res.ok) {
        successCount++;
      } else {
        toast.error(`Failed to save metadata: ${file.name}`);
      }
    }

    if (successCount > 0) {
      toast.success(`${successCount} receipt${successCount > 1 ? "s" : ""} uploaded`);
      fetchReceipts();
      router.refresh();
    }
    setUploading(false);
  }

  async function handleDelete(receipt: Receipt) {
    if (!confirm(`Delete ${receipt.file_name}?`)) return;

    const res = await fetch(
      `/api/finance/outreach/receipts?id=${receipt.id}&file_path=${encodeURIComponent(receipt.file_path)}`,
      { method: "DELETE" }
    );

    if (res.ok) {
      setReceipts((prev) => prev.filter((r) => r.id !== receipt.id));
      toast.success("Receipt deleted");
      router.refresh();
    } else {
      toast.error("Failed to delete receipt");
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    if (readOnly || !e.dataTransfer.files.length) return;
    uploadFiles(e.dataTransfer.files);
  }

  const isImage = (mime: string) => mime.startsWith("image/");

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <>
      {/* Trigger button */}
      <button
        onClick={handleOpen}
        className="flex items-center gap-1 cursor-pointer"
        title={
          receiptCount > 0
            ? `${receiptCount} receipt${receiptCount > 1 ? "s" : ""}`
            : "Add receipts"
        }
      >
        {receiptCount > 0 ? (
          <div className="flex items-center gap-0.5">
            <FileText className="h-4 w-4 text-[color:var(--green-text)]" />
            <span className="text-xs text-[color:var(--green-text)] font-medium">
              {receiptCount}
            </span>
          </div>
        ) : (
          <Upload className="h-4 w-4 text-muted-foreground hover:text-primary" />
        )}
      </button>

      {/* Gallery Dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Receipts</DialogTitle>
          </DialogHeader>

          {/* Drop zone / Upload area */}
          {!readOnly && (
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              className={`border-2 border-dashed border-rule-strong p-6 text-center transition-colors ${
                dragOver
                  ? "border-primary bg-primary/5"
                  : "border-muted-foreground/25"
              }`}
            >
              {uploading ? (
                <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Uploading...
                </div>
              ) : (
                <>
                  <Upload className="h-6 w-6 mx-auto mb-2 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground mb-2">
                    Drag & drop receipts here, or
                  </p>
                  <label className="cursor-pointer">
                    <Button variant="outline" size="sm" asChild>
                      <span>
                        <Upload className="mr-2 h-3 w-3" />
                        Browse Files
                      </span>
                    </Button>
                    <input
                      type="file"
                      className="hidden"
                      multiple
                      accept="image/*,.pdf"
                      onChange={(e) => {
                        if (e.target.files?.length) uploadFiles(e.target.files);
                        e.target.value = "";
                      }}
                    />
                  </label>
                </>
              )}
            </div>
          )}

          {/* Receipt Grid */}
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : receipts.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              No receipts uploaded yet.
            </p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {receipts.map((receipt) => (
                <div
                  key={receipt.id}
                  className="relative group overflow-hidden border border-rule-strong bg-bone"
                >
                  {/* Preview area */}
                  {isImage(receipt.mime_type) && receipt.signed_url ? (
                    <button
                      onClick={() => setPreviewUrl(receipt.signed_url)}
                      className="w-full aspect-square"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={receipt.signed_url}
                        alt={receipt.file_name}
                        className="w-full h-full object-cover"
                      />
                    </button>
                  ) : (
                    <a
                      href={receipt.signed_url ?? "#"}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex flex-col items-center justify-center aspect-square hover:bg-bone transition-colors"
                    >
                      <FileText className="h-8 w-8 text-muted-foreground mb-1" />
                      <span className="text-xs text-muted-foreground">PDF</span>
                    </a>
                  )}

                  {/* Info bar */}
                  <div className="p-2 space-y-0.5">
                    <div className="flex items-center justify-between gap-1">
                      <p
                        className="text-xs truncate flex-1"
                        title={receipt.file_name}
                      >
                        {receipt.file_name}
                      </p>
                      {receipt.signed_url && (
                        <a
                          href={receipt.signed_url}
                          download={receipt.file_name}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="shrink-0 text-muted-foreground hover:text-primary"
                          title="Download"
                        >
                          <Download className="h-3 w-3" />
                        </a>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {formatSize(receipt.file_size)}
                    </p>
                  </div>

                  {/* Delete button */}
                  {!readOnly && (
                    <button
                      onClick={() => handleDelete(receipt)}
                      className="absolute top-1 right-1 h-6 w-6 bg-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-destructive hover:text-destructive-foreground"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Full-size Image Preview */}
      {previewUrl && (
        <div
          className="fixed inset-0 z-[100] bg-black/80 flex items-center justify-center p-4"
          onClick={() => setPreviewUrl(null)}
        >
          <button
            onClick={() => setPreviewUrl(null)}
            className="absolute top-4 right-4 text-white hover:text-[color:var(--rule-strong)]"
          >
            <X className="h-6 w-6" />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={previewUrl}
            alt="Receipt preview"
            className="max-w-full max-h-full object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </>
  );
}
