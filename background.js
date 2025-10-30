// background.js — Part 1/4 (core config + tab helpers + OPENED-BY-MANAGER TRACKING)

const CFG_DEFAULT = {
  force_unmute: true,
  force_resume: true,
  check_interval_sec: 60,
  unmute_streams: true,
  max_tabs: 8,
  blacklist: [],
  live_source: "auto"
};

const TWITCH = "https://www.twitch.tv/";
let config = null, lastPoll = 0;
let currentlyLive = new Set();
let _fetchInProgress = false;

// Track tabs we opened (so we can auto-close them when channel goes offline)
const openedByManager = new Map(); // tabId -> channel
const openTabTimestamps = new Map(); // tabId -> ts (used for LRU / cleanup)
const openingNow = new Set();

// merge + migrate: always persist missing defaults without clobbering user values
async function loadFileConfig() {
  const [cfgRes, folRes] = await Promise.allSettled([
    fetch(chrome.runtime.getURL("config.json")).then(r => r.json()),
    fetch(chrome.runtime.getURL("follows.txt")).then(r => r.text())
  ]);
  const fileCfg = cfgRes.value || {};
  const fileFollows = (folRes.value || "").split("\n")
    .map(s => s.trim().toLowerCase()).filter(Boolean);

  const store = await chrome.storage.local.get(["config", "follows"]);
  const merged = { ...CFG_DEFAULT, ...fileCfg, ...(store.config || {}) };

  if (typeof merged.check_interval_sec !== "number" || merged.check_interval_sec < 10) merged.check_interval_sec = 60;
  if (typeof merged.max_tabs !== "number" || merged.max_tabs < 1) merged.max_tabs = 8;
  if (!Array.isArray(merged.blacklist)) merged.blacklist = [];

  const src = (merged.live_source || "").toLowerCase();
  merged.live_source = ["auto", "helix", "following_html"].includes(src) ? src : "auto";

  // follows: prefer stored (editable in Options); else packaged
  merged.follows = Array.isArray(store.follows) ? store.follows : fileFollows;

  // persist migration (so new keys show up in Options immediately)
  await chrome.storage.local.set({ config: merged });

  return merged;
}

async function getEnabled() {
  const { enabled } = await chrome.storage.local.get("enabled");
  return enabled !== false;
}
async function setEnabled(v) { await chrome.storage.local.set({ enabled: !!v }); }

function isIgnoredPath(p) {
  p = (p || "/").toLowerCase();
  if (p.startsWith("/moderator")) return true;
  return ["/drops", "/drops/inventory", "/settings/connections", "/creatorcamp"].includes(p);
}
// Treat several Twitch URLs as "equivalent" for a given channel (so we don't open a 2nd tab)
function normLogin(x) { return String(x || "").trim().toLowerCase(); }

function isEquivalentChannelTab(urlStr, login) {
  try {
    const u = new URL(urlStr);
    if (u.hostname !== "www.twitch.tv" && u.hostname !== "twitch.tv") return false;

    const seg = u.pathname.split("/").filter(Boolean).map(s => s.toLowerCase());
    const L = normLogin(login);

    // /<login>
    if (seg.length === 1 && seg[0] === L) return true;

    // /<login>/<subpage>  (clips, videos, schedule, about...)
    if (seg.length >= 2 && seg[0] === L) return true;

    // /moderator/<login>[/...]
    if (seg.length >= 2 && seg[0] === "moderator" && seg[1] === L) return true;

    // /popout/<login>/chat
    if (seg.length >= 3 && seg[0] === "popout" && seg[2] === "chat" && seg[1] === L) return true;

    // Some mod pages use ?channel=<login>
    if (seg[0] === "moderator" && (u.searchParams.get("channel") || "").toLowerCase() === L) return true;

    return false;
  } catch {
    return false;
  }
}

async function findExistingEquivalentTab(login) {
  const tabs = await chrome.tabs.query({ url: ["*://www.twitch.tv/*", "*://twitch.tv/*"] });
  const L = normLogin(login);
  for (const t of tabs) {
    if (isEquivalentChannelTab(t.url || "", L)) return t;
  }
  return null;
}

