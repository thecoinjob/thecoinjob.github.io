/* Zero browser recovery: keep the scanner usable when public market-cap providers fail. */
(() => {
  "use strict";
  const nativeFetch = window.fetch.bind(window);
  const originalCreate = window.ZeroBrowserBoard?.create;
  let fallbackInflight = null;

  async function turnoverTop(exchange, limit = 32) {
    const url = exchange === "binance"
      ? "https://fapi.binance.com/fapi/v1/ticker/24hr"
      : "https://api.bybit.com/v5/market/tickers?category=linear";
    const response = await nativeFetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error(`Exchange ticker request failed: HTTP ${response.status}`);
    const payload = await response.json();
    const list = exchange === "binance" ? (Array.isArray(payload) ? payload : []) : (payload?.result?.list || []);
    return list
      .filter(row => /USDT$/.test(String(row.symbol || "")))
      .map(row => ({
        symbol: String(row.symbol).toUpperCase(),
        turnover: Number(exchange === "binance" ? row.quoteVolume : row.turnover24h) || 0,
      }))
      .filter(row => row.turnover > 0)
      .sort((a, b) => b.turnover - a.turnover)
      .slice(0, limit)
      .map(row => row.symbol);
  }

  async function buildFallback(exchange) {
    if (fallbackInflight) return fallbackInflight;
    fallbackInflight = (async () => {
      const symbols = await turnoverTop(exchange, 32);
      const snap = await window.ZeroBrowserData.snapshot({ exchange, symbols, force: true });
      const rows = (snap.rows || []).map(row => ({
        ...row,
        zero_market_cap_fallback: true,
        market_cap_status: "UNAVAILABLE",
        fallback_reason: "Market-cap providers unavailable; selected from exchange 24h turnover.",
      }));
      return { symbols, rows };
    })().finally(() => { fallbackInflight = null; });
    return fallbackInflight;
  }

  window.fetch = async function(input, init) {
    const url = typeof input === "string" ? input : input?.url || "";
    const parsed = new URL(url, location.href);
    if (parsed.pathname === "/api/screen") {
      const response = await nativeFetch(input, init);
      let data;
      try { data = await response.clone().json(); } catch (_) { return response; }
      if (data?.main_board?.length || !(Number(data?.market_count) > 0)) return response;
      try {
        const fallback = await buildFallback(parsed.pathname.includes("binance") ? "binance" : (parsed.searchParams.get("exchange") || "bybit"));
        return new Response(JSON.stringify({
          ...data,
          main_board: fallback.rows,
          retained_rows: fallback.rows,
          discovery_candidates: fallback.rows,
          market_cap_status: { source: "unavailable", coin_count: 0 },
          fallback_mode: "turnover_top32",
          fallback_symbols: fallback.symbols,
          screen: { ...(data.screen || {}), eligible_count: fallback.rows.length, fresh_count: fallback.rows.length, matched_count: fallback.rows.length, missing_market_caps: fallback.rows.length },
        }), { status: 200, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
      } catch (_) {
        return response;
      }
    }
    return nativeFetch(input, init);
  };

  if (originalCreate) {
    window.ZeroBrowserBoard.create = function(storage) {
      const board = originalCreate(storage);
      const originalVisible = board.visible;
      board.visible = function(rows, exchange, now, screenMode) {
        const fallbackRows = screenMode ? rows.filter(row => row.zero_market_cap_fallback) : [];
        const normalRows = fallbackRows.length ? rows.filter(row => !row.zero_market_cap_fallback) : rows;
        const visible = originalVisible(normalRows, exchange, now, screenMode);
        if (!fallbackRows.length) return visible;
        const existing = new Set(visible.map(row => row.symbol));
        const extras = fallbackRows
          .filter(row => !existing.has(row.symbol))
          .filter(row => row.data_status === "LIVE")
          .map(row => ({ ...row, automatic_mover: true, retained_on_board: false, pinned_order: null }));
        return [...visible, ...extras];
      };
      return board;
    };
  }
})();
