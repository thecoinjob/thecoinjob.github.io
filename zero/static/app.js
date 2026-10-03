const REFRESH_SECONDS = 10;
const TRADINGVIEW_CHART_LAYOUT_ID = "bxjAYEj4";
const SORT_STORAGE_KEY = "0scanner.sort.v1";
const PARTICIPATION_HISTORY_KEY = "0scan1.participation-transitions.v1";
const COLUMN_STORAGE_KEY = "0scanner.columns.v1";
const PRICE_COLUMN_DEFS = [
  ["change_5m_pct", "5M"],
  ["change_15m_pct", "15M"],
  ["change_1h_pct", "1H"],
  ["change_4h_pct", "4H"],
  ["change_24h_pct", "1D"],
];
const OI_COLUMN_DEFS = [
  ["oi_5m_pct", "5M"],
  ["oi_15m_pct", "15M"],
  ["oi_1h_pct", "1H"],
  ["oi_4h_pct", "4H"],
  ["oi_24h_pct", "1D"],
];
const VOLUME_COLUMN_DEFS = [
  ["volume_5m_pct", "5M"], ["volume_15m_pct", "15M"], ["volume_1h_pct", "1H"],
  ["volume_4h_pct", "4H"], ["volume_24h_pct", "1D"],
];
const DEFAULT_COLUMN_PREFS = {
  price: ["change_5m_pct", "change_15m_pct"],
  oi: ["oi_5m_pct", "oi_15m_pct"],
  volume: ["volume_15m_pct", "volume_1h_pct"],
};
const SYMBOL_ALIASES = {
  "币安人生": "BIANRENSHENG",
  "币安人生USDT": "BIANRENSHENGUSDT",
  BINANCELIFE: "BIANRENSHENG",
  BINANCELIFEUSDT: "BIANRENSHENGUSDT",
};

const state = {
  exchange: loadExchange(),
  controlTf: loadControlTf(),
  controlFocus: loadControlFocus(),
  controlRows: {},
  markets: [],
  searchSymbol: null,
  searchRow: null,
  searchError: "",
  timer: null,
  sort: loadSortState(),
  rmTie: loadRmTie(),
  participationHistory: loadParticipationHistory(),
  columnPrefs: loadColumnPrefs(),
  discoverySettings: { min_market_cap_usd: 50000000, min_turnover_24h_pct: 3 },
};

const columns = [
  ["symbol", "SYMBOL", "symbol"],
  ["price", "PRICE", "number"],
  ["change_5m_pct", "5M", "number"],
  ["change_15m_pct", "15M", "number"],
  ["change_1h_pct", "1H", "number"],
  ["change_4h_pct", "4H", "number"],
  ["change_24h_pct", "24H", "number"],
  ["rm_value", "RM", "number"],
  ["expansion_ratio", "EXPANSION", "number"],
  ["oi_5m_pct", "OI 5M", "number"],
  ["oi_15m_pct", "OI 15M", "number"],
  ["oi_1h_pct", "OI 1H", "number"],
  ["oi_4h_pct", "OI 4H", "number"],
  ["oi_24h_pct", "OI 24H", "number"],
  ["crowd_rank", "CROWD", "number"],
  ["control_pair", "CONTROL", "pair"],
  ["participation_recent", "RECENTLY INCREASING", "recent"],
];

for (const [key, label] of VOLUME_COLUMN_DEFS) columns.push([key, `VOL ${label}`, "number"]);

const HEADER_TOOLTIPS = {
  price: "Current perpetual price.",
  oi_5m_pct: "OPEN INTEREST change over 5 minutes.",
  oi_15m_pct: "OPEN INTEREST change over 15 minutes.",
  oi_1h_pct: "OPEN INTEREST change over 1 hour.",
  oi_4h_pct: "OPEN INTEREST change over 4 hours.",
  oi_24h_pct: "OPEN INTEREST change over 24 hours.",
  rm_value: "RM:\nBTC-relative movement over the current 15min move.",
  expansion_ratio: "EXPANSION:\nCurrent rolling 15min price magnitude relative to the median of 20 completed 15min moves.",
  crowd_rank: "CROWD:\nActive-exchange funding and account long-short positioning.",
  control_pair: "Sort by Participation first, then Control on the selected timeframe.",
};

const $ = (id) => document.getElementById(id);
const personalBoard = window.ZeroBrowserBoard.create({
  getItem: key => localStorage.getItem(key), setItem: (key, value) => localStorage.setItem(key, value),
});


function loadRmTie() {
  try { return localStorage.getItem("0scan1.rm-tie.v1") === "weaker" ? "weaker" : "stronger"; }
  catch (_) { return "stronger"; }
}

function loadExchange() {
  try { return localStorage.getItem("0scan1.exchange.v1") === "binance" ? "binance" : "bybit"; }
  catch (_) { return "bybit"; }
}

function loadParticipationHistory() {
  try { const saved = JSON.parse(localStorage.getItem(PARTICIPATION_HISTORY_KEY) || "{}"); return saved && typeof saved === "object" && !Array.isArray(saved) ? saved : {}; }
  catch (_) { return {}; }
}

function trackParticipation(rows, exchange, now = Date.now()) {
  for (const row of rows) {
    const key = exchange + ":" + row.symbol;
    const previous = state.participationHistory[key];
    const trend = row.participation_trend;
    const valid = row.data_status === "LIVE" && now - (row.observed_at_unix || 0) * 1000 <= 180000
      && now - (row.market_data_time_unix || 0) * 1000 <= 180000
      && ["INCREASING", "ACTIVE", "QUIET", "DECREASING"].includes(trend);
    if (!valid) {
      delete state.participationHistory[key];
      row.participation_recent = null;
      continue;
    }
    const continuous = previous && now >= previous.seen && now - previous.seen <= 60000;
    const entered = continuous && previous.trend !== "INCREASING" && trend === "INCREASING";
    const since = trend === "INCREASING" ? (entered ? now : continuous && previous.trend === "INCREASING" ? previous.since : null) : null;
    state.participationHistory[key] = { trend, seen: now, since };
    row.participation_recent = since;
  }
  for (const [key, value] of Object.entries(state.participationHistory)) {
    if (!value || now - value.seen > 60000) delete state.participationHistory[key];
  }
  try { localStorage.setItem(PARTICIPATION_HISTORY_KEY, JSON.stringify(state.participationHistory)); } catch (_) {}
}

function compareRmTie(a, b) {
  const av = a.rm_status === "CURRENT" ? a.rm_value : null;
  const bv = b.rm_status === "CURRENT" ? b.rm_value : null;
  const am = av == null || !Number.isFinite(Number(av));
  const bm = bv == null || !Number.isFinite(Number(bv));
  if (am || bm) return am === bm ? 0 : am ? 1 : -1;
  return state.rmTie === "weaker" ? Number(av) - Number(bv) : Number(bv) - Number(av);
}

function compareRecentlyIncreasing(a, b) {
  const av = a.participation_trend === "INCREASING" ? a.participation_recent : null;
  const bv = b.participation_trend === "INCREASING" ? b.participation_recent : null;
  if (av != null || bv != null) {
    if (av == null) return 1;
    if (bv == null) return -1;
    if (av !== bv) return bv - av;
  }
  return compareControlPairs(a, b, "desc");
}

function syncSortingControls() {
  $("participation-sort").value = (state.sort.group || state.sort.key) === "participation_recent" ? "recent" : (state.sort.group || state.sort.key) === "control_pair" ? "control" : "";
  $("rm-tie").value = state.rmTie;
}

function normalizeColumnKeys(keys, defs, fallback) {
  const requested = Array.isArray(keys) ? keys : [];
  const ordered = defs.map(([key]) => key).filter((key) => requested.includes(key));
  return ordered.length ? ordered : [...fallback];
}

function loadColumnPrefs() {
  try {
    const saved = JSON.parse(localStorage.getItem(COLUMN_STORAGE_KEY) || "null");
    if (saved) {
      return {
        price: normalizeColumnKeys(saved.price, PRICE_COLUMN_DEFS, DEFAULT_COLUMN_PREFS.price),
        oi: normalizeColumnKeys(saved.oi, OI_COLUMN_DEFS, DEFAULT_COLUMN_PREFS.oi),
        volume: Array.isArray(saved.volume) ? VOLUME_COLUMN_DEFS.map(([key]) => key).filter(key => saved.volume.includes(key)) : [...DEFAULT_COLUMN_PREFS.volume],
      };
    }
  } catch (error) {
    // Ignore corrupt local column preferences.
  }
  return { price: [...DEFAULT_COLUMN_PREFS.price], oi: [...DEFAULT_COLUMN_PREFS.oi], volume: [...DEFAULT_COLUMN_PREFS.volume] };
}

function saveColumnPrefs() {
  localStorage.setItem(COLUMN_STORAGE_KEY, JSON.stringify(state.columnPrefs));
}

function selectedPriceColumns() {
  return PRICE_COLUMN_DEFS.filter(([key]) => state.columnPrefs.price.includes(key));
}

function selectedOiColumns() {
  return OI_COLUMN_DEFS.filter(([key]) => state.columnPrefs.oi.includes(key));
}

function selectedVolumeColumns() {
  return VOLUME_COLUMN_DEFS.filter(([key]) => state.columnPrefs.volume.includes(key));
}
function requestedVolumeTimeframes() {
  const keys = new Set(selectedVolumeColumns().map(([key]) => key.split("_")[1]));
  for (const key of Object.keys(personalBoard.filters())) if (/^(min|max)_volume_/.test(key)) keys.add(key.split("_")[2]);
  return [...keys].join(",");
}
function volumeTooltip(key) {
  const label = VOLUME_COLUMN_DEFS.find(([item]) => item === key)?.[1] || "";
  return `${label} traded dollar volume change versus the preceding equal window. +50% means 1.5 times as much trading. It includes buying and selling. 5m/15m/1h use completed minute windows; 4h/1D use completed five-minute windows. Missing history or zero previous volume shows —.`;
}
function primaryOiSortKey() {
  const selected = selectedOiColumns();
  return selected.length ? selected[selected.length - 1][0] : "oi_15m_pct";
}

function loadSortState() {
  try {
    const saved = JSON.parse(localStorage.getItem(SORT_STORAGE_KEY) || "null");
    if (saved && typeof saved.key === "string" && ["asc", "desc", "positive"].includes(saved.dir)) return saved;
  } catch (error) {
    // Ignore corrupt local sort state.
  }
  return { key: null, dir: "desc" };
}

function saveSortState() {
  localStorage.setItem(SORT_STORAGE_KEY, JSON.stringify(state.sort));
}

function pctClass(value) {
  if (value === null || value === undefined) return "pending";
  if (value > 0) return "up";
  if (value < 0) return "down";
  return "";
}

function linkClass(value) {
  if (value === null || value === undefined) return "pending";
  if (value >= 45) return "up";
  if (value <= -20) return "down";
  return "pending";
}

function expansionClass(row) {
  if (row.expansion_status === "RECENT" || row.expansion_status === "HELD") return "held";
  if (row.expansion_level === "SPIKE" || row.expansion_level === "STRONG" || row.expansion_level === "EXPANDING") {
    return row.change_15m_pct >= 0 ? "up" : "down";
  }
  if (row.expansion_level === "BUILDING") return "state";
  return "pending";
}

