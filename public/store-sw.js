/* FFSA Hub Store — offline reading.
 *
 * Registered by the reader with scope /store/library/, so it only ever
 * controls the buyer's library pages, never the staff Hub.
 *
 * Page images (/api/store/page) are cached the first time they're opened,
 * keyed by asset + page + reader (the signature and expiry are dropped from
 * the key, so a refreshed link still hits the copy). The page list for a
 * product is network-first with the last copy as the offline fallback.
 * Images are already watermarked for the reader; nothing here can be
 * downloaded as a file.
 */
const CACHE = "ffsa-store-pages-v1";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith("ffsa-store-") && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

function pageKey(url) {
  const q = url.searchParams;
  return `/__store-page/${q.get("a")}/${q.get("p")}/${encodeURIComponent(q.get("v") || "")}`;
}

self.addEventListener("message", (event) => {
  if (event.data === "store:clear") event.waitUntil(caches.delete(CACHE));
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname === "/api/store/page") {
    const key = pageKey(url);
    event.respondWith(
      caches.open(CACHE).then(async (cache) => {
        const hit = await cache.match(key);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) cache.put(key, res.clone());
        return res;
      })
    );
    return;
  }

  if (/^\/api\/store\/library\/[^/]+\/pages$/.test(url.pathname)) {
    event.respondWith(
      caches.open(CACHE).then(async (cache) => {
        const key = `/__store-list${url.pathname}`;
        try {
          const res = await fetch(req);
          if (res.ok) cache.put(key, res.clone());
          return res;
        } catch (e) {
          const hit = await cache.match(key);
          if (hit) return hit;
          throw e;
        }
      })
    );
  }
});
