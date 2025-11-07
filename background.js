// background.js

import {
  DEFAULTS, state, saveSettings, getSettings,
  setOpenChannels, setLastLive, log, diagnose, armAlarm, redactForDiag
} from './bg.core.js';
import './bg.live.js';
import './bg.tabs.js';
import './bg.compat.js';

// Utilities
const rtURL = (p) => chrome.runtime.getURL(p);

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
if (typeof globalThis.__ttm_alarm_listener_installed === 'undefined') globalThis.__ttm_alarm_listener_installed = false;
// === [TTM PATCH A — message normalize + accepted map] ===
(function initTtmMessageMap(){
  if (globalThis.TTM_NAME_MAP) return; // don't re-add if already present
  const map = new Map([
    // canonical
    ['TTM_STATUS','ping'], ['TTM_TOGGLE','toggle'], ['TTM_RELOAD_CONFIG','reload'],
    ['TTM_FORCE_POLL','force'], ['TTM_DIAG','diag'],
    // legacy/fallbacks the popup might still use
    ['PING','ping'], ['TOGGLE','toggle'], ['RELOAD_CONFIG','reload'],
    ['FORCE_POLL','force'], ['DIAGNOSE','diag'],
    // lowercase variants (some older popups sent these)
    ['ttm/ping','ping'], ['ttm/enable','toggle'], ['ttm/reload_config','reload'],
    ['ttm/force_poll','force'], ['ttm/diagnose','diag']
  ]);
  globalThis.TTM_NAME_MAP = map;
  globalThis.TTM_NORMALIZE = (t) => {
    if (!t) return '';
    const k = String(t).trim();
    const hit = map.get(k) || map.get(k.toUpperCase());
    return hit || '';
  };
})();

async function ensureAlarm() {
  // armAlarm reads state.settings.check_interval_sec
  await armAlarm();
  // Install the alarm listener only once (prevent duplicate listeners)
  if (!globalThis.__ttm_alarm_listener_installed) {
    chrome.alarms.onAlarm.addListener(a => {
      if (a.name === 'ttm-tick' && state.settings.enabled) {
        poll().catch(e => log('poll_error', String(e)));
      }
    });
    globalThis.__ttm_alarm_listener_installed = true;
  }
}

async function bootOnce() {
  if (booted) return;
  await reloadConfig();  // storage-over-file merge
  await ensureAlarm();
  booted = true;
  log('boot', { enabled: state.settings.enabled, everySec: state.settings.check_interval_sec });
}
// Config merge (storage only)
async function reloadConfig() {
  // Read full storage to support both nested `settings` and legacy/top-level keys
  const all = await new Promise(r => chrome.storage.local.get(null, r));
  const defaults = getDefaultConfig();

  // Log top-level keys present (redacted) to aid debugging
  try { log('storage_keys', { keys: Object.keys(all || {}) }); } catch (e) { /* noop */ }

  // Stored may be under `settings` (new) or `config` / top-level keys (old). Prefer nested `settings`.
  let storedNested = all?.settings ?? all?.config ?? null;
  if (typeof storedNested === 'string') {
    try { storedNested = JSON.parse(storedNested); } catch (e) { /* leave as-is */ }
  }

  // Build a flattened stored object pulling from nested object first, then top-level keys
  const storedFlat = {
    client_id: storedNested?.client_id ?? all.client_id,
    access_token: storedNested?.access_token ?? all.access_token,
    max_tabs: storedNested?.max_tabs ?? all.max_tabs,
    enabled: (storedNested && storedNested.enabled !== undefined) ? storedNested.enabled : (all.enabled !== undefined ? all.enabled : undefined),
    check_interval_sec: storedNested?.check_interval_sec ?? all.check_interval_sec,
    follows: Array.isArray(storedNested?.follows) ? storedNested.follows : (Array.isArray(all.follows) ? all.follows : []),
    priority: Array.isArray(storedNested?.priority) ? storedNested.priority : (Array.isArray(all.priority) ? all.priority : []),
    live_source: storedNested?.live_source ?? all.live_source,
    force_unmute: storedNested?.force_unmute ?? all.force_unmute,
    unmute_streams: storedNested?.unmute_streams ?? all.unmute_streams,
    autoplay_streams: storedNested?.autoplay_streams ?? all.autoplay_streams,
    force_resume: storedNested?.force_resume ?? all.force_resume,
    // If follows were stored as a newline string, accept that too (we'll normalize below)
    _follows_string: (!Array.isArray(storedNested?.follows) && typeof storedNested?.follows === 'string') ? storedNested.follows : (!Array.isArray(all.follows) && typeof all.follows === 'string' ? all.follows : null)
  };

  // Merge defaults with stored values
  const merged = { ...defaults, ...(storedFlat || {}) };

  // Normalize arrays and derive union/counts
  // If follows were stored as a single newline string, parse it now into an array
  if ((!Array.isArray(merged.follows) || merged.follows.length === 0) && storedFlat?._follows_string) {
    merged.follows = String(storedFlat._follows_string).split(/\r?\n/).map(s => String(s||'').toLowerCase().trim()).filter(Boolean);
  }
  merged.follows = Array.isArray(merged.follows) ? merged.follows.map(s => String(s).toLowerCase().trim()).filter(Boolean) : [];
  merged.priority = Array.isArray(merged.priority) ? merged.priority.map(s => String(s).toLowerCase().trim()).filter(Boolean) : [];
  merged.followUnion = Array.from(new Set([...merged.follows, ...merged.priority]));
  merged.follows_count = merged.follows.length;
  merged.priority_count = merged.priority.length;
  merged.followUnion_count = merged.followUnion.length;

  state.settings = merged;
  // Persist normalized settings under `settings` key so future loads are consistent
  await chrome.storage.local.set({ settings: merged });
  log('config_loaded', redactForDiag(merged));
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
  ['ttm/ping','ping'], ['ttm/enable','toggle'], ['ttm/reload_config','reload'],
  ['ttm/force_poll','force'], ['ttm/diagnose','diag'],
  ['ttm_ping','ping'], ['ttm_toggle','toggle'], ['ttm_reload_config','reload'],
  ['ttm_force_poll','force'], ['ttm_diagnose','diag'],
  ['ping','ping'], ['toggle','toggle'], ['reload_config','reload'],
  ['force_poll','force'], ['diagnose','diag'],
  ['TTM_DIAG','diag'], ['TTM_DIAGNOSE','diag']
]);
  // Debug helper: request the raw storage contents
  (globalThis.TTM_NAME_MAP || map)?.set?.('TTM_GET_STORAGE', 'get_storage');
  (globalThis.TTM_NAME_MAP || map)?.set?.('ttm_get_storage', 'get_storage');

const normalizeType = (t) => {
  if (!t) return '';
  const key = String(t).trim();
  return NAME_MAP.get(key.toLowerCase()) || NAME_MAP.get(key) || '';
};
chrome.runtime.onMessage.addListener((msg, _sender, send) => {
  (async () => {
    const kind = normalizeType(msg?.type);
    const _kind = globalThis.TTM_NORMALIZE?.(msg?.type) || '';
    // Log incoming messages for easier debugging of popup <-> background comms
    try { log('msg_received', { raw: msg?.type, kind, alt: _kind }); } catch {}
    await bootOnce();
    // === [TTM PATCH A.2 — additive branches] ===
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

// kick it off
bootOnce().catch(e => log('boot_err', String(e)));