function oiExpansionClass(row) {
  if (row.oi_expansion_status === "RECENT" || row.oi_expansion_status === "HELD") return "held";
  if (!row.oi_expansion_ratio && row.oi_expansion_ratio !== 0) return "pending";
  if (!row.oi_expansion_meaningful) return "pending";
  if (row.oi_expansion_direction === "up") return "up";
  if (row.oi_expansion_direction === "down") return "down";
  return "state";
}

function stateClass(row) {
  const label = row.state;
  if (row.state_status === "RECENT" || row.state_status === "HELD") return "held";
  if (!label || label === "—" || label === "NO SIGNAL") return "pending";
  if (label.includes("↑")) return "up";
  if (label.includes("↓")) return "down";
  return "state";
}

function heldClass(status) {
  return status === "HELD" || status === "RECENT" ? "held" : "";
}

function fmtPrice(value) {
  if (value === null || value === undefined) return "—";
  if (value >= 1000) return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (value >= 1) return value.toLocaleString(undefined, { maximumFractionDigits: 4 });
  return value.toLocaleString(undefined, { maximumFractionDigits: 8 });
}

function fmtPct(value) {
  if (value === null || value === undefined) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function firstValue(row, keys) {
  for (const key of keys) {
    const value = row[key];
    if (value !== null && value !== undefined) return value;
  }
  return null;
}

function oiMetricValue(row, key) {
  const fallbackKeys = {
    oi_5m_pct: ["oi_5m_pct", "open_interest_5m_pct", "oi5m_pct", "oi5m"],
    oi_15m_pct: ["oi_15m_pct", "open_interest_15m_pct", "oi15m_pct", "oi15m"],
    oi_1h_pct: ["oi_1h_pct", "open_interest_1h_pct", "oi1h_pct", "oi1h"],
    oi_4h_pct: ["oi_4h_pct", "open_interest_4h_pct", "oi4h_pct", "oi4h"],
    oi_24h_pct: ["oi_24h_pct", "open_interest_24h_pct", "oi24h_pct", "oi24h"],
  };
  return firstValue(row, fallbackKeys[key] || [key]);
}

function displayBaseSymbol(row) {
  if (row.base) return row.base;
  return String(row.symbol || "").replace(/USDT$/, "");
}

function recentPrefix(status, age) {
  if (status !== "HELD" && status !== "RECENT") return "";
  const seen = age === null || age === undefined ? "" : `\nSeen ${Math.max(0, Math.round(age))} seconds ago.\n`;
  return `RECENT SIGNAL - no longer current.${seen}`;
}

function tooltipBlock(read, meaning, watch, current = "", prefix = "") {
  const lines = [];
  if (prefix) lines.push(prefix.trim(), "");
  lines.push(`READ: ${read}`, `MEANING: ${meaning}`, `CONTEXT: ${watch}`);
  if (current) lines.push("", current);
  return lines.join("\n");
}

function historyTooltip(current, history) {
  return [
    "CURRENT",
    current,
    "",
    "HISTORY",
    history,
  ].join("\n");
}

function fmtMinutes(value) {
  if (value === null || value === undefined) return "";
  const rounded = Math.max(0, Math.round(Number(value)));
  return `${rounded}m`;
}

function fmtSigned(value) {
  return fmtPct(value);
}

function rmCurrentText(row, memory) {
  const value = memory?.current_value ?? row.rm_value;
  if (row.rm === "BTC FLAT" || memory?.current_valid === false && row.rm_status !== "CURRENT") {
    const last = memory?.last_valid_value ?? row.rm_value;
    return last === null || last === undefined
      ? "BTC is flat. No fresh RM reading is available."
      : `BTC is flat. Last valid RM was ${fmtSigned(last)}.`;
  }
  if (value === null || value === undefined) return "RM is still warming up.";
  if (value >= 0.2) return `RM ${fmtSigned(value)}. Stronger than BTC.`;
  if (value <= -0.2) return `RM ${fmtSigned(value)}. Weaker than BTC.`;
  return `RM ${fmtSigned(value)}. Close to BTC.`;
}

function rmMemoryText(memory) {
  if (!memory || memory.warmup_status !== "ready") return "Not enough recent RM history yet.";
  if (memory.flickering) return `RM crossed positive/negative ${memory.zero_crossings_30m} times in the last 30m.`;
  const start = memory.start_value;
  const end = memory.end_value;
  const minutes = fmtMinutes(memory.trend_minutes);
  if (memory.crossed_positive_minutes_ago !== null && memory.crossed_positive_minutes_ago !== undefined && memory.trend === "rising") {
    return `RM turned positive ${fmtMinutes(memory.crossed_positive_minutes_ago)} ago and has continued improving.`;
  }
  if (memory.trend === "rising") {
    if (memory.quality === "steady") return `RM improved from ${fmtSigned(start)} to ${fmtSigned(end)} over ${minutes}.`;
    return `RM has improved over ${minutes}, but with several reversals.`;
  }
  if (memory.trend === "falling") return `RM weakened from ${fmtSigned(start)} to ${fmtSigned(end)} over ${minutes}.`;
  if (memory.positive_minutes !== null && memory.positive_minutes !== undefined) {
    return `RM has stayed positive but changed little over the last ${minutes}.`;
  }
  if (memory.negative_minutes !== null && memory.negative_minutes !== undefined) {
    return `RM has stayed negative but changed little over the last ${minutes}.`;
  }
  return `RM has been mostly stable over the last ${minutes}.`;
}

function btcLinkZoneText(zone) {
  const labels = {
    strong_link: "Strong BTC relationship",
    linked: "Following BTC reasonably well",
    weak_link: "BTC connection is weak",
    independent: "Mostly independent of BTC",
    opposite: "Moving differently from BTC",
  };
  return labels[zone] || "BTC connection is still warming up";
}

function btcLinkMemoryText(memory) {
  if (!memory || memory.warmup_status !== "ready") return "Not enough recent BTC LINK history yet.";
  if (memory.flickering && memory.relevant_boundary !== null && memory.relevant_boundary !== undefined) {
    return `BTC LINK crossed the ${memory.relevant_boundary} level ${memory.crossings_30m} times in 30m.`;
  }
  const start = Math.round(memory.start_value);
  const end = Math.round(memory.end_value);
  const minutes = fmtMinutes(memory.trend_minutes);
  if (memory.trend === "stable") {
    if (memory.current_zone === "strong_link") return `BTC LINK has remained high for ${minutes}.`;
    if (memory.current_zone === "independent") return `BTC LINK has stayed mostly independent for ${minutes}.`;
    return `BTC LINK has been mostly stable for ${minutes}.`;
  }
  const verb = memory.trend === "rising" ? "rose" : "fell";
  return `BTC LINK ${verb} from ${start} to ${end} over ${minutes}.`;
}

function fmtRatio(value) {
  if (value === null || value === undefined) return "—";
  return `${Number(value).toFixed(1)}x`;
}

function directionWord(direction) {
  if (direction === "up") return "upward";
  if (direction === "down") return "downward";
  return "";
}

function priceCurrentText(row, memory) {
  const level = memory?.current_level || row.expansion_level || "NORMAL";
  const ratio = fmtRatio(memory?.current_ratio ?? row.expansion_ratio);
  const dir = directionWord(memory?.direction);
  if (level === "BUILDING") return `Price momentum is BUILDING at ${ratio} normal.`;
  if (level === "EXPANDING") return `Price is EXPANDING ${dir} at ${ratio} normal.`.replace("  ", " ");
  if (level === "STRONG") return `Price Expansion is STRONG ${dir} at ${ratio} normal.`.replace("  ", " ");
  if (level === "SPIKE") return `Price is SPIKING ${dir} at ${ratio} normal.`.replace("  ", " ");
  return `Price Expansion is NORMAL at ${ratio} normal.`;
}

function priceMemoryText(memory) {
  if (!memory || memory.warmup_status !== "ready") return "Not enough recent Price Expansion history yet.";
  if (memory.failed_building_attempts_60m >= 2) return `${memory.failed_building_attempts_60m} earlier BUILDING attempts faded in the last hour.`;
  if (memory.current_level === "BUILDING" && memory.building_minutes !== null && memory.building_minutes !== undefined) {
    return `Price has been BUILDING for ${fmtMinutes(memory.building_minutes)}.`;
  }
  if (memory.current_level !== "NORMAL" && memory.building_before_expansion_minutes) {
    return `Momentum built for ${fmtMinutes(memory.building_before_expansion_minutes)} before Expansion activated.`;
  }
  if (memory.ratio_trend === "accelerating") {
    return `Expansion increased from ${fmtRatio(memory.ratio_start)} to ${fmtRatio(memory.ratio_current)} over ${fmtMinutes(memory.trend_minutes)}.`;
  }
  if (memory.ratio_trend === "fading") {
    return `Expansion faded from ${fmtRatio(memory.ratio_start)} to ${fmtRatio(memory.ratio_current)} over ${fmtMinutes(memory.trend_minutes)}.`;
  }
  if (memory.gradual_or_sudden === "sudden") return "The move appeared suddenly with little prior BUILDING behavior.";
  return `Expansion has been mostly stable for ${fmtMinutes(memory.trend_minutes)}.`;
}

function oiCurrentText(row, memory) {
  const label = row.oi_interpretation || "OI QUIET";
  if (memory?.meaningful && memory.direction === "up") return "Open interest is increasing unusually fast.";
  if (memory?.meaningful && memory.direction === "down") return "Open interest is falling unusually fast.";
  if (label === "FRESH BUYING") return "Price is expanding upward while OI is increasing.";
  if (label === "FRESH SELLING") return "Price is expanding downward while OI is increasing.";
  if (label === "SHORTS EXITING" || label === "LONGS EXITING") return "Price is expanding while OI is falling.";
  return "OI is quiet.";
}

function oiMemoryText(memory, relation) {
  if (!memory || memory.warmup_status !== "ready") return "Not enough recent OI history yet.";
  if (relation?.price_without_oi_confirmation) return "OI has not shown meaningful expansion during this move.";
  if (memory.oi_lead_to_price_minutes !== null && memory.oi_lead_to_price_minutes !== undefined) {
    return `OI started building ${fmtMinutes(memory.oi_lead_to_price_minutes)} before Price Expansion activated.`;
  }
  if (memory.oi_ahead_of_price) return `Meaningful OI activity began ${fmtMinutes(memory.oi_ahead_minutes)} ago while price remained quiet.`;
  if (memory.meaningful && memory.meaningful_age_minutes !== null && memory.meaningful_age_minutes !== undefined) {
    const action = memory.direction === "down" ? "reduction" : "activity";
    return `Meaningful OI ${action} began ${fmtMinutes(memory.meaningful_age_minutes)} ago.`;
  }
  if (memory.failed_buildup_attempts_60m > 0) return "A previous OI buildup faded before price expanded.";
  return `OI activity has been mostly stable for ${fmtMinutes(memory.trend_minutes)}.`;
}

function metricGrid(values, valueClass = pctClass) {
  const parts = values.map((value, index) => {
    const separator = index ? '<span class="metric-separator">|</span>' : "";
    return `${separator}<span class="metric-value ${valueClass(value)}">${fmtPct(value)}</span>`;
  }).join("");
  return `<div class="metric-series">${parts}</div>`;
}

function expansionDisplay(row) {
  return `<span class="metric-value ${expansionClass(row)}" data-tooltip="${escapeAttr(priceExpansionTooltip(row))}">${row.expansion}</span>`;
}

function participationClass(row) {
  if (row.participation === "BUILDING") return "up";
  if (row.participation === "UNWINDING") return "down";
  if (row.participation === "ACTIVE") return "state";
  if (row.participation === "MISSING") return "pending";
  return "";
}

function participationTooltip(row) {
  if (row.participation_status !== "CURRENT") {
    return `No current participation read. ${row.participation_evidence || "OI — · VOL —"}; both OI and volume history are needed.`;
  }
  const meaning = {
    BUILDING: "More positions are opening and trading volume is high. The move has stronger participation, but this does not identify buyers.",
    UNWINDING: "Positions are closing and trading volume is high. The move may be driven by exits.",
    ACTIVE: "Trading volume is high, but OI is not changing unusually fast. Activity alone does not show new positions.",
    "OI BUILDING": "Positions are opening unusually fast, while trading volume is below its high-activity threshold.",
    "OI REDUCING": "Positions are closing unusually fast, while trading volume is below its high-activity threshold.",
    QUIET: "Neither OI nor trading volume is unusually active compared with its own recent history.",
  };
  return `${meaning[row.participation] || "Participation is still being measured."}\n\n${row.participation_evidence || "OI — · VOL —"}\nOI compares the 15-minute change with the last 20 completed 15-minute periods. VOL compares the last 15 minutes of traded value with the last 20 completed periods. An OI move must also be at least 0.15% to count as unusual.\n15m price: ${fmtPct(row.change_15m_pct)} · 15m OI: ${fmtPct(oiMetricValue(row, "oi_15m_pct"))}`;
}

function participationDisplay(row) {
  return `<div class="reading-stack ${participationClass(row)}" data-tooltip="${escapeAttr(participationTooltip(row))}"><div class="reading-primary">${escapeAttr(row.participation || "MISSING")}</div><div class="reading-evidence">${escapeAttr(row.participation_evidence || "OI — · VOL —")}</div></div>`;
}

function loadControlTf() {
  try { const tf = Number(localStorage.getItem("0scan1.control-tf.v1")); return [15,60,240,1440].includes(tf) ? tf : 15; }
  catch (_) { return 15; }
}
function selectedControl(row) {
  const selected = state.controlRows[row.symbol];
  if (selected) return selected;
  if (state.controlTf === 15) return {control: row.scc_5m_control || "No Control", status: row.scc_5m_status || "MISSING"};
  return {control: "No Control", status: "MISSING"};
}
function controlLine(row) {
  const reading = selectedControl(row);
  if (reading.status === "MISSING") return '<div class="control-line state">🟡 Warming</div>';
  const held = reading.status === "HELD" ? " held" : "";
  const freshness = reading.status === "HELD" ? " · Held" : "";
  if (reading.control === "Bullish Control") return `<div class="control-line up${held}">🟢 Bullish Control${freshness}</div>`;
  if (reading.control === "Bearish Control") return `<div class="control-line down${held}">🔴 Bearish Control${freshness}</div>`;
  return `<div class="control-line pending${held}">⚪ No Control${freshness}</div>`;
}
const CONTROL_FOCUS_OPTIONS = [
  ["", "All combinations"],
  ["bullish:INCREASING", "Bullish + Increasing"], ["bearish:INCREASING", "Bearish + Increasing"],
  ["bullish:ACTIVE", "Bullish + Active"], ["bearish:ACTIVE", "Bearish + Active"],
  ["bullish:QUIET", "Bullish + Quiet"], ["bearish:QUIET", "Bearish + Quiet"],
];
function loadControlFocus() {
  try { const value = localStorage.getItem("0scan1.control-focus.v1") || "";
    return /^(bullish|bearish):(INCREASING|ACTIVE|QUIET)$/.test(value) ? value : "";
  } catch (_) { return ""; }
}
function controlFocusMatch(row) {
  if (!state.controlFocus) return false;
  const [direction, trend] = state.controlFocus.split(":");
  const reading = selectedControl(row);
  return reading.status !== "MISSING" && reading.control === (direction === "bullish" ? "Bullish Control" : "Bearish Control")
    && row.participation_trend === trend;
}
function setControlFocus(value) {
  state.controlFocus = CONTROL_FOCUS_OPTIONS.some(([key]) => key === value) ? value : "";
  try { localStorage.setItem("0scan1.control-focus.v1", state.controlFocus); } catch (_) {}
  state.sort = {key:"control_pair", dir:"desc"};
  saveSortState(); syncSortingControls(); renderLastSnapshot(true);
}
function controlHeader() {
  const options = [[15,"15m"],[60,"1h"],[240,"4h"],[1440,"24h"]].map(([tf,label]) =>
    `<option value="${tf}" ${state.controlTf === tf ? "selected" : ""}>${label}</option>`).join("");
  const focusOptions = CONTROL_FOCUS_OPTIONS.map(([key,label]) => `<option value="${key}" ${state.controlFocus === key ? "selected" : ""}>${label}</option>`).join("");
  return `<th class="col-control"><div class="control-header"><button class="metric-head sortable" data-sort="control_pair" data-type="pair">CONTROL TF:${sortIndicator("control_pair")}</button> <select class="control-tf" aria-label="Control timeframe">${options}</select></div><select class="control-focus" aria-label="Control combination" title="Matching coins come first. Other coins remain below; BTC and pins stay fixed.">${focusOptions}</select></th>`;
}
async function loadSelectedControl(exchange, rows) {
  const tf = state.controlTf;
  const symbols = [...new Set(rows.map(r => r.symbol).concat(state.searchSymbol ? [state.searchSymbol] : []))];
  if (!symbols.length) return;
  const watchIds = window.ZeroControlAlerts ? controlAlerts.active().filter(w=>w.exchange === exchange && w.timeframe === tf).map(w=>w.id) : [];
  try {
    const data = await api(`/api/control/${exchange}?timeframe=${tf}&symbols=${encodeURIComponent(symbols.join(","))}`, {cache:"no-store"});
    observeControlAlertReadings(exchange, tf, data.rows || {}, watchIds);
    if (exchange === state.exchange && tf === state.controlTf) { state.controlRows = data.rows || {}; renderLastSnapshot(); }
  } catch (_) { state.controlRows = Object.fromEntries(Object.entries(state.controlRows).map(([symbol,r]) => [symbol,{...r,status:"HELD"}])); }
}

function participationControlLine(row) {
  const trend = row.participation_trend || "WARMING";
  if (trend === "INCREASING") {
    return '<div class="control-line up">🟢 Participation ↑ Increasing</div>';
  }
  if (trend === "DECREASING") {
    return '<div class="control-line down">🔴 Participation ↓ Decreasing</div>';
  }
  if (trend === "ACTIVE") {
    return '<div class="control-line state">🟡 Participation → Active</div>';
  }
  if (trend === "QUIET") {
    return '<div class="control-line pending">⚪ Participation → Quiet</div>';
  }
  return '<div class="control-line state">🟡 Participation Warming</div>';
}

function controlTooltip(row) {
  const reading = selectedControl(row);
  const detection = {15:"5m",60:"15m",240:"1h",1440:"4h"}[state.controlTf];
  return `SV1: detects using ${detection} candles. Evaluates only the final detection candle at the selected timeframe close.\n${reading.control} · ${reading.status}\nA later evaluated close outside the SCC body establishes Control.\n\n${participationTooltip(row)}`;
}

function controlDisplay(row) {
  return `<div class="control-stack" data-tooltip="${escapeAttr(controlTooltip(row))}">
    ${controlLine(row)}
    ${participationControlLine(row)}
  </div>`;
}

function crowdDisplay(row) {
  const funding = row.funding_rate_pct === null || row.funding_rate_pct === undefined ? "—" : `${Number(row.funding_rate_pct).toFixed(4)}%`;
  const ratio = row.long_short_ratio === null || row.long_short_ratio === undefined ? "—" : Number(row.long_short_ratio).toFixed(2);
  const labels = {
    "Short Squeeze Risk": ["crowd-risk-up", "Price rose while open positions fell. Short exits may help push price higher; liquidation is possible, not confirmed."],
    "Long Squeeze Risk": ["crowd-risk-down", "Price fell while open positions fell. Long exits may help push price lower; liquidation is possible, not confirmed."],
    "Longs Building": ["crowd-building-up", "Price and open positions rose while funding and account ratios lean long. More positions are opening; their side cannot be confirmed from OI alone."],
    "Shorts Building": ["crowd-building-down", "Price fell while open positions rose and positioning leans short. More positions are opening; their side cannot be confirmed from OI alone."],
    "Crowded Long": ["crowd-positioning", "Funding and account ratios lean long. There is no current 15-minute price and OI combination to call a squeeze risk."],
    "Crowded Short": ["crowd-positioning", "Funding and account ratios lean short. There is no current 15-minute price and OI combination to call a squeeze risk."],
    Neutral: ["", "Funding and account ratios do not both show crowded positioning on one side."],
    Missing: ["pending", "Current funding or account positioning is unavailable, so crowd cannot be assessed."],
  };
  const [color, meaning] = labels[row.crowd] || labels.Missing;
  const oiNote = row.oi_status === "CURRENT" && row.oi_expansion_status === "CURRENT"
    ? `15m OI: ${fmtPct(oiMetricValue(row, "oi_15m_pct"))}; unusual OI move: ${row.oi_expansion_meaningful ? "yes" : "no"}.`
    : "Current OI evidence is unavailable; no squeeze call is made from old OI.";
  const tooltip = `${meaning}\n\n15m price: ${fmtPct(row.change_15m_pct)}. ${oiNote}\n${(row.crowd_source || state.exchange).toUpperCase()} funding: ${funding}; account long/short ratio: ${ratio}. Funding shows the cost of holding a side; the account ratio shows how many accounts lean long versus short. Neither proves forced liquidations or aggressive buying.`;
  return `<div class="reading-stack ${color}" data-tooltip="${escapeAttr(tooltip)}"><div class="reading-primary">${escapeAttr(row.crowd || "Missing")}</div><div class="reading-evidence">F ${funding} · L/S ${ratio}</div></div>`;
}

function escapeAttr(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function oiCellTooltip(row) {
  if (row.oi_status !== "CURRENT") return "Open interest is not current. The shown values may be old; wait for a fresh update.";
  return `Open interest is the total number of open contracts. It rose when the percentage is positive and fell when negative. This does not reveal whether buyers or sellers started the move.\n5m ${fmtPct(oiMetricValue(row, "oi_5m_pct"))} · 15m ${fmtPct(oiMetricValue(row, "oi_15m_pct"))} · 1h ${fmtPct(oiMetricValue(row, "oi_1h_pct"))} · 4h ${fmtPct(oiMetricValue(row, "oi_4h_pct"))} · 24h ${fmtPct(oiMetricValue(row, "oi_24h_pct"))}`;
}

function rmTooltip(row) {
  if (row.rm_memory) {
    return historyTooltip(
      rmCurrentText(row, row.rm_memory),
      rmMemoryText(row.rm_memory)
    );
  }
  if ((row.rm_status === "HELD" || row.rm_status === "RECENT") && row.rm_value !== null && row.rm_value !== undefined) {
    const strength = row.rm_value >= 0 ? "stronger" : "weaker";
    const updated = row.rm_age_seconds === null || row.rm_age_seconds === undefined
      ? ""
      : `Last updated: ${Math.max(0, Math.round(row.rm_age_seconds))}s ago`;
    return tooltipBlock(
      `Last valid RM: ${fmtPct(row.rm_value)}.`,
      `This coin was ${strength} than BTC before BTC went flat.`,
      "This is recent context, not a current relative-strength reading.",
      updated
    );
  }
  const prefix = recentPrefix(row.rm_status, row.rm_age_seconds);
  if (row.rm === "BTC FLAT" || row.rm_value === null || row.rm_value === undefined) {
    return tooltipBlock(
      "BTC is flat, so relative strength is not useful right now.",
      "This coin should be judged mainly by its own momentum.",
      "Price Expansion, Open Interest and chart structure.",
      "",
      prefix
    );
  }
  if (row.rm_value >= 0.2) {
    return tooltipBlock(
      "This coin is stronger than BTC.",
      "It is moving harder than BTC in BTC's direction.",
      "If BTC continues, this coin may offer the stronger move.",
      `Current RM: ${fmtPct(row.rm_value)}`,
      prefix
    );
  }
  if (row.rm_value <= -0.2) {
    return tooltipBlock(
      "This coin is weaker than BTC.",
      "It is not responding as strongly to BTC's move.",
      "Current RM is below the negative relative-move threshold.",
      `Current RM: ${fmtPct(row.rm_value)}`,
      prefix
    );
  }
  return tooltipBlock(
    "This coin is moving roughly with BTC.",
    "No clear relative-strength advantage.",
    "BTC direction and the coin's own Expansion.",
    `Current RM: ${fmtPct(row.rm_value)}`,
    prefix
  );
}

function btcLinkTooltip(row) {
  if (row.btc_link_memory) {
    const score = row.btc_link_memory.current_value;
    const current = score === null || score === undefined
      ? "BTC LINK is still warming up."
      : `BTC LINK ${score}. ${btcLinkZoneText(row.btc_link_memory.current_zone)}.`;
    return historyTooltip(
      current,
      btcLinkMemoryText(row.btc_link_memory)
    );
  }
  const score = row.btc_link_value;
  const prefix = recentPrefix(row.btc_link_status, row.btc_link_age_seconds);
  if (score === null || score === undefined) {
    return tooltipBlock(
      "BTC connection is still warming up.",
      "The scanner needs more recent movement to judge the relationship.",
      "Use the coin's own price and Open Interest until this fills in.",
      "",
      prefix
    );
  }
  if (score >= 70) {
    return tooltipBlock(
      "Strongly following BTC.",
      "BTC is an important driver of this coin right now.",
      "Keep BTC open while trading this coin.",
      `Current BTC LINK: ${score}`,
      prefix
    );
  }
  if (score >= 45) {
    return tooltipBlock(
      "Following BTC reasonably well.",
      "BTC remains a strong influence on this coin's movement.",
      "BTC direction plus this coin's RM and Expansion.",
      `Current BTC LINK: ${score}`,
      prefix
    );
  }
  if (score >= 20) {
    return tooltipBlock(
      "Weak BTC connection.",
      "The coin is partly doing its own thing.",
      "Give more weight to the coin's own momentum.",
      `Current BTC LINK: ${score}`,
      prefix
    );
  }
  if (score <= -20) {
    return tooltipBlock(
      "Recently moving differently from BTC.",
      "This is not behaving like a normal BTC follower.",
      "The current BTC LINK score is in the opposite-movement range.",
      `Current BTC LINK: ${score}`,
      prefix
    );
  }
  return tooltipBlock(
    "Mostly independent of BTC right now.",
    "BTC is not driving this move.",
    "Coin-specific Expansion and Open Interest; BTC remains market risk.",
    `Current BTC LINK: ${score}`,
    prefix
  );
}

function priceExpansionTooltip(row) {
  if (row.price_expansion_memory) {
    return historyTooltip(
      priceCurrentText(row, row.price_expansion_memory),
      priceMemoryText(row.price_expansion_memory)
    );
  }
  const level = row.expansion_level || "NORMAL";
  const prefix = recentPrefix(row.expansion_status, row.expansion_age_seconds);
  const current = row.expansion_ratio === null || row.expansion_ratio === undefined
    ? "Current: WARMING"
    : `Current: ${row.expansion_ratio.toFixed(1)}x normal 15min movement.`;
  const direction = row.change_15m_pct > 0 ? "Direction: ↑" : row.change_15m_pct < 0 ? "Direction: ↓" : "Direction: →";
  const byLevel = {
    NORMAL: ["Price movement is normal.", "The 15min move is within its normal range.", "Expansion category: NORMAL."],
    BUILDING: ["Momentum is starting to build.", "Price activity is above normal but below the EXPANDING threshold.", "Expansion category: BUILDING."],
    EXPANDING: ["Price is expanding beyond its normal 15min movement.", "The measured move is above the EXPANDING threshold.", "Expansion category: EXPANDING."],
    STRONG: ["Strong active price expansion.", "The measured move is clearly above normal.", "Expansion category: STRONG."],
    SPIKE: ["Extreme price expansion.", "The measured move is in the highest expansion category.", "Expansion category: SPIKE."],
  };
  const [read, meaning, watch] = byLevel[level] || byLevel.NORMAL;
  return tooltipBlock(read, meaning, watch, `${current}\n${direction}`, prefix);
}

function oiExpansionTooltip(row) {
  if (row.oi_memory) {
    return historyTooltip(
      oiCurrentText(row, row.oi_memory),
      oiMemoryText(row.oi_memory, row.price_oi_memory)
    );
  }
  const label = row.oi_interpretation || "OI QUIET";
  const prefix = recentPrefix(row.oi_expansion_status, row.oi_expansion_age_seconds);
  const current = row.oi_expansion_ratio === null || row.oi_expansion_ratio === undefined
    ? ""
    : `Current OI activity: ${row.oi_expansion_ratio.toFixed(1)}x normal.`;
  const byLabel = {
    "OI QUIET": ["Open Interest is behaving normally.", "Open Interest is not confirming the price move yet.", "Let price structure lead."],
    "OI BUILDING ↑": ["Positions are building unusually fast before price has expanded.", "Open Interest is increasing while price expansion remains below threshold.", "OI category: BUILDING."],
    "OI REDUCING ↓": ["Positions are being removed unusually fast.", "Open Interest is shrinking while price expansion remains below threshold.", "OI category: REDUCING."],
    "FRESH BUYING": ["Price is expanding up while Open Interest is increasing strongly.", "Price and Open Interest are both increasing.", "OI category: FRESH BUYING."],
    "SHORTS EXITING": ["Price is expanding up while Open Interest is falling.", "Price is rising while positions are being removed.", "OI category: SHORTS EXITING."],
    "FRESH SELLING": ["Price is expanding down while Open Interest is increasing strongly.", "Price is falling while Open Interest is increasing.", "OI category: FRESH SELLING."],
    "LONGS EXITING": ["Price is expanding down while Open Interest is falling.", "Price and Open Interest are both falling.", "OI category: LONGS EXITING."],
  };
  const [read, meaning, watch] = byLabel[label] || byLabel["OI QUIET"];
  return tooltipBlock(read, meaning, watch, current, prefix);
}

function stateTooltip(row) {
  const label = row.state_type || row.state || "NO SIGNAL";
  const prefix = recentPrefix(row.state_status, row.state_age_seconds);
  const byLabel = {
    LEADER: ["Following BTC and moving significantly harder than BTC.", "RM and BTC LINK meet the LEADER classification.", "STATE category: LEADER."],
    FOLLOWER: ["Moving with BTC at roughly the same pace.", "BTC LINK is active without a strong RM difference.", "STATE category: FOLLOWER."],
    LAGGARD: ["Following BTC but responding weakly.", "BTC LINK is active while RM is weaker.", "STATE category: LAGGARD."],
    DIVERGING: ["Moving meaningfully against BTC.", "The coin's short-term direction differs from BTC.", "STATE category: DIVERGING."],
    INDEPENDENT: ["Moving without a strong BTC connection.", "BTC LINK is low while the coin has measurable movement.", "STATE category: INDEPENDENT."],
    "NO SIGNAL": ["No STATE classification is active.", "Current measurements do not meet a named STATE threshold.", "STATE category: NO SIGNAL."],
    "—": ["No STATE classification is available.", "The required measurements are not available yet.", "STATE category: unavailable."],
  };
  const [read, meaning, watch] = byLabel[label] || byLabel["NO SIGNAL"];
  return tooltipBlock(read, meaning, watch, "", prefix);
}

function normalizeSymbol(symbol) {
  let cleaned = String(symbol || "").trim().toUpperCase();
  cleaned = SYMBOL_ALIASES[cleaned] || cleaned;
  if (!cleaned) return "";
  return cleaned.endsWith("USDT") ? cleaned : `${cleaned}USDT`;
}

function tradingViewExchange() {
  return state.exchange === "bybit" ? "BYBIT" : "BINANCE";
}

function tradingViewUrl(symbol) {
  const normalized = normalizeSymbol(symbol);
  const tvSymbol = `${tradingViewExchange()}:${normalized}.P`;
  return `https://www.tradingview.com/chart/${TRADINGVIEW_CHART_LAYOUT_ID}/?symbol=${encodeURIComponent(tvSymbol)}`;
}

function openSymbol(symbol) {
  const url = tradingViewUrl(symbol);
  window.open(url, "_blank", "noopener,noreferrer");
  return Promise.resolve();
}

const CONTROL_PAIR_ORDER = [
  ["Bullish Control", "Bullish Control"],
  ["Bullish Control", "Bearish Control"],
  ["Bearish Control", "Bearish Control"],
  ["Bearish Control", "Bullish Control"],
  ["Bullish Control", "Control Forming"],
  ["Bearish Control", "Control Forming"],
  ["Bullish Control", "No Control"],
  ["Bearish Control", "No Control"],
  ["Control Forming", "Bullish Control"],
  ["Control Forming", "Bearish Control"],
  ["No Control", "Bullish Control"],
  ["No Control", "Bearish Control"],
  ["Control Forming", "Control Forming"],
  ["Control Forming", "No Control"],
  ["No Control", "Control Forming"],
  ["No Control", "No Control"],
];
const CONTROL_PAIR_RANK = new Map(CONTROL_PAIR_ORDER.map((pair, index) => [pair.join("|"), index]));
const PARTICIPATION_TREND_RANK = { INCREASING: 4, ACTIVE: 3, QUIET: 2, DECREASING: 1, WARMING: 0 };

function controlPairRank(row) {
  const reading = selectedControl(row);
  if (reading.status === "MISSING") return 3;
  return {"Bullish Control":0,"Bearish Control":1,"No Control":2}[reading.control] ?? 2;
}

function compareControlPairs(a, b, dir, groupOnly = false) {
  const participation = (PARTICIPATION_TREND_RANK[b.participation_trend] ?? 0)
    - (PARTICIPATION_TREND_RANK[a.participation_trend] ?? 0);
  const pair = controlPairRank(a) - controlPairRank(b);
  const score = (Number(b.participation_trend_score) || 0) - (Number(a.participation_trend_score) || 0);
  const rank = (Number(b.participation_rank) || 0) - (Number(a.participation_rank) || 0);
  const group = participation || pair;
  if (group) return dir === "asc" ? -group : group;
  if (groupOnly) return 0;
  return compareRmTie(a, b) || score || rank || String(a.symbol).localeCompare(String(b.symbol));
}

function sortValue(row, key) {
  if (key === "symbol") return row.symbol || "";
  if (key.startsWith("oi_")) return oiMetricValue(row, key);
  return row[key];
}

function compareRows(a, b, key, type, dir) {
  if (type === "recent") return compareRecentlyIncreasing(a, b);
  if (type === "pair") return compareControlPairs(a, b, dir);
  const av = sortValue(a, key);
  const bv = sortValue(b, key);
  if (dir === "positive") {
    const ap = typeof av === "number" && Number.isFinite(av) && av > 0;
    const bp = typeof bv === "number" && Number.isFinite(bv) && bv > 0;
    if (ap !== bp) return ap ? -1 : 1;
  }
  if (type === "symbol") {
    return dir === "asc" ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
  }
  const aMissing = av === null || av === undefined || Number.isNaN(Number(av));
  const bMissing = bv === null || bv === undefined || Number.isNaN(Number(bv));
  if (aMissing && bMissing) return String(a.symbol).localeCompare(String(b.symbol));
  if (aMissing) return 1;
  if (bMissing) return -1;
  return dir === "asc" || dir === "positive" ? Number(av) - Number(bv) : Number(bv) - Number(av);
}

function sortedRows(rows, mode) {
  const { key, dir } = state.sort;
  const col = columns.find(([colKey]) => colKey === key);
  const input = [...(rows || [])];
  const btc = mode === "main" ? input.filter((row) => row.symbol === "BTCUSDT") : [];
  const pins = mode === "main" ? input.filter((row) => row.symbol !== "BTCUSDT" && row.pinned_order != null)
    .sort((a, b) => a.pinned_order - b.pinned_order) : [];
  let sortable = mode === "main" ? input.filter((row) => row.symbol !== "BTCUSDT" && row.pinned_order == null) : input;
  if (dir === "positive" && positiveSortKey(key)) sortable = sortable.filter(row => {
    const value = sortValue(row, key);
    return row.retained_on_board || (typeof value === "number" && Number.isFinite(value) && value > 0);
  });
  if (key && col) sortable.sort((a, b) => {
    const focus = Number(controlFocusMatch(b)) - Number(controlFocusMatch(a));
    if (focus) return focus;
    let group = 0;
    if (state.sort.group === "participation_recent") {
      const av = a.participation_trend === "INCREASING" ? a.participation_recent : null;
      const bv = b.participation_trend === "INCREASING" ? b.participation_recent : null;
      group = av != null || bv != null ? av == null ? 1 : bv == null ? -1 : bv - av : 0;
    }
    if (state.sort.group) group ||= compareControlPairs(a, b, "desc", true);
    return group || compareRows(a, b, key, col[2], dir) || (state.sort.group ? compareRmTie(a,b) : 0);
  });
  return [...btc, ...pins, ...sortable];
}

function positiveSortKey(key) { return /^(change|oi|volume)_(5m|15m|1h|4h|24h)_pct$/.test(key || ""); }
function setSort(key, type) {
  const group = state.sort.group || (["control_pair", "participation_recent"].includes(state.sort.key) ? state.sort.key : null);
  if (state.sort.key === key) state.sort.dir = state.sort.dir === "desc" ? "asc" : state.sort.dir === "asc" && positiveSortKey(key) ? "positive" : "desc";
  else state.sort = {key, dir:type === "symbol" ? "asc" : "desc"};
  if (positiveSortKey(key) && group) state.sort.group = group;
  else delete state.sort.group;
  if (key === "control_pair" && state.controlFocus) state.sort.dir = "desc";
  saveSortState(); syncSortingControls(); renderLastSnapshot(true);
}

function sortIndicator(key) {
  if (state.sort.key !== key) return "";
  return state.sort.dir === "positive" ? " +↑" : state.sort.dir === "desc" ? " ↓" : " ↑";
}

function sortHeader(key, label, type = "number", extraClass = "") {
  const baseTooltip = key.startsWith("volume_") ? volumeTooltip(key) : HEADER_TOOLTIPS[key];
  const tooltipText = positiveSortKey(key) ? `${baseTooltip || ""} Click: highest first, lowest first, smallest positive first (+↑). +↑ orders positives first. Already retained coins stay visible when readings turn zero, negative or missing; BTC and pins stay fixed. With a group sort, order applies within groups.` : baseTooltip;
  const tooltip = tooltipText ? ` data-tooltip="${escapeAttr(tooltipText)}"` : "";
  return `<th class="sortable ${extraClass} ${state.sort.key === key ? "active-sort" : ""}" data-sort="${key}" data-type="${type}"${tooltip}>${label}<span class="sort-indicator">${sortIndicator(key)}</span></th>`;
}

function metricSubheader(items) {
  return `<div class="metric-pair metric-head-grid">
    <button class="metric-head sortable ${state.sort.key === items[0][0] ? "active-sort" : ""}" data-sort="${items[0][0]}" data-type="number">${items[0][1]}<span class="sort-indicator">${sortIndicator(items[0][0])}</span></button>
    <span class="metric-separator head-separator">|</span>
    <button class="metric-head sortable ${state.sort.key === items[1][0] ? "active-sort" : ""}" data-sort="${items[1][0]}" data-type="number">${items[1][1]}<span class="sort-indicator">${sortIndicator(items[1][0])}</span></button>
  </div>`;
}

function headerTemplate() {
  const priceHeaders = selectedPriceColumns()
    .map(([key, label]) => sortHeader(key, label, "number", "col-change"))
    .join("");
  const oiHeaders = selectedOiColumns()
    .map(([key, label]) => sortHeader(key, `OI ${label}`, "number", "col-oi"))
    .join("");
  const volumeHeaders = selectedVolumeColumns().map(([key, label]) => sortHeader(key, `VOL ${label}`, "number", "col-volume")).join("");
  return `
    <tr class="parent-head">
      <th class="col-pin" title="Pin coins below BTC or remove them from this board">PIN</th>
      ${sortHeader("symbol", "SYMBOL", "symbol", "symbol-head")}
      ${sortHeader("price", "PRICE", "number", "col-price-current")}
      ${priceHeaders}
      ${sortHeader("rm_value", "RM", "number", "col-rm")}
      ${sortHeader("expansion_ratio", "EXPANSION", "number", "col-expansion")}
      ${oiHeaders}
      ${volumeHeaders}
      ${controlHeader()}
      ${sortHeader("crowd_rank", "CROWD", "number", "col-crowd")}
    </tr>
  `;
}

function rowTemplate(row, mode) {
  const boardRow = lastSnapshot?.main_board?.find((item) => item.symbol === row.symbol);
  const pinned = boardRow?.pinned_order != null;
  const isBtc = row.symbol === "BTCUSDT";
  const action = isBtc ? '<span class="btc-pin" title="BTC benchmark stays first">◆</span>' :
    `<button class="pin-action ${pinned ? "is-pinned" : ""}" data-pin="${row.symbol}" data-pinned="${!pinned}"
      aria-label="${pinned ? "Unpin" : "Pin"} ${displayBaseSymbol(row)}" aria-pressed="${pinned}"
      title="${pinned ? "Unpin: return to normal sorting; keep saved" : "Pin: save and keep below BTC"}">📌</button>` +
    (boardRow ? `<button class="remove-action" data-remove="${row.symbol}" aria-label="Remove ${displayBaseSymbol(row)}"
      title="Remove from board; hide from automatic discovery for 4 hours">×</button>` :
      `<button class="add-action" data-add="${row.symbol}" title="Save to board" aria-label="Add ${displayBaseSymbol(row)}">+</button>`);
  const statusClass = row.data_status === "LIVE" ? "" : " stale";
  const oiCells = selectedOiColumns()
    .map(([key]) => `<td class="metric-cell oi-cell ${heldClass(row.oi_status)}" data-tooltip="${escapeAttr(oiCellTooltip(row))}"><span class="metric-value ${pctClass(oiMetricValue(row, key))}">${fmtPct(oiMetricValue(row, key))}</span></td>`)
    .join("");
  const volumeCells = selectedVolumeColumns().map(([key]) => `<td class="volume-cell ${pctClass(row[key])}" data-tooltip="${escapeAttr(volumeTooltip(key))}">${fmtPct(row[key])}</td>`).join("");
  const priceCells = selectedPriceColumns()
    .map(([key]) => `<td class="price-change ${pctClass(row[key])}">${fmtPct(row[key])}</td>`)
    .join("");

  return `
    <tr class="${isBtc ? "btc-row" : pinned ? "pinned-row" : ""}${statusClass}">
      <td class="pin-cell"><div class="pin-actions">${action}</div></td>
      <td class="symbol-cell"><button class="symbol-link" data-symbol="${row.symbol}" data-tooltip="Open ${tradingViewExchange()}:${row.symbol}.P on TradingView"><span class="symbol">${displayBaseSymbol(row)}</span></button></td>
      <td class="last-cell">${fmtPrice(row.price)}</td>
      ${priceCells}
      <td class="signal-cell ${pctClass(row.rm_value)} ${heldClass(row.rm_status)} ${row.rm_status === "RECENT" ? "recent-rm" : row.rm_status === "HELD" ? "held-rm" : ""}" data-tooltip="${escapeAttr(rmTooltip(row))}">${row.rm}</td>
      <td class="metric-cell expansion-cell">${expansionDisplay(row)}</td>
      ${oiCells}
      ${volumeCells}
      <td class="control-cell">${controlDisplay(row)}</td>
      <td class="crowd-cell">${crowdDisplay(row)}</td>
    </tr>
  `;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({ detail: response.statusText }));
    throw new Error(err.detail || response.statusText);
  }
  return response.json();
}

