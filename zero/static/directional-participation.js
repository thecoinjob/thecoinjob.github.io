(() => {
  const CONTROL_TFS = new Set([15, 60, 240, 1440]);
  const COMBINATIONS = [
    ["", "All combinations"],
    ["bullish:Bullish:INCREASING", "Bullish Control + Bullish Participation Increasing ↑"],
    ["bullish:Bearish:INCREASING", "Bullish Control + Bearish Participation Increasing ↑"],
    ["bearish:Bearish:INCREASING", "Bearish Control + Bearish Participation Increasing ↑"],
    ["bearish:Bullish:INCREASING", "Bearish Control + Bullish Participation Increasing ↑"],
  ];
  const rowCache = new Map();
  let selectedCombination = "";
  let observer = null;
  let applying = false;

  function selectedControlTf() {
    try {
      const value = Number(localStorage.getItem("0scan1.control-tf.v1"));
      return CONTROL_TFS.has(value) ? value : 15;
    } catch (_) { return 15; }
  }

  function controlMetricKeys(tf) {
    const suffix = ({15: "15m", 60: "1h", 240: "4h", 1440: "24h"})[Number(tf)];
    if (!suffix) return null;
    return {
      price: `change_${suffix}_pct`,
      oi: `oi_${suffix}_pct`,
      volume: `volume_${suffix}_pct`,
    };
  }

  function resetMetricColumnsToControlTf(tf) {
    const keys = controlMetricKeys(tf);
    if (!keys) return;
    try {
      const saved = JSON.parse(localStorage.getItem("0scanner.columns.v1") || "{}");
      localStorage.setItem("0scanner.columns.v1", JSON.stringify({
        ...saved,
        price: [keys.price], oi: [keys.oi], volume: [keys.volume],
      }));
    } catch (_) {
      localStorage.setItem("0scanner.columns.v1", JSON.stringify({ price: [keys.price], oi: [keys.oi], volume: [keys.volume] }));
    }
  }

  function normalizeLabel(row) {
    const label = String(row?.participation || "");
    return /^(Bullish|Bearish) Participation (Increasing|Decreasing) [↑↓]$/.test(label) ? label : "";
  }

  function participationSide(row) {
    const label = normalizeLabel(row);
    if (label.startsWith("Bullish Participation")) return "Bullish";
    if (label.startsWith("Bearish Participation")) return "Bearish";
    return "";
  }

  function participationTrend(row) {
    const label = normalizeLabel(row);
    if (label.includes("Increasing")) return "INCREASING";
    if (label.includes("Decreasing")) return "DECREASING";
    return "";
  }

  function combinationMatch(row, controlText, key) {
    if (!key) return true;
    const [controlDirection, side, trend] = key.split(":");
    const expected = controlDirection === "bullish" ? "Bullish Control" : "Bearish Control";
    return String(controlText || "").includes(expected) && participationSide(row) === side && participationTrend(row) === trend;
  }

  function setLabelElement(element, label) {
    const text = label || "Participation Pending";
    const match = text.match(/^(Bullish|Bearish) Participation (Increasing|Decreasing) ([↑↓])$/);
    if (!match) {
      element.textContent = text;
      element.classList.remove("up", "down", "state", "pending");
      element.classList.add("pending");
      return;
    }
    const [, side, trend, arrow] = match;
    const sideColor = side === "Bullish" ? "var(--green)" : "var(--red)";
    const trendColor = trend === "Increasing" ? "var(--green)" : "var(--red)";
    element.innerHTML = `<span style="color:${sideColor};font-weight:800">${side} Participation</span> <span style="color:${trendColor};font-weight:800">${trend} ${arrow}</span>`;
    element.classList.remove("up", "down", "state", "pending");
    element.classList.add("state");
  }

  function syncCombinationOptions() {
    const select = document.querySelector(".control-focus");
    if (!select) return;
    const desired = COMBINATIONS.map(([value, label]) => `${value}\u0000${label}`).join("\u0001");
    const actual = [...select.options].map(option => `${option.value}\u0000${option.textContent}`).join("\u0001");
    if (actual === desired) return;
    select.innerHTML = COMBINATIONS.map(([value, label]) => `<option value="${value}">${label}</option>`).join("");
    select.value = COMBINATIONS.some(([value]) => value === selectedCombination) ? selectedCombination : "";
  }

  function applyBoard() {
    if (applying) return;
    applying = true;
    observer?.disconnect();
    try {
      syncCombinationOptions();
      document.querySelectorAll("#main-board tr").forEach((tr) => {
        const symbol = tr.querySelector("[data-symbol]")?.dataset.symbol;
        if (!symbol) return;
        const row = rowCache.get(symbol);
        if (!row) return;
        const controlLines = tr.querySelectorAll(".control-stack .control-line");
        const controlText = controlLines[0]?.textContent || "";
        if (controlLines.length >= 2) {
          setLabelElement(controlLines[1], normalizeLabel(row));
          controlLines[1].classList.add("directional-participation-label");
          controlLines[1].style.fontSize = "11px";
          controlLines[1].style.whiteSpace = "nowrap";
          controlLines[1].style.overflow = "hidden";
          controlLines[1].style.textOverflow = "clip";
          while (controlLines[1].scrollWidth > controlLines[1].clientWidth && parseFloat(controlLines[1].style.fontSize) > 7) {
            controlLines[1].style.fontSize = `${parseFloat(controlLines[1].style.fontSize) - 0.5}px`;
          }
        }
        const fixed = tr.classList.contains("btc-row") || tr.classList.contains("pinned-row");
        tr.style.display = fixed || combinationMatch(row, controlText, selectedCombination) ? "" : "none";
      });
    } finally {
      applying = false;
      observer?.observe(document.body, { childList: true, subtree: true });
    }
  }

  function captureRows(data) {
    const rows = [...(Array.isArray(data?.main_board) ? data.main_board : []), ...(Array.isArray(data?.discovery_candidates) ? data.discovery_candidates : []), ...(Array.isArray(data?.retained_rows) ? data.retained_rows : []), ...(Array.isArray(data?.rows) ? data.rows : [])];
    for (const row of rows) if (row?.symbol) rowCache.set(row.symbol, row);
    requestAnimationFrame(applyBoard);
  }

  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.toString() : input?.url;
    if (!raw) return nativeFetch(input, init);
    const url = new URL(raw, window.location.href);
    if (["/api/screen/", "/api/watch/", "/api/search/", "/api/snapshot/"].some(prefix => url.pathname.startsWith(prefix))) {
      url.searchParams.set("control_tf", String(selectedControlTf()));
      const response = await nativeFetch(url.toString(), init);
      if (response.ok) response.clone().json().then(captureRows).catch(() => {});
      return response;
    }
    return nativeFetch(input, init);
  };

  const filterForm = document.getElementById("filter-form");
  filterForm?.addEventListener("submit", () => {
    setTimeout(() => {
      try {
        const filters = {};
        document.querySelectorAll("#filter-form [data-filter-key]").forEach(input => {
          if (input.value.trim() !== "") filters[input.dataset.filterKey] = Number(input.value);
        });
        if (typeof personalBoard !== "undefined" && personalBoard?.savePreset) personalBoard.savePreset(filters);
      } catch (_) {}
    }, 0);
  });

  document.addEventListener("change", (event) => {
    if (event.target?.classList?.contains("control-focus")) {
      selectedCombination = event.target.value;
      requestAnimationFrame(applyBoard);
    }
    if (event.target?.classList?.contains("control-tf")) {
      const tf = Number(event.target.value);
      selectedCombination = "";
      resetMetricColumnsToControlTf(tf);
      setTimeout(() => { syncCombinationOptions(); window.location.reload(); }, 0);
    }
  });

  observer = new MutationObserver(() => { if (!applying) applyBoard(); });
  observer.observe(document.body, { childList: true, subtree: true });
  window.addEventListener("resize", applyBoard);
  setTimeout(() => { syncCombinationOptions(); applyBoard(); }, 0);
})();
