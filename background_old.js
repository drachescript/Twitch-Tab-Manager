// background.js

(() => {
  const g = globalThis;
  if (g.__TTM_BG_INITED__) return;   // prevent double-eval / duplicate const errors
  g.__TTM_BG_INITED__ = true;
  g.TTM = g.TTM || {};               // single namespace for top-level helpers
})();

function coerceSettings(s) {
  const copy = { ...s };
  copy.max_tabs = Math.max(1, Math.min(24, Number(copy.max_tabs) || 4));
  copy.check_interval_sec = Math.max(15, Math.min(3600, Number(copy.check_interval_sec) || 60));
  return copy;
}

// wherever you do: state.settings = mergedSettings;
state.settings = coerceSettings(mergedSettings);


import {
  DEFAULTS, state, saveSettings, getSettings,
  setOpenChannels, setLastLive, log, diagnose, armAlarm, redactForDiag
} from './bg.core.js';
import './bg.live.js';
import './bg.tabs.js';
import './bg.compat.js';
import './bg.stability.js';

import { normalizeType, ensureAlarm, setEnabled } from './bg.compat.js';
import { diagnose } from './bg.core.js';

chrome.runtime.onMessage.addListener((msg, _sender, send) => {
  (async () => {
    const kind = normalizeType(msg?.type);

    if (kind === 'ping')   { send({ ok:true, alive:true, enabled: TTM?.state?.enabled ?? true }); return; }
    if (kind === 'toggle') { await setEnabled(msg?.enabled ?? !(TTM?.state?.enabled ?? true)); await ensureAlarm(); send({ ok:true, enabled: TTM?.state?.enabled ?? true }); return; }
    if (kind === 'reload') { // your own reloadConfig will run via options; we just confirm + echo redacted
      if (typeof TTM?.reloadConfig === 'function') await TTM.reloadConfig();
      await ensureAlarm();
      send(await diagnose());
      return;
    }
    if (kind === 'force')  { if (typeof poll === 'function') { await poll({ force:true }); } send({ ok:true }); return; }
    if (kind === 'diag')   { send(await diagnose()); return; }

    // Tell popup what we accept (helps when types mismatch)
    send({ ok:false, error:'unknown_message', received:{type: msg?.type}, accepted_types: globalThis.TTM_ACCEPTED || [] });
  })().catch(e => { console.error('[TTM] msg_err', e); try { send({ ok:false, error:String(e) }); } catch {} });
  return true;
});

// Utilities
const rtURL = (p) => chrome.runtime.getURL(p);
// message aliases → one canonical key
const TTM_NAME_MAP = new Map([
  ['ttm_status','status'], ['status','status'], ['ttm/ping','ping'], ['ping','ping'], ['ttm_ping','ping'],
  ['ttm_toggle','toggle'], ['toggle','toggle'], ['ttm/enable','toggle'],
  ['ttm_reload_config','reload'], ['reload_config','reload'], ['reload','reload'], ['ttm/reload_config','reload'],
  ['ttm_force_poll','force'], ['force_poll','force'], ['force','force'], ['ttm/force_poll','force'],
  ['ttm_diag','diag'], ['ttm_diagnose','diag'], ['diagnose','diag']
]);
function ttmNormalizeType(t){ const k = String(t||'').toLowerCase(); return TTM_NAME_MAP.get(k)||k; }

async function readTextFromPackage(path) {
  try {
    const res = await fetch(rtURL(path));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } catch (e) {
    console.warn('[TTM] readTextFromPackage failed:', path, e.message);
    return '';
  }
}

// Storage keys we use (plus legacy fallbacks we read-only)
const TTM_KEYS = {
  SETTINGS: 'ttm.settings',
  FOLLOWS:  'ttm.follows',
  PRIORITY: 'ttm.priority',
  LEGACY_SETTINGS: ['settings','config','ttm_config'],
  LEGACY_FOLLOWS:  ['follows','followUnion','ttm_followUnion'],
  LEGACY_PRIORITY: ['priority','ttm_priority'],
};

function arr(x){ return Array.isArray(x) ? x : (x ? [x].flat().filter(Boolean) : []); }
function uniq(a){ return [...new Set(a.map(s => String(s||'').trim().toLowerCase()).filter(Boolean))]; }

