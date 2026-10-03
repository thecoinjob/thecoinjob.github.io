/*
 * Zero browser data engine v2.
 * Same output contract as browser-data.js, but exchange sub-requests are
 * isolated so one failed auxiliary endpoint never removes the whole market.
 */
(() => {
  "use strict";

  const DEFAULT_SYMBOLS = [
    "BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "HYPEUSDT",
    "ZECUSDT", "DOGEUSDT", "SUIUSDT", "BCHUSDT", "LINKUSDT", "ADAUSDT", "LTCUSDT",
  ];
  const CACHE_TTL_MS = 10_000;
  const MARKET_CAP_TTL_MS = 15 * 60_000;
  const REQUEST_TIMEOUT_MS = 5_000;
  const MAX_CONCURRENCY = 4;
  const ENDPOINTS = { bybit: "https://api.bybit.com", binance: "https://fapi.binance.com" };
  const cache = new Map();
  let marketCapCache = { at: 0, values: {} };

  const finite = value => { const n = Number(value); return Number.isFinite(n) ? n : null; };
  const pct = (current, previous) => current == null || previous == null || previous === 0 ? null : ((current / previous) - 1) * 100;
  const sum = values => { const nums = values.filter(v => Number.isFinite(v)); return nums.length === values.length ? nums.reduce((a,b) => a+b, 0) : null; };
  const sorted = rows => [...rows].sort((a,b) => a.time - b.time);

  async function getJson(url, params = {}) {
    const query = new URLSearchParams();
    for (const [key,value] of Object.entries(params)) if (value !== undefined && value !== null && value !== "") query.set(key, String(value));
    const full = query.toString() ? `${url}?${query}` : url;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(full, { method:"GET", cache:"no-store", signal:controller.signal, headers:{Accept:"application/json"} });
      if (!response.ok) return null;
      return await response.json();
    } catch (_) {
      return null;
    } finally { clearTimeout(timer); }
  }

  async function pool(items, worker, concurrency = MAX_CONCURRENCY) {
    const results = new Array(items.length); let cursor = 0;
    async function runner() {
      while (true) {
        const index = cursor++;
        if (index >= items.length) return;
        try { results[index] = await worker(items[index], index); }
        catch (error) { results[index] = { error: error instanceof Error ? error.message : String(error) }; }
      }
    }
    await Promise.all(Array.from({length:Math.min(concurrency,items.length)}, runner));
    return results;
  }

  function parseBybitKlines(payload) {
    const list = payload?.result?.list || [];
    return sorted(list.map(row => ({time:Number(row[0]),open:finite(row[1]),high:finite(row[2]),low:finite(row[3]),close:finite(row[4]),volume:finite(row[5]),turnover:finite(row[6])})).filter(row => Number.isFinite(row.time)));
  }
  function parseBinanceKlines(payload) {
    return sorted((Array.isArray(payload) ? payload : []).map(row => ({time:Number(row[0]),open:finite(row[1]),high:finite(row[2]),low:finite(row[3]),close:finite(row[4]),volume:finite(row[5]),turnover:finite(row[7])})).filter(row => Number.isFinite(row.time)));
  }
  function stripOpenCandle(candles, now = Date.now(), intervalMs = 300_000) { return candles.filter(c => c.time + intervalMs <= now + 1_000); }
  function windowStats(candles, count) {
    if (candles.length < count * 2) return {change:null,volumeChange:null};
    const current=candles.slice(-count), previous=candles.slice(-count*2,-count);
    const currentClose=current.at(-1)?.close, previousClose=previous.at(-1)?.close;
    const currentVolume=sum(current.map(c=>c.turnover ?? (c.close!=null&&c.volume!=null?c.close*c.volume:NaN)));
    const previousVolume=sum(previous.map(c=>c.turnover ?? (c.close!=null&&c.volume!=null?c.close*c.volume:NaN)));
    return {change:pct(currentClose,previousClose),volumeChange:pct(currentVolume,previousVolume)};
  }
  function derivePriceAndVolume(candles) {
    const windows={"5m":1,"15m":3,"1h":12,"4h":48,"24h":288}, out={};
    for(const [tf,count] of Object.entries(windows)){const s=windowStats(candles,count);out[`change_${tf}_pct`]=s.change;out[`volume_${tf}_pct`]=s.volumeChange;}
    const last=candles.at(-1); out.price=last?.close??null; out.market_data_time_unix=last?last.time/1000:0; return out;
  }
  function parseBybitOi(payload) { return (payload?.result?.list||[]).map(row=>({time:Number(row.timestamp),value:finite(row.singleOpenInterest??row.openInterest)})).filter(r=>Number.isFinite(r.time)&&r.value!=null).sort((a,b)=>a.time-b.time); }
  function parseBinanceOi(payload) { return (Array.isArray(payload)?payload:[]).map(row=>({time:Number(row.timestamp),value:finite(row.sumOpenInterestValue??row.sumOpenInterest)})).filter(r=>Number.isFinite(r.time)&&r.value!=null).sort((a,b)=>a.time-b.time); }
  function oiAtOrBefore(rows,target){let answer=null;for(const row of rows){if(row.time<=target)answer=row.value;else break;}return answer;}
  function deriveOi(rows5m,rows1h,now=Date.now()){
    const latest=rows5m.at(-1)?.value??rows1h.at(-1)?.value??null, source5m=rows5m.length?rows5m:rows1h;
    const valueAt=ms=>oiAtOrBefore(source5m,now-ms);
    return {oi_5m_pct:pct(latest,valueAt(5*60_000)),oi_15m_pct:pct(latest,valueAt(15*60_000)),oi_1h_pct:pct(latest,valueAt(60*60_000)),oi_4h_pct:pct(latest,oiAtOrBefore(rows1h,now-4*60*60_000)),oi_24h_pct:pct(latest,oiAtOrBefore(rows1h,now-24*60*60_000)),oi_status:latest!=null?"CURRENT":"MISSING",oi_reference_time_ms:rows5m.at(-1)?.time??rows1h.at(-1)?.time??0};
  }
  function crowdFromBybit(payload,ticker){const latest=payload?.result?.list?.[0],buy=finite(latest?.buyRatio),sell=finite(latest?.sellRatio);return {funding_rate:finite(ticker?.fundingRate),long_ratio:buy,short_ratio:sell,crowd_ratio:buy!=null&&sell!=null&&sell!==0?buy/sell:null,crowd_timestamp:finite(latest?.timestamp)};}
  function crowdFromBinance(payload,ticker){const latest=Array.isArray(payload)?payload.at(-1):null,longRatio=finite(latest?.longAccount),shortRatio=finite(latest?.shortAccount);return {funding_rate:finite(ticker?.lastFundingRate),long_ratio:longRatio,short_ratio:shortRatio,crowd_ratio:longRatio!=null&&shortRatio!=null&&shortRatio!==0?longRatio/shortRatio:null,crowd_timestamp:finite(latest?.timestamp)};}
  function participationFromRow(row){
    const price=finite(row.change_15m_pct),oi=finite(row.oi_15m_pct),volume=finite(row.volume_15m_pct);
    if(price==null||oi==null||volume==null)return {participation_trend:"QUIET",participation_direction:null};
    const activity=volume>20||Math.abs(oi)>0.3;
    if(!activity)return {participation_trend:"QUIET",participation_direction:null};
    if(price>0&&oi>0)return {participation_trend:"INCREASING",participation_direction:"BULLISH"};
    if(price<0&&oi>0)return {participation_trend:"INCREASING",participation_direction:"BEARISH"};
    if(oi<0&&Math.abs(price)>0.1)return {participation_trend:"DECREASING",participation_direction:price>0?"BULLISH":"BEARISH"};
    return {participation_trend:"ACTIVE",participation_direction:price>=0?"BULLISH":"BEARISH"};
  }

  async function bybitRow(symbol,ticker,now){
    const [klinePayload,oi5Payload,oi1hPayload,ratioPayload]=await Promise.all([
      getJson(`${ENDPOINTS.bybit}/v5/market/kline`,{category:"linear",symbol,interval:"5",limit:1000}),
      getJson(`${ENDPOINTS.bybit}/v5/market/open-interest`,{category:"linear",symbol,intervalTime:"5min",limit:200}),
      getJson(`${ENDPOINTS.bybit}/v5/market/open-interest`,{category:"linear",symbol,intervalTime:"1h",limit:30}),
      getJson(`${ENDPOINTS.bybit}/v5/market/account-ratio`,{category:"linear",symbol,period:"15min",limit:2}),
    ]);
    const candles=stripOpenCandle(parseBybitKlines(klinePayload),now), market=derivePriceAndVolume(candles), oi=deriveOi(parseBybitOi(oi5Payload),parseBybitOi(oi1hPayload),now), crowd=crowdFromBybit(ratioPayload,ticker);
    const row={symbol,base:symbol.replace(/USDT$/,""),...market,price:finite(ticker?.lastPrice)??market.price,turnover_24h:finite(ticker?.turnover24h),volume_24h:finite(ticker?.volume24h),market_cap_usd:null,turnover_24h_pct:null,...oi,...crowd,observed_at_unix:now/1000,data_status:"LIVE",source:"browser/bybit"};
    Object.assign(row,participationFromRow(row));
    row.data_quality={candles:!!klinePayload,oi5m:!!oi5Payload,oi1h:!!oi1hPayload,crowd:!!ratioPayload};
    return row;
  }

  async function binanceRow(symbol,ticker,now){
    const [klinePayload,oiPayload,ratioPayload,fundingPayload]=await Promise.all([
      getJson(`${ENDPOINTS.binance}/fapi/v1/klines`,{symbol,interval:"5m",limit:1000}),
      getJson(`${ENDPOINTS.binance}/futures/data/openInterestHist`,{symbol,period:"5m",contractType:"PERPETUAL",limit:500}),
      getJson(`${ENDPOINTS.binance}/futures/data/globalLongShortAccountRatio`,{symbol,period:"15m",contractType:"PERPETUAL",limit:2}),
      getJson(`${ENDPOINTS.binance}/fapi/v1/premiumIndex`,{symbol}),
    ]);
    const candles=stripOpenCandle(parseBinanceKlines(klinePayload),now),market=derivePriceAndVolume(candles),oiRows=parseBinanceOi(oiPayload),oi=deriveOi(oiRows,[],now),crowd=crowdFromBinance(ratioPayload,{...ticker,lastFundingRate:fundingPayload?.lastFundingRate});
    const latest=oiRows.at(-1)?.value??null;
    const row={symbol,base:symbol.replace(/USDT$/,""),...market,price:finite(ticker?.lastPrice)??market.price,turnover_24h:finite(ticker?.quoteVolume),volume_24h:finite(ticker?.volume),market_cap_usd:null,turnover_24h_pct:null,...oi,...crowd,observed_at_unix:now/1000,data_status:"LIVE",source:"browser/binance"};
    row.oi_4h_pct=pct(latest,oiAtOrBefore(oiRows,now-4*60*60_000));row.oi_24h_pct=pct(latest,oiAtOrBefore(oiRows,now-24*60*60_000));Object.assign(row,participationFromRow(row));
    row.data_quality={candles:!!klinePayload,oi5m:!!oiPayload,crowd:!!ratioPayload,funding:!!fundingPayload};return row;
  }

  async function marketCaps(symbols){
    const now=Date.now(); if(now-marketCapCache.at<MARKET_CAP_TTL_MS)return marketCapCache.values;
    try{
      const rows=await getJson("https://api.coingecko.com/api/v3/coins/markets",{vs_currency:"usd",order:"market_cap_desc",per_page:250,page:1,sparkline:"false"}),values={},wanted=new Set(symbols.map(s=>s.replace(/USDT$/i,"").toUpperCase()));
      for(const coin of Array.isArray(rows)?rows:[]){const symbol=String(coin?.symbol||"").toUpperCase();if(wanted.has(symbol)&&finite(coin?.market_cap)!=null)values[symbol]=finite(coin.market_cap);}
      marketCapCache={at:now,values};return values;
    }catch(_){return marketCapCache.values;}
  }

  async function fetchBybit(symbols){
    const tickerPayload=await getJson(`${ENDPOINTS.bybit}/v5/market/tickers`,{category:"linear"});
    const tickerMap=new Map((tickerPayload?.result?.list||[]).map(t=>[t.symbol,t]));
    const wanted=symbols.filter(symbol=>tickerMap.has(symbol));
    const results=await pool(wanted,symbol=>bybitRow(symbol,tickerMap.get(symbol),Date.now()));
    return results.filter(row=>row&&!row.error);
  }
  async function fetchBinance(symbols){
    const tickerPayload=await getJson(`${ENDPOINTS.binance}/fapi/v1/ticker/24hr`);
    const tickerMap=new Map((Array.isArray(tickerPayload)?tickerPayload:[]).map(t=>[t.symbol,t]));
    const wanted=symbols.filter(symbol=>tickerMap.has(symbol));
    const results=await pool(wanted,symbol=>binanceRow(symbol,tickerMap.get(symbol),Date.now()));
    return results.filter(row=>row&&!row.error);
  }
  function enrich(rows,caps){return rows.map(row=>{const cap=caps[row.base]??null;return {...row,market_cap_usd:cap,turnover_24h_pct:cap&&row.turnover_24h!=null?(row.turnover_24h/cap)*100:null};});}

  async function snapshot({exchange="bybit",symbols=DEFAULT_SYMBOLS,force=false}={}){
    exchange=exchange==="binance"?"binance":"bybit";
    const unique=[...new Set(symbols.map(s=>String(s).toUpperCase()).filter(s=>/USDT$/.test(s)))],key=`${exchange}:${unique.join(",")}`,cached=cache.get(key);
    if(!force&&cached&&Date.now()-cached.at<CACHE_TTL_MS)return cached.value;
    const [rows,caps]=await Promise.all([exchange==="binance"?fetchBinance(unique):fetchBybit(unique),marketCaps(unique)]);
    const value={exchange,rows:enrich(rows,caps),fetched_at_unix:Date.now()/1000,engine:"browser",source:exchange==="bybit"?ENDPOINTS.bybit:ENDPOINTS.binance};
    cache.set(key,{at:Date.now(),value});return value;
  }
  async function diagnostics(exchange="bybit"){const value=await snapshot({exchange,symbols:["BTCUSDT"],force:true}),row=value.rows[0]||null;return {ok:!!row,exchange,row,checked_at:Date.now()};}
  window.ZeroBrowserData={DEFAULT_SYMBOLS:[...DEFAULT_SYMBOLS],snapshot,diagnostics,clearCache:()=>{cache.clear();marketCapCache={at:0,values:{}};}};
})();