async function dedupeChannelTabs(ch) {
  const tabs = await chrome.tabs.query({ url: `${TWITCH}${ch}*` });
  if (tabs.length <= 1) return;
  const keep = tabs.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0];
  const toClose = tabs.filter(t => t.id !== keep.id);
  await Promise.all(toClose.map(t => chrome.tabs.remove(t.id).catch(() => {})));
  for (const t of toClose) { openedByManager.delete(t.id); openTabTimestamps.delete(t.id); }
}

// ensure tab fully loads + player mounts before we inject
async function waitForCompleteAndHydrated(tabId, extraMs = 1800) {
  const tab0 = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab0) return;
  if (tab0.status !== "complete") {
    await new Promise(res => {
      const onUpd = (id, info) => {
        if (id === tabId && info.status === "complete") {
          chrome.tabs.onUpdated.removeListener(onUpd); res();
        }
      };
      chrome.tabs.onUpdated.addListener(onUpd);
    });
  }
  await new Promise(r => setTimeout(r, extraMs));
}
// background.js — Part 2/4 (open/close helpers + HELIX batching + HTML live)

async function openStreamTab(ch) {
  const login = (ch || "").toLowerCase();

  // If ANY equivalent tab for this channel already exists (incl. Moderator View),
  // reuse it and DO NOT open a new /<login> tab.
  const eq = await findExistingEquivalentTab(login);
  if (eq) {
    // Do NOT mark as openedByManager (so we won't auto-close a user-opened mod tab).
    openTabTimestamps.set(eq.id, Date.now());
    try { await chrome.tabs.update(eq.id, { active: false }); } catch {}
    return eq.id;
  }

  // Fallback: check plain /<login> (older logic)
  const url = `${TWITCH}${login}`;
  const existing = await chrome.tabs.query({ url: `${url}*` });
  if (existing.length) {
    await dedupeChannelTabs(login);
    // Marking as openedByManager here is legacy behavior; keep it to preserve your cleanup rules.
    openedByManager.set(existing[0].id, login);
    openTabTimestamps.set(existing[0].id, Date.now());
    return existing[0].id;
  }

  if (openingNow.has(login)) return;
  openingNow.add(login);
  try {
    const tab = await chrome.tabs.create({ url, active: false });
    try { await chrome.tabs.update(tab.id, { autoDiscardable: false }); } catch {}

    openedByManager.set(tab.id, login);
    openTabTimestamps.set(tab.id, Date.now());

    await waitForCompleteAndHydrated(tab.id, 2200);
    try { await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content_unmute.js"] }); } catch {}
    try { await chrome.tabs.update(tab.id, { muted: false }); } catch {}

    setTimeout(() => chrome.tabs.update(tab.id, { autoDiscardable: true }).catch(()=>{}), 60000);
    return tab.id;
  } finally {
    setTimeout(() => openingNow.delete(login), 3000);
  }
}

async function closeStreamTab(ch) {
  const tabs = await chrome.tabs.query({ url: `${TWITCH}${ch}*` });
  await Promise.all(tabs.map(t => chrome.tabs.remove(t.id).catch(() => {})));
  for (const t of tabs) { openedByManager.delete(t.id); openTabTimestamps.delete(t.id); }
}

async function closeUnfollowedTwitchTabs() {
  const tabs = await chrome.tabs.query({ url: "*://www.twitch.tv/*" });
  const now = Date.now();
  for (const tab of tabs) {
    try {
      const u = new URL(tab.url);
      const path = u.pathname || "/";
      if (isIgnoredPath(path)) continue;
      const ch = path.split("/")[1]?.toLowerCase();
      if (!ch || ch === "videos" || ch === "directory") continue;

      if (!config.follows.includes(ch)) {
        const started = openTabTimestamps.get(tab.id) || now;
        if (!openTabTimestamps.has(tab.id)) openTabTimestamps.set(tab.id, now);
        if (now - started > 60000) {
          await chrome.tabs.remove(tab.id).catch(() => {});
          openedByManager.delete(tab.id);
          openTabTimestamps.delete(tab.id);
        }
      } else if (!openTabTimestamps.has(tab.id)) {
        openTabTimestamps.set(tab.id, now);
      }
    } catch {}
  }
  const openIds = new Set(tabs.map(t => t.id));
  for (const id of [...openTabTimestamps.keys()]) if (!openIds.has(id)) openTabTimestamps.delete(id);
  for (const id of [...openedByManager.keys()]) if (!openIds.has(id)) openedByManager.delete(id);
}

async function enforceMaxTabs(n) {
  const tabs = await chrome.tabs.query({ url: "*://www.twitch.tv/*" });
  const chan = [];
  for (const t of tabs) {
    try {
      const u = new URL(t.url); const p = u.pathname || "/";
      if (isIgnoredPath(p)) continue;
      const ch = p.split("/")[1]?.toLowerCase();
      if (!ch || ch === "videos" || ch === "directory") continue;
      chan.push(t);
    } catch {}
  }
  if (chan.length <= n) return;
  const sorted = chan.map(t => ({ t, last: t.lastAccessed || 0 })).sort((a, b) => b.last - a.last);
  for (const x of sorted.slice(n)) {
    await chrome.tabs.remove(x.t.id).catch(() => {});
    openedByManager.delete(x.t.id);
    openTabTimestamps.delete(x.t.id);
  }
}

// HELIX request in chunks of 100 user_login params
async function checkStreamers(logins) {
  if (!config?.client_id || !config?.access_token || !logins?.length) return new Set();
  const headers = { "Client-ID": config.client_id, "Authorization": `Bearer ${config.access_token}` };
  const chunk = 100, sets = [];
  for (let i = 0; i < logins.length; i += chunk) {
    const slice = logins.slice(i, i + chunk);
    const qs = slice.map(s => `user_login=${encodeURIComponent(s)}`).join("&");
    const res = await fetch(`https://api.twitch.tv/helix/streams?${qs}`, { headers }).catch(() => null);
    if (!res || !res.ok) continue;
    const data = await res.json().catch(() => ({}));
    const part = (data.data || []).map(s => (s.user_login || "").toLowerCase()).filter(Boolean);
    sets.push(...part);
  }
  return new Set(sets);
}

async function fetchFollowingLiveLogins() {
  try {
    const r = await fetch("https://www.twitch.tv/directory/following/live",
      { credentials: "include", cache: "no-cache" });
    if (!r.ok) return new Set();
    const h = await r.text();
    const set = new Set(); let m;
    const re1 = /"broadcaster[_-]?login"\s*:\s*"([^"]+)"/gi;
    while ((m = re1.exec(h))) set.add(m[1].toLowerCase());
    const re2 = /https?:\/\/www\.twitch\.tv\/([a-zA-Z0-9_]+)/g;
    while ((m = re2.exec(h))) set.add(m[1].toLowerCase());
    return set;
  } catch { return new Set(); }
}
// background.js — Part 3/4 (Fetch My Follows: active-tab & current-tab + offline-close)

