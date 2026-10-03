/* Zero browser data engine v4: full Bybit/Binance perpetual universe + resilient market-cap enrichment. */
(() => {
  "use strict";
  const CACHE_TTL_MS=10_000, MARKET_CAP_TTL_MS=15*60_000, REQUEST_TIMEOUT_MS=12_000, MAX_CONCURRENCY=4;
  const ENDPOINTS={bybit:"https://api.bybit.com",binance:"https://fapi.binance.com"};
  const cache=new Map(); let marketCapCache={at:0,values:{},source:"none"};
  const finite=v=>Number.isFinite(Number(v))?Number(v):null;
  const pct=(a,b)=>a==null||b==null||b===0?null:((a/b)-1)*100;
  const sum=a=>{const n=a.filter(Number.isFinite);return n.length===a.length?n.reduce((x,y)=>x+y,0):null;};
  const sorted=a=>[...a].sort((x,y)=>x.time-y.time);
  async function getJson(url,params={},timeoutMs=REQUEST_TIMEOUT_MS){const q=new URLSearchParams();for(const[k,v]of Object.entries(params))if(v!==undefined&&v!==null&&v!=="")q.set(k,String(v));const full=q.toString()?`${url}?${q}`:url,ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),timeoutMs);try{const r=await fetch(full,{cache:"no-store",signal:ctl.signal,headers:{Accept:"application/json"}});if(!r.ok)return null;return await r.json()}catch(_){return null}finally{clearTimeout(timer)}}
  async function pool(items,worker){const out=new Array(items.length);let cursor=0;async function run(){while(true){const i=cursor++;if(i>=items.length)return;try{out[i]=await worker(items[i],i)}catch(e){out[i]={error:e?.message||String(e)}}}}await Promise.all(Array.from({length:Math.min(MAX_CONCURRENCY,items.length)},run));return out}
  function parseBybitKlines(p){return sorted((p?.result?.list||[]).map(r=>({time:Number(r[0]),open:finite(r[1]),high:finite(r[2]),low:finite(r[3]),close:finite(r[4]),volume:finite(r[5]),turnover:finite(r[6])})).filter(r=>Number.isFinite(r.time)))}
  function parseBinanceKlines(p){return sorted((Array.isArray(p)?p:[]).map(r=>({time:Number(r[0]),open:finite(r[1]),high:finite(r[2]),low:finite(r[3]),close:finite(r[4]),volume:finite(r[5]),turnover:finite(r[7])})).filter(r=>Number.isFinite(r.time)))}
  function stripOpen(a,now,ms=300000){return a.filter(c=>c.time+ms<=now+1000)}
  function stats(c,n){if(c.length<n*2)return{change:null,volumeChange:null};const a=c.slice(-n),b=c.slice(-n*2,-n),ac=a.at(-1)?.close,bc=b.at(-1)?.close,av=sum(a.map(x=>x.turnover??(x.close!=null&&x.volume!=null?x.close*x.volume:NaN))),bv=sum(b.map(x=>x.turnover??(x.close!=null&&x.volume!=null?x.close*x.volume:NaN)));return{change:pct(ac,bc),volumeChange:pct(av,bv)}}
  function derive(c){const windows={"5m":1,"15m":3,"1h":12,"4h":48,"24h":288},o={};for(const[k,n]of Object.entries(windows)){const s=stats(c,n);o[`change_${k}_pct`]=s.change;o[`volume_${k}_pct`]=s.volumeChange}const last=c.at(-1);o.price=last?.close??null;o.market_data_time_unix=last?last.time/1000:0;return o}
  function parseBybitOi(p){return(p?.result?.list||[]).map(r=>({time:Number(r.timestamp),value:finite(r.singleOpenInterest??r.openInterest)})).filter(r=>Number.isFinite(r.time)&&r.value!=null).sort((a,b)=>a.time-b.time)}
  function parseBinanceOi(p){return(Array.isArray(p)?p:[]).map(r=>({time:Number(r.timestamp),value:finite(r.sumOpenInterestValue??r.sumOpenInterest)})).filter(r=>Number.isFinite(r.time)&&r.value!=null).sort((a,b)=>a.time-b.time)}
  function atOrBefore(rows,t){let x=null;for(const r of rows){if(r.time<=t)x=r.value;else break}return x}
  function oi(rows5,rows1,now){const latest=rows5.at(-1)?.value??rows1.at(-1)?.value??null,src=rows5.length?rows5:rows1;return{oi_5m_pct:pct(latest,atOrBefore(src,now-300000)),oi_15m_pct:pct(latest,atOrBefore(src,now-900000)),oi_1h_pct:pct(latest,atOrBefore(src,now-3600000)),oi_4h_pct:pct(latest,atOrBefore(rows1,now-14400000)),oi_24h_pct:pct(latest,atOrBefore(rows1,now-86400000)),oi_status:latest!=null?"CURRENT":"MISSING",oi_reference_time_ms:src.at(-1)?.time??0}}
  function crowdBybit(p,t){const x=p?.result?.list?.[0],buy=finite(x?.buyRatio),sell=finite(x?.sellRatio);return{funding_rate:finite(t?.fundingRate),long_ratio:buy,short_ratio:sell,crowd_ratio:buy!=null&&sell!=null&&sell!==0?buy/sell:null,crowd_timestamp:finite(x?.timestamp)}}
  function crowdBinance(p,t){const x=Array.isArray(p)?p.at(-1):null,l=finite(x?.longAccount),s=finite(x?.shortAccount);return{funding_rate:finite(t?.lastFundingRate),long_ratio:l,short_ratio:s,crowd_ratio:l!=null&&s!=null&&s!==0?l/s:null,crowd_timestamp:finite(x?.timestamp)}}
  function participation(r){const p=finite(r.change_15m_pct),o=finite(r.oi_15m_pct),v=finite(r.volume_15m_pct);if(p==null||o==null||v==null)return{participation_trend:"QUIET",participation_direction:null};if(!(v>20||Math.abs(o)>0.3))return{participation_trend:"QUIET",participation_direction:null};if(p>0&&o>0)return{participation_trend:"INCREASING",participation_direction:"BULLISH"};if(p<0&&o>0)return{participation_trend:"INCREASING",participation_direction:"BEARISH"};if(o<0&&Math.abs(p)>0.1)return{participation_trend:"DECREASING",participation_direction:p>0?"BULLISH":"BEARISH"};return{participation_trend:"ACTIVE",participation_direction:p>=0?"BULLISH":"BEARISH"}}
  async function bybitRow(symbol,ticker,now){const [kp,o5,o1,cr]=await Promise.all([getJson(`${ENDPOINTS.bybit}/v5/market/kline`,{category:"linear",symbol,interval:"5",limit:1000}),getJson(`${ENDPOINTS.bybit}/v5/market/open-interest`,{category:"linear",symbol,intervalTime:"5min",limit:200}),getJson(`${ENDPOINTS.bybit}/v5/market/open-interest`,{category:"linear",symbol,intervalTime:"1h",limit:30}),getJson(`${ENDPOINTS.bybit}/v5/market/account-ratio`,{category:"linear",symbol,period:"15min",limit:2})]);const candles=stripOpen(parseBybitKlines(kp),now),m=derive(candles),o=oi(parseBybitOi(o5),parseBybitOi(o1),now),c=crowdBybit(cr,ticker),r={symbol,base:symbol.replace(/USDT$/,""),...m,price:finite(ticker?.lastPrice)??m.price,turnover_24h:finite(ticker?.turnover24h),volume_24h:finite(ticker?.volume24h),market_cap_usd:null,turnover_24h_pct:null,...o,...c,observed_at_unix:now/1000,data_status:"LIVE",source:"browser/bybit",data_quality:{candles:!!kp,oi5m:!!o5,oi1h:!!o1,crowd:!!cr}};Object.assign(r,participation(r));return r}
  async function binanceRow(symbol,ticker,now){const[kp,op,cr,fp]=await Promise.all([getJson(`${ENDPOINTS.binance}/fapi/v1/klines`,{symbol,interval:"5m",limit:1000}),getJson(`${ENDPOINTS.binance}/futures/data/openInterestHist`,{symbol,period:"5m",contractType:"PERPETUAL",limit:500}),getJson(`${ENDPOINTS.binance}/futures/data/globalLongShortAccountRatio`,{symbol,period:"15m",contractType:"PERPETUAL",limit:2}),getJson(`${ENDPOINTS.binance}/fapi/v1/premiumIndex`,{symbol})]);const candles=stripOpen(parseBinanceKlines(kp),now),m=derive(candles),or=parseBinanceOi(op),o=oi(or,[],now),c=crowdBinance(cr,{...ticker,lastFundingRate:fp?.lastFundingRate}),latest=or.at(-1)?.value??null,r={symbol,base:symbol.replace(/USDT$/,""),...m,price:finite(ticker?.lastPrice)??m.price,turnover_24h:finite(ticker?.quoteVolume),volume_24h:finite(ticker?.volume),market_cap_usd:null,turnover_24h_pct:null,...o,oi_4h_pct:pct(latest,atOrBefore(or,now-14400000)),oi_24h_pct:pct(latest,atOrBefore(or,now-86400000)),...c,observed_at_unix:now/1000,data_status:"LIVE",source:"browser/binance",data_quality:{candles:!!kp,oi5m:!!op,crowd:!!cr,funding:!!fp}};Object.assign(r,participation(r));return r}
  function normalizePerpetual(symbol,base){return{symbol:String(symbol).toUpperCase(),base:String(base||symbol).replace(/USDT$/i,"").toUpperCase()}}
  async function discoverBybit(){
    const found=new Map();
    let cursor="";
    for(let page=0;page<20;page++){
      const p=await getJson(`${ENDPOINTS.bybit}/v5/market/instruments-info`,{category:"linear",limit:1000,cursor});
      const list=p?.result?.list||[];
      for(const x of list){if(x.status==="Trading"&&x.quoteCoin==="USDT"&&x.contractType==="LinearPerpetual"&&/USDT$/.test(x.symbol)){const m=normalizePerpetual(x.symbol,x.baseCoin);found.set(m.symbol,m)}}
      const next=p?.result?.nextPageCursor;
      if(!next||next===cursor||!list.length)break;
      cursor=next;
    }
    // Bybit's linear ticker endpoint is a second, lightweight source of the live
    // USDT-perpetual universe. It prevents a partial instruments-info response
    // from collapsing the browser scanner to a tiny/default universe.
    const ticker=await getJson(`${ENDPOINTS.bybit}/v5/market/tickers`,{category:"linear"});
    for(const x of ticker?.result?.list||[]){if(/USDT$/.test(String(x.symbol||""))){const m=normalizePerpetual(x.symbol);found.set(m.symbol,m)}}
    return [...found.values()];
  }
  async function discoverBinance(){const p=await getJson(`${ENDPOINTS.binance}/fapi/v1/exchangeInfo`);return(Array.isArray(p?.symbols)?p.symbols:[]).filter(x=>x.status==="TRADING"&&x.contractType==="PERPETUAL"&&x.quoteAsset==="USDT").map(x=>({symbol:x.symbol,base:x.baseAsset||x.symbol.replace(/USDT$/i,"")}))}
  async function discover(exchange){return exchange==="binance"?discoverBinance():discoverBybit()}
  async function marketCaps(symbols){
    const now=Date.now();
    if(now-marketCapCache.at<MARKET_CAP_TTL_MS)return marketCapCache;
    const wanted=new Set(symbols.map(s=>s.replace(/USDT$/i,"").toUpperCase())),values={};
    let source="none";
    let geckoHadResponse=false;
    try{
      const p=await getJson("https://api.coingecko.com/api/v3/coins/markets",{vs_currency:"usd",order:"market_cap_desc",per_page:250,page:1,sparkline:"false"});
      if(Array.isArray(p)){geckoHadResponse=true;for(const c of p){const s=String(c?.symbol||"").toUpperCase();if(wanted.has(s)&&finite(c?.market_cap)!=null)values[s]=finite(c.market_cap)}}
      if(Object.keys(values).length)source="coingecko";
    }catch(_){}
    // CoinGecko can respond successfully but with zero matched assets in the
    // browser. In that case CoinPaprika is the actual fallback, not a stale UI label.
    if(!Object.keys(values).length){
      try{
        const p=await getJson("https://api.coinpaprika.com/v1/tickers",{quotes:"USD"},15000);
        for(const c of Array.isArray(p)?p:[]){const s=String(c?.symbol||"").toUpperCase();const cap=finite(c?.quotes?.USD?.market_cap);if(wanted.has(s)&&cap!=null)values[s]=cap}
        if(Object.keys(values).length)source="coinpaprika";
      }catch(_){}
    }
    marketCapCache={at:now,values,source,coingecko_response:geckoHadResponse};
    return marketCapCache;
  }
  async function fetchBybit(symbols){const p=await getJson(`${ENDPOINTS.bybit}/v5/market/tickers`,{category:"linear"}),map=new Map((p?.result?.list||[]).map(t=>[t.symbol,t])),wanted=symbols.filter(s=>map.has(s)),rows=await pool(wanted,s=>bybitRow(s,map.get(s),Date.now()));return rows.filter(r=>r&&!r.error)}
  async function fetchBinance(symbols){const p=await getJson(`${ENDPOINTS.binance}/fapi/v1/ticker/24hr`),map=new Map((Array.isArray(p)?p:[]).map(t=>[t.symbol,t])),wanted=symbols.filter(s=>map.has(s)),rows=await pool(wanted,s=>binanceRow(s,map.get(s),Date.now()));return rows.filter(r=>r&&!r.error)}
  function enrich(rows,caps){return rows.map(r=>({...r,market_cap_usd:caps[r.base]??null,turnover_24h_pct:caps[r.base]&&r.turnover_24h!=null?(r.turnover_24h/caps[r.base])*100:null}))}
  async function snapshot({exchange="bybit",symbols=null,force=false}={}){exchange=exchange==="binance"?"binance":"bybit";const universe=symbols?.length?symbols.map(s=>String(s).toUpperCase()):await discover(exchange),unique=[...new Set(universe.filter(s=>/USDT$/.test(s)))],key=`${exchange}:${unique.join(",")}`,cached=cache.get(key);if(!force&&cached&&Date.now()-cached.at<CACHE_TTL_MS)return cached.value;const[caps,rows]=await Promise.all([marketCaps(unique),exchange==="binance"?fetchBinance(unique):fetchBybit(unique)]),value={exchange,universe_count:unique.length,market_cap_source:caps.source,market_cap_count:Object.keys(caps.values).length,rows:enrich(rows,caps.values),fetched_at_unix:Date.now()/1000,engine:"browser",source:ENDPOINTS[exchange]};cache.set(key,{at:Date.now(),value});return value}
  async function diagnostics(exchange="bybit"){const u=await discover(exchange);return{exchange,universe_count:u.length,sample:u.slice(0,20),checked_at:Date.now()}}
  window.ZeroBrowserData={snapshot,diagnostics,discover,clearCache:()=>{cache.clear();marketCapCache={at:0,values:{},source:"none"}}};
})();
