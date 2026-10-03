/* Zero Pages service-worker cleanup.
 *
 * Zero no longer proxies API requests through Render. The scanner's browser
 * engine talks directly to the public exchange APIs. If an older Zero service
 * worker is still registered in a browser, this worker unregisters itself so
 * the old Render proxy cannot intercept requests.
 */
self.addEventListener("install", event => {
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    await self.clients.claim();
    await self.registration.unregister();
  })());
});

self.addEventListener("fetch", event => {
  // Intentionally do not intercept requests.
});
