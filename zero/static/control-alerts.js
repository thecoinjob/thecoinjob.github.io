/* Personal, one-shot Control watches. No account or shared settings. */
(function(root) {
  const KEY = '0scan1.control-alerts.v1';
  const valid = w => w && typeof w.id === 'string' && ['bybit','binance'].includes(w.exchange)
    && /^[A-Z0-9_\u3400-\u9fff]+USDT$/.test(w.symbol) && [15,60,240,1440].includes(w.timeframe)
    && ['Bullish Control','Bearish Control'].includes(w.target);
  function create(storage) {
    let data = {watches:[], alerts:[]};
    try { const saved = JSON.parse(storage.getItem(KEY) || 'null');
      if (saved) data = {watches:(saved.watches || []).filter(valid), alerts:(saved.alerts || []).filter(valid)};
    } catch (_) {}
    const save = () => storage.setItem(KEY, JSON.stringify(data));
    const id = () => Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
    const active = () => data.watches.filter(w => w.state === 'watching');
    function add(w) {
      if (active().length >= 20) throw Error('You can watch up to 20 coins at once.');
      if (active().some(x => x.exchange === w.exchange && x.symbol === w.symbol && x.timeframe === w.timeframe && x.target === w.target)) throw Error('That Control watch is already running.');
      const watch = {...w,id:id(),state:'watching',armedAt:Date.now(),checks:0};
      if (!valid(watch)) throw Error('Choose a supported coin, direction and timeframe.');
      data.watches.push(watch); save(); return watch;
    }
    function consume(readings, now = Date.now()) {
      const fired = [];
      for (const watch of active()) {
        const read = readings[watch.id];
        if (!read) continue;
        if (read.status !== 'CURRENT') { watch.lastStatus = read.status || 'MISSING'; continue; }
        const first = watch.checks === 0;
        watch.checks++; watch.checkedAt = now; watch.lastStatus = 'CURRENT'; watch.lastControl = read.control;
        if (read.control !== watch.target) continue;
        watch.state = 'triggered'; watch.triggeredAt = now;
        const alert = {...watch,id:id(),watchId:watch.id,alreadyPresent:first};
        data.alerts.unshift(alert); fired.push(alert);
      }
      save(); return fired;
    }
    function remove(watchId) { data.watches = data.watches.filter(w => w.id !== watchId); save(); }
    function rearm(watchId) {
      const old = data.watches.find(w => w.id === watchId); if (!old) return;
      const copy = {exchange:old.exchange,symbol:old.symbol,timeframe:old.timeframe,target:old.target};
      // A new ID means responses from the previous arm cannot trigger this watch.
      const fresh = add(copy); remove(watchId); return fresh;
    }
    function dismiss(alertId) { data.alerts = data.alerts.filter(a => a.id !== alertId); save(); }
    return {active,add,consume,remove,rearm,dismiss,all:()=>data};
  }
  root.ZeroControlAlerts = {create};
})(typeof window === 'undefined' ? globalThis : window);