let lastSnapshot = null;
let sharedSnapshot = null;
let watchRows = new Map();
let snapshotRequest = 0;
const activeSnapshotLoads = new Set();

async function loadMarkets() {
  try {
    const data = await api(`/api/markets/${state.exchange}`);
    state.markets = data.markets || [];
    renderMarketSuggestions();
  } catch (error) {
    state.markets = [];
    renderMarketSuggestions();
  }
}

function renderMarketSuggestions() {
  const datalist = $("market-suggestions");
  if (!datalist) return;
  const input = $("search-input");
  const query = String(input?.value || "").trim().toUpperCase();
  const matches = state.markets
    .filter((market) => {
      const base = String(market.base || market.symbol || "").toUpperCase();
      const symbol = String(market.symbol || "").toUpperCase();
      const strippedBase = base.replace(/^[0-9]+/, "");
      return !query || base.startsWith(query) || symbol.startsWith(query) || strippedBase.startsWith(query);
    })
    .slice(0, 20);
  datalist.innerHTML = matches
    .map((market) => `<option value="${escapeAttr(market.base || market.symbol)}" label="${escapeAttr(market.symbol)}"></option>`)
    .join("");
}

function renderSearchResult() {
  if (orderHold.held()) return;
  const shell = $("search-shell");
  if (!shell) return;
  if (!state.searchSymbol && !state.searchRow && !state.searchError) {
    shell.classList.add("hidden");
    return;
  }
  shell.classList.remove("hidden");
  $("search-head").innerHTML = headerTemplate();
  $("search-status").textContent = state.searchError || (state.searchSymbol ? `${state.exchange.toUpperCase()} ${state.searchSymbol}` : "");
  $("search-board").innerHTML = state.searchRow ? rowTemplate(state.searchRow, "search") : "";
}

