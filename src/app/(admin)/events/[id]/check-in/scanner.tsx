"use client";

import { useEffect, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type OkResult = {
  result: "ok";
  ticketTypeName: string;
  buyerName: string;
};
type AlreadyResult = {
  result: "already_checked_in";
  ticketTypeName: string;
  checkedInAt: string;
};
type RejectedResult = { result: "void" | "invalid" | "wrong_event" };
type ErrorResult = { result: "error"; error: string };
type ScanResult = OkResult | AlreadyResult | RejectedResult | ErrorResult;

type DisplayItem = {
  id: number;
  code: string;
  result: ScanResult;
  at: number;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type BarcodeDetectorCtor = new (opts?: { formats?: string[] }) => {
  detect: (source: CanvasImageSource) => Promise<Array<{ rawValue: string }>>;
};

export function Scanner({
  eventId,
  eventTitle,
}: {
  eventId: string;
  eventTitle: string;
}) {
  const [scanning, setScanning] = useState(false);
  const [manual, setManual] = useState("");
  const [items, setItems] = useState<DisplayItem[]>([]);
  const [cameraError, setCameraError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const lastScannedRef = useRef<string>("");
  const lastScannedAtRef = useRef<number>(0);
  const itemIdRef = useRef<number>(0);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Detector: BarcodeDetectorCtor | undefined =
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    typeof window !== "undefined" ? (window as any).BarcodeDetector : undefined;
  const supportsCamera = !!Detector;

  // Cleanup camera on unmount.
  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, []);

  async function startCamera() {
    setCameraError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setScanning(true);
    } catch (e) {
      setCameraError(
        e instanceof Error
          ? e.message
          : "Couldn't open the camera. Check the site has camera permission."
      );
    }
  }

  function stopCamera() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setScanning(false);
  }

  // Scan loop — runs while `scanning` is true.
  useEffect(() => {
    if (!scanning || !Detector) return;
    const detector = new Detector({ formats: ["qr_code"] });
    const interval = setInterval(async () => {
      const video = videoRef.current;
      if (!video || video.readyState < 2) return;
      try {
        const codes = await detector.detect(video);
        if (codes.length === 0) return;
        const code = codes[0].rawValue;
        if (!code) return;
        const now = Date.now();
        // De-dup: ignore the same code re-scanned within 3 seconds.
        if (
          code === lastScannedRef.current &&
          now - lastScannedAtRef.current < 3000
        ) {
          return;
        }
        lastScannedRef.current = code;
        lastScannedAtRef.current = now;
        await processScan(code);
      } catch {
        /* Frame-decode errors during normal scanning are expected — ignore. */
      }
    }, 350);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanning, Detector]);

  async function processScan(code: string) {
    const id = ++itemIdRef.current;
    let result: ScanResult;
    try {
      const res = await fetch(`/api/events/${eventId}/check-in`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        result = {
          result: "error",
          error: data.error ?? `Request failed (${res.status})`,
        };
      } else {
        result = (await res.json()) as ScanResult;
      }
    } catch (e) {
      result = {
        result: "error",
        error: e instanceof Error ? e.message : "Network error",
      };
    }
    setItems((prev) =>
      [{ id, code, result, at: Date.now() }, ...prev].slice(0, 12)
    );
  }

  async function submitManual(e: React.FormEvent) {
    e.preventDefault();
    const code = manual.trim();
    if (!code) return;
    await processScan(code);
    setManual("");
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Scanner</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Scan ticket QR codes for {eventTitle}, or type a code by hand.
          </p>
          {supportsCamera ? (
            <>
              <div
                className="overflow-hidden border bg-black relative"
                style={{ aspectRatio: "16 / 9" }}
              >
                <video
                  ref={videoRef}
                  className="w-full h-full object-cover"
                  muted
                  playsInline
                />
                {!scanning && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-white text-sm">
                    Tap &quot;Start scanning&quot; to open the camera.
                  </div>
                )}
              </div>
              {cameraError && (
                <p className="text-xs text-destructive">{cameraError}</p>
              )}
              <div className="flex gap-2">
                {scanning ? (
                  <button
                    type="button"
                    onClick={stopCamera}
                    className="px-3 py-1.5 border text-sm hover:bg-[color:var(--surface-2)]"
                  >
                    Stop scanner
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={startCamera}
                    className="px-3 py-1.5 bg-ink text-white text-sm hover:bg-[#262622]"
                  >
                    Start scanning
                  </button>
                )}
              </div>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">
              Camera scanning isn&apos;t supported in this browser. Use manual entry
              below — works everywhere.
            </p>
          )}

          <form onSubmit={submitManual} className="flex gap-2 border-t pt-4">
            <input
              type="text"
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              placeholder="Enter the code by hand"
              className="flex-1 border px-2 py-1.5 text-sm font-mono"
            />
            <button
              type="submit"
              className="px-3 py-1.5 bg-ink text-white text-sm hover:bg-[#262622]"
            >
              Check in
            </button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent scans</CardTitle>
        </CardHeader>
        <CardContent>
          {items.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">
              No scans yet.
            </p>
          ) : (
            <ul className="space-y-2">
              {items.map((it) => (
                <li
                  key={it.id}
                  className="border p-3"
                  style={resultStyle(it.result)}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <p className="text-sm font-semibold">
                        {resultMessage(it.result)}
                      </p>
                      {it.result.result === "ok" && (
                        <p className="text-xs mt-0.5">
                          {it.result.ticketTypeName}
                          {it.result.buyerName
                            ? ` · ${it.result.buyerName}`
                            : ""}
                        </p>
                      )}
                      {it.result.result === "already_checked_in" && (
                        <p className="text-xs mt-0.5">
                          {it.result.ticketTypeName} · checked in at{" "}
                          {new Date(it.result.checkedInAt).toLocaleString()}
                        </p>
                      )}
                      {it.result.result === "error" && (
                        <p className="text-xs mt-0.5">{it.result.error}</p>
                      )}
                      <p className="text-xs font-mono mt-1 opacity-60">
                        {it.code}
                      </p>
                    </div>
                    <p className="text-xs opacity-60 shrink-0">
                      {new Date(it.at).toLocaleTimeString()}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function resultMessage(r: ScanResult): string {
  switch (r.result) {
    case "ok":
      return "Checked in";
    case "already_checked_in":
      return "Already checked in";
    case "void":
      return "Voided ticket — reject";
    case "invalid":
      return "Invalid code — reject";
    case "wrong_event":
      return "Ticket is for a different event";
    case "error":
      return "Error";
  }
}

function resultStyle(r: ScanResult): React.CSSProperties {
  switch (r.result) {
    case "ok":
      return {
        backgroundColor: "#dcfce7",
        borderColor: "#86efac",
        color: "#065f46",
      };
    case "already_checked_in":
      return {
        backgroundColor: "#fef3c7",
        borderColor: "#fcd34d",
        color: "#854d0e",
      };
    case "void":
    case "invalid":
    case "wrong_event":
    case "error":
      return {
        backgroundColor: "#fee2e2",
        borderColor: "#fca5a5",
        color: "#991b1b",
      };
  }
}
