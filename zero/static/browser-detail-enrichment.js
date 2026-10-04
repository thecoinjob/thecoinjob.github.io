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
})();