async function fetchFollowsViaActiveTabOneTab() {
  const targetURL = "https://www.twitch.tv/directory/following/channels";
  const [prevActive] = await chrome.tabs.query({ active: true, currentWindow: true });
  let tab = (await chrome.tabs.query({ url: targetURL + "*" }))[0];
  let created = false;
  if (tab) { try { await chrome.tabs.update(tab.id, { active: true }); } catch {} }
  else { tab = await chrome.tabs.create({ url: targetURL, active: true }); created = true; }
  await waitForCompleteAndHydrated(tab.id, 2000);

  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => {
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const rootMain = () => document.querySelector('main,[role="main"]') || document.body;
      const onPage = () => location.pathname.startsWith("/directory/following/channels");

      function findScrollContainer() {
        const main = rootMain();
        const cands = new Set([main]);
        main.querySelectorAll("div,section").forEach(el => {
          const cs = getComputedStyle(el);
          const can = (cs.overflowY === "auto" || cs.overflowY === "scroll" || el.scrollHeight > el.clientHeight + 20);
          if (can && el.clientHeight > 200) cands.add(el);
        });
        let best = null, h = 0;
        for (const el of cands) { const sh = el.scrollHeight || 0; if (sh > h) { h = sh; best = el; } }
        return best || main;
      }

      async function waitForGrid(timeoutMs = 15000) {
        const t0 = performance.now();
        while (performance.now() - t0 < timeoutMs) {
          if (!onPage()) return;
          if (rootMain().querySelector('[data-test-selector*="card"], [data-a-target*="card"], a[data-test-selector="PreviewCard-link"]')) return;
          await sleep(250);
        }
      }

      async function autoScrollToEnd(maxMs = 80000) {
        const sc = findScrollContainer();
        const t0 = performance.now();
        let last = 0, stable = 0;
        while (performance.now() - t0 < maxMs) {
          sc.scrollTop = sc.scrollHeight;
          sc.dispatchEvent(new WheelEvent("wheel", { deltaY: 240, bubbles: true, cancelable: true }));
          await sleep(400);
          const count = rootMain().querySelectorAll('a[href^="/"]').length;
          if (count <= last) { if (++stable >= 4) break; } else { stable = 0; last = count; }
        }
      }

      function collectUsernames() {
        const main = rootMain();
        const set = new Set();
        const anchors = main.querySelectorAll('a[href^="/"]');
        for (const a of anchors) {
          if (a.closest('aside, nav, [data-test-selector="side-nav"]')) continue;
          const href = a.getAttribute("href") || "";
          const m = href.match(/^\/([A-Za-z0-9_]+)\/?$/);
          if (!m) continue;
          const user = m[1].toLowerCase();
          if (user === "directory" || user === "videos") continue;
          const card = a.closest('[data-test-selector*="card"], [data-a-target*="card"], [data-test-selector="PreviewCard"], [data-test-selector="ChannelLink"]');
          if (!card || !main.contains(card)) continue;
          set.add(user);
        }
        return [...set];
      }

      return (async () => {
        if (!onPage()) return [];
        await waitForGrid();
        await autoScrollToEnd();
        await sleep(300);
        return collectUsernames();
      })();
    }
  });

  if (created) {
    try { await chrome.tabs.remove(tab.id); } catch {}
    if (prevActive?.id) { try { await chrome.tabs.update(prevActive.id, { active: true }); } catch {} }
  }
  return Array.isArray(result) ? result : [];
}