async function loadSearchRow(showLoading = true) {
  if (!state.searchSymbol) {
    renderSearchResult();
    return;
  }
  if (showLoading) {
    state.searchError = `Loading ${state.searchSymbol}...`;
    renderSearchResult();
  }
  try {
    const data = await api(`/api/search/${state.exchange}?symbol=${encodeURIComponent(state.searchSymbol)}&volume_timeframes=${requestedVolumeTimeframes()}`);
    state.searchRow = data.row;
    state.searchError = "";
  } catch (error) {
    state.searchRow = null;
    state.searchError = error.message || `Market not found on ${state.exchange.toUpperCase()}.`;
  }
  renderSearchResult();
}

async function searchCoin() {
  const input = $("search-input");
  const symbol = normalizeSymbol(input.value);
  if (!symbol) return;
  state.searchSymbol = symbol;
  await loadSearchRow();
}

function clearSearch() {
  state.searchSymbol = null;
  state.searchRow = null;
  state.searchError = "";
  const input = $("search-input");
  if (input) input.value = "";
  renderSearchResult();
}

function renderTimeframeControls() {
  const groups = [
    ["price", PRICE_COLUMN_DEFS, $("price-timeframe-options")],
    ["oi", OI_COLUMN_DEFS, $("oi-timeframe-options")],
    ["volume", VOLUME_COLUMN_DEFS, $("volume-timeframe-options")],
  ];
  for (const [group, defs, shell] of groups) {
    if (!shell) continue;
    shell.innerHTML = defs.map(([key, label]) => {
      const checked = state.columnPrefs[group].includes(key) ? " checked" : "";
      return `<label class="timeframe-option"><input type="checkbox" data-column-group="${group}" data-column-key="${key}"${checked}>${label}</label>`;
    }).join("");
  }
}

