/* Zero diagnostic harness: visible, read-only pipeline checks. Remove after recovery. */
(() => {
  "use strict";
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
