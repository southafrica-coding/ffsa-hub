"use client";

// A random id for this browser, kept in localStorage. The server stores
// only its hash. Clearing site data makes this a "new device".
const KEY = "ffsa-store-device";

export function getDeviceId(): string {
  let id = window.localStorage.getItem(KEY);
  if (!id || !/^[A-Za-z0-9_-]{16,128}$/.test(id)) {
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    id = Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 40);
    window.localStorage.setItem(KEY, id);
  }
  return id;
}

export async function registerOfflineReader() {
  if (!("serviceWorker" in navigator)) return;
  try {
    await navigator.serviceWorker.register("/store-sw.js", { scope: "/store/library/" });
  } catch {
    // Offline reading is a bonus; the reader works without it.
  }
}

export async function clearOfflineCopies() {
  if ("caches" in window) {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith("ffsa-store-")).map((k) => caches.delete(k)));
  }
}
