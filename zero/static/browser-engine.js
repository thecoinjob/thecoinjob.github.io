/* GitHub-only Zero engine bridge. Intercepts the old /api/* calls and serves browser-computed data. */
(() => {
  "use strict";
  const nativeFetch = window.fetch.bind(window);
  const controlCache = new Map();
  const candleCache = new Map();
  const marketCache = new Map();
  const symbolAliases = {"币安人生":"BIANRENSHENGUSDT","币安人生USDT":"BIANRENSHENGUSDT",BINANCELIFE:"BIANRENSHENGUSDT",BINANCELIFEUSDT:"BIANRENSHENGUSDT"};
  const tfMinutes = [15,60,240,1440];
  const tfToInterval = tf => ({15:"15",60:"60",240:"240",1440:"D"}[tf]);
  const now = () => Date.now();
  const json = value => new Response(JSON.stringify(value), {status:200,headers:{"Content-Type":"application/json","Cache-Control":"no-store"}});
  const error = (status,message) => new Response(JSON.stringify({detail:message}), {status,headers:{"Content-Type":"application/json"}});
  const finite = v => Number.isFinite(Number(v)) ? Number(v) : null;
  const pct = (a,b) => a==null||b==null||b===0 ? null : ((a/b)-1)*100;
  const median = values => { const a=values.filter(Number.isFinite).sort((x,y)=>x-y); if(!a.length)return null; const n=a.length; return n%2?a[(n-1)/2]:(a[n/2-1]+a[n/2])/2; };
  function selectedSymbols(exchange){
    const fallback = window.ZeroBrowserData?.DEFAULT_SYMBOLS || ["BTCUSDT","ETHUSDT","SOLUSDT","BNBUSDT","XRPUSDT","HYPEUSDT","ZECUSDT","DOGEUSDT","SUIUSDT","BCHUSDT","LINKUSDT","ADAUSDT","LTCUSDT","XAUUSDT","XAGUSDT"];
    const out = [...fallback];
    try {
      const saved = JSON.parse(localStorage.getItem("zero-scanner.browser-board.v4") || "null");
      const list = saved?.exchanges?.[exchange]?.saved;
      if (Array.isArray(list)) out.push(...list);
    } catch (_) {}
    return [...new Set(["BTCUSDT",...out.map(s=>String(s).toUpperCase())].filter(s=>/USDT$/.test(s)))];
  }
  async function marketList(exchange){
    const cached=marketCache.get(exchange); if(cached && now()-cached.at<60000)return cached.value;
    try {
      let markets=[];
      if(exchange==="bybit"){
        const r=await nativeFetch("https://api.bybit.com/v5/market/instruments-info?category=linear&limit=1000",{cache:"no-store"});
        const p=await r.json(); markets=(p?.result?.list||[]).filter(x=>x.status==="Trading" && /USDT$/.test(x.symbol)).map(x=>({symbol:x.symbol,base:x.baseCoin||x.symbol.replace(/USDT$/i,"")}));
      } else {
        const r=await nativeFetch("https://fapi.binance.com/fapi/v1/exchangeInfo",{cache:"no-store"});
        const p=await r.json(); markets=(p?.symbols||[]).filter(x=>x.status==="TRADING" && x.contractType==="PERPETUAL" && x.quoteAsset==="USDT").map(x=>({symbol:x.symbol,base:x.baseAsset||x.symbol.replace(/USDT$/i,"")}));
      }
      marketCache.set(exchange,{at:now(),value:markets}); return markets;
    } catch (_) { return []; }
  }
  async function rowsFor(exchange,symbols,force=false){
    if(!window.ZeroBrowserData) throw new Error("Browser data engine is not loaded");
    const snap=await window.ZeroBrowserData.snapshot({exchange,symbols,force});
    const rows=snap.rows||[];
    const btc=rows.find(r=>r.symbol==="BTCUSDT");
    const candleRows=await Promise.all(rows.map(r=>decorateRow(r,btc,exchange)));
    return candleRows;
  }
  async function get5mCandles(exchange,symbol){
    const key=`${exchange}:${symbol}:5m`; const cached=candleCache.get(key); if(cached && now()-cached.at<60000)return cached.candles;
    const candles=await window.ZeroMarketData.candles(exchange,symbol,"5",500); candleCache.set(key,{at:now(),candles}); return candles;
  }
  async function decorateRow(row,btc,exchange){
    const out={...row};
    if(btc && row.symbol!=="BTCUSDT"){
      const rm = window.ZeroBrain?.relativeMoveVsBtc?.(btc.change_15m_pct,row.change_15m_pct) ?? null;
      out.rm_value=rm; out.rm_status="CURRENT";
      out.rm=rm==null?"BTC FLAT":rm>=0.2?"Stronger":rm<=-0.2?"Weaker":"In Sync";
    } else { out.rm_value=null; out.rm_status="CURRENT"; out.rm="BTC"; }
    try {
      const candles=await get5mCandles(exchange,row.symbol); const bars=new Map();
      for(const c of candles){const bucket=Math.floor(c.time/900000)*900000;const b=bars.get(bucket)||{time:bucket,close:c.close,turnover:0};b.close=c.close;b.turnover+=(c.turnover??(c.close!=null&&c.volume!=null?c.close*c.volume:0));bars.set(bucket,b)}
      const fifteen=[...bars.values()].sort((a,b)=>a.time-b.time); const moves=[];
      for(let i=1;i<fifteen.length;i++){const v=pct(fifteen[i].close,fifteen[i-1].close);if(v!=null)moves.push(v)}
      const current=moves.at(-1), previous=moves.slice(-21,-1), baseline=median(previous.map(Math.abs));
      const ratio=baseline&&current!=null?Math.abs(current)/baseline:null, abs=Math.abs(current??0);
      let level="WARMING"; if(ratio!=null){if(ratio>4&&abs>=0.8)level="SPIKE";else if(ratio>=2.5&&abs>=0.5)level="STRONG";else if(ratio>=1.5&&abs>=0.3)level="EXPANDING";else if(ratio>=1)level="BUILDING";else level="NORMAL";}
      out.expansion_ratio=ratio; out.expansion_level=level; out.expansion_status="CURRENT"; out.expansion=ratio==null?level:`${level} ${ratio.toFixed(1)}x`;
      out.price_expansion_memory=null;
    } catch (_) { out.expansion_ratio=null; out.expansion_level="WARMING"; out.expansion_status="MISSING"; out.expansion="WARMING"; }
    const fundingPct=row.funding_rate==null?null:row.funding_rate*100; const ls=row.crowd_ratio;
    out.funding_rate_pct=fundingPct; out.long_short_ratio=ls;
    if(fundingPct==null || ls==null){out.crowd="Missing";out.crowd_rank=-1;}
    else if(fundingPct>=0.005 && ls>=1.25 && (row.oi_15m_pct||0)>0 && (row.change_5m_pct||0)>0){out.crowd="Long Expanding";out.crowd_rank=4;}
    else if(fundingPct<=-0.005 && ls<=0.80 && (row.oi_15m_pct||0)>0 && (row.change_5m_pct||0)<0){out.crowd="Short Expanding";out.crowd_rank=4;}
    else if(fundingPct>=0.005 && ls>=1.25){out.crowd="Crowded Long";out.crowd_rank=3;}
    else if(fundingPct<=-0.005 && ls<=0.80){out.crowd="Crowded Short";out.crowd_rank=3;}
    else {out.crowd="Neutral";out.crowd_rank=0;}
    out.participation_status="CURRENT"; out.participation_evidence=`OI ${out.oi_15m_pct==null?"—":out.oi_15m_pct.toFixed(2)+"%"} · VOL ${out.volume_15m_pct==null?"—":out.volume_15m_pct.toFixed(1)+"%"}`;
    out.participation=out.participation_trend==="INCREASING"?"BUILDING":out.participation_trend==="DECREASING"?"UNWINDING":out.participation_trend==="ACTIVE"?"ACTIVE":"QUIET";
    return out;
  }
  async function controlReading(exchange,symbol,timeframe){
    const key=`${exchange}:${symbol}:${timeframe}`; const cached=controlCache.get(key); const through=window.ZeroSCC?.sv1CompletedThrough?.(now(),timeframe);
    if(cached && cached.through===through)return cached.reading;
    if(!window.ZeroSCC) return {control:"No Control",status:"MISSING"};
    const interval=tfToInterval(timeframe); let candles=[];
    try { candles=await window.ZeroMarketData.candles(exchange,symbol,interval,1000); }
    catch (_) { return {control:"No Control",status:"UNAVAILABLE"}; }
    const normalized=candles.map(c=>({open_time_ms:c.time,open:c.open,high:c.high,low:c.low,close:c.close,volume:c.volume}));
    const snap=window.ZeroSCC.detectSCC(normalized,timeframe,now());
    const reading={control:snap.control||"No Control",status:"CURRENT",origin:snap.origin_direction,id:snap.scc_id,control_time_ms:snap.control_time_ms,body_high:snap.body_high,body_low:snap.body_low};
    controlCache.set(key,{through,reading}); return reading;
  }
  async function screen(exchange){
    const symbols=selectedSymbols(exchange); const rows=await rowsFor(exchange,symbols,false); const by=new Map(rows.map(r=>[r.symbol,r]));
    const ordered=symbols.map(s=>by.get(s)).filter(Boolean); const fresh=ordered.filter(r=>r.data_status==="LIVE").length;
    return {exchange,engine:"browser",market_count:ordered.length,main_board:ordered,discovery_candidates:[],retained_rows:[],screen_mode:false,screen:{eligible_count:ordered.length,fresh_count:fresh,matched_count:fresh,missing_market_caps:ordered.filter(r=>r.market_cap_usd==null).length,oldest_reading_seconds:0},market_cap_status:{source:"coingecko",coin_count:ordered.filter(r=>r.market_cap_usd!=null).length},fetched_at_unix:now()/1000};
  }
  async function handle(url){
    const u=new URL(url,location.href), parts=u.pathname.split("/").filter(Boolean); if(parts[0]!=="api")return null;
    const exchange=(parts[2]||"bybit").toLowerCase(); if(!["bybit","binance"].includes(exchange))return error(404,"Unsupported exchange");
    try {
      if(parts[1]==="exchanges") return json({default:"bybit",exchanges:["bybit","binance"]});
      if(parts[1]==="markets") return json({exchange,markets:await marketList(exchange)});
      if(parts[1]==="screen") return json(await screen(exchange));
      if(parts[1]==="watch") {const symbols=(u.searchParams.get("symbols")||"").split(",").filter(Boolean);return json({exchange,rows:await rowsFor(exchange,symbols,false)});}
      if(parts[1]==="search") {const symbol=symbolAliases[(u.searchParams.get("symbol")||"").toUpperCase()]||((u.searchParams.get("symbol")||"").toUpperCase().endsWith("USDT")?(u.searchParams.get("symbol")||"").toUpperCase():`${(u.searchParams.get("symbol")||"").toUpperCase()}USDT`);const rows=await rowsFor(exchange,[symbol],true);if(!rows.length)return error(404,`Market not found on ${exchange.toUpperCase()}.`);return json({exchange,row:rows[0]});}
      if(parts[1]==="control") {const tf=Number(u.searchParams.get("timeframe")||15);if(!tfMinutes.includes(tf))return error(400,"Unsupported Control timeframe");const symbols=(u.searchParams.get("symbols")||"").split(",").filter(Boolean);const result={};for(const s of symbols)result[s]=await controlReading(exchange,s,tf);return json({timeframe:tf,rows:result,engine:"browser"});}
      if(parts[1]==="control-alerts") {const watches=JSON.parse(u.searchParams.get("watches")||"[]"),rows={};for(const w of watches){const reading=await controlReading(w.exchange,w.symbol,Number(w.timeframe));rows[w.id]=reading}return json({rows});}
      if(parts[1]==="discovery-settings") return json({min_market_cap_usd:50000000,min_turnover_24h_pct:3});
      if(parts[1]==="chart-profiles") return json({profiles:[{id:"current",label:"Current Browser",kind:"current",profile_directory:null}],selected:{id:"current",label:"Current Browser",kind:"current",profile_directory:null}});
      return error(404,"GitHub browser engine: API route not available");
    } catch(e) { return error(502,e?.message||"Browser market engine failed"); }
  }
  window.fetch = async function(input,init){
    const url=typeof input==="string"?input:input?.url||"";
    if(new URL(url,location.href).pathname.startsWith("/api/")) { const response=await handle(url); if(response)return response; }
    return nativeFetch(input,init);
  };
  window.ZeroBrowserEngine={version:"github-browser-v1",clearCaches:()=>{controlCache.clear();candleCache.clear();marketCache.clear();window.ZeroBrowserData?.clearCache?.();}};
})();
