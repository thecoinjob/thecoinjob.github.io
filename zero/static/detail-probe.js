(() => {
  "use strict";
  const ENDPOINT="https://api.bybit.com";
  const SYMBOLS=["BTCUSDT","ETHUSDT","SOLUSDT","AAVEUSDT","ADAUSDT","XRPUSDT","DOGEUSDT","1000PEPEUSDT"];
  const timeout=10000;
  async function probe(name,path,params){
    const q=new URLSearchParams(params); const url=ENDPOINT+path+"?"+q;
    const ctl=new AbortController(); const timer=setTimeout(()=>ctl.abort(),timeout);
    const started=performance.now();
    try{
      const r=await fetch(url,{cache:"no-store",headers:{Accept:"application/json"},signal:ctl.signal});
      let data=null; try{data=await r.json()}catch(_){ }
      const list=data?.result?.list;
      return {name,http:r.status,retCode:data?.retCode??null,retMsg:data?.retMsg??"",rows:Array.isArray(list)?list.length:null,ms:Math.round(performance.now()-started)};
    }catch(e){ return {name,http:0,retCode:null,retMsg:e?.name||e?.message||"fetch_failed",rows:null,ms:Math.round(performance.now()-started)}; }
    finally{clearTimeout(timer)}
  }
  function panel(){
    let el=document.getElementById("zero-detail-probe");
    if(!el){
      el=document.createElement("pre"); el.id="zero-detail-probe";
      el.style.cssText="position:fixed;z-index:2147483647;left:8px;right:8px;bottom:72px;max-height:68vh;overflow:auto;margin:0;padding:14px;background:#111;color:#f2f2f2;border:1px solid #666;border-radius:12px;font:12px/1.45 monospace;white-space:pre-wrap;box-shadow:0 8px 30px rgba(0,0,0,.6)";
      document.body.appendChild(el);
    }
    return el;
  }
  async function run(){
    const el=panel();
    const lines=["ZERO DETAIL ENRICHMENT PROBE","Sequential — one symbol at a time","",`Symbols: ${SYMBOLS.join(", ")}`,"", "Starting..."];
    el.textContent=lines.join("\n");
    for(const symbol of SYMBOLS){
      lines.push(`\n=== ${symbol} ===`); el.textContent=lines.join("\n");
      const k=await probe("KLINE 5M","/v5/market/kline",{category:"linear",symbol,interval:"5",limit:"1000"});
      lines.push(fmt(k)); el.textContent=lines.join("\n");
      const oi5=await probe("OI 5M","/v5/market/open-interest",{category:"linear",symbol,intervalTime:"5min",limit:"200"});
      lines.push(fmt(oi5)); el.textContent=lines.join("\n");
      const oi1=await probe("OI 1H","/v5/market/open-interest",{category:"linear",symbol,intervalTime:"1h",limit:"30"});
      lines.push(fmt(oi1)); el.textContent=lines.join("\n");
      const cr=await probe("ACCOUNT RATIO 15M","/v5/market/account-ratio",{category:"linear",symbol,period:"15min",limit:"2"});
      lines.push(fmt(cr));
      const ok=k.http===200&&k.retCode===0&&Number(k.rows)>0;
      const oiOk=oi5.http===200&&oi5.retCode===0&&Number(oi5.rows)>0;
      const oi1Ok=oi1.http===200&&oi1.retCode===0&&Number(oi1.rows)>0;
      const crOk=cr.http===200&&cr.retCode===0&&Number(cr.rows)>0;
      lines.push(`RESULT: ${ok?"KLINE OK":"KLINE FAIL"} | ${oiOk?"OI5 OK":"OI5 FAIL"} | ${oi1Ok?"OI1 OK":"OI1 FAIL"} | ${crOk?"CROWD OK":"CROWD FAIL"}`);
      el.textContent=lines.join("\n");
    }
    lines.push("\n=== END ==="); lines.push("If requests are OK but LIVE rows remain missing, the bug is inside browser parsing/enrichment rather than Bybit access."); el.textContent=lines.join("\n");
  }
  function fmt(x){return `${x.name}: HTTP=${x.http} retCode=${x.retCode} rows=${x.rows} ms=${x.ms}${x.retMsg?` msg=${x.retMsg}`:""}`}
  window.ZeroDetailProbe={run};
  setTimeout(run,2500);
})();
