/* Browser port of app/scc.py. Constants and decision order are intentionally preserved. */
window.ZeroSCC = (() => {
  const SCC_LOOKBACK = 10;
  const SCC_PERCENTILE = 85.0;
  const SCC_EXPIRY_BARS = 500;
  const SCC_MAX_CC = 6;
  const SCC_PRINT_COOLDOWN = 1;
  const SCC_REPLACEMENT_PERCENTILE = 95.0;
  const SCC_REPLACEMENT_EFI_MULTIPLIER = 1.25;
  const SCC_PARENT_MINUTES = { 5: 15, 15: 60, 60: 240, 240: 1440 };
  function sv1CompletedThrough(referenceTimeMs, timeframeMinutes) { const parentMs = SCC_PARENT_MINUTES[timeframeMinutes] * 60000; return Math.floor(referenceTimeMs / parentMs) * parentMs; }
  function uniqueSorted(candles) { const byStart = new Map(); for (const candle of candles || []) if (Number(candle.open_time_ms) > 0) byStart.set(Number(candle.open_time_ms), candle); return [...byStart.values()].sort((a,b)=>a.open_time_ms-b.open_time_ms); }
  function sv1FinalCandles(candles, timeframeMinutes, referenceTimeMs) { const duration=timeframeMinutes*60000,parent=SCC_PARENT_MINUTES[timeframeMinutes]*60000,through=sv1CompletedThrough(referenceTimeMs,timeframeMinutes); return uniqueSorted(candles).filter(c=>((c.open_time_ms+duration)%parent===0)&&c.open_time_ms+duration<=through); }
  function percentRank(values,current) { const n=values.length; if(n<=0)return null; if(n<=1)return 100; return 100*values.filter(v=>v<=current).length/n; }
  function efiMagnitude(candle) { const body=candle.close-candle.open,range=Math.max(candle.high-candle.low,1e-12); return Math.abs(candle.volume*(body/range)); }
  function sccId(tf,candle,direction,bodyHigh,bodyLow) { return `${tf}m:${candle.open_time_ms}:${direction}:${Number(bodyHigh).toPrecision(12).replace(/(?:\.0+|(?:(\.[0-9]*?)0+))$/,'$1')}:${Number(bodyLow).toPrecision(12).replace(/(?:\.0+|(?:(\.[0-9]*?)0+))$/,'$1')}`; }
  function controlLabel(dir,locked) { if(locked&&dir===1)return 'Bullish Control'; if(locked&&dir===-1)return 'Bearish Control'; return 'No Control'; }
  function noControl(tf) { return {timeframe_minutes:tf,control:'No Control'}; }
  function detectSCC(candles,timeframeMinutes,referenceTimeMs=null) {
    const all=candles||[]; if(referenceTimeMs==null){const maxOpen=all.reduce((m,c)=>Math.max(m,Number(c.open_time_ms)||0),0);referenceTimeMs=maxOpen+timeframeMinutes*60000;}
    const source=sv1FinalCandles(all,timeframeMinutes,referenceTimeMs); if(source.length<SCC_LOOKBACK)return noControl(timeframeMinutes);
    let liveSccs=[],controlCounter=0; const durationMs=timeframeMinutes*60000;
    for(let idx=0;idx<source.length;idx++){
      const candle=source[idx]; controlCounter++; const nextLive=[];
      for(const scc of liveSccs){ scc.age++; const bodyHigh=scc.body_high,bodyLow=scc.body_low;
        if(idx>scc.index&&!scc.control_locked){if(candle.close>bodyHigh){scc.control_dir=1;scc.control_locked=true;scc.control_locked_bar=controlCounter;scc.control_time_ms=candle.open_time_ms+durationMs;}else if(candle.close<bodyLow){scc.control_dir=-1;scc.control_locked=true;scc.control_locked_bar=controlCounter;scc.control_time_ms=candle.open_time_ms+durationMs;}}
        if(candle.close>bodyHigh)scc.closed_above=true; if(candle.close<bodyLow)scc.closed_below=true;
        const invalidated=(scc.closed_above&&scc.closed_below)||scc.age>SCC_EXPIRY_BARS; if(!invalidated)nextLive.push(scc);
      }
      liveSccs=nextLive; const body=candle.close-candle.open,range=Math.max(candle.high-candle.low,1e-12),efi=Math.abs(candle.volume*(body/range)); if(idx<SCC_LOOKBACK-1)continue;
      const window=[]; for(let j=idx-SCC_LOOKBACK+1;j<=idx;j++)window.push(efiMagnitude(source[j])); const rank=percentRank(window,efi); if(!(rank!=null&&rank>=SCC_PERCENTILE&&Math.abs(body)>0&&efi>0))continue;
      const bodyHigh=Math.max(candle.open,candle.close),bodyLow=Math.min(candle.open,candle.close),direction=candle.close>candle.open?1:-1,directionText=direction===1?'bullish':'bearish',noLive=liveSccs.length===0;
      let selected=null; if(liveSccs.length)selected=liveSccs.reduce((best,s)=>{const distance=Math.abs(candle.close-((s.body_high+s.body_low)/2));if(!best||distance<best.distance)return{s,distance};return best;},null)?.s||null;
      const lastCreatedBar=liveSccs.length?liveSccs[liveSccs.length-1].created_control_bar:null,cooldownPassed=noLive?true:(controlCounter-Number(lastCreatedBar))>=SCC_PRINT_COOLDOWN;
      const strongerByEfi=Boolean(selected&&efi>=Number(selected.efi_mag||0)*SCC_REPLACEMENT_EFI_MULTIPLIER),strongerByBullBreak=Boolean(selected&&direction===1&&candle.close>selected.body_high),strongerByBearBreak=Boolean(selected&&direction===-1&&candle.close<selected.body_low);
      const structurallyStronger=Boolean(rank!=null&&rank>=SCC_REPLACEMENT_PERCENTILE&&(strongerByEfi||strongerByBullBreak||strongerByBearBreak)); if(!(noLive||(cooldownPassed&&structurallyStronger)))continue;
      liveSccs.push({id:sccId(timeframeMinutes,candle,directionText,bodyHigh,bodyLow),index:idx,direction:directionText,dir:direction,body_high:bodyHigh,body_low:bodyLow,wick_high:candle.high,wick_low:candle.low,age:0,closed_above:false,closed_below:false,control_dir:0,control_locked:false,control_locked_bar:null,control_time_ms:null,efi_mag:efi,rank,created_control_bar:controlCounter,birth_open_ms:candle.open_time_ms,birth_close_ms:candle.open_time_ms+durationMs});
      while(liveSccs.length>SCC_MAX_CC)liveSccs.shift();
    }
    if(!liveSccs.length)return noControl(timeframeMinutes); const currentClose=source[source.length-1].close; const liveScc=liveSccs.reduce((best,s)=>{const distance=Math.abs(currentClose-((s.body_high+s.body_low)/2));if(!best||distance<best.distance)return{s,distance};return best;},null).s;
    const lockedBar=liveScc.control_locked_bar,controlAge=liveScc.control_locked&&lockedBar!=null?Math.max(0,controlCounter-Number(lockedBar)):null;
    return {timeframe_minutes:timeframeMinutes,control:controlLabel(Number(liveScc.control_dir||0),Boolean(liveScc.control_locked)),scc_id:liveScc.id,origin_direction:liveScc.direction==='bullish'?'Bullish':'Bearish',birth_open_ms:liveScc.birth_open_ms,birth_close_ms:liveScc.birth_close_ms,control_time_ms:liveScc.control_time_ms,age_candles:liveScc.age,control_age_candles:controlAge,body_high:liveScc.body_high,body_low:liveScc.body_low,wick_high:liveScc.wick_high,wick_low:liveScc.wick_low,efi_magnitude:liveScc.efi_mag,percentile_rank:liveScc.rank,closed_above:Boolean(liveScc.closed_above),closed_below:Boolean(liveScc.closed_below)};
  }
  return {detectSCC,sv1CompletedThrough,sv1FinalCandles};
})();
