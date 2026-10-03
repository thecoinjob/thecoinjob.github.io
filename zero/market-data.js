window.ZeroMarketData = (() => {
  const REST = {
    bybit: 'https://api.bybit.com',
    binance: 'https://fapi.binance.com',
  };
  const WS = {
    bybit: 'wss://stream.bybit.com/v5/public/linear',
    binance: 'wss://fstream.binance.com/stream',
  };

  function intervalFor(exchange, interval) {
    const value = String(interval);
    if (exchange === 'bybit') return value === '1h' ? '60' : value === '4h' ? '240' : value === '1d' ? 'D' : value;
    return value === '1h' ? '1h' : value === '4h' ? '4h' : value === '1d' ? '1d' : `${value}m`;
  }

  async function json(url, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeout || 15000);
    try {
      const response = await fetch(url, { cache: 'no-store', signal: controller.signal });
      const text = await response.text();
      let body;
      try { body = JSON.parse(text); } catch (_) { body = text; }
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${typeof body === 'string' ? body.slice(0, 180) : JSON.stringify(body).slice(0, 180)}`);
      return body;
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('Request timed out');
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  function normalizeKlines(exchange, payload) {
    if (exchange === 'bybit') {
      if (payload?.retCode !== 0) throw new Error(payload?.retMsg || 'Bybit kline request failed');
      return (payload.result?.list || []).map(r => ({
        time: Number(r[0]), open: Number(r[1]), high: Number(r[2]), low: Number(r[3]), close: Number(r[4]), volume: Number(r[5]), turnover: Number(r[6])
      })).sort((a, b) => a.time - b.time);
    }
    return (payload || []).map(r => ({
      time: Number(r[0]), open: Number(r[1]), high: Number(r[2]), low: Number(r[3]), close: Number(r[4]), volume: Number(r[5]), turnover: Number(r[7])
    })).sort((a, b) => a.time - b.time);
  }

  async function candles(exchange, symbol, interval = '5', limit = 300) {
    const iv = intervalFor(exchange, interval);
    if (exchange === 'bybit') {
      const url = `${REST.bybit}/v5/market/kline?category=linear&symbol=${encodeURIComponent(symbol.toUpperCase())}&interval=${encodeURIComponent(iv)}&limit=${Math.min(Number(limit) || 300, 1000)}`;
      return normalizeKlines(exchange, await json(url));
    }
    const url = `${REST.binance}/fapi/v1/klines?symbol=${encodeURIComponent(symbol.toUpperCase())}&interval=${encodeURIComponent(iv)}&limit=${Math.min(Number(limit) || 300, 1500)}`;
    return normalizeKlines(exchange, await json(url));
  }

  async function ticker(exchange, symbol) {
    if (exchange === 'bybit') {
      const data = await json(`${REST.bybit}/v5/market/tickers?category=linear&symbol=${encodeURIComponent(symbol.toUpperCase())}`);
      if (data?.retCode !== 0) throw new Error(data?.retMsg || 'Bybit ticker request failed');
      return data.result?.list?.[0] || null;
    }
    return json(`${REST.binance}/fapi/v1/ticker/24hr?symbol=${encodeURIComponent(symbol.toUpperCase())}`);
  }

  function sub(exchange, symbols) {
    const unique = [...new Set(symbols.map(x => x.toUpperCase()))];
    return exchange === 'bybit'
      ? { op: 'subscribe', args: unique.map(x => `tickers.${x}`) }
      : { method: 'SUBSCRIBE', params: unique.map(x => `${x.toLowerCase()}@ticker`), id: Date.now() };
  }

  function normTicker(exchange, message) {
    if (exchange === 'bybit') {
      const d = message?.data;
      if (!d?.symbol) return null;
      return { exchange, symbol: d.symbol, price: Number(d.lastPrice), volume24h: Number(d.volume24h), turnover24h: Number(d.turnover24h), ts: Number(d.ts || message.ts || Date.now()) };
    }
    const d = message?.data || message;
    if (!d?.s) return null;
    return { exchange, symbol: d.s, price: Number(d.c), volume24h: Number(d.v), turnover24h: Number(d.q), ts: Number(d.E || Date.now()) };
  }

  function stream(exchange, symbols, { onTicker = () => {}, onStatus = () => {} } = {}) {
    let socket;
    let stopped = false;
    function connect() {
      socket = new WebSocket(WS[exchange]);
      socket.onopen = () => { onStatus({ exchange, status: 'OPEN' }); socket.send(JSON.stringify(sub(exchange, symbols))); };
      socket.onmessage = event => { try { const row = normTicker(exchange, JSON.parse(event.data)); if (row) onTicker(row); } catch (_) {} };
      socket.onerror = () => onStatus({ exchange, status: 'ERROR' });
      socket.onclose = () => { onStatus({ exchange, status: 'CLOSED' }); if (!stopped) setTimeout(connect, 1500); };
    }
    connect();
    return { close() { stopped = true; if (socket) socket.close(); } };
  }

  return { candles, ticker, stream, REST };
})();
