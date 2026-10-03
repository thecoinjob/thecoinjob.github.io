/* Zero GitHub browser fallback: when market-cap providers are unavailable, enrich the turnover-selected board directly. */
(() => {
  "use strict";
  const original = window.ZeroBrowserData?.snapshot;
  if (typeof original !== "function") return;

  const LIMIT = 32;
  const ENDPOINTS = {
    bybit: "https://api.bybit.com",
    binance: "https://fapi.binance.com",
  };

  async function topTurnoverSymbols(exchange) {
    const url = exchange === "binance"
      ? `${ENDPOINTS.binance}/fapi/v1/ticker/24hr`
      : `${ENDPOINTS.bybit}/v5/market/tickers?category=linear`;
    try {
      const response = await fetch(url, { cache: "no-store", headers: { Accept: "application/json" } });
      if (!response.ok) return [];
      const payload = await response.json();
      const rows = exchange === "binance"
        ? (Array.isArray(payload) ? payload : []).map(x => ({
            symbol: String(x?.symbol || "").toUpperCase(),
            turnover: Number(x?.quoteVolume),
          }))
        : (payload?.result?.list || []).map(x => ({
            symbol: String(x?.symbol || "").toUpperCase(),
            turnover: Number(x?.turnover24h),
          }));
      return rows
        .filter(x => /USDT$/.test(x.symbol) && Number.isFinite(x.turnover) && x.turnover > 0)
        .sort((a, b) => b.turnover - a.turnover)
        .slice(0, LIMIT)
        .map(x => x.symbol);
    } catch (_) {
      return [];
    }
  }

  window.ZeroBrowserData.snapshot = async function patchedSnapshot(options = {}) {
    const result = await original(options);
    if (options.symbols?.length) return result;
    if (Array.isArray(result?.rows) && result.rows.some(row => row?.data_status === "LIVE")) return result;
    const capUnavailable = result?.market_cap_status === "UNAVAILABLE"
      || result?.fallback_mode === "turnover_top32"
      || Number(result?.market_cap_coverage || 0) < 0.25;
    if (!capUnavailable) return result;

    const symbols = await topTurnoverSymbols(options.exchange === "binance" ? "binance" : "bybit");
    if (!symbols.length) return result;

    const direct = await original({
      exchange: options.exchange === "binance" ? "binance" : "bybit",
      symbols,
      force: true,
    });
    return {
      ...direct,
      fallback_mode: "turnover_top32",
      market_cap_status: "UNAVAILABLE",
      market_cap_coverage: result.market_cap_coverage || 0,
      fallback_reason: "Market-cap providers unavailable; board enriched directly from the top 32 Bybit/Binance perpetuals by 24h turnover.",
    };
  };
})();
