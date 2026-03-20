import { state, saveSettings, log } from "./core.js";

const T = (globalThis.TTM = globalThis.TTM || {});

function parseBool(value, fallback) {
  if (value === true || value === false) return value;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (v === "true") return true;
    if (v === "false") return false;
  }
  if (value === undefined || value === null) return fallback;
  return !!value;
}

function normalizeName(value) {
  return String(value || "").trim().toLowerCase();
}

function uniqNames(list) {
  return [...new Set((list || []).map(normalizeName).filter(Boolean))];
}

function clampSettings(raw) {
  const cfg = { ...(raw || {}) };

  cfg.enabled = parseBool(cfg.enabled, true);
  cfg.check_interval_sec = Math.max(10, Number(cfg.check_interval_sec || 60) || 60);
  cfg.max_tabs = Math.max(1, Number(cfg.max_tabs || 4) || 4);

  cfg.force_unmute = parseBool(cfg.force_unmute, false);
  cfg.unmute_streams = parseBool(cfg.unmute_streams, false);
  cfg.force_resume = parseBool(cfg.force_resume, false);
  cfg.autoplay_streams = parseBool(cfg.autoplay_streams, false);
  cfg.soft_wake_tabs = parseBool(cfg.soft_wake_tabs, false);
  cfg.soft_wake_only_when_browser_focused = parseBool(cfg.soft_wake_only_when_browser_focused, true);

  cfg.close_unfollowed_tabs = parseBool(cfg.close_unfollowed_tabs, true);
  cfg.allow_extra_twitch_tabs = parseBool(cfg.allow_extra_twitch_tabs, true);
  cfg.temp_whitelist_hours = Math.max(1, Number(cfg.temp_whitelist_hours || 12) || 12);

  if (!cfg.temp_whitelist_entries || typeof cfg.temp_whitelist_entries !== "object" || Array.isArray(cfg.temp_whitelist_entries)) {
    cfg.temp_whitelist_entries = {};
  }

  cfg.follows = uniqNames(cfg.follows);
  cfg.priority = uniqNames(cfg.priority);
  cfg.followUnion = uniqNames([...(cfg.follows || []), ...(cfg.priority || [])]);
  cfg.blacklist = uniqNames(cfg.blacklist);

  return cfg;
}

function redactForDiag(input = {}) {
  const value = JSON.parse(JSON.stringify(input || {}));
  const redactKeys = new Set([
    "client_id",
    "access_token",
    "client_secret",
    "oauth_token",
    "token"
  ]);

  function walk(obj) {
    if (!obj || typeof obj !== "object") return;

    for (const key of Object.keys(obj)) {
      if (redactKeys.has(key)) {
        const raw = obj[key];
        if (typeof raw === "string" && raw.length > 8) {
          obj[key] = `${raw.slice(0, 4)}…REDACTED…${raw.slice(-2)}`;
        } else if (raw != null) {
          obj[key] = "REDACTED";
        }
        continue;
      }

      walk(obj[key]);
    }
  }

  walk(value);
  return value;
}

async function loadSettings() {
  const bag = await chrome.storage.local.get(null);

  const base =
    bag.settings ??
    bag.config ??
    bag.ttm_settings_v1 ??
    bag ??
    {};

  const merged = clampSettings(base);
  state.settings = { ...state.settings, ...merged };

  await saveSettings(state.settings);
  await chrome.storage.local.set({
    settings: state.settings,
    config: state.settings,
    enabled: state.settings.enabled,
    follows: state.settings.follows,
    priority: state.settings.priority,
    followUnion: state.settings.followUnion,
    max_tabs: state.settings.max_tabs,
    check_interval_sec: state.settings.check_interval_sec,
    follows_count: state.settings.follows.length,
    priority_count: state.settings.priority.length,
    followUnion_count: state.settings.followUnion.length
  });

  log("config_loaded", redactForDiag(state.settings));
  return state.settings;
}

async function recordPollMeta(status, extra = {}) {
  try {
    await chrome.storage.local.set({
      ttm_last_poll_at: Date.now(),
      ttm_last_poll_status: status,
      ...extra
    });
  } catch {}
}

function getVersionText() {
  try {
    return chrome.runtime.getManifest()?.version || "unknown";
  } catch {
    return "unknown";
  }
}

async function maybeShowUpdateNotification(details) {
  if (!details || details.reason !== "update") return;

  const version = getVersionText();
  const fromVersion = details.previousVersion || "older version";

  try {
    const bag = await chrome.storage.local.get(["ttm_last_update_notified_version"]);
    if (bag.ttm_last_update_notified_version === version) return;

    await chrome.notifications.create(`ttm-update-${version}`, {
      type: "basic",
      iconUrl: "icons/icon192.png",
      title: "Twitch Tab Manager updated",
      message: `Extension got updated to ${version}. Click the extension icon to review what changed.`
    });

    await chrome.storage.local.set({
      ttm_last_update_notified_version: version
    });

    log("update_notification_shown", { version, fromVersion });
  } catch (e) {
    log("update_notification_failed", { error: String(e), version, fromVersion });
  }
}

T.parseBool = parseBool;
T.normalizeName = normalizeName;
T.uniqNames = uniqNames;
T.clampSettings = clampSettings;
T.redactForDiag = redactForDiag;
T.loadSettings = loadSettings;
T.recordPollMeta = recordPollMeta;
T.getVersionText = getVersionText;
T.maybeShowUpdateNotification = maybeShowUpdateNotification;

export {
  parseBool,
  normalizeName,
  uniqNames,
  clampSettings,
  redactForDiag,
  loadSettings,
  recordPollMeta,
  getVersionText,
  maybeShowUpdateNotification
};