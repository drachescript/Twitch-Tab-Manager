// bg.config.js
(() => { const T = (globalThis.TTM = globalThis.TTM || {}); 

T.redactForDiag ??= (s)=>{
  const {follows,priority,followUnion,client_id,access_token,...rest}=s||{};
  return {...rest,
    follows_count:(follows?.length||0),
    priority_count:(priority?.length||0),
    followUnion_count:(followUnion?.length||0)};
};

async function readAllStorage(){
  try{
    const bag = await chrome.storage.local.get(null);
    const fromSettings = bag.settings||{};
    const fromOptions  = (bag.options && (bag.options.settings||bag.options))||{};
    const legacy = {follows:bag.follows,priority:bag.priority,followUnion:bag.followUnion,
      max_tabs:bag.max_tabs,check_interval_sec:bag.check_interval_sec,enabled:bag.enabled};
    return {...legacy,...fromOptions,...fromSettings};
  }catch{ return {}; }
}

function coerce(s){
  const o = {...T.CFG_DEFAULT, ...s};
  o.enabled=!!o.enabled;
  o.check_interval_sec=Math.max(10, Number(o.check_interval_sec)||T.CFG_DEFAULT.check_interval_sec);
  o.max_tabs=Math.max(1, Number(o.max_tabs)||T.CFG_DEFAULT.max_tabs);
  o.force_unmute=!!o.force_unmute; o.unmute_streams=!!o.unmute_streams;
  o.force_resume=!!o.force_resume; o.autoplay_streams=!!o.autoplay_streams;
  const norm = a => Array.isArray(a)? a.map(x=>String(x).toLowerCase()) : [];
  o.follows=norm(o.follows); o.priority=norm(o.priority);
  o.followUnion = norm(o.followUnion?.length?o.followUnion:[...new Set([...o.follows,...o.priority])]);
  o.blacklist=norm(o.blacklist);
  return o;
}

T.saveSettings ??= (s)=> chrome.storage.local.set({ settings:s });

T.reloadConfig ??= async ()=>{
  let base = {...T.CFG_DEFAULT};
  try{ const r = await fetch(chrome.runtime.getURL('config.json'),{cache:'no-cache'});
       if(r.ok){ base={...base, ...(await r.json())}; }}catch{}
  const fromStore = await readAllStorage();
  const merged = coerce({...base,...fromStore});
  T.state.settings = merged;
  await chrome.storage.local.set({
    settings:merged, follows:merged.follows, priority:merged.priority, followUnion:merged.followUnion,
    follows_count:merged.follows.length, priority_count:merged.priority.length, followUnion_count:merged.followUnion.length
  });
  T.log('config_loaded', T.redactForDiag(merged));
  return merged;
};

T.ensureAlarm ??= async ()=>{
  const s=T.state.settings; const name='ttm.poll';
  const min=Math.max(1, Math.round((s.check_interval_sec||60)/60));
  await chrome.alarms.clear(name); await chrome.alarms.create(name,{ periodInMinutes:min });
  T.log('alarm_armed',{ everySec: s.check_interval_sec });
};

T.bootOnce ??= async ()=>{
  if (T.state.booted) return;
  await T.reloadConfig(); await T.ensureAlarm();
  T.state.booted=true; T.log('boot',{enabled:T.state.settings.enabled, everySec:T.state.settings.check_interval_sec});
};

})();