async function readAllStorage() {
  const [sync, local] = await Promise.all([
    chrome.storage.sync?.get?.(null).catch(()=>({})) ?? {},
    chrome.storage.local.get(null).catch(()=>({}))
  ]);
  return { ...sync, ...local };
}

async function loadSettingsFromStorage(defaults) {
  const all = await readAllStorage();

  let settings = all[TTM_KEYS.SETTINGS];
  if (!settings) for (const k of TTM_KEYS.LEGACY_SETTINGS) { if (all[k]) { settings = all[k]; break; } }
  settings = { ...(defaults||{}), ...(settings||{}) };

  let follows = all[TTM_KEYS.FOLLOWS];
  if (!follows) for (const k of TTM_KEYS.LEGACY_FOLLOWS) { if (all[k]) { follows = all[k]; break; } }
  settings.follows = uniq(arr(follows ?? settings.follows));

  let priority = all[TTM_KEYS.PRIORITY];
  if (!priority) for (const k of TTM_KEYS.LEGACY_PRIORITY) { if (all[k]) { priority = all[k]; break; } }
  settings.priority = uniq(arr(priority ?? settings.priority));

  settings.followUnion = uniq([...(settings.follows||[]), ...(settings.priority||[])]);
  settings.follows_count = settings.follows.length;
  settings.priority_count = settings.priority.length;
  settings.followUnion_count = settings.followUnion.length;

  return settings;
}

async function saveSettingsToStorage(settings) {
  const out = {
    [TTM_KEYS.SETTINGS]: {
      ...settings,
      follows: undefined,
      priority: undefined,
      followUnion: undefined
    },
    [TTM_KEYS.FOLLOWS]: uniq(arr(settings.follows)),
    [TTM_KEYS.PRIORITY]: uniq(arr(settings.priority)),
  };
  await chrome.storage.local.set(out);
}

const uniqLower = (arr) =>
  Array.from(new Set((arr || []).map(s => String(s).trim().toLowerCase()).filter(Boolean)));

// Default settings
function getDefaultConfig() {
  return {
    enabled: true,
    check_interval_sec: 60,
    max_tabs: 4,
    client_id: '',
    access_token: '',
    follows: [],
    priority: [],
    live_source: 'auto',
    force_unmute: false,
    unmute_streams: true,
    autoplay_streams: false,
    force_resume: true,
    followUnion: [],
    followUnion_count: 0,
    follows_count: 0,
    priority_count: 0
  };
}

// Boot and alarm
let booted = false;
// guard to avoid registering the alarm listener more than once
if (typeof globalThis.__ttm_alarm_listener_installed === 'undefined') {
  globalThis.__ttm_alarm_listener_installed = false;
}

async function ensureAlarm() {
  await armAlarm(); // uses state.settings.check_interval_sec
  if (!globalThis.__ttm_alarm_listener_installed) {
    chrome.alarms.onAlarm.addListener(a => {
      if (a.name === 'ttm-tick' && state.settings.enabled) {
        poll().catch(e => log('poll_error', String(e)));
      }
    });
    globalThis.__ttm_alarm_listener_installed = true;
  }
}

(function initTtmMessageMap(){
  if (globalThis.TTM_NAME_MAP) return; // already set
  const map = new Map([
    // canonical
    ['TTM_STATUS','ping'], ['TTM_TOGGLE','toggle'], ['TTM_RELOAD_CONFIG','reload'],
    ['TTM_FORCE_POLL','force'], ['TTM_DIAG','diag'],
    // legacy/fallbacks
    ['PING','ping'], ['TOGGLE','toggle'], ['RELOAD_CONFIG','reload'],
    ['FORCE_POLL','force'], ['DIAGNOSE','diag'],
    // lowercase variants
    ['ttm/ping','ping'], ['ttm/enable','toggle'], ['ttm/reload_config','reload'],
    ['ttm/force_poll','force'], ['ttm/diagnose','diag']
  ]);
  globalThis.TTM_NAME_MAP = map;
  globalThis.TTM_NORMALIZE = (t) => {
    if (!t) return '';
    const k = String(t).trim();
    return map.get(k) || map.get(k.toUpperCase()) || '';
  };
})();
chrome.runtime.onMessage.addListener((msg, sender, send) => {
  (async () => {
    await bootOnce();

    const kind = ttmNormalizeType(msg?.type);

    if (kind === 'ping' || kind === 'status') {
      return void send({ ok:true, alive:true, enabled: state?.settings?.enabled === true });
    }
    if (kind === 'toggle') {
      const on = msg?.enabled !== undefined ? !!msg.enabled : !state.settings.enabled;
      await saveSettings({ ...state.settings, enabled:on });
      await ensureAlarm();
      log('toggle', { enabled:on });
      return void send({ ok:true, enabled:on });
    }
    if (kind === 'reload') {
      await reloadConfig();
      await ensureAlarm();
      return void send({ ok:true, settings: TTM.redactForDiag(state.settings) });
    }
    if (kind === 'force') {
      log('poll_start', { mode: state.settings.live_source || 'auto', enabled: state.settings.enabled, force:true });
      await poll({ force:true });
      return void send({ ok:true });
    }
    if (kind === 'diag') {
      const d = await diagnose();
      return void send(d);
    }

    return void send({ ok:false, error:'unknown_message', received:{ type: msg?.type },
      accepted_types: Array.from(new Set(TTM_NAME_MAP.values())) });
  })().catch(e => { log('msg_err', String(e)); send({ ok:false, error:String(e) }); });

  return true; // keep port open for async
});