function renderColumnGroups() {
  const html = [
    '<col class="col-pin" />',
    '<col class="col-symbol" />',
    '<col class="col-price-current" />',
    ...selectedPriceColumns().map(() => '<col class="col-change" />'),
    '<col class="col-rm" />',
    '<col class="col-expansion" />',
    ...selectedOiColumns().map(() => '<col class="col-oi" />'),
    ...selectedVolumeColumns().map(() => '<col class="col-volume" />'),
    '<col class="col-control" />',
    '<col class="col-crowd" />',
  ].join("");
  document.querySelectorAll("colgroup[data-dynamic-cols]").forEach((group) => { group.innerHTML = html; });
  const minWidth = 1214
    + Math.max(0, selectedPriceColumns().length - 2) * 76
    + Math.max(0, selectedOiColumns().length - 2) * 85 + selectedVolumeColumns().length * 90;
  document.querySelectorAll(".board-table").forEach((table) => { table.style.minWidth = `${minWidth}px`; });
}

function updateColumnPreference(group, key, checked) {
  const defs = group === "price" ? PRICE_COLUMN_DEFS : group === "oi" ? OI_COLUMN_DEFS : VOLUME_COLUMN_DEFS;
  const current = new Set(state.columnPrefs[group]);
  if (checked) current.add(key);
  else current.delete(key);
  const ordered = defs.map(([itemKey]) => itemKey).filter((itemKey) => current.has(itemKey));
  if (!ordered.length && group !== "volume") {
    $("status").textContent = `Keep at least one ${group === "price" ? "price" : "OI"} timeframe visible.`;
    renderTimeframeControls();
    return;
  }
  state.columnPrefs[group] = ordered;
  const visibleSortKeys = new Set([
    "symbol", "price", "rm_value", "expansion_ratio", "crowd_rank", "control_pair", "participation_recent",
    ...state.columnPrefs.price,
    ...state.columnPrefs.oi,
    ...state.columnPrefs.volume,
  ]);
  if (state.sort.key && !visibleSortKeys.has(state.sort.key)) {
    state.sort = { key: null, dir: "desc" };
    saveSortState();
  }
  saveColumnPrefs();
  if (group === "volume") loadSnapshot();
  renderTimeframeControls();
  renderColumnGroups();
  renderLastSnapshot();
}

