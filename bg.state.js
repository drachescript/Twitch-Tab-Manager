// bg.state.js
(() => { const T = (globalThis.TTM = globalThis.TTM || {}); 

T.CFG_DEFAULT ??= {
  live_source:"auto",
  force_unmute:true,
  unmute_streams:true,
  force_resume:true,
  autoplay_streams:false,
  check_interval_sec:60,
  max_tabs:4,
  enabled:true,
  follows:[], priority:[], followUnion:[], blacklist:[]
};

T.state ??= { booted:false, settings:{...T.CFG_DEFAULT}, managed:new Set(), lastSeen:new Map() };

T.log ??= (type, detail)=>console.log('[TTM]', type, detail ?? '');

})();
