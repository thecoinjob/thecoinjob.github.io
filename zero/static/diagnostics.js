/* Zero diagnostic harness: visible, read-only pipeline checks. Remove after recovery. */
(() => {
  "use strict";

  /* The API already produced 32 rows in the previous diagnostic. The app then
     passed those rows through ZeroBrowserBoard.visible(), where PARTIAL
     diagnostic rows were rejected by the normal LIVE/fresh retention rules.
     Wrap create() before app.js calls it so diagnostic fallback rows can reach
     the DOM. This is intentionally limited to PARTIAL rows and screen mode. */
  const installBoardDiagnosticBridge = () => {
    const Board = window.ZeroBrowserBoard;
    if (!Board || typeof Board.create !== "function" || Board.__diagnosticBridge) return;
    const originalCreate = Board.create;
    Board.create = function(storage) {
      const instance = originalCreate(storage);
      const originalVisible = instance.visible;
      instance.visible = function(rows, exchange, now = Date.now(), screenMode = false) {
        const input = Array.isArray(rows) ? rows : [];
        if (screenMode) {
          const partial = input.filter(row => row && row.data_status === "PARTIAL" && typeof row.symbol === "string");
          if (partial.length) {
            const entry = instance.board(exchange);
            const btc = partial.find(row => row.symbol === "BTCUSDT");
            const automatic = partial.filter(row => row.symbol !== "BTCUSDT")
              .sort((a, b) => (Number(b.turnover_24h) || 0) - (Number(a.turnover_24h) || 0))
              .slice(0, 31);
            const output = btc ? [btc, ...automatic] : automatic.slice(0, 32);
            return output.map((row, index) => ({
              ...row,
              pinned_order: index === 0 ? 0 : null,
              automatic_mover: row.symbol !== "BTCUSDT" && !entry.saved.includes(row.symbol),
              retained_on_board: true,
            }));
          }
        }
        return originalVisible(rows, exchange, now, screenMode);
      };
      return instance;
    };
    Board.__diagnosticBridge = true;
  };
  installBoardDiagnosticBridge();

  const start = Date.now();
  function ensurePanel() {
    let panel = document.getElementById("zero-diagnostics");
    if (panel) return panel;
    panel = document.createElement("aside");
    panel.id = "zero-diagnostics";
    panel.style.cssText = "position:fixed;right:10px;bottom:10px;z-index:99999;max-width:430px;background:#111;color:#eee;border:1px solid #555;border-radius:8px;padding:10px;font:12px/1.45 monospace;box-shadow:0 4px 20px #0008;white-space:pre-wrap";
    document.body.appendChild(panel);
    return panel;
  }
  function line(label, value) { return `${label}: ${value}`; }
  async function run() {
    const panel = ensurePanel();
    const engine = window.ZeroBrowserEngine;
    const data = window.ZeroBrowserData;
    const board = window.ZeroBrowserBoard;
    const appBoard = !!document.getElementById("main-board");
    panel.textContent = [
      "ZERO 3-STAGE DIAGNOSTICS",
      line("Stage 1 engine loaded", !!engine),
      line("Stage 1 data engine loaded", !!data),
      line("Stage 1 board module loaded", !!board),
      line("Stage 1 main board DOM", appBoard),
      line("Engine version", engine?.version || "MISSING"),
      line("Board diagnostic bridge", !!board?.__diagnosticBridge),
      "Stage 2: testing /api/screen/bybit ..."
    ].join("\n");
    try {
      const response = await fetch("/api/screen/bybit?diagnostic=1", {cache:"no-store"});
      const payload = await response.json();
      const rows = Array.isArray(payload?.main_board) ? payload.main_board : [];
      const retained = Array.isArray(payload?.retained_rows) ? payload.retained_rows : [];
      panel.textContent = [
        "ZERO 3-STAGE DIAGNOSTICS",
        line("Stage 1 engine loaded", !!engine),
        line("Stage 1 data engine loaded", !!data),
        line("Stage 1 board module loaded", !!board),
        line("Stage 1 main board DOM", appBoard),
        line("Engine version", engine?.version || "MISSING"),
        line("Board diagnostic bridge", !!board?.__diagnosticBridge),
        "",
        "STAGE 2 API INTERCEPTION",
        line("HTTP", response.status),
        line("engine", payload?.engine || "MISSING"),
        line("market_count", payload?.market_count ?? "MISSING"),
        line("universe_count", payload?.universe_count ?? "MISSING"),
        line("main_board rows", rows.length),
        line("retained rows", retained.length),
        line("fresh count", payload?.screen?.fresh_count ?? "MISSING"),
        line("fallback mode", payload?.screen?.fallback_mode ?? "MISSING"),
        line("cap status", payload?.market_cap_status?.source ?? "MISSING"),
        "",
        "STAGE 3 BOARD DATA",
        line("first symbols", rows.slice(0,8).map(r => r.symbol).join(", ") || "NONE"),
        line("BTC present", rows.some(r => r.symbol === "BTCUSDT")),
        line("diagnostic age", `${Date.now()-start}ms`),
        "",
        rows.length ? "PASS: API produced board rows." : "FAIL: API returned ZERO board rows."
      ].join("\n");
    } catch (error) {
      panel.textContent += `\n\nSTAGE 2 FAILED\n${error?.name || "Error"}: ${error?.message || String(error)}\n\nSTAGE 3 cannot proceed until API interception works.`;
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => setTimeout(run, 250));
  else setTimeout(run, 250);
  window.ZeroDiagnostics = {run};
})();