const orderHold = window.ZeroInteractionHold ? window.ZeroInteractionHold.create({
  release: () => { renderLastSnapshot(); if (alertRenderPending) renderControlAlerts(); },
  changed: held => { $("order-hold-status").textContent = held ? "Order held · resumes 5s after interaction" : ""; }
}) : {held:()=>false};

function renderStableBoard(rows) {
  const bySymbol = new Map(rows.map(row => [row.symbol,row]));
  for (const existing of $("main-board").rows) {
    const symbol = existing.querySelector("[data-symbol]")?.dataset.symbol;
    const row = bySymbol.get(symbol);
    if (!row) continue; // Expiry/new arrivals wait until interaction ends.
    const template = document.createElement("tbody");
    template.innerHTML = rowTemplate(row,"main");
    const updated = template.rows[0];
    if (existing.cells.length !== updated.cells.length) continue;
    // Keep action buttons and symbol nodes intact throughout the gesture.
    for (let index = 2; index < existing.cells.length; index++) {
      existing.cells[index].className = updated.cells[index].className;
      existing.cells[index].innerHTML = updated.cells[index].innerHTML;
      if (updated.cells[index].dataset.tooltip) existing.cells[index].dataset.tooltip = updated.cells[index].dataset.tooltip;
    }
  }
}

function renderLastSnapshot(forceOrder = false) {
  if (forceOrder || !orderHold.held()) renderColumnGroups();
  if (!sharedSnapshot) return;
  const facts = new Map();
  for (const row of [...(sharedSnapshot.main_board || []), ...(sharedSnapshot.discovery_candidates || []), ...(sharedSnapshot.retained_rows || []), ...watchRows.values()]) {
    const previous = facts.get(row.symbol);
    if (!previous || (row.observed_at_unix || 0) >= (previous.observed_at_unix || 0)) facts.set(row.symbol, row);
  }
  const rows = personalBoard.visible([...facts.values()], state.exchange, Date.now(), sharedSnapshot.screen_mode);
  lastSnapshot = {...sharedSnapshot, main_board: rows};
  if (!forceOrder && orderHold.held() && $("main-board").rows.length) renderStableBoard(rows);
  else {
    $("main-head").innerHTML = headerTemplate();
    $("main-board").innerHTML = sortedRows(lastSnapshot.main_board, "main").map(row => rowTemplate(row,"main")).join("");
  }
  const screen = lastSnapshot.screen;
  if (screen) $("board-note").textContent = `BTC first · Pins stay fixed · 4h retention · ${screen.eligible_count} pass cap/turnover · ${screen.fresh_count}/${screen.eligible_count} fresh · ${screen.matched_count} match all filters · ${screen.missing_market_caps} without market cap${screen.oldest_reading_seconds != null ? ` · Oldest check ${Math.ceil(screen.oldest_reading_seconds / 60)}m ago` : ""}${screen.error ? ` · ${screen.error}` : ""}`;
  renderSearchResult();
}

function tooltipElement() {
  let tooltip = $("scanner-tooltip");
  if (!tooltip) {
    tooltip = document.createElement("div");
    tooltip.id = "scanner-tooltip";
    tooltip.className = "scanner-tooltip";
    document.body.appendChild(tooltip);
  }
  return tooltip;
}

function positionTooltip(event) {
  const tooltip = tooltipElement();
  if (!tooltip.classList.contains("visible")) return;
  const margin = 12;
  const offset = 14;
  const rect = tooltip.getBoundingClientRect();
  let left = event.clientX + offset;
  let top = event.clientY + offset;
  if (left + rect.width + margin > window.innerWidth) left = event.clientX - rect.width - offset;
  if (top + rect.height + margin > window.innerHeight) top = event.clientY - rect.height - offset;
  tooltip.style.left = `${Math.max(margin, left)}px`;
  tooltip.style.top = `${Math.max(margin, top)}px`;
}

function showTooltip(target, event) {
  const text = target?.dataset?.tooltip;
  if (!text) return;
  const tooltip = tooltipElement();
  tooltip.textContent = text;
  tooltip.classList.add("visible");
  positionTooltip(event);
}

function hideTooltip() {
  tooltipElement().classList.remove("visible");
}

function compactUsd(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "$—";
  if (number >= 1e9 && number % 1e9 === 0) return `$${number / 1e9}B`;
  if (number >= 1e6 && number % 1e6 === 0) return `$${number / 1e6}M`;
  return `$${Math.round(number).toLocaleString()}`;
}

function buildFilterPanel() {
  $("metric-filter-groups").innerHTML = [["change", "Price change"], ["oi", "OI change"], ["volume", "Volume change"]].map(([prefix, label]) => `
    <details class="filter-metric-group"><summary>${label} (%)</summary>
      <div class="filter-metric-grid"><span></span><span class="filter-grid-heading">Minimum %</span><span class="filter-grid-heading">Maximum %</span>
      ${[["5m", "5m"], ["15m", "15m"], ["1h", "1h"], ["4h", "4h"], ["24h", "1D"]].map(([tf, title]) => `<span>${title}</span><input type="number" step="any" data-filter-key="min_${prefix}_${tf}_pct" aria-label="Minimum ${label.toLowerCase()} ${title}" placeholder="No minimum"><input type="number" step="any" data-filter-key="max_${prefix}_${tf}_pct" aria-label="Maximum ${label.toLowerCase()} ${title}" placeholder="No maximum">`).join("")}</div>
    </details>`).join("");
}
function renderDiscoverySettings(settings, setInputs = false) {
  state.discoverySettings = settings;
  $("setup-direction").value = personalBoard.direction();
  $("filter-title").textContent = `${personalBoard.direction()[0].toUpperCase() + personalBoard.direction().slice(1)} filters`;
  if (setInputs) document.querySelectorAll("[data-filter-key]").forEach(input => {
    input.value = settings[input.dataset.filterKey] == null ? "" : String(settings[input.dataset.filterKey]);
  });
  const parts = [];
  if (settings.min_market_cap_usd > 0) parts.push(`Cap ≥ ${compactUsd(settings.min_market_cap_usd)}`);
  if (settings.max_market_cap_usd != null) parts.push(`Cap ≤ ${compactUsd(settings.max_market_cap_usd)}`);
  if (settings.min_turnover_24h_pct > 0) parts.push(`Turnover ≥ ${settings.min_turnover_24h_pct}%`);
  for (const prefix of ["change", "oi", "volume"]) for (const tf of ["5m", "15m", "1h", "4h", "24h"]) for (const [bound, sign] of [["min", "≥"], ["max", "≤"]]) {
    const value = settings[`${bound}_${prefix}_${tf}_pct`];
    if (value != null) parts.push(`${tf === "24h" ? "1D" : tf} ${prefix === "change" ? "Price" : prefix === "oi" ? "OI" : "Vol"} ${sign} ${value > 0 ? "+" : ""}${value}%`);
  }
  $("active-discovery-filters").textContent = parts.join(" · ") || "All supported coins with available market cap";
}
async function loadDiscoverySettings() { renderDiscoverySettings(personalBoard.filters(), true); }
async function applyDiscoverySettings(event, savePreset = false) {
  event?.preventDefault();
  const filters = {};
  document.querySelectorAll("[data-filter-key]").forEach(input => {
    if (input.value.trim() !== "") filters[input.dataset.filterKey] = Number(input.value);
  });
  try {
    if (savePreset) personalBoard.savePreset(filters);
    else personalBoard.setFilters(filters);
    renderDiscoverySettings(personalBoard.filters(), true);
    $("filter-dialog").close();
    sharedSnapshot = null;
    watchRows = new Map();
    $("main-board").innerHTML = "";
    await loadSnapshot();
  } catch (error) { $("filter-error").textContent = error.message; }
}

