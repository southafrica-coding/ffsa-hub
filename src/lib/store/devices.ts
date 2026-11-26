// Reading devices: a random id kept in the browser's localStorage, hashed
// before it reaches the database. Three active per buyer (STORE_DEVICE_LIMIT).
import { createHash } from "node:crypto";

export function hashDeviceId(deviceId: string): string | null {
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(deviceId)) return null;
  return createHash("sha256").update(`store-device:${deviceId}`).digest("hex");
}

/** "iPhone · Safari" from a user agent, for the Devices tab. */
export function deviceLabel(ua: string | null): string {
  if (!ua) return "A browser";
  const os = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua)
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /Mac OS X/.test(ua)
          ? "Mac"
          : /Windows/.test(ua)
            ? "Windows"
            : /Linux/.test(ua)
              ? "Linux"
              : "A device";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /CriOS|Chrome\//.test(ua)
      ? "Chrome"
      : /FxiOS|Firefox\//.test(ua)
        ? "Firefox"
        : /Safari\//.test(ua)
          ? "Safari"
          : "Browser";
  return `${os} · ${browser}`;
}
