// bg.patch.guard_close.js

(function(){
  if (globalThis.__ttm_guard_close) return;
  globalThis.__ttm_guard_close = true;

  const realRemove = chrome.tabs.remove;
  chrome.tabs.remove = function(tabIds, cb) {
    // Normalize to array
    const ids = Array.isArray(tabIds) ? tabIds.slice() : [tabIds];
    const liveSet = new Set((globalThis.state?.lastLive || []).map(s => String(s).toLowerCase()));

    // For each tab: if it's twitch and login is currently live, skip removal.
    Promise.all(ids.map(id => new Promise(resolve => {
      try {
        chrome.tabs.get(id, tab => {
          if (chrome.runtime.lastError || !tab?.url) return resolve({ id, remove:true });
          const url = String(tab.url);
          const m = url.match(/^https?:\/\/(www\.)?twitch\.tv\/([^\/?#]+)/i);
          if (!m) return resolve({ id, remove:true }); // not twitch
          const login = m[2].toLowerCase();
          if (liveSet.has(login)) {
            // Skip closing live stream
            (globalThis.log || console.log)('skip_close_live', { id, login });
            return resolve({ id, remove:false });
          }
          resolve({ id, remove:true });
        });
      } catch { resolve({ id, remove:true }); }
    }))).then(list => {
      const keep = list.filter(x => x.remove).map(x => x.id);
      if (keep.length === 0) { if (typeof cb === 'function') cb(); return; }
      try { realRemove.call(chrome.tabs, keep, cb); } catch(e) { if (typeof cb === 'function') cb(); }
    });
  };
})();
