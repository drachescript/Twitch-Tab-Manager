import { state, DEFAULTS, saveSettings, getSettings, log } from "./bg.core.js";

const Root = self || globalThis;

export const CFG_DEFAULT = DEFAULTS;
Root.CFG_DEFAULT = CFG_DEFAULT;

const TYPE_ALIASES = new Map([
  ["ttm/ping", "ping"],
  ["ttm/enable", "toggle"],
  ["ttm/reload_config", "reload"],
  ["ttm/force_poll", "force"],
  ["ttm/diagnose", "diagnose"],

  ["ping", "ping"],
  ["toggle", "toggle"],
  ["reload_config", "reload"],
  ["force_poll", "force"],
  ["diagnose", "diagnose"],
  ["diag", "diagnose"],

  ["ttm_ping", "ping"],
  ["ttm_status", "ping"],
  ["ttm_enable", "toggle"],
  ["ttm_toggle", "toggle"],
  ["ttm_reload_config", "reload"],
  ["ttm_force_poll", "force"],
  ["ttm_diagnose", "diagnose"],
  ["ttm_diag", "diagnose"],

  ["ttm_get_logs", "get_logs"],
  ["ttm_clear_logs", "clear_logs"],
  ["ttm_open_channel", "open_channel"],
  ["ttm_fetch_follows", "fetch_follows"]
]);

export function normalizeType(type) {
  const raw = String(type || "").trim().toLowerCase();
  return TYPE_ALIASES.get(raw) || raw;
}

export async function ensureAlarm() {
  try {
    if (Root.TTM?.armAlarm) {
      await Root.TTM.armAlarm();
      return true;
    }
  } catch (e) {
    log("ensure_alarm_error", String(e));
  }
  return false;
}

export async function setEnabled(on) {
  const current = (typeof getSettings === "function" ? getSettings() : null) || state.settings || {};
  const enabled = !!on;
  await saveSettings({ ...current, enabled });
  await ensureAlarm();
  log("toggle", { enabled });
  return enabled;
}