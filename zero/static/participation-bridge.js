/* GitHub Pages participation presentation bridge.
   Browser-data-v2 already computes participation_trend + participation_direction.
   Normalize those native fields into the exact Zero board label consumed by the
   directional participation UI. No new participation formula is introduced. */
(() => {
  "use strict";
  const nativeFetch = window.fetch.bind(window);

  function decorateRow(row) {
    if (!row || typeof row !== "object") return row;
    const direction = String(row.participation_direction || "").toUpperCase();
    const trend = String(row.participation_trend || "").toUpperCase();
    if (direction === "BULLISH" && trend === "INCREASING") {
      return { ...row, participation: "Bullish Participation Increasing ↑", participation_status: "CURRENT" };
    }
    if (direction === "BEARISH" && trend === "INCREASING") {
      return { ...row, participation: "Bearish Participation Increasing ↑", participation_status: "CURRENT" };
    }
    if (direction === "BULLISH" && trend === "DECREASING") {
      return { ...row, participation: "Bullish Participation Decreasing ↓", participation_status: "CURRENT" };
    }
    if (direction === "BEARISH" && trend === "DECREASING") {
      return { ...row, participation: "Bearish Participation Decreasing ↓", participation_status: "CURRENT" };
    }
    return { ...row, participation: "", participation_status: row.participation_status || "CURRENT" };
  }

  function transform(payload) {
    if (!payload || typeof payload !== "object") return payload;
    const mapRows = rows => Array.isArray(rows) ? rows.map(decorateRow) : rows;
    return {
      ...payload,
      main_board: mapRows(payload.main_board),
      retained_rows: mapRows(payload.retained_rows),
      discovery_candidates: mapRows(payload.discovery_candidates),
      rows: mapRows(payload.rows),
      row: payload.row ? decorateRow(payload.row) : payload.row,
    };
  }

  window.fetch = async function(input, init) {
    const raw = typeof input === "string" ? input : input?.url || "";
    const url = new URL(raw, location.href);
    const watched = ["/api/screen/", "/api/watch/", "/api/search/", "/api/snapshot/"]
      .some(prefix => url.pathname.startsWith(prefix));
    const response = await nativeFetch(input, init);
    if (!watched || !response.ok) return response;
    try {
      const payload = await response.clone().json();
      return new Response(JSON.stringify(transform(payload)), {
        status: response.status,
        statusText: response.statusText,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      });
    } catch (_) {
      return response;
    }
  };
})();
