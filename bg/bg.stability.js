// bg.stability.js
(() => { const T = (globalThis.TTM = globalThis.TTM || {}); 

// prevent rapid close/open thrash
T.cooldown ??= new Map();
T.inCooldown ??= (key, ms=15000)=>{
  const now=Date.now(), until=T.cooldown.get(key)||0;
  if (until>now) return true; T.cooldown.set(key, now+ms); return false;
};

// expose a simple reconcile log
T.reconcileInfo ??= (desired, open)=>{
  const cap=Math.max(0, T.state.settings.max_tabs - open);
  T.log('reconcile_info',{ desired, open_now:open, capacity:cap });
};

})();

(() => {
  const OFFLINE_GRACE_SEC = 120;   // wait this long before closing offline channels
  const PER_CHANNEL_COOLDOWN = 12; // seconds after any action (open/close)

  // Map<channel, {tabId?, openedBy?, lastLiveTs?, lastActionTs?, offlineSeenTs?, lock?}>
  const reg = new Map();

  function now() { return Date.now(); }
  const norm = (u) => (u || '').toLowerCase().replace(/^https?:\/\/(www\.)?twitch\.tv\//, '').split(/[/?#]/)[0];

  function recordLive(ch) {
    const s = reg.get(ch) || {};
    s.lastLiveTs = now();
    s.offlineSeenTs = undefined;
    reg.set(ch, s);
  }

  function recordOfflineSeen(ch) {
    const s = reg.get(ch) || {};
    if (!s.offlineSeenTs) s.offlineSeenTs = now();
    reg.set(ch, s);
  }

  function setTab(ch, tabId, openedBy) {
    const s = reg.get(ch) || {};
    s.tabId = tabId;
    if (openedBy) s.openedBy = openedBy;
    reg.set(ch, s);
  }

  function markAction(ch) {
    const s = reg.get(ch) || {};
    s.lastActionTs = now();
    reg.set(ch, s);
  }

  function onTabsSnapshot(tabs) {
    // sync Map with current tabs
    for (const t of tabs) {
      const ch = norm(t.url);
      if (ch) setTab(ch, t.id);
    }
  }

  function hasCooldown(ch) {
    const s = reg.get(ch);
    if (!s?.lastActionTs) return false;
    return (now() - s.lastActionTs) < PER_CHANNEL_COOLDOWN * 1000;
  }

  function shouldClose(ch) {
    const s = reg.get(ch);
    if (!s?.offlineSeenTs) return false;
    const waited = (now() - s.offlineSeenTs) >= OFFLINE_GRACE_SEC * 1000;
    if (!waited) return false;
    // Only close tabs we opened OR (optionally) user tabs when offline; default: manager only
    return (s.openedBy === 'manager');
  }

  async function findExistingChannelTab(channel) {
    const q = await chrome.tabs.query({ url: ['https://www.twitch.tv/*'] });
    for (const t of q) if (norm(t.url) === channel) return t;
    return null;
  }

  globalThis.TTM_STAB = {
    recordLive, recordOfflineSeen, onTabsSnapshot,
    setTab, markAction, hasCooldown, shouldClose, findExistingChannelTab
  };
})();
