/* Personal settings live in this browser. This module never calls the server. */
window.ZeroBrowserBoard = (() => {
  const KEY = "zero-scanner.browser-board.v4";
  const FOUR_HOURS = 4 * 60 * 60 * 1000;
  const DEFAULTS = ["ETH", "SOL", "BNB", "XRP", "HYPE", "ZEC", "DOGE", "SUI", "BCH", "LINK", "ADA", "LTC"].map(base => base + "USDT");
  const validSymbol = symbol => typeof symbol === "string" && /^[A-Z0-9\u4e00-\u9fff]{1,40}USDT$/.test(symbol);
  const unique = values => [...new Set(Array.isArray(values) ? values.filter(validSymbol) : [])];
  const finite = (value, fallback) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
  const TF = ["5m", "15m", "1h", "4h", "24h"];
  const metrics = ["change", "oi", "volume"].flatMap(prefix => TF.map(tf => `${prefix}_${tf}_pct`));
  const filterKeys = ["min_market_cap_usd", "max_market_cap_usd", "min_turnover_24h_pct", ...metrics.flatMap(key => ["min_" + key, "max_" + key])];
  function validateFilters(filters) {
    const result = {};
    for (const [key, value] of Object.entries(filters)) {
      if (!filterKeys.includes(key)) throw new Error("Unknown filter");
      if (value == null) continue;
      if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("Enter a number or leave the field blank.");
      if (["min_market_cap_usd", "max_market_cap_usd", "min_turnover_24h_pct"].includes(key) && value < 0) throw new Error("Market cap and turnover cannot be negative.");
      result[key] = value;
    }
    for (const key of ["market_cap_usd", ...metrics]) {
      if (result["min_" + key] != null && result["max_" + key] != null && result["min_" + key] > result["max_" + key]) throw new Error("A minimum cannot exceed its maximum.");
    }
    result.min_market_cap_usd ??= 0;
    result.min_turnover_24h_pct ??= 0;
    return result;
  }
  function readingsPass(row, filters, now) {
    if (row.data_status !== "LIVE" || !(row.observed_at_unix > 0) || !(row.market_data_time_unix > 0)
      || now - row.observed_at_unix * 1000 > 180000 || now - row.market_data_time_unix * 1000 > 180000) return false;
    return metrics.every(key => {
      const low = filters["min_" + key], high = filters["max_" + key];
      if (low == null && high == null) return true;
      if (typeof row[key] !== "number" || !Number.isFinite(row[key])) return false;
      if (key.startsWith("oi_") && (row.oi_status !== "CURRENT" || !(row.oi_reference_time_ms > 0) || now - row.oi_reference_time_ms > 600000)) return false;
      return (low == null || row[key] >= low) && (high == null || row[key] <= high);
    });
  }
  function defaultPreset(mode) {
    const filters = {min_market_cap_usd: 50000000, min_turnover_24h_pct: mode === "neutral" ? 3 : 0.5};
    if (mode !== "neutral") Object.assign(filters, {min_volume_15m_pct:10, ...(mode === "bullish" ? {min_change_15m_pct:0.1} : {max_change_15m_pct:-0.1})});
    return filters;
  }
  function create(storage) {
    let data;
    try { data = JSON.parse(storage.getItem(KEY) || storage.getItem("zero-scanner.browser-board.v3") || storage.getItem("zero-scanner.browser-board.v2") || storage.getItem("zero-scanner.browser-board.v1") || "null"); } catch (_) {}
    if (!data || typeof data !== "object" || Array.isArray(data)) data = {};
    try { data.filters = validateFilters(data.filters || {min_market_cap_usd: 50_000_000, min_turnover_24h_pct: 3}); }
    catch (_) { data.filters = {min_market_cap_usd: 50_000_000, min_turnover_24h_pct: 3}; }
    if (!["neutral", "bullish", "bearish"].includes(data.direction)) data.direction = "neutral";
    if (!data.presets || typeof data.presets !== "object" || Array.isArray(data.presets)) data.presets = {};
    for (const mode of ["neutral", "bullish", "bearish"]) {
      try { data.presets[mode] = validateFilters(data.presets[mode] || (mode === "neutral" ? data.filters : defaultPreset(mode))); }
      catch (_) { data.presets[mode] = defaultPreset(mode); }
    }
    if (!data.directionDefaultsV2) {
      for (const mode of ["bullish", "bearish"]) {
        const old = {min_market_cap_usd:50000000,min_turnover_24h_pct:0.5,min_volume_15m_pct:30,min_change_15m_pct:mode === "bullish" ? 0.1 : -1,max_change_15m_pct:mode === "bullish" ? 1 : -0.1};
        const matches = filters => Object.keys(filters).length === Object.keys(old).length && Object.entries(old).every(([key,value]) => filters[key] === value);
        if (matches(data.presets[mode])) data.presets[mode] = defaultPreset(mode);
        if (data.direction === mode && matches(data.filters)) data.filters = defaultPreset(mode);
      }
      data.directionDefaultsV2 = true;
    }
    if (!data.exchanges || typeof data.exchanges !== "object" || Array.isArray(data.exchanges)) data.exchanges = {};
    let persistent = true;
    function save() {
      try { storage.setItem(KEY, JSON.stringify(data)); } catch (_) { persistent = false; }
    }
    function board(exchange) {
      if (!["bybit", "binance"].includes(exchange)) throw new Error("Unsupported exchange");
      let entry = data.exchanges[exchange];
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) entry = {};
      entry.saved = unique(entry.saved == null ? DEFAULTS : entry.saved).filter(symbol => symbol !== "BTCUSDT").slice(0, 32);
      entry.pins = unique(entry.pins).filter(symbol => entry.saved.includes(symbol));
      for (const key of ["movers", "removed"]) {
        if (!entry[key] || typeof entry[key] !== "object" || Array.isArray(entry[key])) entry[key] = {};
        entry[key] = Object.fromEntries(Object.entries(entry[key])
          .filter(([symbol, stamp]) => validSymbol(symbol) && typeof stamp === "number" && Number.isFinite(stamp) && stamp >= 0)
          .slice(0, key === "movers" ? 32 : 1000));
      }
      data.exchanges[exchange] = entry;
      return entry;
    }
    function eligible(row) {
      return typeof row.market_cap_usd === "number" && row.market_cap_usd > 0
        && typeof row.turnover_24h_pct === "number" && Number.isFinite(row.turnover_24h_pct)
        && row.market_cap_usd <= (data.filters.max_market_cap_usd ?? Infinity)
        && row.market_cap_usd >= data.filters.min_market_cap_usd
        && row.turnover_24h_pct >= data.filters.min_turnover_24h_pct;
    }
    function fresh(row, now) {
      return row.data_status === "LIVE" && row.observed_at_unix > 0 && row.market_data_time_unix > 0
        && now - row.observed_at_unix * 1000 <= 180_000 && now - row.market_data_time_unix * 1000 <= 180_000
        && ["INCREASING", "ACTIVE", "QUIET", "DECREASING"].includes(row.participation_trend);
    }
    function capFallbackSymbols(rows, now) {\n      const withCap = rows.filter(row => typeof row.market_cap_usd === "number" && row.market_cap_usd > 0);\n      const coverageTarget = Math.min(10, Math.max(1, Math.ceil(rows.length * 0.10)));\n      if (withCap.length >= coverageTarget) return new Set();\n      return new Set(rows.filter(row => row.symbol !== "BTCUSDT" && fresh(row, now) && Number.isFinite(row.turnover_24h) && row.turnover_24h > 0)\n        .sort((a,b) => Number(b.turnover_24h) - Number(a.turnover_24h)).slice(0,32).map(row => row.symbol));\n    }\n    function update(rows, exchange, now) {
      const entry = board(exchange);
      for (const [symbol, until] of Object.entries(entry.removed)) if (until <= now) delete entry.removed[symbol];
      for (const row of rows) {
        if (!validSymbol(row.symbol) || row.symbol === "BTCUSDT" || entry.saved.includes(row.symbol) || entry.removed[row.symbol] > now) continue;
        if (!fresh(row, now)) continue;
        const active = ["INCREASING", "ACTIVE"].includes(row.participation_trend);
        const existing = Object.hasOwn(entry.movers, row.symbol);
        if (active && (eligible(row) || fallback.has(row.symbol)) && (existing || Object.keys(entry.movers).length < 32)) {
          entry.movers[row.symbol] = Math.max(entry.movers[row.symbol] || 0, row.observed_at_unix * 1000);
        } else if (existing && !active && now - entry.movers[row.symbol] >= FOUR_HOURS) {
          delete entry.movers[row.symbol];
        }
      }
      save();
    }
    function retainedBoard(exchange) {
      const entry = board(exchange);
      const profile = JSON.stringify([data.direction,Object.entries(data.filters).sort()]);
      if (entry.retentionProfile !== profile) { entry.retentionProfile = profile; entry.retained = {}; entry.silentExcluded = {}; }
      if (!entry.retained || typeof entry.retained !== "object" || Array.isArray(entry.retained)) entry.retained = {};
      return entry;
    }
    function retainedSymbols(exchange) { return Object.keys(retainedBoard(exchange).retained).filter(validSymbol); }
    function retainedVisible(rows, exchange, now) {
      const entry = retainedBoard(exchange);
      for (const [symbol, until] of Object.entries(entry.removed)) if (until <= now) delete entry.removed[symbol];
      entry.silentExcluded ||= {};
      const facts = new Map(rows.map(row => [row.symbol,row]));
      for (const row of rows) {
        if (!validSymbol(row.symbol) || row.symbol === "BTCUSDT" || entry.removed[row.symbol] > now) continue;
        if (entry.silentExcluded[row.symbol]) {
          if (fresh(row,now) && ["INCREASING","ACTIVE"].includes(row.participation_trend)) delete entry.silentExcluded[row.symbol];
          else continue;
        }
        if (entry.pins.includes(row.symbol) && !entry.retained[row.symbol]) entry.retained[row.symbol] = {since:now,quiet:null,row};
        if (!entry.retained[row.symbol] && (eligible(row) || fallback.has(row.symbol)) && readingsPass(row,data.filters,now)) entry.retained[row.symbol] = {since:now,quiet:null,row};
        const held = entry.retained[row.symbol];
        if (!held) continue;
        if (!held.row || row.observed_at_unix >= held.row.observed_at_unix) held.row = row;
        const continuous = held.seen != null && now - held.seen <= 60000;
        if (fresh(row,now)) {
          if (["QUIET","DECREASING"].includes(row.participation_trend)) held.quiet = continuous && held.quiet != null ? held.quiet : now;
          else held.quiet = null;
          held.seen = now;
        } else { held.quiet = null; held.seen = null; }
      }
      const output = [];
      const symbols = unique(["BTCUSDT",...entry.pins,...Object.keys(entry.retained)]);
      for (const symbol of symbols) {
        if (entry.removed[symbol] > now) { delete entry.retained[symbol]; continue; }
        const held = entry.retained[symbol];
        const pin = entry.pins.indexOf(symbol);
        let row = facts.get(symbol) || held?.row;
        if (!row) continue;
        if (held && !facts.has(symbol)) { held.quiet = null; held.seen = null; }
        if (pin < 0 && symbol !== "BTCUSDT" && held && now-held.since >= FOUR_HOURS && held.quiet != null && now-held.quiet >= 900000) {
          delete entry.retained[symbol]; entry.silentExcluded[symbol] = true; continue;
        }
        if (!fresh(row,now)) row = {...row,data_status:"STALE"};
        output.push({...row,pinned_order:pin >= 0 ? pin : null,automatic_mover:!entry.saved.includes(symbol),retained_on_board:!!held});
      }
      save(); return output;
    }
    function visible(rows, exchange, now = Date.now(), screenMode = false) {
      if (screenMode) return retainedVisible(rows,exchange,now);
      update(rows, exchange, now);
      const entry = board(exchange);
      const bySymbol = new Map(rows.map(row => [row.symbol, row]));
      const symbols = unique(["BTCUSDT", ...entry.saved, ...(screenMode ? rows.map(row => row.symbol) : Object.keys(entry.movers))]);
      return symbols.flatMap(symbol => {
        const row = bySymbol.get(symbol);
        if (!row) return [];
        const pin = entry.pins.indexOf(symbol);
        if (symbol !== "BTCUSDT" && pin < 0 && (!eligible(row) && !fallback.has(symbol) || entry.removed[symbol] > now || (screenMode && !readingsPass(row, data.filters, now)))) return [];
        return [{...row, pinned_order: pin >= 0 ? pin : null, automatic_mover: !entry.saved.includes(symbol) && symbol !== "BTCUSDT"}];
      });
    }
    function add(symbol, exchange) {
      if (!validSymbol(symbol)) throw new Error("Invalid symbol");
      const entry = board(exchange);
      if (symbol !== "BTCUSDT" && !entry.saved.includes(symbol)) {
        if (entry.saved.length >= 32) throw new Error("This browser can save 32 coins plus BTC. Remove one before adding another.");
        entry.saved.push(symbol);
      }
      delete entry.movers[symbol]; delete entry.removed[symbol]; save();
    }
    function pin(symbol, exchange, pinned) {
      if (symbol === "BTCUSDT") return;
      if (pinned) add(symbol, exchange);
      const entry = board(exchange);
      if (pinned && !entry.pins.includes(symbol)) entry.pins.push(symbol);
      if (!pinned) entry.pins = entry.pins.filter(item => item !== symbol);
      save();
    }
    function remove(symbol, exchange, now = Date.now()) {
      if (symbol === "BTCUSDT") return;
      const entry = board(exchange);
      entry.saved = entry.saved.filter(item => item !== symbol);
      entry.pins = entry.pins.filter(item => item !== symbol);
      delete entry.movers[symbol]; if (entry.retained) delete entry.retained[symbol]; entry.removed[symbol] = now + FOUR_HOURS; save();
    }
    function setFilters(filters) {
      data.filters = validateFilters(filters);
      if (data.direction === "neutral") data.presets.neutral = {...data.filters};
      save();
    }
    function setDirection(mode) {
      if (!["neutral", "bullish", "bearish"].includes(mode)) throw new Error("Unsupported setup direction");
      data.direction = mode;
      data.filters = {...data.presets[mode]};
      save();
    }
    function savePreset(filters) {
      const valid = validateFilters(filters);
      data.presets[data.direction] = {...valid};
      data.filters = {...valid};
      save();
    }
    function watchSymbols(exchange, screenMode = false) {
      const entry = board(exchange);
      return unique([...entry.saved, ...(screenMode ? [] : Object.keys(entry.movers))]).filter(symbol => symbol !== "BTCUSDT").slice(0, 64);
    }
    save();
    return {visible, retainedSymbols, add, pin, remove, setFilters, setDirection, savePreset, direction: () => data.direction, defaultFilters: () => defaultPreset(data.direction), watchSymbols, board,
      filters: () => ({...data.filters}), persistent: () => persistent};
  }
  return {create, KEY, filterKeys, validateFilters};
})();