(function () {
  const TWITCH_RX = /^https:\/\/www\.twitch\.tv\/(?!directory|p|videos|friends|inventory|drops|settings|messages|login|downloads|moderator)([^/?#]+)/;

  function isChannelUrl(url) { try { return TWITCH_RX.test(url || ''); } catch { return false; } }

  async function pokeTab(tabId, settings) {
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: ['content_unmute.js'] });
      await chrome.tabs.sendMessage(tabId, { type: 'TTM_ENFORCE', settings });
    } catch {}
  }

  async function enforceIfChannel(tabId) {
    const tab = await chrome.tabs.get(tabId);
    if (!isChannelUrl(tab?.url)) return;
    const s = (globalThis.state?.settings) || {};
    await pokeTab(tabId, {
      force_unmute: !!s.force_unmute,
      unmute_streams: !!s.unmute_streams,
      force_resume: !!s.force_resume,
      autoplay_streams: !!s.autoplay_streams
    });
  }

  chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
    if (info.status === 'complete' && isChannelUrl(tab?.url)) enforceIfChannel(tabId);
  });
  chrome.tabs.onActivated.addListener(({ tabId }) => enforceIfChannel(tabId));
  globalThis.TTM_PLAYER = { enforceIfChannel };
})();

async function bootOnce() {
  if (booted) return;
  await reloadConfig();  // storage-over-file merge
  await ensureAlarm();
  booted = true;
  log('boot', { enabled: state.settings.enabled, everySec: state.settings.check_interval_sec });
}
async function reloadConfig() {
  const fromStore = await loadSettingsFromStorage(DEFAULTS);

  // If follows list still empty, try bundled follows.txt (optional bootstrap)
  if (!fromStore.follows?.length) {
    try {
      const url = chrome.runtime.getURL('follows.txt');
      const txt = await fetch(url).then(r => r.ok ? r.text() : '');
      const parsed = uniq(txt.split(/\r?\n/).map(s => s.replace(/^#.*$/,'').trim()));
      if (parsed.length) fromStore.follows = parsed;
    } catch {}
  }
// background.js — reliable config reload
TTM.redactForDiag ??= function redactForDiag(s) {
  // small privacy-friendly snapshot for Diagnose
  const { client_id, access_token, follows, priority, followUnion, ...rest } = s || {};
  return {
    ...rest,
    follows_count: (follows?.length||0),
    priority_count: (priority?.length||0),
    followUnion_count: (followUnion?.length||0)
  };
};

async function readAllStorage() {
  try {
    // grab everything; options page may store under different keys
    const bag = await chrome.storage.local.get(null);
    // common shapes we’ve seen in this project:
    const fromSettings = bag.settings || {};
    const fromOptions  = (bag.options && (bag.options.settings || bag.options)) || {};
    const legacy = {
      follows: bag.follows, priority: bag.priority, followUnion: bag.followUnion,
      max_tabs: bag.max_tabs, check_interval_sec: bag.check_interval_sec, enabled: bag.enabled
    };
    return { ...legacy, ...fromOptions, ...fromSettings };
  } catch (e) {
    log('storage_read_err', String(e));
    return {};
  }
}

function normalizeSettings(raw) {
  const s = { ...raw };
  s.enabled = !!s.enabled;
  s.check_interval_sec = Math.max(10, Number(s.check_interval_sec ?? CFG_DEFAULT.check_interval_sec) || CFG_DEFAULT.check_interval_sec);
  s.max_tabs = Math.max(1, Number(s.max_tabs ?? CFG_DEFAULT.max_tabs) || CFG_DEFAULT.max_tabs);
  s.force_unmute   = !!s.force_unmute;
  s.unmute_streams = !!s.unmute_streams;
  s.force_resume   = !!s.force_resume;
  s.autoplay_streams = !!s.autoplay_streams;
  s.blacklist = Array.isArray(s.blacklist) ? s.blacklist.map(x=>String(x).toLowerCase()) : [];
  s.follows = Array.isArray(s.follows) ? s.follows.map(x=>String(x).toLowerCase()) : [];
  s.priority = Array.isArray(s.priority) ? s.priority.map(x=>String(x).toLowerCase()) : [];
  s.followUnion = Array.isArray(s.followUnion) ? s.followUnion.map(x=>String(x).toLowerCase()) : [...new Set([...(s.follows||[]), ...(s.priority||[])])];
  return s;
}

async function reloadConfig() {
  // 1) defaults
  let base = { ...CFG_DEFAULT };

  // 2) optional file config (web_accessible_resources: ["config.json"])
  try {
    const url = chrome.runtime.getURL('config.json');
    const r = await fetch(url, { cache:'no-cache' });
    if (r.ok) {
      const fileCfg = await r.json();
      base = { ...base, ...fileCfg };
    }
  } catch { /* no file or not needed */ }

  // 3) options/storage (wins over file/defaults)
  const fromStorage = await readAllStorage();

  // 4) final merge (scoped; nothing leaks to top level)
  const mergedSettings = normalizeSettings({ ...base, ...fromStorage });

  // 5) assign to state and write back cheap counts for UI
  state.settings = mergedSettings;
  await chrome.storage.local.set({
    settings: mergedSettings,
    follows: mergedSettings.follows,
    priority: mergedSettings.priority,
    followUnion: mergedSettings.followUnion,
    follows_count: mergedSettings.follows.length,
    priority_count: mergedSettings.priority.length,
    followUnion_count: mergedSettings.followUnion.length
  });

  log('config_loaded', TTM.redactForDiag(mergedSettings));
  return mergedSettings;
}

  fromStore.followUnion = uniq([...(fromStore.follows||[]), ...(fromStore.priority||[])]);
  fromStore.follows_count = fromStore.follows.length;
  fromStore.priority_count = fromStore.priority.length;
  fromStore.followUnion_count = fromStore.followUnion.length;

  state.settings = { ...state.settings, ...fromStore };
  await saveSettingsToStorage(state.settings);

  log('config_loaded', {
    enabled: state.settings.enabled,
    check_interval_sec: state.settings.check_interval_sec,
    max_tabs: state.settings.max_tabs,
    client_id: state.settings.client_id ? 'set' : '',
    access_token: state.settings.access_token ? 'set' : '',
    follows: [], priority: [], // don’t spam
    live_source: state.settings.live_source,
    force_unmute: !!state.settings.force_unmute,
    unmute_streams: !!state.settings.unmute_streams,
    autoplay_streams: !!state.settings.autoplay_streams,
    force_resume: !!state.settings.force_resume
  });
}

// Tab helpers (fallback)
const Tabs = {
  async listOpenChannels() {
    const tabs = await chrome.tabs.query({ url: ['*://www.twitch.tv/*', '*://twitch.tv/*'] });
    const out = new Set();
    for (const t of tabs) {
      try {
        const u = new URL(t.url);
        const seg = u.pathname.split('/').filter(Boolean);
        const login = seg[0]?.toLowerCase();
        if (login && !['directory','videos','about','schedule','moderator'].includes(login)) {
          out.add(login);
        }
      } catch {}
    }
    return [...out];
  },

  async openNeeded(liveList, maxTabs) {
    const open = await this.listOpenChannels();
    const slots = Math.max(0, (maxTabs || 0) - open.length);
    const want = liveList.filter(x => !open.includes(x)).slice(0, slots);
    for (const login of want) {
      try {
        await chrome.tabs.create({ url: `https://www.twitch.tv/${login}`, active: false });
      } catch (e) {
        log('open_err', { login, e: String(e) });
      }
    }
    return { open, opened: want };
  },

  async closeOffline(liveSet) {
    const tabs = await chrome.tabs.query({ url: ['*://www.twitch.tv/*', '*://twitch.tv/*'] });
    for (const t of tabs) {
      try {
        const u = new URL(t.url);
        const seg = u.pathname.split('/').filter(Boolean);
        const login = (seg[0] || '').toLowerCase();
        if (!login) continue;
        if (['directory','videos','about','schedule','moderator'].includes(login)) continue;

        if (!liveSet.has(login)) {
          if (self.bgTabs?.shouldClose) {
            const ok = await self.bgTabs.shouldClose(t, login, liveSet);
            if (!ok) continue;
          }
          await chrome.tabs.remove(t.id);
          log('closed_offline', { login });
        }
      } catch {}
    }
  }
};
// ---------- polling (with guard to avoid duplicate runs) ----------
let _polling = false;

export async function poll({ force = false } = {}) {
  if (_polling) {
    if (!force) {
      log('poll_skip', 'busy');
      return;
    }
    // Force requested: wait for current poll to finish (bounded) then proceed
    try {
      const maxWaitMs = 30_000;
      const start = Date.now();
      log('poll_waiting', { reason: 'waiting_for_current', maxWaitMs });
      while (_polling && (Date.now() - start) < maxWaitMs) {
        // small sleep
        await new Promise(r => setTimeout(r, 250));
      }
      if (_polling) {
        log('poll_skip', 'still_busy_after_wait');
        return;
      }
    } catch (e) {
      log('poll_wait_err', String(e));
      return;
    }
  }
  _polling = true;
  log('poll_begin', { force });

  try {
    await bootOnce();
    const cfg = getSettings();

    const openNow = await Tabs.listOpenChannels();
    setOpenChannels(openNow);
    const cap = Math.max(0, (cfg.max_tabs || 0) - openNow.length);

    // live list (priority-aware) via bg.live.js
    let liveSet = new Set();
    try {
      if (self.bgLive?.getLiveNowByConfigSafe) {
        liveSet = await self.bgLive.getLiveNowByConfigSafe(cfg);
      }
    } catch (e) {
      log('live_error', String(e));
    }

    const liveList = Array.from(liveSet);
    setLastLive(liveList);
    log('live_result', { count: liveList.length, source: cfg.live_source || 'auto' });

    if (self.bgTabs?.reconcile) {
      await self.bgTabs.reconcile({
        liveList,
        maxTabs: cfg.max_tabs,
        priority: cfg.priority || []
      });
      // Also close any non-managed/open Twitch tabs that are offline (not in liveSet).
      try {
        await Tabs.closeOffline(liveSet);
        log('closed_offline_extra', { note: 'closed non-managed offline tabs' });
      } catch (e) {
        log('closed_offline_extra_err', String(e));
      }
    } else {
      await Tabs.openNeeded(liveList, cfg.max_tabs || 0);
      await Tabs.closeOffline(liveSet);
    }

    const afterOpen = await Tabs.listOpenChannels();
    setOpenChannels(afterOpen);
    log('capacity', { open: afterOpen.length, max: cfg.max_tabs || 0 });
  } finally {
    _polling = false;
  }
}

// Expose poll to globals
try {
  if (typeof self === 'object' && self.TTM) self.TTM.poll = poll;
  globalThis.poll = poll;
} catch (e) { /* ignore in restricted environments */ }

function ttmBuildUnion(settings) {
  const f = Array.isArray(settings?.follows) ? settings.follows : [];
  const p = Array.isArray(settings?.priority) ? settings.priority : [];
  const u = Array.from(new Set([...f, ...p].map(s => String(s).toLowerCase())));
  return u;
}

async function ttmHydrateCounts() {
  if (!state || !state.settings) return;
  
  // Ensure arrays exist
  state.settings.follows = Array.isArray(state.settings.follows) ? state.settings.follows : [];
  state.settings.priority = Array.isArray(state.settings.priority) ? state.settings.priority : [];
  
  // Build union list from follows and priority
  const allChannels = [...state.settings.follows, ...state.settings.priority];
  state.settings.followUnion = [...new Set(allChannels.map(s => String(s).toLowerCase().trim()).filter(Boolean))];
  
  // Update counts
  state.settings.follows_count = state.settings.follows.length;
  state.settings.priority_count = state.settings.priority.length;
  state.settings.followUnion_count = state.settings.followUnion.length;
  
  log('counts_updated', {
    follows: state.settings.follows_count,
    priority: state.settings.priority_count,
    union: state.settings.followUnion_count
  });
  
  await chrome.storage.local.set({ settings: state.settings });
}

let ttmBooted = false;
async function ttmBootOnce(){
  if (ttmBooted) return;
  if (typeof reloadConfig === 'function') await reloadConfig();
  if (typeof ensureAlarm === 'function') await ensureAlarm();
  ttmBooted = true;
  log?.('boot', { enabled: state?.settings?.enabled === true, everySec: state?.settings?.check_interval_sec });

// Do not use top-level await in service worker; call and ignore completion here
ttmHydrateCounts().catch(() => {});
}
chrome.runtime.onInstalled.addListener(()=>{ ttmBooted = false; ttmBootOnce(); });
chrome.runtime.onStartup?.addListener(()=>{ ttmBooted = false; ttmBootOnce(); });
ttmBootOnce();

// Message routing
const NAME_MAP = new Map([
  ['ttm/ping','ping'], ['TTM_PING','ping'], ['PING','ping'],
  ['ttm/enable','toggle'], ['TTM_TOGGLE','toggle'], ['TOGGLE','toggle'],
  ['ttm/reload_config','reload'], ['TTM_RELOAD_CONFIG','reload'], ['RELOAD_CONFIG','reload'],
  ['ttm/force_poll','force'], ['TTM_FORCE_POLL','force'], ['FORCE_POLL','force'],
  ['ttm/diagnose','diag'], ['TTM_DIAGNOSE','diag'], ['DIAGNOSE','diag']
]);
  // Debug helper: request the raw storage contents
  globalThis.TTM_NAME_MAP?.set?.('TTM_GET_STORAGE', 'get_storage');
  globalThis.TTM_NAME_MAP?.set?.('ttm_get_storage', 'get_storage');

const normalizeType = (t='') => NAME_MAP.get(String(t)) || String(t).toLowerCase();
chrome.runtime.onMessage.addListener((msg, _sender, send) => {
  (async () => {
    const kind = normalizeType(msg?.type);
    const _kind = globalThis.TTM_NORMALIZE?.(msg?.type) || '';
    // Log incoming messages for easier debugging of popup <-> background comms
    try { log('msg_received', { raw: msg?.type, kind, alt: _kind }); } catch {}
    await bootOnce();
    
    // Extra RPC helpers (non-breaking)
  if (kind === 'get_storage') {
  const dump = await readAllStorage();
  // redact secrets
  if (dump?.[TTM_KEYS.SETTINGS]?.access_token) dump[TTM_KEYS.SETTINGS].access_token = 'set';
  send({ ok: true, store: dump });
  return;
  }
  if (kind === 'save_settings') {
  const next = { ...state.settings, ...(msg?.settings||{}) };
  await saveSettingsToStorage(next);
  await reloadConfig();           // keep memory in sync + recompute counts
  await ensureAlarm();
  send({ ok: true, settings: redactForDiag(state.settings) });
  return;
  }
  if (kind === 'save_lists') {
  const s = { ...state.settings };
  if (msg?.follows)  s.follows  = uniq(arr(msg.follows));
  if (msg?.priority) s.priority = uniq(arr(msg.priority));
  s.followUnion = uniq([...(s.follows||[]), ...(s.priority||[])]);
  await saveSettingsToStorage(s);
  await reloadConfig();
  send({ ok: true, counts: {
    follows: s.follows.length, priority: s.priority.length, union: s.followUnion.length
  }});
  return;
  }

    if (_kind === 'ping') {
  send({ ok:true, alive:true, enabled: state?.settings?.enabled === true });
  return;
  }
  if (_kind === 'toggle') {
  const on = (msg?.enabled === undefined) ? !(state?.settings?.enabled === true) : !!msg.enabled;
  const next = { ...(state.settings||{}), enabled: on };
  await chrome.storage.local.set({ settings: next });
  state.settings = next;
  if (typeof ensureAlarm === 'function') await ensureAlarm();
  log?.('toggle', { enabled: on });
  send({ ok:true, enabled:on });
  return;
  }
  if (_kind === 'reload') {
  if (typeof reloadConfig === 'function') await reloadConfig();
  if (typeof ensureAlarm === 'function') await ensureAlarm();
  send({ ok:true, settings: (state?.settings || {}) });
  return;
  }
  if (_kind === 'force') {
  log?.('poll_start', { mode: state?.settings?.live_source || 'auto', enabled: state?.settings?.enabled === true, force:true });
  if (typeof poll === 'function') await poll({ force:true });
  send({ ok:true });
  return;
  }
  if (_kind === 'diag') {
  const d = (typeof diagnose === 'function') ? await diagnose() : { ok:true };
  send(d);
  return;
  }

    if (kind === 'ping') {
      send({ ok: true, alive: true, enabled: state.settings.enabled });
      return;
    }
    if (kind === 'toggle') {
      const on = !!msg?.enabled ? true : !state.settings.enabled;
      await saveSettings({ ...state.settings, enabled: on });
      await ensureAlarm();
      log('toggle', { enabled: on });
      send({ ok: true, enabled: on });
      return;
    }
    if (kind === 'reload') {
      await reloadConfig();
      await ensureAlarm();
      send({ ok: true, settings: redactForDiag(state.settings) });
      return;
    }
    if (kind === 'force') {
      if (!(state.settings.follows?.length) && !(state.settings.priority?.length)) {
        await reloadConfig(); // make sure file lists are present
      }
      log('poll_start', {
        mode: state.settings.live_source || 'auto',
        enabled: state.settings.enabled,
        force: true
      });
      await poll({ force: true });
      send({ ok: true });
      return;
    }
    if (kind === 'diag') {
      const d = await diagnose();
      send(d);
      return;
    }

    if (kind === 'get_storage') {
      try {
        const all = await new Promise(r => chrome.storage.local.get(null, r));
        send({ ok: true, storage: all });
      } catch (e) {
        send({ ok: false, error: String(e) });
      }
      return;
    }

  send({
  ok:false,
  error:'unknown_message',
  received:{ type: msg?.type },
  accepted_types: Array.from(globalThis.TTM_NAME_MAP?.keys?.() || [])
  });

  })().catch(e => { log('msg_err', String(e)); send({ ok:false, error:String(e) }); });

  // keep port open for async
  return true;
});

// Service worker lifecycle
chrome.runtime.onInstalled.addListener(async () => {
  // Initialize settings if they don't exist
  const { settings } = await chrome.storage.local.get(['settings']);
  if (!settings) {
    await chrome.storage.local.set({ settings: getDefaultConfig() });
  }
  // Update followUnion/counts even if settings exist
  await ttmHydrateCounts();
  booted = false;
  await bootOnce();
});

chrome.runtime.onStartup?.addListener(async () => {
  booted = false;
  await bootOnce();
});
// PATCH C1: coerce numeric settings + persist if changed
async function ttmCoerceNumericSettings() {
  try {
    const s = (globalThis.state && state.settings) ? state.settings : {};
    const next = { ...s };
    next.max_tabs = Math.max(0, Number(s.max_tabs ?? 4));
    next.check_interval_sec = Math.max(5, Number(s.check_interval_sec ?? 60)); // guard

    const changed =
      Number(next.max_tabs) !== Number(s.max_tabs) ||
      Number(next.check_interval_sec) !== Number(s.check_interval_sec);

    if (changed) {
      state.settings = next;
      try { await chrome.storage.local.set({ ttm_settings_v1: next }); } catch {}
      try { if (typeof ensureAlarm === 'function') await ensureAlarm(); } catch {}
      try { (globalThis.log||console.log)('coerce_settings', { max_tabs: next.max_tabs, check_interval_sec: next.check_interval_sec }); } catch {}
    }
  } catch {}
}

// Run once after boot completes
try { setTimeout(() => { ttmCoerceNumericSettings().catch(()=>{}); }, 0); } catch {}

// Also run whenever options writes settings
try {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes && changes.ttm_settings_v1) {
      ttmCoerceNumericSettings().catch(()=>{});
    }
  });
} catch {}

// kick it off
bootOnce().catch(e => log('boot_err', String(e)));