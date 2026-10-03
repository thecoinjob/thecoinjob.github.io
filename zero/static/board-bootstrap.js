/* Zero board bootstrap: render the screen payload immediately. The main app used to wait for optional watch/enrichment requests before committing the first board snapshot. */
(() => {
  "use strict";
  let busy = false;
  async function bootstrap() {
    if (busy || !window.ZeroBrowserEngine || typeof api !== "function" || typeof renderLastSnapshot !== "function") return;
    busy = true;
    try {
      const exchange = typeof state === "object" && state.exchange ? state.exchange : "bybit";
      const response = await api(`/api/screen/${exchange}?bootstrap=1`, {cache:"no-store"});
      if (!response || !Array.isArray(response.main_board) || !response.main_board.length) return;
      if (typeof snapshotRequest !== "undefined") snapshotRequest++;
      if (typeof watchRows !== "undefined") watchRows = new Map();
      if (typeof sharedSnapshot !== "undefined") sharedSnapshot = response;
      renderLastSnapshot(true);
      const status = document.getElementById("status");
      if (status) status.textContent = `${exchange.toUpperCase()} | ${response.market_count || 0} markets | BOARD LIVE | Bootstrap | Refresh: 10s`;
    } catch (_) {
      // The normal app loader remains responsible for reporting its own errors.
    } finally {
      busy = false;
    }
  }
  setTimeout(bootstrap, 1500);
  setTimeout(bootstrap, 7000);
})();
