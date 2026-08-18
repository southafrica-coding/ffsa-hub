"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import jsQR from "jsqr";
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

type BarcodeDetectorCtor = new (opts?: { formats?: string[] }) => {
  detect: (source: CanvasImageSource) => Promise<Array<{ rawValue: string }>>;
};

// Longest edge we hand the decoder. Full-res frames from a modern phone
// camera are 1080p+; downscaling keeps each decode well under the frame
// budget without hurting read rate at door distance.
const DECODE_MAX_EDGE = 640;

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
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const lastScannedRef = useRef<string>("");
  const lastScannedAtRef = useRef<number>(0);
  const itemIdRef = useRef<number>(0);

  // Cleanup camera on unmount.
  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, []);

  async function startCamera() {
    setCameraError(null);
    if (typeof navigator === "undefined" || !navigator.mediaDevices) {
      // getUserMedia only exists on secure origins (https / localhost).
      setCameraError(
        "This browser won't give the page camera access. Open the Hub over https, or use manual entry below."
      );
      return;
    }
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

  const processScan = useCallback(
    async (code: string) => {
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
    },
    [eventId]
  );

  // Scan loop — runs while `scanning` is true.
  //
  // Decoding is two-tier: the native BarcodeDetector where the browser has
  // it (Android Chrome, Chrome on macOS), and a jsQR canvas decode
  // everywhere else. Safari — iOS and macOS — and Firefox ship no
  // BarcodeDetector at all, so the native-only path meant door staff on an
  // iPhone got no camera whatsoever.
  useEffect(() => {
    if (!scanning) return;

    const Ctor = (
      window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }
    ).BarcodeDetector;
    const detector = Ctor ? new Ctor({ formats: ["qr_code"] }) : null;

    let cancelled = false;

    const readFrame = async (): Promise<string | null> => {
      const video = videoRef.current;
      if (!video || video.readyState < 2) return null;

      if (detector) {
        const codes = await detector.detect(video);
        return codes[0]?.rawValue ?? null;
      }

      const vw = video.videoWidth;
      const vh = video.videoHeight;
      if (!vw || !vh) return null;
      const scale = Math.min(1, DECODE_MAX_EDGE / Math.max(vw, vh));
      const w = Math.round(vw * scale);
      const h = Math.round(vh * scale);

      const canvas = (canvasRef.current ??= document.createElement("canvas"));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return null;
      ctx.drawImage(video, 0, 0, w, h);
      const frame = ctx.getImageData(0, 0, w, h);
      // dontInvert: ticket QRs are always dark-on-light, and skipping the
      // inverted pass roughly halves the per-frame cost.
      const found = jsQR(frame.data, w, h, { inversionAttempts: "dontInvert" });
      return found?.data ?? null;
    };

    const interval = setInterval(async () => {
      if (cancelled) return;
      try {
        const code = await readFrame();
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
    }, 250);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [scanning, processScan]);

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
          <div
            className="rounded-lg overflow-hidden border bg-black relative"
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
                Tap &ldquo;Start scanning&rdquo; to open the camera.
              </div>
            )}
          </div>
          {cameraError && <p className="text-xs text-red-600">{cameraError}</p>}
          <div className="flex gap-2">
            {scanning ? (
              <button
                type="button"
                onClick={stopCamera}
                className="px-3 py-1.5 rounded border text-sm hover:bg-gray-50"
              >
                Stop scanner
              </button>
            ) : (
              <button
                type="button"
                onClick={startCamera}
                className="px-3 py-1.5 rounded bg-blue-600 text-white text-sm hover:bg-blue-700"
              >
                Start scanning
              </button>
            )}
          </div>

          <form onSubmit={submitManual} className="flex gap-2 border-t pt-4">
            <input
              type="text"
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              placeholder="Enter the code by hand"
              className="flex-1 border rounded px-2 py-1.5 text-sm font-mono"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />
            <button
              type="submit"
              className="px-3 py-1.5 rounded bg-blue-600 text-white text-sm hover:bg-blue-700"
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
            <p className="text-sm text-muted-foreground italic">No scans yet.</p>
          ) : (
            <ul className="space-y-2">
              {items.map((it) => (
                <li
                  key={it.id}
                  className="border rounded p-3"
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
