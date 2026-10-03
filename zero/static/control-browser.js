/* SV1 Auto-1 Control browser adapter: parent TF -> detection TF. */
(() => {
  const previousFetch = window.fetch.bind(window);
  const detectionTf = {15:5,60:15,240:60,1440:240};
  const interval = {5:"5",15:"15",60:"60",240:"240"};
  const cache = new Map();
  const response = value => new Response(JSON.stringify(value),{status:200,headers:{"Content-Type":"application/json","Cache-Control":"no-store"}});
  async function read(exchange,symbol,parentTf){
    const key=`${exchange}:${symbol}:${parentTf}`, through=window.ZeroSCC.sv1CompletedThrough(Date.now(),detectionTf[parentTf]);
    const hit=cache.get(key); if(hit&&hit.through===through)return hit.value;
    const candles=await window.ZeroMarketData.candles(exchange,symbol,interval[detectionTf[parentTf]],1000);
    const source=candles.map(c=>({open_time_ms:c.time,open:c.open,high:c.high,low:c.low,close:c.close,volume:c.volume}));
    const snap=window.ZeroSCC.detectSCC(source,detectionTf[parentTf],Date.now());
    const value={control:snap.control||"No Control",status:"CURRENT",origin:snap.origin_direction,id:snap.scc_id,control_time_ms:snap.control_time_ms,body_high:snap.body_high,body_low:snap.body_low};
    cache.set(key,{through,value}); return value;
  }
  window.fetch = async function(input,init){
    const url=typeof input==="string"?input:input?.url||"";
    const u=new URL(url,location.href);
    if(u.pathname.startsWith("/api/control/")){
      try{const exchange=u.pathname.split("/").filter(Boolean)[2],tf=Number(u.searchParams.get("timeframe")||15),symbols=(u.searchParams.get("symbols")||"").split(",").filter(Boolean),rows={};for(const s of symbols)rows[s]=await read(exchange,s,tf);return response({timeframe:tf,rows,engine:"browser"});}
      catch(e){return new Response(JSON.stringify({detail:e?.message||"Browser Control failed"}),{status:502,headers:{"Content-Type":"application/json"}})}
    }
    if(u.pathname==="/api/control-alerts"){
      try{const watches=JSON.parse(u.searchParams.get("watches")||"[]"),rows={};for(const w of watches)rows[w.id]=await read(w.exchange,w.symbol,Number(w.timeframe));return response({rows,engine:"browser"});}
      catch(e){return new Response(JSON.stringify({detail:e?.message||"Browser Control alert check failed"}),{status:502,headers:{"Content-Type":"application/json"}})}
    }
    return previousFetch(input,init);
  };
  window.ZeroBrowserControl={clearCache:()=>cache.clear()};
})();
