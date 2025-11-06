// bg.tabs.js 
(function () {
  const TWITCH = "https://www.twitch.tv/";
  function normLogin(x){ return String(x||"").trim().toLowerCase(); }

  function isEquivalentChannelTab(urlStr, login){
    try{
      const u = new URL(urlStr); if (!/^(www\.)?twitch\.tv$/.test(u.hostname)) return false;
      const seg = u.pathname.split("/").filter(Boolean).map(s=>s.toLowerCase()); const L = normLogin(login);
      if (!seg.length) return false;
      if (seg[0] === L) return true;
      if (seg[0] === "moderator" && seg[1] === L) return true;
      if (seg[0] === "popout" && seg[1] === L && seg[2] === "chat") return true;
      if (seg[0] === "moderator" && (u.searchParams.get("channel")||"").toLowerCase() === L) return true;
      return false;
    }catch{ return false; }
  }

  async function findExistingEquivalentTab(login){
    const tabs = await chrome.tabs.query({ url:["*://www.twitch.tv/*","*://twitch.tv/*"] });
    const L = normLogin(login);
    for (const t of tabs) if (isEquivalentChannelTab(t.url||"", L)) return t;
    return null;
  }

  async function waitForCompleteAndHydrated(tabId, extraMs=1800){
    const t0 = await chrome.tabs.get(tabId).catch(()=>null); if (!t0) return;
    if (t0.status !== "complete"){
      await new Promise(res=>{
        const onUpd = (id,info)=>{ if (id===tabId && info.status==="complete"){ chrome.tabs.onUpdated.removeListener(onUpd); res(); } };
        chrome.tabs.onUpdated.addListener(onUpd);
      });
    }
    await new Promise(r=>setTimeout(r, extraMs));
  }
  async function openStreamTab(login, state, cfg){
    const eq = await findExistingEquivalentTab(login);
    if (eq){ state.openTabTimestamps.set(eq.id, Date.now()); try{ await chrome.tabs.update(eq.id,{active:false}); }catch{}; return eq.id; }
    const current = await chrome.tabs.query({ url:"*://www.twitch.tv/*" });
    if (current.length >= (cfg?.max_tabs||8)) return null;
    if (state.openingNow.has(login)) return null;

    state.openingNow.add(login);
    try{
      const tab = await chrome.tabs.create({ url: `${TWITCH}${login}`, active:false });
      try{ await chrome.tabs.update(tab.id,{ autoDiscardable:false }); }catch{}
      state.openedByManager.set(tab.id, login);
      state.openTabTimestamps.set(tab.id, Date.now());
      await waitForCompleteAndHydrated(tab.id, 2200);
      try{ await chrome.scripting.executeScript({ target:{ tabId:tab.id }, files:["content_unmute.js"] }); }catch{}
      try{ await chrome.tabs.update(tab.id,{ muted:false }); }catch{}
      setTimeout(()=>chrome.tabs.update(tab.id,{ autoDiscardable:true }).catch(()=>{}), 60000);
      return tab.id;
    } finally { setTimeout(()=>state.openingNow.delete(login), 3000); }
  }

  async function dedupeManagerDuplicates(login, state){
    const tabs = await chrome.tabs.query({ url: `${TWITCH}${login}*` });
    if (tabs.length <= 1) return;
    const userTabs = tabs.filter(t=>!state.openedByManager.has(t.id));
    if (userTabs.length){
      for (const t of tabs){ if (state.openedByManager.has(t.id)){ await chrome.tabs.remove(t.id).catch(()=>{}); state.openedByManager.delete(t.id); state.openTabTimestamps.delete(t.id); } }
    } else {
      const sorted = tabs.sort((a,b)=>(b.lastAccessed||0)-(a.lastAccessed||0));
      const keepId = sorted[0].id;
      for (const t of sorted.slice(1)){ if (state.openedByManager.has(t.id)){ await chrome.tabs.remove(t.id).catch(()=>{}); state.openedByManager.delete(t.id); state.openTabTimestamps.delete(t.id); } }
      state.openTabTimestamps.set(keepId, Date.now());
    }
  }

  async function closeOfflineManagerTabs(liveSet, state, cfg, graceMs=15000){
    const tabs = await chrome.tabs.query({ url:"*://www.twitch.tv/*" });
    const now = Date.now();
    for (const tab of tabs){
      if (!state.openedByManager.has(tab.id)) continue;
      try{
        const u=new URL(tab.url); const seg=u.pathname.split("/").filter(Boolean);
        const ch=(seg[0]==="moderator"?seg[1]:seg[0])?.toLowerCase();
        if (!ch || ch==="videos" || ch==="directory") continue;
        if (tab.audible){ if (!state.openTabTimestamps.has(tab.id)) state.openTabTimestamps.set(tab.id, now); continue; }
        if (!liveSet.has(ch)){
          const first = state.openTabTimestamps.get(tab.id) || now;
          if (!state.openTabTimestamps.has(tab.id)) state.openTabTimestamps.set(tab.id, now);
          if (now-first > graceMs){ await chrome.tabs.remove(tab.id).catch(()=>{}); state.openedByManager.delete(tab.id); state.openTabTimestamps.delete(tab.id); }
        } else { if (!state.openTabTimestamps.has(tab.id)) state.openTabTimestamps.set(tab.id, now); }
      }catch{}
    }
  }

  async function closeUnfollowedManagerTabs(state, cfg){
    const tabs = await chrome.tabs.query({ url:"*://www.twitch.tv/*" });
    const now = Date.now();
    for (const tab of tabs){
      if (!state.openedByManager.has(tab.id)) continue;
      try{
        const u=new URL(tab.url); const seg=u.pathname.split("/").filter(Boolean); const ch=seg[0]?.toLowerCase();
        if (!ch || ch==="videos") continue;
        if ((cfg.follows||[]).includes(ch)) continue;
        if (tab.audible) continue;
        const started = state.openTabTimestamps.get(tab.id) || now;
        if (now - started > 60000){ await chrome.tabs.remove(tab.id).catch(()=>{}); state.openedByManager.delete(tab.id); state.openTabTimestamps.delete(tab.id); }
      }catch{}
    }
  }

  function scheduleRaidHold(tabId, state, minSec=90, maxSec=200){
    if (state.raidHolds.has(tabId)) return;
    const secs = Math.floor(minSec + Math.random()*(maxSec-minSec+1));
    const when = Date.now() + secs*1000; const alarm = `TTM_RAID_${tabId}_${when}`;
    chrome.alarms.create(alarm, { when }); state.raidHolds.set(tabId,{ alarm, until:when });
  }
  function clearRaidHold(tabId, state){ const rec=state.raidHolds.get(tabId); if(!rec) return; chrome.alarms.clear(rec.alarm); state.raidHolds.delete(tabId); }

  self.bgTabs = { waitForCompleteAndHydrated, findExistingEquivalentTab, openStreamTab,
    dedupeManagerDuplicates, closeOfflineManagerTabs, closeUnfollowedManagerTabs, scheduleRaidHold, clearRaidHold };
})();
