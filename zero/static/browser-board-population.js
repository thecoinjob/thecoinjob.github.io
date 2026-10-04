/* Zero board population bridge: keep board existence independent of market-cap enrichment. */
window.ZeroBrowserBoard = (() => {
  const KEY = "zero-scanner.browser-board.v4";
  const FOUR_HOURS = 4 * 60 * 60 * 1000;
  const DEFAULTS = ["ETH", "SOL", "BNB", "XRP", "HYPE", "ZEC", "DOGE", "SUI", "BCH", "LINK", "ADA", "LTC"].map(base => base + "USDT");
  const TF = ["5m", "15m", "1h", "4h", "24h"];
  const metrics = ["change", "oi", "volume"].flatMap(prefix => TF.map(tf => `${prefix}_${tf}_pct`));
  const filterKeys = ["min_market_cap_usd", "max_market_cap_usd", "min_turnover_24h_pct", ...metrics.flatMap(key => ["min_" + key, "max_" + key])];
  const validSymbol = symbol => typeof symbol === "string" && /^[A-Z0-9\u4e00-\u9fff]{1,40}USDT$/.test(symbol);
  const unique = values => [...new Set(Array.isArray(values) ? values.filter(validSymbol) : [])];
  function validateFilters(filters) {
    const result = {};
    for (const [key, value] of Object.entries(filters || {})) {
      if (!filterKeys.includes(key)) throw new Error("Unknown filter");
      if (value == null) continue;
      if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("Enter a number or leave the field blank.");
      if (["min_market_cap_usd", "max_market_cap_usd", "min_turnover_24h_pct"].includes(key) && value < 0) throw new Error("Market cap and turnover cannot be negative.");
      result[key] = value;
    }
    result.min_market_cap_usd ??= 0;
    result.min_turnover_24h_pct ??= 0;
    return result;
  }
  function defaultPreset(mode) {
    const filters = {min_market_cap_usd: 50000000, min_turnover_24h_pct: mode === "neutral" ? 3 : 0.5};
    if (mode !== "neutral") Object.assign(filters, {min_volume_15m_pct: 10, ...(mode === "bullish" ? {min_change_15m_pct: 0.1} : {max_change_15m_pct: -0.1})});
    return filters;
  }
  function fresh(row, now) {
    return row && row.data_status === "LIVE" && Number(row.observed_at_unix) > 0 && Number(row.market_data_time_unix) > 0
      && now - row.observed_at_unix * 1000 <= 180000 && now - row.market_data_time_unix * 1000 <= 180000;
  }
  function readingsPass(row, filters, now) {
    if (!fresh(row, now)) return false;
    return metrics.every(key => {
      const low = filters["min_" + key], high = filters["max_" + key];
      if (low == null && high == null) return true;
      if (typeof row[key] !== "number" || !Number.isFinite(row[key])) return false;
      if (key.startsWith("oi_") && (row.oi_status !== "CURRENT" || !(row.oi_reference_time_ms > 0) || now - row.oi_reference_time_ms > 600000)) return false;
      return (low == null || row[key] >= low) && (high == null || row[key] <= high);
    });
  }
  function create(storage) {
    let data;
    try { data = JSON.parse(storage.getItem(KEY) || "null"); } catch (_) {}
    if (!data || typeof data !== "object" || Array.isArray(data)) data = {};
    if (!["neutral", "bullish", "bearish"].includes(data.direction)) data.direction = "neutral";
    try { data.filters = validateFilters(data.filters || defaultPreset(data.direction)); } catch (_) { data.filters = defaultPreset(data.direction); }
    if (!data.presets || typeof data.presets !== "object" || Array.isArray(data.presets)) data.presets = {};
    for (const mode of ["neutral", "bullish", "bearish"]) {
      try { data.presets[mode] = validateFilters(data.presets[mode] || (mode === "neutral" ? data.filters : defaultPreset(mode))); } catch (_) { data.presets[mode] = defaultPreset(mode); }
    }
    if (!data.exchanges || typeof data.exchanges !== "object" || Array.isArray(data.exchanges)) data.exchanges = {};
    let persistent = true;
    function save() { try { storage.setItem(KEY, JSON.stringify(data)); } catch (_) { persistent = false; } }
    function board(exchange) {
      if (!["bybit", "binance"].includes(exchange)) throw new Error("Unsupported exchange");
      let entry = data.exchanges[exchange];
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) entry = {};
      entry.saved = unique(entry.saved == null ? DEFAULTS : entry.saved).filter(symbol => symbol !== "BTCUSDT").slice(0, 32);
      entry.pins = unique(entry.pins).filter(symbol => entry.saved.includes(symbol));
      if (!entry.movers || typeof entry.movers !== "object" || Array.isArray(entry.movers)) entry.movers = {};
      if (!entry.removed || typeof entry.removed !== "object" || Array.isArray(entry.removed)) entry.removed = {};
      data.exchanges[exchange] = entry;
      return entry;
    }
    function automaticRows(rows, now) {
      return rows.filter(row => validSymbol(row.symbol) && fresh(row, now) && row.symbol !== "BTCUSDT")
        .sort((a, b) => (Number(b.turnover_24h) || 0) - (Number(a.turnover_24h) || 0));
    }
    function visible(rows, exchange, now = Date.now(), screenMode = false) {
      const entry = board(exchange);
      const inputRows = Array.isArray(rows) ? rows : [];
      const bySymbol = new Map(inputRows.filter(r => validSymbol(r.symbol)).map(r => [r.symbol, r]));
      if (screenMode) {
        /* A turnover fallback can be either PARTIAL (ticker-only) or LIVE (detail
           enrichment succeeded but market-cap coverage is unavailable). Both must
           remain visible; otherwise the normal retention rules collapse the board
           back to the saved list before the rest of the scanner can use the rows. */
        const partial = [...bySymbol.values()].filter(row => row.data_status === "PARTIAL");
        const fallbackLive = [...bySymbol.values()].filter(row => row.data_status === "LIVE" && row.market_cap_usd == null);
        const fallbackRows = partial.length ? partial : fallbackLive;
        if (fallbackRows.length) {
          const btc = bySymbol.get("BTCUSDT");
          const automatic = fallbackRows.filter(row => row.symbol !== "BTCUSDT")
            .sort((a, b) => (Number(b.turnover_24h) || 0) - (Number(a.turnover_24h) || 0)).slice(0, 31);
          const output = btc ? [btc, ...automatic] : automatic.slice(0, 32);
          return output.map((row, index) => ({...row, pinned_order: index === 0 ? 0 : null, automatic_mover: row.symbol !== "BTCUSDT" && !entry.saved.includes(row.symbol), retained_on_board: true}));
        }
        return retainedVisible(inputRows, exchange, now);
      }
      const symbols = unique(["BTCUSDT", ...entry.saved, ...Object.keys(entry.movers)]);
      return symbols.flatMap(symbol => {
        const row = bySymbol.get(symbol);
        if (!row) return [];
        if (entry.removed[symbol] > now && symbol !== "BTCUSDT") return [];
        const pin = entry.pins.indexOf(symbol);
        if (symbol !== "BTCUSDT" && pin < 0 && !readingsPass(row, data.filters, now)) return [];
        return [{...row, pinned_order: pin >= 0 ? pin : null, automatic_mover: !entry.saved.includes(symbol) && symbol !== "BTCUSDT", retained_on_board: true}];
      });
    }
    function retainedVisible(rows, exchange, now) {
      const entry = board(exchange);
      const output = [];
      const facts = new Map((Array.isArray(rows) ? rows : []).map(row => [row.symbol,row]));
      const symbols = unique(["BTCUSDT",...entry.pins,...Object.keys(entry.movers)]);
      for (const symbol of symbols) {
        const row = facts.get(symbol);
        if (!row || (entry.removed[symbol] > now && symbol !== "BTCUSDT")) continue;
        const pin = entry.pins.indexOf(symbol);
        if (symbol !== "BTCUSDT" && pin < 0 && !readingsPass(row, data.filters, now)) continue;
        output.push({...row,pinned_order:pin >= 0 ? pin : null,automatic_mover:!entry.saved.includes(symbol),retained_on_board:true});
      }
      return output;
    }
    function retainedSymbols(exchange) { return Object.keys(board(exchange).movers).filter(validSymbol); }
    function add(symbol, exchange) {
      symbol = String(symbol || "").toUpperCase();
      if (!validSymbol(symbol)) throw new Error("Invalid symbol");
      const entry = board(exchange);
      if (symbol !== "BTCUSDT" && !entry.saved.includes(symbol)) {
        if (entry.saved.length >= 32) throw new Error("This browser can save 32 coins plus BTC. Remove one before adding another.");
        entry.saved.push(symbol);
      }
      delete entry.movers[symbol]; delete entry.removed[symbol]; save();
    }
    function pin(symbol, exchange, pinned) {
      symbol = String(symbol || "").toUpperCase();
      if (symbol === "BTCUSDT") return;
      if (pinned) {
        add(symbol, exchange);
        const entry = board(exchange); if (!entry.pins.includes(symbol)) entry.pins.push(symbol);
      } else board(exchange).pins = board(exchange).pins.filter(item => item !== symbol);
      save();
    }
    function remove(symbol, exchange, now = Date.now()) {
      symbol = String(symbol || "").toUpperCase();
      if (symbol === "BTCUSDT") return;
      const entry = board(exchange);
      entry.saved = entry.saved.filter(item => item !== symbol);
      entry.pins = entry.pins.filter(item => item !== symbol);
      delete entry.movers[symbol]; entry.removed[symbol] = now + FOUR_HOURS; save();
    }
    function setFilters(filters) { data.filters = validateFilters(filters); if (data.direction === "neutral") data.presets.neutral = {...data.filters}; save(); }
    function setDirection(mode) { if (!["neutral", "bullish", "bearish"].includes(mode)) throw new Error("Unsupported setup direction"); data.direction = mode; data.filters = {...data.presets[mode]}; save(); }
    function savePreset(filters) { const valid = validateFilters(filters); data.presets[data.direction] = {...valid}; data.filters = {...valid}; save(); }
    function watchSymbols(exchange) { return unique(board(exchange).saved).filter(symbol => symbol !== "BTCUSDT").slice(0, 64); }
    save();
    return {visible, retainedSymbols, add, pin, remove, setFilters, setDirection, savePreset, direction: () => data.direction, defaultFilters: () => defaultPreset(data.direction), watchSymbols, board, filters: () => ({...data.filters}), persistent: () => persistent};
  }
  return {create, KEY, filterKeys, validateFilters};
})();