async function fetchFollowsFromCurrentTab() {
  const tabs = await chrome.tabs.query({ url: "*://www.twitch.tv/*" });
  const tUse = tabs.find(t => { try { return new URL(t.url).pathname.startsWith("/directory/following/channels"); } catch { return false; } });
  if (!tUse) return [];
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tUse.id },
    func: () => {
      const rootMain = () => document.querySelector('main,[role="main"]') || document.body;
      if (!location.pathname.startsWith("/directory/following/channels")) return [];
      const main = rootMain();
      const set = new Set();
      const anchors = main.querySelectorAll('a[href^="/"]');
      for (const a of anchors) {
        if (a.closest('aside, nav, [data-test-selector="side-nav"]')) continue;
        const href = a.getAttribute("href") || "";
        const m = href.match(/^\/([A-Za-z0-9_]+)\/?$/);
        if (!m) continue;
        const user = m[1].toLowerCase();
        if (user === "directory" || user === "videos") continue;
        const card = a.closest('[data-test-selector*="card"], [data-a-target*="card"], [data-test-selector="PreviewCard"], [data-test-selector="ChannelLink"]');
        if (!card || !main.contains(card)) continue;
        set.add(user);
      }
      return [...set];
    }
  });
  return Array.isArray(result) ? result : [];
}

// Close any open channel tabs that are NOT in the current live set (grace period applies)
async function closeOfflineChannelTabs(liveSet, graceMs = 15000) {
  const tabs = await chrome.tabs.query({ url: "*://www.twitch.tv/*" });
  const now = Date.now();
  for (const tab of tabs) {
    try {
      const u = new URL(tab.url);
      const p = u.pathname || "/";
      if (isIgnoredPath(p)) continue;
      const ch = p.split("/")[1]?.toLowerCase();
      if (!ch || ch === "videos" || ch === "directory") continue;
      if ((config.blacklist || []).includes(ch)) continue;
      if (!config.follows.includes(ch)) continue;

      if (!liveSet.has(ch)) {
        const firstSeen = openTabTimestamps.get(tab.id) || now;
        if (!openTabTimestamps.has(tab.id)) openTabTimestamps.set(tab.id, now);
        const opened = openedByManager.has(tab.id);
        if (opened || now - firstSeen > graceMs) {
          await chrome.tabs.remove(tab.id).catch(() => {});
          openedByManager.delete(tab.id);
          openTabTimestamps.delete(tab.id);
        }
      } else {
        if (!openTabTimestamps.has(tab.id)) openTabTimestamps.set(tab.id, now);
      }
    } catch {}
  }
}
// background.js — Part 4/4 (live-source selection + poll + alarms + messages)

