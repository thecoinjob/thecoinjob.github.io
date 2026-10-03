/* Zero browser migration bridge.
 * Today: /api requests fall back to the existing Render API.
 * Later: these handlers will be replaced one endpoint at a time by browser-native calculations.
 */
const RENDER_API = "https://zero-scan1.onrender.com";
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith("/api/")) return;
  event.respondWith(fetch(RENDER_API + url.pathname + url.search, {
    method: event.request.method,
    headers: event.request.headers,
    body: event.request.method === "GET" || event.request.method === "HEAD" ? undefined : event.request.body,
    cache: "no-store",
  }));
});
