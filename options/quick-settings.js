import { $, ok, err, rpc, uniqNames } from "./core.js";
import { clampConfig, getStoredConfig, readStorage, writeConfigEverywhere } from "./storage.js";

export function fillQuickSettings(cfg) {
  const liveSource = $("#liveSource");
  const checkInterval = $("#checkIntervalSec");
  const maxTabs = $("#maxTabs");
  const enabled = $("#enabledSelect");
  const forceUnmute = $("#forceUnmute");
  const unmuteStreams = $("#unmuteStreams");
  const forceResume = $("#forceResume");
  const autoplayStreams = $("#autoplayStreams");
  const softWakeTabs = $("#softWakeTabs");
  const softWakeFocusedOnly = $("#softWakeFocusedOnly");
  const closeUnfollowedTabs = $("#closeUnfollowedTabs");
  const allowExtraTwitchTabs = $("#allowExtraTwitchTabs");
  const tempWhitelistHours = $("#tempWhitelistHours");
  const blacklistBox = $("#blacklistBox");

  if (liveSource) liveSource.value = cfg.live_source || "auto";
  if (checkInterval) checkInterval.value = String(cfg.check_interval_sec ?? 60);
  if (maxTabs) maxTabs.value = String(cfg.max_tabs ?? 4);
  if (enabled) enabled.value = String(cfg.enabled !== false);
  if (forceUnmute) forceUnmute.checked = !!cfg.force_unmute;
  if (unmuteStreams) unmuteStreams.checked = !!cfg.unmute_streams;
  if (forceResume) forceResume.checked = !!cfg.force_resume;
  if (autoplayStreams) autoplayStreams.checked = !!cfg.autoplay_streams;
  if (softWakeTabs) softWakeTabs.checked = !!cfg.soft_wake_tabs;
  if (softWakeFocusedOnly) softWakeFocusedOnly.checked = !!cfg.soft_wake_only_when_browser_focused;
  if (closeUnfollowedTabs) closeUnfollowedTabs.checked = !!cfg.close_unfollowed_tabs;
  if (allowExtraTwitchTabs) allowExtraTwitchTabs.checked = !!cfg.allow_extra_twitch_tabs;
  if (tempWhitelistHours) tempWhitelistHours.value = String(cfg.temp_whitelist_hours ?? 12);
  if (blacklistBox) blacklistBox.value = uniqNames(cfg.blacklist).join("\n");
}

export function readQuickSettings(baseCfg = {}) {
  return clampConfig({
    ...baseCfg,
    live_source: $("#liveSource")?.value || baseCfg.live_source || "auto",
    check_interval_sec: Number($("#checkIntervalSec")?.value || baseCfg.check_interval_sec || 60),
    max_tabs: Number($("#maxTabs")?.value || baseCfg.max_tabs || 4),
    enabled: $("#enabledSelect")?.value !== "false",
    force_unmute: !!$("#forceUnmute")?.checked,
    unmute_streams: !!$("#unmuteStreams")?.checked,
    force_resume: !!$("#forceResume")?.checked,
    autoplay_streams: !!$("#autoplayStreams")?.checked,
    soft_wake_tabs: !!$("#softWakeTabs")?.checked,
    soft_wake_only_when_browser_focused: !!$("#softWakeFocusedOnly")?.checked,
    close_unfollowed_tabs: !!$("#closeUnfollowedTabs")?.checked,
    allow_extra_twitch_tabs: !!$("#allowExtraTwitchTabs")?.checked,
    temp_whitelist_hours: Number($("#tempWhitelistHours")?.value || baseCfg.temp_whitelist_hours || 12),
    blacklist: uniqNames(($("#blacklistBox")?.value || "").split("\n"))
  });
}

export async function saveQuickSettings({ reload = false } = {}) {
  try {
    const bag = await readStorage();
    const cfg = getStoredConfig(bag);
    const follows = uniqNames(Array.isArray(bag.follows) ? bag.follows : cfg.follows);
    const priority = uniqNames(Array.isArray(bag.priority) ? bag.priority : cfg.priority);

    const nextCfg = readQuickSettings({
      ...cfg,
      follows,
      priority,
      followUnion: uniqNames([...follows, ...priority])
    });

    const saved = await writeConfigEverywhere(nextCfg);

    const cfgTA = $("#cfg");
    if (cfgTA) cfgTA.value = JSON.stringify(saved, null, 2);

    if (reload) {
      const resp = await rpc("ttm/reload_config");
      if (resp?.ok) ok($("#quickStatus"), "Quick settings saved and reloaded.");
      else err($("#quickStatus"), "Saved quick settings, but reload failed.");
      return;
    }

    ok($("#quickStatus"), "Quick settings saved.");
  } catch {
    err($("#quickStatus"), "Quick settings save failed.");
  }
}

export function setupQuickSettings() {
  $("#quickSave")?.addEventListener("click", () => {
    saveQuickSettings({ reload: false });
  });

  $("#quickApplyReload")?.addEventListener("click", () => {
    saveQuickSettings({ reload: true });
  });
}