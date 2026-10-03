/* Zero discovery guard: prevent transient browser exchange-discovery failures from
 * collapsing a healthy scanner into "0 markets". No market-cap or eligibility logic
 * is changed here. */
(() => {
  "use strict";
  const original = window.ZeroBrowserData?.snapshot;
  if (typeof original !== "function") return;

  let lastGood = new Map();
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  window.ZeroBrowserData.snapshot = async function guardedSnapshot(options = {}) {
    const exchange = options.exchange === "binance" ? "binance" : "bybit";
    let result = await original(options);

    if (Number(result?.universe_count) > 0) {
      lastGood.set(exchange, result);
      return result;
    }

    // A zero universe is treated as a discovery failure, not as a valid empty
    // exchange. Retry after clearing the browser-data caches once.
    if (!options.symbols?.length) {
      try {
        window.ZeroBrowserData.clearCache?.();
        await sleep(750);
        result = await original({ ...options, force: true });
        if (Number(result?.universe_count) > 0) {
          lastGood.set(exchange, result);
          return result;
        }
      } catch (_) {}

      const previous = lastGood.get(exchange);
      if (previous && Number(previous.universe_count) > 0) {
        return {
          ...previous,
          stale_discovery: true,
          stale_discovery_reason: "Exchange discovery temporarily returned zero markets; retaining the last known universe."
        };
      }
    }

    return result;
  };
})();
