(() => {
  // Stable board ranking layer. Data collection remains fast; board order publishes once per minute.
  const PUBLISH_INTERVAL_MS = 60_000;
  const EMA_ALPHA = 0.35;
  const HISTORY_LIMIT = 6;
  const SCORE_WEIGHTS = { price: 0.40, volume: 0.35, oi: 0.25 };
  const samples = new Map();
  const smoothed = new Map();
  let lastPublish = 0;
  let publishScheduled = false;
  let touchActive = false;

  function finite(value) {
    return Number.isFinite(Number(value)) ? Number(value) : null;
  }

  function activityRows(data) {
    const rows = [
      ...(Array.isArray(data?.main_board) ? data.main_board : []),
      ...(Array.isArray(data?.discovery_candidates) ? data.discovery_candidates : []),
      ...(Array.isArray(data?.rows) ? data.rows : []),
      ...(Array.isArray(data?.retained_rows) ? data.retained_rows : []),
    ];
    const map = new Map();
    for (const row of rows) {
      if (row?.symbol) map.set(row.symbol, row);
    }
    return [...map.values()];
  }

  function percentile(value, values) {
    if (value == null || !values.length) return null;
    const sorted = values.slice().sort((a, b) => a - b);
    if (sorted.length === 1) return 100;
    let below = 0;
    let equal = 0;
    for (const item of sorted) {
      if (item < value) below += 1;
      else if (item === value) equal += 1;
    }
    return ((below + equal * 0.5) / sorted.length) * 100;
  }

  function rawMetrics(row) {
    const price = finite(row.change_5m_pct);
    const volume = finite(row.rvol_5m ?? row.volume_ratio);
    const oi = finite(row.oi_5m_pct);
    return {
      price: price == null ? null : Math.abs(price),
      volume: volume == null ? null : Math.max(0, volume),
      oi: oi == null ? null : Math.abs(oi),
    };
  }

  function updateRanking(rows) {
    const metrics = rows.map(rawMetrics);
    const values = {
      price: metrics.map(m => m.price).filter(v => v != null),
      volume: metrics.map(m => m.volume).filter(v => v != null),
      oi: metrics.map(m => m.oi).filter(v => v != null),
    };
    const now = Date.now();
    const seen = new Set();

    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      const symbol = row.symbol;
      const m = metrics[i];
      if (!symbol) continue;
      seen.add(symbol);
      const components = [];
      if (m.price != null && values.price.length > 1) components.push([percentile(m.price, values.price), SCORE_WEIGHTS.price]);
      if (m.volume != null && values.volume.length > 1) components.push([percentile(m.volume, values.volume), SCORE_WEIGHTS.volume]);
      if (m.oi != null && values.oi.length > 1) components.push([percentile(m.oi, values.oi), SCORE_WEIGHTS.oi]);
      if (!components.length) continue;
      const weight = components.reduce((sum, item) => sum + item[1], 0);
      const raw = components.reduce((sum, item) => sum + item[0] * item[1], 0) / weight;
      const previous = smoothed.get(symbol);
      const score = previous == null ? raw : previous + EMA_ALPHA * (raw - previous);
      smoothed.set(symbol, score);
      const history = samples.get(symbol) || [];
      history.push({ ts: now, score });
      samples.set(symbol, history.slice(-HISTORY_LIMIT));
    }

    // Keep the memory bounded when discovery rotates symbols.
    for (const symbol of smoothed.keys()) {
      if (!seen.has(symbol)) {
        const history = samples.get(symbol) || [];
        if (!history.length || now - history[history.length - 1].ts > 15 * 60_000) {
          smoothed.delete(symbol);
          samples.delete(symbol);
        }
      }
    }
  }

  function userIsInteracting() {
    if (touchActive) return true;
    const board = document.getElementById('main-board');
    return !!board && board.matches(':hover');
  }

  function publishOrder() {
    publishScheduled = false;
    const tbody = document.getElementById('main-board');
    if (!tbody || userIsInteracting()) return;

    const rows = [...tbody.querySelectorAll(':scope > tr')];
    if (rows.length < 2) return;

    const fixed = row => row.classList.contains('btc-row') || row.classList.contains('pinned-row');
    const normal = rows.filter(row => !fixed(row));
    if (normal.length < 2) return;

    const originalIndex = new Map(normal.map((row, index) => [row, index]));
    normal.sort((a, b) => {
      const sa = smoothed.get(a.querySelector('[data-symbol]')?.dataset.symbol) ?? -1;
      const sb = smoothed.get(b.querySelector('[data-symbol]')?.dataset.symbol) ?? -1;
      if (sb !== sa) return sb - sa;
      return originalIndex.get(a) - originalIndex.get(b);
    });

    // Rebuild the tbody in the same fixed-row slots, filling only movable slots with the ranked rows.
    const fixedSlots = rows.map(row => fixed(row));
    for (const row of rows) row.remove();
    let normalIndex = 0;
    for (const isFixed of fixedSlots) {
      if (isFixed) {
        const originalRow = rows.find(row => fixed(row) && !row.isConnected);
        if (originalRow) tbody.appendChild(originalRow);
      } else {
        tbody.appendChild(normal[normalIndex++]);
      }
    }
    lastPublish = Date.now();
  }

  function schedulePublish() {
    if (publishScheduled) return;
    const wait = Math.max(0, PUBLISH_INTERVAL_MS - (Date.now() - lastPublish));
    publishScheduled = true;
    setTimeout(publishOrder, wait);
  }

  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const response = await nativeFetch(input, init);
    try {
      const clone = response.clone();
      if (clone.ok) {
        clone.json().then(data => {
          updateRanking(activityRows(data));
          schedulePublish();
        }).catch(() => {});
      }
    } catch (_) {}
    return response;
  };

  document.addEventListener('pointerdown', event => {
    if (event.target.closest('#main-board')) touchActive = true;
  }, { passive: true });
  document.addEventListener('pointerup', () => { touchActive = false; }, { passive: true });
  document.addEventListener('touchstart', event => {
    if (event.target.closest('#main-board')) touchActive = true;
  }, { passive: true });
  document.addEventListener('touchend', () => { touchActive = false; }, { passive: true });
  document.addEventListener('touchcancel', () => { touchActive = false; }, { passive: true });
  document.addEventListener('scroll', event => {
    if (event.target === document || event.target?.closest?.('#main-board')) {
      if (Date.now() - lastPublish >= PUBLISH_INTERVAL_MS) schedulePublish();
    }
  }, { passive: true, capture: true });
})();