async function getLiveNowByConfig(cfg) {
  const src = (cfg.live_source || "auto").toLowerCase();
  const canHelix = !!(cfg.client_id && cfg.access_token);
  if (src === "helix") return await checkStreamers(cfg.follows);
  if (src === "following_html") {
    const live = await fetchFollowingLiveLogins();
    return live.size ? live : new Set();
  }
  if (canHelix) {
    const helix = await checkStreamers(cfg.follows);
    if (helix.size) return helix;
  }
  const htmlLive = await fetchFollowingLiveLogins();
  return htmlLive.size ? htmlLive : new Set();
}

async function poll(override = false) {
  if (!override && !(await getEnabled())) return;
  if (!config) config = await loadFileConfig().catch(() => CFG_DEFAULT);

  const live = await getLiveNowByConfig(config); // lowercase

  // open newly-live
  for (const ch of live) {
    if ((config.blacklist || []).includes(ch)) continue;
    if (!currentlyLive.has(ch)) await openStreamTab(ch);
  }

  // close tabs for channels now offline
  await closeOfflineChannelTabs(live, 15000);

  // snapshot + housekeeping
  currentlyLive = live;
  await closeUnfollowedTwitchTabs();
  await enforceMaxTabs(config.max_tabs);
}

chrome.runtime.onInstalled.addListener(async () => {
  if ((await chrome.storage.local.get("enabled")).enabled === undefined) await setEnabled(true);
  config = await loadFileConfig();
  chrome.alarms.create("ttm_tick", { periodInMinutes: 1 });
  lastPoll = 0; poll();
});
chrome.runtime.onStartup.addListener(async () => {
  config = await loadFileConfig();
  chrome.alarms.create("ttm_tick", { periodInMinutes: 1 });
  lastPoll = 0; poll();
});
chrome.alarms.onAlarm.addListener(async a => {
  if (a.name !== "ttm_tick") return;
  const now = Date.now();
  const iv = (config?.check_interval_sec || CFG_DEFAULT.check_interval_sec) * 1000;
  if (now - lastPoll >= iv) { lastPoll = now; await poll(); }
});

chrome.runtime.onMessage.addListener((msg, _s, reply) => {
  (async () => {
    if (msg?.type === "TTM_STATUS") {
  const enabled = await getEnabled();
  const now = Date.now();
  const iv = (config?.check_interval_sec || CFG_DEFAULT.check_interval_sec) * 1000;
  const nextPollInSec = Math.max(0, Math.ceil((iv - (now - lastPoll)) / 1000));
  return reply({ ok: true, enabled, nextPollInSec });
  }

    if (msg?.type === "TTM_FORCE_POLL") { lastPoll = 0; await poll(true); return reply({ ok: true }); }
    if (msg?.type === "TTM_RELOAD_CONFIG") { config = await loadFileConfig(); return reply({ ok: true }); }
    if (msg?.type === "TOGGLE_BOT") { const v = await getEnabled(); await setEnabled(!v); return reply({ ok: true, enabled: !v }); }
    if (msg?.type === "TTM_FETCH_FOLLOWS") {
      if (_fetchInProgress) return reply({ ok: false, busy: true });
      _fetchInProgress = true;
      try {
        const mode = (msg.mode || "active");
        const names = mode === "current" ? await fetchFollowsFromCurrentTab()
                                         : await fetchFollowsViaActiveTabOneTab();
        const uniq = [...new Set(names)].map(s => s.toLowerCase()).filter(Boolean);
        await chrome.storage.local.set({ follows: uniq });
        return reply({ ok: true, usernames: uniq });
      } catch (e) {
        return reply({ ok: false, error: String(e && e.message || e) });
      } finally {
        _fetchInProgress = false;
      }
    }
    reply({ ok: false });
  })();
  return true;
});
