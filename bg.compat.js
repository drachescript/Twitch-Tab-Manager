// bg.compat.js
import {
  state, DEFAULTS, saveSettings, getSettings,
  setOpenChannels, setLastLive, log, armAlarm, redactForDiag
} from './bg.core.js';
import { poll as corePoll } from './background.js'; // safe cyclic import (module bindings)

const Global = (self || globalThis);

// ---- Legacy constants / aliases (no functional deletion) ----
export const CFG_DEFAULT = DEFAULTS;          // old name still reachable
Global.CFG_DEFAULT = CFG_DEFAULT;

// Keep a stable logger name you used in older files
export function dispatchLog(type, detail) { log(type, detail); }
Global.dispatchLog = dispatchLog;

// Some older code referenced setEnabled; keep it
export async function setEnabled(on) {
  const enabled = !!on;
  await saveSettings({ ...getSettings(), enabled });
  await ensureAlarm();
  log('toggle', { enabled });
}
Global.setEnabled = setEnabled;

// Unified alarm arming (older code may call this directly)
export async function ensureAlarm() {
  await armAlarm();
}
Global.ensureAlarm = ensureAlarm;

// ---- Helpers you previously had inline in background.js ----
export function uniqLower(arr) {
  return Array.from(new Set((arr || []).map(s => String(s).trim().toLowerCase()).filter(Boolean)));
}
Global.uniqLower = uniqLower;

export async function readTextFromPackage(path) {
  try {
    const res = await fetch(chrome.runtime.getURL(path));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } catch (e) {
    console.warn('[TTM] compat.readTextFromPackage:', path, e.message);
    return '';
  }
}
Global.readTextFromPackage = readTextFromPackage;

// ---- Tabs helpers (kept for older callers; forward to bg.tabs if present) ----
async function listOpenChannelsCompat() {
  if (Global.bgTabs?.listOpenChannels) return Global.bgTabs.listOpenChannels();
  const tabs = await chrome.tabs.query({ url: ['*://www.twitch.tv/*', '*://twitch.tv/*'] });
  const out = new Set();
  for (const t of tabs) {
    try {
      const u = new URL(t.url);
      const seg = u.pathname.split('/').filter(Boolean);
      const login = seg[0]?.toLowerCase();
      if (login && !['directory','videos','about','schedule','moderator'].includes(login)) out.add(login);
    } catch {}
  }
  return [...out];
}
Global.listOpenChannels = listOpenChannelsCompat;

// Keep old names for “open/close” flows if something calls them
Global.openNeeded = async (liveList, maxTabs) => {
  if (Global.bgTabs?.reconcile) {
    return Global.bgTabs.reconcile({ liveList, maxTabs, priority: getSettings().priority || [] });
  }
  // minimal fallback: only open missing
  const open = await listOpenChannelsCompat();
  const slots = Math.max(0, (maxTabs || 0) - open.length);
  const want = (liveList || []).filter(x => !open.includes(x)).slice(0, slots);
  for (const login of want) {
    try { await chrome.tabs.create({ url: `https://www.twitch.tv/${login}`, active: false }); }
    catch (e) { log('open_err', { login, e: String(e) }); }
  }
  return { opened: want };
};
// ---- Message router compat (accept *all* historical types) ----
const NAME_MAP = new Map([
  ['ttm/ping','ping'], ['ttm/enable','toggle'], ['ttm/reload_config','reload'],
  ['ttm/force_poll','force'], ['ttm/diagnose','diag'],
  ['TTM_PING','ping'], ['TTM_TOGGLE','toggle'], ['TTM_RELOAD_CONFIG','reload'],
  ['TTM_FORCE_POLL','force'], ['TTM_DIAGNOSE','diag'], ['TTM_DIAG','diag'],
  ['PING','ping'], ['TOGGLE','toggle'], ['RELOAD_CONFIG','reload'],
  ['FORCE_POLL','force'], ['DIAGNOSE','diag'],
  // older plain keys:
  ['ping','ping'], ['toggle','toggle'], ['reload_config','reload'],
  ['force_poll','force'], ['diagnose','diag']
]);
Global.TTM_ACCEPTED = Array.from(NAME_MAP.keys());

// Normalize for any caller
export const normalizeType = (t) => {
  if (!t) return '';
  const key = String(t).trim();
  return NAME_MAP.get(key.toLowerCase()) || NAME_MAP.get(key) || '';
};
Global.normalizeType = normalizeType;

// Plug into the live message bus only if nobody else did it already
if (!Global.__ttm_compat_router_installed) {
  Global.__ttm_compat_router_installed = true;

  chrome.runtime.onMessage.addListener((msg, _sender, send) => {
    (async () => {
      const kind = normalizeType(msg?.type);

      if (kind === 'ping')   { send({ ok: true, alive: true, enabled: getSettings().enabled }); return; }
      if (kind === 'toggle') { await setEnabled(msg?.enabled ?? !getSettings().enabled); send({ ok: true, enabled: getSettings().enabled }); return; }
      if (kind === 'reload') { // let background.js own reload; we just forward
        // Signal through the primary router if present; otherwise answer lightweight
        send({ ok: true, settings: redactForDiag(getSettings()) });
        return;
      }
      if (kind === 'force')  { await corePoll({ force: true }); send({ ok: true }); return; }
      if (kind === 'diag')   {
        // minimal diag (let main one do the heavy work if it exists)
        send({
          ok: true,
          settings: {
            ...redactForDiag(getSettings()),
            follows_count: (getSettings().follows || []).length,
            priority_count: (getSettings().priority || []).length,
            followUnion_count: (getSettings().followUnion || []).length
          },
          live_count: (Global.__lastLive || []).length,
          open_count: (Global.__lastOpen || []).length,
          capacity: Math.max(0, (getSettings().max_tabs || 0) - ((Global.__lastOpen || []).length))
        });
        return;
      }

      send({
        ok: false, error: 'unknown_message',
        received: { type: msg?.type }, accepted_types: Global.TTM_ACCEPTED
      });
    })().catch(e => { log('msg_err_compat', String(e)); send({ ok:false, error:String(e) }); });
    return true;
  });
}

// Update mirrors so Diagnose can read last values even if only compat runs
const __mirror = () => {
  Global.__lastOpen = state.openChannels || [];
  Global.__lastLive = state.lastLive || [];
};
setInterval(__mirror, 1500);
