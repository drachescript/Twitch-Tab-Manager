// MV3 service worker: polling via chrome.alarms, no long-lived intervals.

const CFG_DEFAULT = {
  force_unmute: true,
  force_resume: true,
  check_interval_sec: 60,
  unmute_streams: true,
  max_tabs: 8
};

const TWITCH = "https://www.twitch.tv/";
const openTabTimestamps = new Map();
let config = null;
let currentlyLive = new Set();
let lastPoll = 0;

async function loadFileConfig() {
  const [cfgRes, folRes] = await Promise.all([
    fetch(chrome.runtime.getURL("config.json")),
    fetch(chrome.runtime.getURL("follows.txt"))
  ]);
  const j = await cfgRes.json();
  const lines = (await folRes.text()).split("\n").map(s => s.trim().toLowerCase()).filter(Boolean);
  return { ...CFG_DEFAULT, ...j, follows: lines };
}
async function getEnabled() {
  const { enabled } = await chrome.storage.local.get("enabled");
  return enabled !== false; // default ON
}
async function setEnabled(v) { await chrome.storage.local.set({ enabled: !!v }); }

async function ensureStartup() {
  if (!config) config = await loadFileConfig().catch(() => CFG_DEFAULT);
  const store = await chrome.storage.local.get(["openTabs"]);
  if (!store.openTabs) await chrome.storage.local.set({ openTabs: {} });
  if ((await chrome.storage.local.get("enabled")).enabled === undefined) await setEnabled(true);
}

function isIgnoredPath(path) {
  const p = (path || "/").toLowerCase();
  if (p.startsWith("/moderator")) return true;
  return ["/drops", "/drops/inventory", "/settings/connections", "/directory", "/creatorcamp"].includes(p);
}

async function dedupeChannelTabs(channel) {
  const tabs = await chrome.tabs.query({ url: `${TWITCH}${channel}*` });
  if (tabs.length <= 1) return;
  const keep = tabs.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0];
  await Promise.all(tabs.filter(t => t.id !== keep.id).map(t => chrome.tabs.remove(t.id)));
}

async function openStreamTab(username) {
  const url = `${TWITCH}${username}`;
  const existing = await chrome.tabs.query({ url: `${url}*` });
  if (existing.length) { await dedupeChannelTabs(username); return existing[0].id; }

  const tab = await chrome.tabs.create({ url, active: false });
  setTimeout(async () => {
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content_unmute.js"] });
    } catch {}
  }, 1500 + Math.floor(Math.random() * 1200));
  return tab.id;
}

async function closeStreamTab(username) {
  const url = `${TWITCH}${username}`;
  const tabs = await chrome.tabs.query({ url: `${url}*` });
  await Promise.all(tabs.map(t => chrome.tabs.remove(t.id).catch(() => {})));
  for (const t of tabs) openTabTimestamps.delete(t.id);
}

async function closeUnfollowedTwitchTabs() {
  const tabs = await chrome.tabs.query({ url: "*://www.twitch.tv/*" });
  const now = Date.now();
  for (const tab of tabs) {
    try {
      const u = new URL(tab.url); const path = u.pathname || "/";
      if (isIgnoredPath(path)) continue;
      const ch = path.split("/")[1]?.toLowerCase();
      if (!ch || ch === "videos" || ch === "directory") continue;
      if (!config.follows.includes(ch)) {
        const started = openTabTimestamps.get(tab.id) || now;
        if (!openTabTimestamps.has(tab.id)) openTabTimestamps.set(tab.id, now);
        if (now - started > 60000) { await chrome.tabs.remove(tab.id).catch(() => {}); openTabTimestamps.delete(tab.id); }
      } else {
        if (!openTabTimestamps.has(tab.id)) openTabTimestamps.set(tab.id, now);
      }
    } catch {}
  }
  const openIds = new Set(tabs.map(t => t.id));
  for (const id of openTabTimestamps.keys()) if (!openIds.has(id)) openTabTimestamps.delete(id);
}

async function enforceMaxTabs(maxTabs) {
  const tabs = await chrome.tabs.query({ url: "*://www.twitch.tv/*" });
  const chanTabs = [];
  for (const t of tabs) {
    try {
      const u = new URL(t.url); const path = u.pathname || "/";
      if (isIgnoredPath(path)) continue;
      const ch = path.split("/")[1]?.toLowerCase();
      if (!ch || ch === "videos" || ch === "directory") continue;
      chanTabs.push(t);
    } catch {}
  }
  if (chanTabs.length <= maxTabs) return;
  const sorted = chanTabs.map(t => ({ t, last: t.lastAccessed || 0 })).sort((a, b) => b.last - a.last);
  for (const item of sorted.slice(maxTabs)) {
    await chrome.tabs.remove(item.t.id).catch(() => {});
    openTabTimestamps.delete(item.t.id);
  }
}

async function checkStreamers(logins) {
  if (!config?.client_id || !config?.access_token) return new Set();
  if (!logins.length) return new Set();
  const qs = logins.map(s => `user_login=${encodeURIComponent(s)}`).join("&");
  const res = await fetch(`https://api.twitch.tv/helix/streams?${qs}`, {
    headers: { "Client-ID": config.client_id, "Authorization": `Bearer ${config.access_token}` }
  }).catch(() => null);
  if (!res || !res.ok) return new Set();
  const data = await res.json().catch(() => ({}));
  const live = (data.data || []).map(s => (s.user_login || "").toLowerCase()).filter(Boolean);
  return new Set(live);
}

async function poll() {
  if (!(await getEnabled())) return;
  if (!config) config = await loadFileConfig().catch(() => CFG_DEFAULT);

  const live = await checkStreamers(config.follows);
  // open newly live (skip blacklist if present)
  for (const ch of live) if (!currentlyLive.has(ch) && !(config.blacklist || []).includes(ch)) await openStreamTab(ch);
  // close tabs for channels that went offline
  for (const ch of currentlyLive) if (!live.has(ch)) await closeStreamTab(ch);
  currentlyLive = live;

  await closeUnfollowedTwitchTabs();
  await enforceMaxTabs(config.max_tabs);
}

chrome.runtime.onInstalled.addListener(async () => {
  await ensureStartup();
  chrome.alarms.create("ttm_tick", { periodInMinutes: 1 });
  lastPoll = 0;
  poll();
});
chrome.runtime.onStartup.addListener(async () => {
  await ensureStartup();
  chrome.alarms.create("ttm_tick", { periodInMinutes: 1 });
  lastPoll = 0;
  poll();
});
chrome.alarms.onAlarm.addListener(async a => {
  if (a.name !== "ttm_tick") return;
  const now = Date.now();
  const interval = (config?.check_interval_sec || CFG_DEFAULT.check_interval_sec) * 1000;
  if (now - lastPoll >= interval) { lastPoll = now; await poll(); }
});
chrome.runtime.onMessage.addListener((msg, _s, reply) => {
  if (msg?.type === "TTM_FORCE_POLL") { lastPoll = 0; poll().then(() => reply({ ok: true })).catch(() => reply({ ok: false })); return true; }
  if (msg?.type === "TTM_RELOAD_CONFIG") { loadFileConfig().then(c => { config = c; reply({ ok: true }); }).catch(() => reply({ ok: false })); return true; }
  if (msg?.type === "TOGGLE_BOT") { // popup toggle
    getEnabled().then(v => setEnabled(!v).then(() => reply({ ok: true, enabled: !v })));
    return true;
  }
  return false;
});