function marketCapStatusText(status) {
  if (!status) return "Caps: unknown";
  const source = { coingecko: "CoinGecko", coinpaprika: "CoinPaprika fallback", stale: "stale cache", unavailable: "UNAVAILABLE" }[status.source] || status.source;
  const error = status.coingecko_error;
  if (!error) return `Caps: ${source} (${status.coin_count || 0} coins)`;
  const seconds = status.coingecko_failure_seconds;
  const duration = seconds == null ? "since first observed failure" : seconds < 60
    ? `${seconds}s` : seconds < 3600 ? `${Math.floor(seconds / 60)}m`
    : `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  const cacheAge = status.source === "stale" && status.cache_age_seconds != null
    ? ` · data age ${Math.floor(status.cache_age_seconds / 60)}m` : "";
  return `CAPS: ${source} · ${error} for ${duration} (this run)${cacheAge}`;
}

async function loadSnapshot() {
  const exchange = state.exchange;
  const loadKey = exchange + JSON.stringify(personalBoard.filters()) + requestedVolumeTimeframes();
  if (activeSnapshotLoads.has(loadKey)) return;
  activeSnapshotLoads.add(loadKey);
  const request = ++snapshotRequest;
  try {
    $("status").textContent = `Loading ${state.exchange.toUpperCase()} futures...`;
    const data = await api(`/api/screen/${exchange}?filters=${encodeURIComponent(JSON.stringify(personalBoard.filters()))}&volume_timeframes=${requestedVolumeTimeframes()}&retained=${encodeURIComponent(personalBoard.retainedSymbols(exchange).join(","))}`);
    if (exchange !== state.exchange || request !== snapshotRequest) return;
    const available = new Set(state.markets.map(market => market.symbol));
    const sharedSymbols = new Set((data.main_board || []).map(row => row.symbol));
    const requested = personalBoard.watchSymbols(exchange, true).filter(symbol => !sharedSymbols.has(symbol)
      && (!available.size || available.has(symbol)));
    let custom = [];
    if (requested.length) {
      try {
        const watched = await api(`/api/watch/${exchange}?symbols=${encodeURIComponent(requested.join(","))}&volume_timeframes=${requestedVolumeTimeframes()}`);
        custom = watched.rows || [];
      } catch (error) {
        custom = requested.flatMap(symbol => watchRows.has(symbol) ? [{...watchRows.get(symbol), data_status: "STALE"}] : []);
      }
    }
    if (exchange !== state.exchange || request !== snapshotRequest) return;
    watchRows = new Map(custom.map(row => [row.symbol, row]));
    const tracked = new Map();
    for (const row of [...(data.main_board || []), ...(data.discovery_candidates || []), ...(data.retained_rows || []), ...custom]) {
      if (!tracked.has(row.symbol) || (row.observed_at_unix || 0) >= (tracked.get(row.symbol).observed_at_unix || 0)) tracked.set(row.symbol, row);
    }
    trackParticipation([...tracked.values()], exchange);
    sharedSnapshot = data;
    renderLastSnapshot();
    void loadSelectedControl(exchange, lastSnapshot?.main_board || []);
    renderDiscoverySettings(personalBoard.filters(), false);
    if (state.searchSymbol) await loadSearchRow(false);
    const updated = new Date().toLocaleTimeString();
    $("status").textContent = `${state.exchange.toUpperCase()} | ${data.market_count} markets | POLLING | Refresh: ${REFRESH_SECONDS}s | Updated: ${updated} | ${marketCapStatusText(data.market_cap_status)}`;
  } catch (error) {
    if (exchange !== state.exchange || request !== snapshotRequest) return;
    $("status").textContent = `${state.exchange.toUpperCase()} data error: ${error.message}`;
  } finally { activeSnapshotLoads.delete(loadKey); }
}

async function addSymbol(symbol) {
  const normalized = normalizeSymbol(symbol);
  let market = state.markets.find(item => item.symbol === normalized);
  if (!market) {
    const base = normalized.replace(/USDT$/, "");
    const matches = state.markets.filter(item => String(item.base || "").replace(/^[0-9]+/, "").toUpperCase() === base);
    if (matches.length === 1) market = matches[0];
  }
  if (!market) throw new Error("Choose a supported coin from search before adding it.");
  personalBoard.add(market.symbol, state.exchange);
  if (state.searchRow?.symbol === market.symbol) watchRows.set(market.symbol, state.searchRow);
  renderLastSnapshot();
  await loadSnapshot();
}

async function pinSymbol(symbol, pinned) {
  personalBoard.pin(symbol, state.exchange, pinned);
  for (const button of $("main-board").querySelectorAll("[data-pin]")) if (button.dataset.pin === symbol) {
    button.dataset.pinned = String(!pinned); button.setAttribute("aria-pressed",String(pinned));
    button.setAttribute("aria-label",`${pinned ? "Unpin" : "Pin"} ${displayBaseSymbol({symbol})}`);
    button.classList.toggle("is-pinned",pinned);
  }
  if (state.searchRow?.symbol === symbol) watchRows.set(symbol, state.searchRow);
  renderLastSnapshot();
  await loadSnapshot();
}

async function removeSymbol(symbol) {
  personalBoard.remove(symbol, state.exchange);
  watchRows.delete(symbol);
  for (const button of $("main-board").querySelectorAll("[data-symbol]")) if (button.dataset.symbol === symbol) button.closest("tr").remove();
  renderLastSnapshot();
}

function startAutoRefresh() {
  clearInterval(state.timer);
  state.timer = setInterval(loadSnapshot, REFRESH_SECONDS * 1000);
}

$("exchange").addEventListener("change", (event) => {
  state.exchange = event.target.value;
  try { localStorage.setItem("0scan1.exchange.v1", state.exchange); } catch (_) {}
  lastSnapshot = null;
  sharedSnapshot = null;
  watchRows = new Map();
  state.controlRows = {};
  state.searchSymbol = null;
  state.searchRow = null;
  state.searchError = "";
  clearSearch();
  loadMarkets();
  loadSnapshot();
  startAutoRefresh();
});

$("participation-sort").addEventListener("change", (event) => {
  state.controlFocus = "";
  try { localStorage.setItem("0scan1.control-focus.v1", ""); } catch (_) {}
  const group = event.target.value === "recent" ? "participation_recent" : event.target.value === "control" ? "control_pair" : null;
  if (positiveSortKey(state.sort.key)) {
    if (group) state.sort.group = group; else delete state.sort.group;
  } else state.sort = {key:group,dir:"desc"};
  saveSortState();
  syncSortingControls();
  renderLastSnapshot(true);
});
$("rm-tie").addEventListener("change", (event) => {
  state.rmTie = event.target.value;
  localStorage.setItem("0scan1.rm-tie.v1", state.rmTie);
  renderLastSnapshot(true);
});

$("refresh").addEventListener("click", loadSnapshot);
buildFilterPanel();
$("change-filters").addEventListener("click", () => { renderDiscoverySettings(personalBoard.filters(), true); $("filter-error").textContent = ""; $("filter-dialog").showModal(); });
$("filter-form").addEventListener("submit", applyDiscoverySettings);
$("save-preset").addEventListener("click", event => applyDiscoverySettings(event, true));
$("default-preset").addEventListener("click", () => { document.querySelectorAll("[data-filter-key]").forEach(input => { const defaults = personalBoard.defaultFilters(); input.value = defaults[input.dataset.filterKey] == null ? "" : String(defaults[input.dataset.filterKey]); }); $("filter-error").textContent = ""; });
$("setup-direction").addEventListener("change", async event => {
  personalBoard.setDirection(event.target.value);
  if (personalBoard.direction() !== "neutral") {
    state.sort = {key: "participation_recent", dir: "desc"};
    saveSortState(); syncSortingControls();
  }
  renderDiscoverySettings(personalBoard.filters(), true);
  sharedSnapshot = null; watchRows = new Map();
  $("main-board").innerHTML = "";
  await loadSnapshot();
});
for (const id of ["cancel-filters", "close-filters"]) $(id).addEventListener("click", () => $("filter-dialog").close());
$("reset-filters").addEventListener("click", () => { document.querySelectorAll("[data-filter-key]").forEach(input => input.value = ""); $("filter-error").textContent = ""; });

document.body.addEventListener("change", (event) => {
  const input = event.target.closest("[data-column-group][data-column-key]");
  if (!input) return;
  updateColumnPreference(input.dataset.columnGroup, input.dataset.columnKey, input.checked);
});

$("search-input").addEventListener("input", renderMarketSuggestions);

$("search-input").addEventListener("keydown", async (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  await searchCoin();
});

$("search-button").addEventListener("click", searchCoin);

$("search-clear").addEventListener("click", clearSearch);

$("add-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const input = $("symbol-input");
  if (!input.value.trim()) return;
  try {
    await addSymbol(input.value);
    input.value = "";
  } catch (error) {
    $("status").textContent = error.message;
  }
});

document.body.addEventListener("click", async (event) => {
  if (event.target.closest(".control-tf, .control-focus")) return;
  const sortHeader = event.target.closest("[data-sort]");
  if (sortHeader) {
    setSort(sortHeader.dataset.sort, sortHeader.dataset.type);
    return;
  }
  const symbolButton = event.target.closest("[data-symbol]");
  if (symbolButton) {
    try {
      await openSymbol(symbolButton.dataset.symbol);
    } catch (error) {
      $("status").textContent = `Chart open error: ${error.message}`;
    }
    return;
  }
  const pin = event.target.closest("[data-pin]");
  if (pin) {
    pin.disabled = true;
    try { await pinSymbol(pin.dataset.pin, pin.dataset.pinned === "true"); }
    catch (error) { $("status").textContent = error.message; }
    finally { pin.disabled = false; }
    return;
  }
  const add = event.target.closest("[data-add]")?.dataset.add;
  const remove = event.target.closest("[data-remove]")?.dataset.remove;
  try {
    if (add) await addSymbol(add);
    if (remove) await removeSymbol(remove);
  } catch (error) {
    $("status").textContent = error.message;
  }
});

document.body.addEventListener("mouseover", (event) => {
  const target = event.target.closest("[data-tooltip]");
  if (!target || !document.body.contains(target)) return;
  showTooltip(target, event);
});

document.body.addEventListener("mousemove", (event) => {
  if (event.target.closest("[data-tooltip]")) positionTooltip(event);
});

document.body.addEventListener("mouseout", (event) => {
  const from = event.target.closest("[data-tooltip]");
  const to = event.relatedTarget?.closest?.("[data-tooltip]");
  if (!from || from === to) return;
  hideTooltip();
});

document.body.addEventListener("focusin", (event) => {
  const target = event.target.closest("[data-tooltip]");
  if (!target) return;
  const rect = target.getBoundingClientRect();
  showTooltip(target, { clientX: rect.left + rect.width / 2, clientY: rect.bottom });
});

document.body.addEventListener("focusout", hideTooltip);

$("exchange").value = state.exchange;
syncSortingControls();
renderTimeframeControls();
renderColumnGroups();
renderLastSnapshot();
loadDiscoverySettings().catch((error) => { $("status").textContent = `Discovery settings error: ${error.message}`; });
loadMarkets();
loadSnapshot();
startAutoRefresh();

// Capture the gesture before refresh code can replace any action target.
const touchOnScanner = event => event.target.closest?.("main");
document.addEventListener("pointerdown", event => { if (touchOnScanner(event)) orderHold.down(event.pointerId); }, {capture:true,passive:true});
for (const eventName of ["pointerup","pointercancel"]) document.addEventListener(eventName, event => orderHold.up(event.pointerId), {capture:true,passive:true});
document.addEventListener("scroll", () => orderHold.scroll(), {capture:true,passive:true});
document.addEventListener("wheel", () => orderHold.scroll(), {capture:true,passive:true});
$("main-board").addEventListener("pointerenter", event => { if (event.pointerType === "mouse") orderHold.hover(true); });
$("main-board").addEventListener("pointerleave", event => { if (event.pointerType === "mouse") orderHold.hover(false); });
window.addEventListener("blur", () => { orderHold.hover(false); orderHold.activity(); });

document.body.addEventListener("change", event => {
  if (!event.target.matches(".control-tf")) return;
  state.controlTf = Number(event.target.value);
  $("alert-timeframe").value = String(state.controlTf);
  state.controlRows = {};
  try { localStorage.setItem("0scan1.control-tf.v1", String(state.controlTf)); } catch (_) {}
  orderHold.reset();
  renderLastSnapshot();
  void loadSelectedControl(state.exchange, lastSnapshot?.main_board || []);
});

document.body.addEventListener("change", event => {
  if (event.target.matches(".control-focus")) setControlFocus(event.target.value);
});

// Alerts have their own poll and do not depend on board ranking or filters.
const controlAlerts = window.ZeroControlAlerts.create({
  getItem:key => localStorage.getItem(key), setItem:(key,value) => localStorage.setItem(key,value),
});
let alertPollBusy = false;
let alertAudio = null;
let alertSoundEnabled = false;
let alertRenderPending = false;
let alertPollController = null;
let alertLastError = "";
const alertTfLabel = tf => ({15:'15m',60:'1h',240:'4h',1440:'24h'}[tf]);
function alertDescription(w) { return `${w.symbol.replace(/USDT$/, '')} · ${w.target} · ${alertTfLabel(w.timeframe)} · ${w.exchange.toUpperCase()}`; }
function renderControlAlerts(force = false) {
  const data = controlAlerts.all();
  const count = data.alerts.length;
  $("control-alert-count").textContent = `${controlAlerts.active().length} watching · ${count} alerts`;
  $("control-alert-notice").classList.toggle("hidden", count === 0);
  $("control-alert-notice").textContent = count ? `${count} Control alert${count === 1 ? '' : 's'} · ${data.alerts.slice(0,3).map(a=>a.symbol.replace(/USDT$/, '')).join(', ')} · View` : '';
  if (!force && orderHold.held()) { alertRenderPending = true; return; }
  alertRenderPending = false;
  $("control-watch-list").innerHTML = data.watches.length ? data.watches.map(w => `<div class="control-watch-item"><span>${escapeAttr(alertDescription(w))}<small>${w.state === 'triggered' ? 'Triggered' : w.lastStatus === 'CURRENT' ? 'Watching · last: ' + (w.lastControl || 'No Control') + ' · checked ' + new Date(w.checkedAt).toLocaleTimeString() : w.lastStatus === 'UNAVAILABLE' ? 'Waiting · coin or exchange unavailable' : 'Watching · waiting for fresh Control'}</small></span><div>${w.state === 'triggered' ? `<button type="button" data-alert-rearm="${escapeAttr(w.id)}">Rearm</button>` : ''}<button type="button" data-alert-remove="${escapeAttr(w.id)}">Remove watch</button></div></div>`).join('') : '<p class="alert-help">No watches yet.</p>';
  $("control-alert-list").innerHTML = count ? data.alerts.map(a=>`<div class="control-watch-item ${a.target === 'Bullish Control' ? 'up' : 'down'}"><span>${a.target === 'Bullish Control' ? '🟢' : '🔴'} ${escapeAttr(alertDescription(a))}<small>${new Date(a.triggeredAt).toLocaleString()}${a.alreadyPresent ? ' · Already present at first check' : ' · Detected'}</small></span><div><button type="button" data-alert-chart="${escapeAttr(a.id)}">Open chart</button><button type="button" data-alert-dismiss="${escapeAttr(a.id)}">Dismiss</button></div></div>`).join('') : '<p class="alert-help">Triggered alerts stay here until dismissed.</p>';
}
async function prepareAlertAudio() {
  const Audio = window.AudioContext || window.webkitAudioContext;
  if (!Audio) throw Error('This browser does not support alert sound.');
  if (!alertAudio || alertAudio.state === 'closed') alertAudio = new Audio();
  await alertAudio.resume();
  if (alertAudio.state !== 'running') throw Error('Sound is blocked. Tap Enable sound again.');
}
function playAlertChime() {
  if (!alertSoundEnabled) return;
  if (!alertAudio || alertAudio.state !== 'running') throw Error('Alert sound is paused');
  const start = alertAudio.currentTime;
  for (const [offset, frequency] of [[0,660],[0.22,880]]) {
    const oscillator = alertAudio.createOscillator(), gain = alertAudio.createGain();
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0,start+offset);
    gain.gain.linearRampToValueAtTime(0.15,start+offset+0.02);
    gain.gain.exponentialRampToValueAtTime(0.001,start+offset+0.20);
    oscillator.connect(gain); gain.connect(alertAudio.destination);
    oscillator.start(start+offset); oscillator.stop(start+offset+0.22);
  }
}
function handleControlAlertReadings(readings) {
  const fired = controlAlerts.consume(readings);
  renderControlAlerts(); // Visual alerts must work even when audio fails.
  if (fired.length) {
    let soundNote = alertSoundEnabled ? '' : ' Sound is off.';
    try { playAlertChime(); }
    catch (_) { soundNote = ' Sound could not play; tap Enable sound.'; }
    $("alert-message").textContent = `${fired.length} Control alert${fired.length === 1 ? '' : 's'} triggered. Review the Alerts list.${soundNote}`;
  }
  return fired;
}
function observeControlAlertReadings(exchange, timeframe, rows, watchIds) {
  const ids = new Set(watchIds);
  const readings = {};
  for (const watch of controlAlerts.active()) {
    if (ids.has(watch.id) && watch.exchange === exchange && watch.timeframe === timeframe && rows[watch.symbol]?.status === 'CURRENT')
      readings[watch.id] = rows[watch.symbol];
  }
  if (Object.keys(readings).length) handleControlAlertReadings(readings);
}
async function pollControlAlerts() {
  if (alertPollBusy) return;
  const watches = controlAlerts.active().map(({id,symbol,exchange,timeframe})=>({id,symbol,exchange,timeframe}));
  if (!watches.length) return;
  alertPollBusy = true;
  const controller = new AbortController();
  alertPollController = controller;
  const timeout = setTimeout(()=>controller.abort(), 15000);
  try {
    const response = await api(`/api/control-alerts?watches=${encodeURIComponent(JSON.stringify(watches))}`, {signal:controller.signal,cache:'no-store'});
    const fired = handleControlAlertReadings(response.rows || {});
    if (alertLastError && !fired.length) $("alert-message").textContent = 'Alert checks resumed. Watching for fresh confirmed Control.';
    alertLastError = '';
  } catch (error) {
    alertLastError = error.name === 'AbortError' ? 'Alert check timed out' : 'Alert checks temporarily unavailable';
    $("alert-message").textContent = `${alertLastError}. Watches remain armed; retrying automatically.`;
  } finally { clearTimeout(timeout); alertPollController = null; alertPollBusy = false; }
}
$("alert-exchange").value = state.exchange;
$("alert-timeframe").value = String(state.controlTf);
$("control-alert-form").addEventListener("submit", event => {
  event.preventDefault();
  try {
    const symbol = normalizeSymbol($("alert-symbol").value);
    const exchange = $("alert-exchange").value;
    if (exchange === state.exchange && state.markets.length && !state.markets.some(m=>m.symbol === symbol)) throw Error('That coin is not a supported USDT perpetual on this exchange.');
    controlAlerts.add({symbol,exchange,timeframe:Number($("alert-timeframe").value),target:$("alert-target").value});
    $("alert-message").textContent = 'Watch started. If the requested Control already exists, the first fresh check will alert you.';
    $("alert-symbol").value = '';
    renderControlAlerts(true); void pollControlAlerts();
  } catch (error) { $("alert-message").textContent = error.message; }
});
$("alert-sound").addEventListener("click", async () => {
  try {
    if (alertSoundEnabled) { alertSoundEnabled = false; $("alert-sound").textContent = 'Enable sound'; }
    else { await prepareAlertAudio(); alertSoundEnabled = true; $("alert-sound").textContent = 'Sound on · Mute'; playAlertChime(); }
  } catch (error) { $("alert-message").textContent = error.message; }
});
$("alert-test-sound").addEventListener("click", async () => {
  try { await prepareAlertAudio(); const previous = alertSoundEnabled; alertSoundEnabled = true; playAlertChime(); alertSoundEnabled = previous; $("alert-message").textContent = 'Test chime played.'; }
  catch (error) { $("alert-message").textContent = error.message; }
});
$("control-alert-notice").addEventListener("click", () => {
  $("control-alert-panel").open = true; renderControlAlerts(true);
  $("control-alert-panel").scrollIntoView({behavior:'smooth',block:'start'});
});
$("control-alert-panel").addEventListener("toggle", () => { if ($("control-alert-panel").open) renderControlAlerts(true); });
$("control-alert-panel").addEventListener("click", event => {
  const button = event.target.closest('[data-alert-chart], [data-alert-dismiss], [data-alert-remove], [data-alert-rearm]');
  if (!button) return;
  try {
    if (button.dataset.alertChart) {
      const alert = controlAlerts.all().alerts.find(a=>a.id === button.dataset.alertChart);
      if (alert) {
        const symbol = `${alert.exchange.toUpperCase()}:${alert.symbol}.P`;
        window.open(`https://www.tradingview.com/chart/${TRADINGVIEW_CHART_LAYOUT_ID}/?symbol=${encodeURIComponent(symbol)}`, '_blank', 'noopener,noreferrer');
      }
    } else if (button.dataset.alertDismiss) controlAlerts.dismiss(button.dataset.alertDismiss);
    else if (button.dataset.alertRemove) controlAlerts.remove(button.dataset.alertRemove);
    else if (button.dataset.alertRearm) { controlAlerts.rearm(button.dataset.alertRearm); void pollControlAlerts(); }
    renderControlAlerts(true);
  } catch (error) { $("alert-message").textContent = error.message; }
});
renderControlAlerts(true);
void pollControlAlerts();
setInterval(pollControlAlerts, REFRESH_SECONDS * 1000);

$("exchange").addEventListener("change", () => { $("alert-exchange").value = state.exchange; });

$("alert-check-now").addEventListener("click", () => { void pollControlAlerts(); });
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === 'visible') { alertPollController?.abort(); setTimeout(()=>{ void pollControlAlerts(); }, 0); }
});
window.addEventListener("pageshow", () => { void pollControlAlerts(); });
