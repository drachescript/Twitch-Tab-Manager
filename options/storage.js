import { $, cfgTA, folTA, parseBool, uniqNames } from "./core.js";
import { fillQuickSettings } from "./quick-settings.js";
import { renderTokenSnippets } from "./tokens.js";

export const CFG_DEFAULT = {
  live_source: "auto",
  client_id: "",
  access_token: "",
  force_unmute: true,
  unmute_streams: true,
  force_resume: true,
  autoplay_streams: false,
  soft_wake_tabs: false,
  soft_wake_only_when_browser_focused: true,
  close_unfollowed_tabs: true,
  allow_extra_twitch_tabs: true,
  temp_whitelist_hours: 12,
  temp_whitelist_entries: {},
  check_interval_sec: 60,
  max_tabs: 4,
  enabled: true,
  followUnion: [],
  follows: [],
  priority: [],
  blacklist: []
};

export function mergeDefaults(input) {
  return { ...CFG_DEFAULT, ...(input || {}) };
}

export function clampConfig(input) {
  const cfg = mergeDefaults(input);

  cfg.enabled = parseBool(cfg.enabled, true);
  cfg.force_unmute = parseBool(cfg.force_unmute, true);
  cfg.unmute_streams = parseBool(cfg.unmute_streams, true);
  cfg.force_resume = parseBool(cfg.force_resume, true);
  cfg.autoplay_streams = parseBool(cfg.autoplay_streams, false);
  cfg.soft_wake_tabs = parseBool(cfg.soft_wake_tabs, false);
  cfg.soft_wake_only_when_browser_focused = parseBool(cfg.soft_wake_only_when_browser_focused, true);

  cfg.close_unfollowed_tabs = parseBool(cfg.close_unfollowed_tabs, true);
  cfg.allow_extra_twitch_tabs = parseBool(cfg.allow_extra_twitch_tabs, true);
  cfg.temp_whitelist_hours = Math.max(1, Number(cfg.temp_whitelist_hours || 12) || 12);

  if (!cfg.temp_whitelist_entries || typeof cfg.temp_whitelist_entries !== "object" || Array.isArray(cfg.temp_whitelist_entries)) {
    cfg.temp_whitelist_entries = {};
  }

  cfg.check_interval_sec = Math.max(10, Number(cfg.check_interval_sec || 60) || 60);
  cfg.max_tabs = Math.max(1, Number(cfg.max_tabs || 4) || 4);

  cfg.follows = uniqNames(cfg.follows);
  cfg.priority = uniqNames(cfg.priority);
  cfg.followUnion = uniqNames([...(cfg.follows || []), ...(cfg.priority || [])]);
  cfg.blacklist = uniqNames(cfg.blacklist);

  return cfg;
}

export async function readStorage() {
  try {
    return await chrome.storage.local.get(null);
  } catch {
    return {};
  }
}

export function getStoredConfig(bag) {
  const raw =
    bag?.settings ??
    bag?.config ??
    bag?.ttm_settings_v1 ??
    {};
  return clampConfig(raw);
}

export async function packagedConfig() {
  try {
    const url = chrome.runtime.getURL("config.json");
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return clampConfig(CFG_DEFAULT);
    return clampConfig(await res.json());
  } catch {
    return clampConfig(CFG_DEFAULT);
  }
}

export async function packagedFollows() {
  try {
    const url = chrome.runtime.getURL("follows.txt");
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return [];
    const text = await res.text();
    return uniqNames(text.split(/\r?\n/));
  } catch {
    return [];
  }
}

export async function writeConfigEverywhere(cfg) {
  const clean = clampConfig(cfg);

  await chrome.storage.local.set({
    settings: clean,
    config: clean,
    enabled: clean.enabled,
    live_source: clean.live_source,
    client_id: clean.client_id,
    access_token: clean.access_token,
    force_unmute: clean.force_unmute,
    unmute_streams: clean.unmute_streams,
    force_resume: clean.force_resume,
    autoplay_streams: clean.autoplay_streams,
    soft_wake_tabs: clean.soft_wake_tabs,
    soft_wake_only_when_browser_focused: clean.soft_wake_only_when_browser_focused,
    close_unfollowed_tabs: clean.close_unfollowed_tabs,
    allow_extra_twitch_tabs: clean.allow_extra_twitch_tabs,
    temp_whitelist_hours: clean.temp_whitelist_hours,
    temp_whitelist_entries: clean.temp_whitelist_entries,
    check_interval_sec: clean.check_interval_sec,
    max_tabs: clean.max_tabs,
    follows: clean.follows,
    priority: clean.priority,
    followUnion: clean.followUnion,
    blacklist: clean.blacklist,
    follows_count: clean.follows.length,
    priority_count: clean.priority.length,
    followUnion_count: clean.followUnion.length
  });

  return clean;
}

export async function loadUI() {
  const bag = await readStorage();
  const cfg = getStoredConfig(bag);
  const follows = Array.isArray(bag.follows) && bag.follows.length
    ? uniqNames(bag.follows)
    : cfg.follows.length
      ? cfg.follows
      : await packagedFollows();

  const priority = Array.isArray(bag.priority) && bag.priority.length
    ? uniqNames(bag.priority)
    : cfg.priority;

  const fullCfg = clampConfig({
    ...cfg,
    follows,
    priority,
    followUnion: uniqNames([...follows, ...priority])
  });

  if (cfgTA()) cfgTA().value = JSON.stringify(fullCfg, null, 2);
  if (folTA()) folTA().value = follows.join("\n");

  fillQuickSettings(fullCfg);

  const priorityBox = $("#priorityBox");
  if (priorityBox) priorityBox.value = priority.join("\n");

  renderTokenSnippets();
}