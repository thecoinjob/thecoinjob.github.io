/* GitHub Pages: turn the turnover fallback rows into full scanner rows. */
(() => {
  "use strict";
  const previousFetch = window.fetch.bind(window);
  const BATCH = 8;
  const json = value => new Response(JSON.stringify(value), { status: 200, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

  async function enrichScreen(url, payload) {
    const board = Array.isArray(payload?.main_board) ? payload.main_board : [];
    const partial = board.filter(row => row?.data_status === "PARTIAL");
    if (!partial.length) return payload;

    const exchange = payload.exchange || new URL(url, location.href).pathname.split("/").filter(Boolean)[2] || "bybit";
    const enriched = [];
    for (let i = 0; i < partial.length; i += BATCH) {
      const symbols = partial.slice(i, i + BATCH).map(row => row.symbol).filter(Boolean);
      try {
        const response = await previousFetch(`/api/watch/${exchange}?symbols=${encodeURIComponent(symbols.join(","))}`);
        if (!response.ok) continue;
        const data = await response.json();
        if (Array.isArray(data?.rows)) enriched.push(...data.rows);
      } catch (_) {}
    }

    if (!enriched.length) return payload;
    const bySymbol = new Map(enriched.filter(row => row?.symbol).map(row => [row.symbol, row]));
    const merged = board.map(row => bySymbol.get(row.symbol) || row);
    const fresh = merged.filter(row => row?.data_status === "LIVE").length;
    return {
      ...payload,
      main_board: merged,
      retained_rows: merged,
      screen: {
        ...(payload.screen || {}),
        fallback_mode: "turnover_top32_enriched",
        fresh_count: fresh,
        matched_count: fresh,
        error: null,
      },
    };
  }

  window.fetch = async function(input, init) {
    const raw = typeof input === "string" ? input : input?.url || "";
    const url = new URL(raw, location.href);
    if (url.pathname.startsWith("/api/screen/")) {
      const response = await previousFetch(input, init);
      if (!response.ok) return response;
      try {
        const payload = await response.clone().json();
        const merged = await enrichScreen(url.toString(), payload);
        return json(merged);
      } catch (_) {
        return response;
      }
    }
    return previousFetch(input, init);
  };

  /* browser-board-population is loaded later. Once available, let a fully enriched
     turnover fallback remain visible instead of collapsing back to the saved 12-coin set. */
  function installBoardFallback() {
    const board = window.ZeroBrowserBoard;
    if (!board?.create) return setTimeout(installBoardFallback, 0);
    if (board.create.__tcjFallbackWrapped) return;
    const originalCreate = board.create;
    const wrappedCreate = function(storage) {
      const instance = originalCreate(storage);
      const originalVisible = instance.visible;
      instance.visible = function(rows, exchange, now = Date.now(), screenMode = false) {
        const fallbackLive = screenMode && Array.isArray(rows)
          && rows.length > 1
          && rows.some(row => row?.data_status === "LIVE")
          && rows.every(row => row?.market_cap_usd == null);
        if (fallbackLive) {
          return rows
            .filter(row => row?.symbol && row.symbol !== "")
            .sort((a, b) => (Number(b.turnover_24h) || 0) - (Number(a.turnover_24h) || 0))
            .slice(0, 32)
            .map((row, index) => ({
              ...row,
              pinned_order: row.symbol === "BTCUSDT" ? 0 : null,
              automatic_mover: row.symbol !== "BTCUSDT",
              retained_on_board: true,
            }));
        }
        return originalVisible.call(instance, rows, exchange, now, screenMode);
      };
      return instance;
    };
    wrappedCreate.__tcjFallbackWrapped = true;
    board.create = wrappedCreate;
  }
  installBoardFallback();
})();
