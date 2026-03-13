// bg.diagnose.js
(() => { const T = (globalThis.TTM = globalThis.TTM || {}); 

T.diagnose ??= async ()=>{
  const open = (await T.listOpenTabs()).filter(t=>T.isManaged(t)).length;
  const s=T.state.settings;
  return {
    ok:true,
    settings: T.redactForDiag(s),
    live_count: T.__lastLiveCount ?? 0,
    open_count: open,
    capacity: Math.max(0, s.max_tabs - open)
  };
};

})();
