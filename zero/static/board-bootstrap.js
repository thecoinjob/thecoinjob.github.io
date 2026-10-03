/* Zero board bootstrap: render real detailed rows immediately.
   The browser data engine already has a directSnapshot path for an explicit symbol list.
   Use the screen's selected/fallback symbols as the seed, then request them through /api/watch
   so the board receives LIVE rows instead of ticker-only PARTIAL diagnostics. */
(() => {
  "use strict";
  let busy = false;

  async function apiJson(path) {
    const r = await fetch(path, {cache:"no-store"});
    if (!r || !r.ok) return null;
    return await r.json();
  }

  async function bootstrap() {
    if (busy || !window.ZeroBrowserEngine || typeof api !== "function" || typeof renderLastSnapshot !== "function") return;
    busy = true;
    try {
      const exchange = typeof state === "object" && state.exchange ? state.exchange : "bybit";
      const screen = await apiJson(`/api/screen/${exchange}?bootstrap=1`);
      if (!screen || !Array.isArray(screen.main_board) || !screen.main_board.length) return;

      const seed = [...new Set(screen.main_board.map(r => r && r.symbol).filter(Boolean))].slice(0, 32);
      let response = screen;

      if (seed.length) {
        try {
          const detailed = await apiJson(`/api/watch/${exchange}?symbols=${encodeURIComponent(seed.join(","))}&bootstrap=detail`);
          if (detailed && Array.isArray(detailed.rows) && detailed.rows.length) {
            response = {
              ...screen,
              main_board: detailed.rows,
              retained_rows: detailed.rows,
              screen: {
                ...(screen.screen || {}),
                fallback_mode: "direct-detail-bootstrap",
                fresh_count: detailed.rows.filter(r => r && r.data_status === "LIVE").length,
                matched_count: detailed.rows.filter(r => r && r.data_status === "LIVE").length,
                error: null
              }
            };
          }
        } catch (_) {}
      }

      if (!Array.isArray(response.main_board) || !response.main_board.length) return;
      if (typeof snapshotRequest !== "undefined") snapshotRequest++;
      if (typeof watchRows !== "undefined") watchRows = new Map();
      if (typeof sharedSnapshot !== "undefined") sharedSnapshot = response;
      renderLastSnapshot(true);
      const status = document.getElementById("status");
      if (status) status.textContent = `${exchange.toUpperCase()} | ${response.market_count || 0} markets | BOARD LIVE | Detailed Bootstrap | Refresh: 10s`;
    } catch (_) {
      // The normal app loader remains responsible for reporting its own errors.
    } finally {
      busy = false;
    }
  }

  setTimeout(bootstrap, 1500);
  setTimeout(bootstrap, 12000);
})();
