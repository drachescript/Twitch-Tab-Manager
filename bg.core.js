// bg.core.js
self.TTM = self.TTM || {};
TTM.state = TTM.state || { enabled: true, nextPollAt: 0 };

TTM.setEnabled = async (on) => {
  TTM.state.enabled = !!on;
  await chrome.storage.local.set({ ttm_enabled: TTM.state.enabled });
  if (TTM.state.enabled) TTM.armAlarm();
  else chrome.alarms.clear('ttm-tick');
};

TTM.armAlarm = () => {
  const interval = (TTM.config?.check_interval_sec ?? 60) || 60;
  chrome.alarms.create('ttm-tick', { periodInMinutes: Math.max(1, interval / 60) });
};

// Alarm listener registered in background

// Init on install/startup
(async () => {
  const { ttm_enabled } = await chrome.storage.local.get('ttm_enabled');
  TTM.state.enabled = (typeof ttm_enabled === 'boolean') ? ttm_enabled : true;
  await TTM.reloadConfig?.();
  if (TTM.state.enabled) TTM.armAlarm();
  console.log('[TTM] ready; enabled=', TTM.state.enabled);
})();

export const DEFAULTS = {
  enabled: true,
  check_interval_sec: 60,
  max_tabs: 4,
  client_id: "",
  access_token: "",
  follows: [],
  priority: [],
  live_source: "auto",        // "auto" | "helix" | "gql" | "following_html"
  force_unmute: false,
  unmute_streams: false,
  autoplay_streams: false
};

const LS_KEYS = {
  settings: "ttm_settings_v1",
  logs:     "ttm_logs_v1"
};

export const state = {
  settings: { ...DEFAULTS },
  nextCheckAt: 0,
  openChannels: [],
  lastLive: [],
  logs: []
};

// ---- logging / diagnostics ----
export function log(type, detail) {
  try {
    const line = { t: new Date().toISOString(), type, detail };
    state.logs.push(line);
    if (state.logs.length > 400) state.logs.splice(0, state.logs.length - 400);
    chrome.storage.local.set({ [LS_KEYS.logs]: state.logs });
    // also mirror to console (nice for DevTools)
    if (type.includes("error")) console.error("[TTM]", type, detail);
    else console.log("[TTM]", type, detail);
  } catch { /* noop */ }
}

export async function readAll() {
  const got = await chrome.storage.local.get([LS_KEYS.settings, LS_KEYS.logs]);
  if (Array.isArray(got[LS_KEYS.logs])) state.logs = got[LS_KEYS.logs];
  if (got[LS_KEYS.settings]) state.settings = { ...DEFAULTS, ...got[LS_KEYS.settings] };
  return state.settings;
}

export async function saveSettings(patch) {
  state.settings = { ...state.settings, ...patch };
  await chrome.storage.local.set({ [LS_KEYS.settings]: state.settings });
  return state.settings;
}

export function redactForDiag(s) {
  const redacted = { ...s };
  if (redacted.access_token) redacted.access_token = "***";
  if (redacted.client_id) redacted.client_id = "***";
  return redacted;
}

export async function diagnose() {
  const settings = state.settings;
  const diag = {
    ok: true,
    settings: {
      live_source: settings.live_source,
      max_tabs: settings.max_tabs,
      follows_count: Array.isArray(settings.follows) ? settings.follows.length : 0,
      priority_count: Array.isArray(settings.priority) ? settings.priority.length : 0,
      followUnion_count: Array.isArray(settings.follows) ? settings.follows.length : 0
    },
    live_count: Array.isArray(state.lastLive) ? state.lastLive.length : 0,
    open_count: Array.isArray(state.openChannels) ? state.openChannels.length : 0,
    capacity: Math.max(0, (settings.max_tabs || 0) - (state.openChannels?.length || 0)),
    logs: state.logs?.slice(-12) || []
  };
  return diag;
}

// ---- alarms ----
export async function armAlarm() {
  const everySec = Math.max(15, Number(state.settings.check_interval_sec || 60));
  await chrome.alarms.clear("ttm-tick");
  chrome.alarms.create("ttm-tick", { periodInMinutes: Math.max(1, everySec / 60) });
  state.nextCheckAt = Date.now() + everySec * 1000;
  log("alarm_armed", { everySec });
}

// ---- helpers used by background.js ----
export function setOpenChannels(list) {
  state.openChannels = Array.from(new Set(list.map(x => x?.toLowerCase?.() || x))).filter(Boolean);
}

export function setLastLive(list) {
  state.lastLive = list || [];
}

export function getSettings() {
  return state.settings;
}
