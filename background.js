import { state, saveSettings, armAlarm, log, diagnose } from "./bg.core.js";
import { ensureAlarm, setEnabled, normalizeType } from "./bg.compat.js";
import { reconcileTabs, listManaged, ensureClosed, adoptOpenTabs } from "./bg.tabs.js";import "./bg.live.js";
import "./bg.stability.js";

(() => {
  const root = globalThis;
  if (root.__TTM_BG_INITED__) return;
  root.__TTM_BG_INITED__ = true;
  root.TTM = root.TTM || {};
})();

const ACCEPTED_TYPES = [
  "ttm/ping",
  "ttm/enable",
  "ttm/reload_config",
  "ttm/force_poll",
  "ttm/diagnose",
  "TTM_STATUS",
  "TTM_TOGGLE",
  "TTM_RELOAD_CONFIG",
  "TTM_FORCE_POLL",
  "TTM_DIAG",
  "PING",
  "TOGGLE",
  "RELOAD_CONFIG",
  "FORCE_POLL",
  "DIAGNOSE",
  "TTM_FETCH_FOLLOWS",
  "TTM_GET_LOGS",
  "TTM_PLAYER_STATUS",
  "TTM_CLEAR_LOGS",
  "channel_status",
  "raid_detected"
];

const TWITCH_CHANNEL_RX = /^https:\/\/www\.twitch\.tv\/(?!directory|p|videos|friends|inventory|drops|settings|messages|login|downloads|moderator)([^/?#]+)/i;
const TTM_REPOKE_ALARM = "ttm-repoke";
const REPOKE_DELAYS_MS = [1500, 4500, 9000];

const OPEN_GRACE_MS = 20000;
const REOPEN_COOLDOWN_MS = 90000;
const RAID_CLOSE_DELAY_MS = 3 * 60 * 1000;
const RAID_REOPEN_COOLDOWN_MS = 5 * 60 * 1000;

const playerStatusByTab = new Map();
const softWakeByTab = new Map();
const openedAtByChannel = new Map();
const reopenBlockedUntilByChannel = new Map();
const raidTimers = new Map();
const offlineTimers = new Map();
const offlinePendingSinceByChannel = new Map();

const OFFLINE_CLOSE_DELAY_MS = 45000;
const SOFT_WAKE_MIN_STUCK_MS = 12000;
const SOFT_WAKE_COOLDOWN_MS = 60000;
const SOFT_WAKE_TAB_MS = 900;
const missingLiveSinceByChannel = new Map();
const LIVE_MISS_CLOSE_DELAY_MS = 120000;

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

  cfg.follows = uniqNames(cfg.follows);
  cfg.priority = uniqNames(cfg.priority);
  cfg.followUnion = uniqNames([...(cfg.follows || []), ...(cfg.priority || [])]);
  cfg.blacklist = uniqNames(cfg.blacklist);

  return cfg;
}

function redactForDiag(settings = {}) {
  const {
    client_id,
    access_token,
    follows = [],
    priority = [],
    followUnion = [],
    ...rest
  } = settings;

  return {
    ...rest,
    follows_count: follows.length,
    priority_count: priority.length,
    followUnion_count: followUnion.length
  };
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
chrome.runtime.onInstalled.addListener((details) => {
  maybeShowUpdateNotification(details);
});
function isChannelUrl(url) {
  try {
    return TWITCH_CHANNEL_RX.test(String(url || ""));
  } catch {
    return false;
  }
}

function channelFromUrl(url) {
  try {
    const match = String(url || "").match(TWITCH_CHANNEL_RX);
    return match ? String(match[1] || "").trim().toLowerCase() : "";
  } catch {
    return "";
  }
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
function rememberPlayerStatus(tabId, status) {
  const prev = playerStatusByTab.get(tabId) || {};
  playerStatusByTab.set(tabId, {
    ...prev,
    ...status,
    seenAt: Date.now()
  });
}

function getPlayerStatus(tabId) {
  return playerStatusByTab.get(tabId) || null;
}

function noteManagedOpen(login) {
  const key = normalizeName(login);
  if (!key) return;

  openedAtByChannel.set(key, Date.now());
  reopenBlockedUntilByChannel.delete(key);
  clearRaidTimer(key);
  clearOfflineTimer(key);
}

function noteManagedClosed(login, cooldownMs = REOPEN_COOLDOWN_MS) {
  const key = normalizeName(login);
  if (!key) return;

  reopenBlockedUntilByChannel.set(key, Date.now() + cooldownMs);
  openedAtByChannel.delete(key);
  clearRaidTimer(key);
  clearOfflineTimer(key);
}

function clearRaidTimer(login) {
  const key = normalizeName(login);
  const timer = raidTimers.get(key);
  if (timer) {
    clearTimeout(timer);
    raidTimers.delete(key);
  }
}

function clearOfflineTimer(login) {
  const key = normalizeName(login);
  const timer = offlineTimers.get(key);
  if (timer) {
    clearTimeout(timer);
    offlineTimers.delete(key);
  }
  offlinePendingSinceByChannel.delete(key);
}

function isInOpenGrace(login) {
  const key = normalizeName(login);
  const openedAt = openedAtByChannel.get(key);
  if (!openedAt) return false;
  return Date.now() - openedAt < OPEN_GRACE_MS;
}

function isReopenBlocked(login) {
  const key = normalizeName(login);
  const until = reopenBlockedUntilByChannel.get(key) || 0;
  return until > Date.now();
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

async function fetchFollowLoginsFromPage(tabId) {
  const [{ result } = {}] = await chrome.scripting.executeScript({
    target: { tabId },
    func: async () => {
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const normalizeName = (value) => String(value || "").trim().toLowerCase();

      const getFollowedCards = () => {
        const out = new Set();

        const cardLinks = Array.from(
          document.querySelectorAll(
            'main a[href^="/"], section a[href^="/"], [data-a-target="user-card-modal"] a[href^="/"]'
          )
        );

        for (const link of cardLinks) {
          const href = link.getAttribute("href") || "";
          if (!href.startsWith("/")) continue;

          const parts = href.split("?")[0].split("#")[0].split("/").filter(Boolean);
          const first = normalizeName(parts[0]);
          if (!first) continue;
          if (!/^[a-z0-9_]+$/.test(first)) continue;

          const card =
            link.closest('[data-a-target="user-card-modal"]') ||
            link.closest(".user-card") ||
            link.closest('[class*="channel-follow-listing"]');

          if (!card) continue;

          const unfollowBtn = card.querySelector('[data-a-target="unfollow-button"]');
          if (!unfollowBtn) continue;

          out.add(first);
        }

        return [...out];
      };

      const clickShowMore = () => {
        const buttons = Array.from(document.querySelectorAll("button, a"));
        let clicked = false;

        for (const el of buttons) {
          const text = (el.textContent || "").trim().toLowerCase();
          const target = el.getAttribute("data-a-target") || "";
          const inSidebar = !!el.closest('[data-test-selector="side-nav"]');

          if (inSidebar) continue;

          if (
            target === "side-nav-show-more-button" ||
            target === "side-nav-show-more" ||
            text !== "show more"
          ) {
            continue;
          }

          el.click();
          clicked = true;
        }

        return clicked;
      };

      const scroller =
        document.querySelector('[data-a-target="root-scroller"]') ||
        document.scrollingElement ||
        document.documentElement;

      let best = [];
      let stablePasses = 0;

      for (let i = 0; i < 20; i += 1) {
        const beforeCount = getFollowedCards().length;
        const clicked = clickShowMore();

        scroller.scrollTo({
          top: scroller.scrollHeight,
          behavior: "instant"
        });

        await sleep(clicked ? 1800 : 1400);

        const after = getFollowedCards();
        if (after.length > best.length) best = after;

        if (after.length <= beforeCount) stablePasses += 1;
        else stablePasses = 0;

        if (stablePasses >= 3 && !clicked) break;
      }

      scroller.scrollTo({ top: 0, behavior: "instant" });
      await sleep(250);

      return best;
    }
  });

  return uniqNames(result || []);
}

async function fetchMyFollows(mode = "active") {
  let tabId = null;
  let createdTab = false;

  try {
    if (mode === "current") {
      const tabs = await chrome.tabs.query({});
      const twitchTab = tabs.find((tab) => {
        const url = tab.url || tab.pendingUrl || "";
        return /https:\/\/www\.twitch\.tv\//i.test(url);
      });

      if (!twitchTab?.id) {
        return { ok: false, error: "No Twitch tab found." };
      }

      tabId = twitchTab.id;
    } else {
      const tab = await chrome.tabs.create({
        url: "https://www.twitch.tv/directory/following/channels",
        active: false
      });

      tabId = tab.id;
      createdTab = true;
    }

    const targetUrl = "https://www.twitch.tv/directory/following/channels";

    const current = await chrome.tabs.get(tabId);
    const currentUrl = current?.url || current?.pendingUrl || "";

    if (!/\/directory\/following\/channels/i.test(currentUrl)) {
      await chrome.tabs.update(tabId, { url: targetUrl });
    }

    await new Promise((resolve) => {
      const timeout = setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(onUpdated);
        resolve();
      }, 30000);

      function onUpdated(id, info, tab) {
        if (id !== tabId) return;
        const url = tab?.url || tab?.pendingUrl || "";
        if (info.status !== "complete") return;
        if (!/\/directory\/following\/channels/i.test(url)) return;

        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(onUpdated);
        resolve();
      }

      chrome.tabs.onUpdated.addListener(onUpdated);
    });

    await new Promise((resolve) => setTimeout(resolve, 2500));

    const usernames = await fetchFollowLoginsFromPage(tabId);

    if (!usernames.length) {
      return { ok: false, error: "No follows were found on the page." };
    }

    return { ok: true, usernames };
  } catch (e) {
    return { ok: false, error: String(e) };
  } finally {
    if (createdTab && tabId != null) {
      try {
        await chrome.tabs.remove(tabId);
      } catch {}
    }
  }
}

async function pokeChannelTab(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content_unmute.js", "content_status.js"]
    });
  } catch {}

  try {
    await chrome.tabs.sendMessage(tabId, {
      type: "TTM_ENFORCE",
      settings: {
        force_unmute: !!state.settings.force_unmute,
        unmute_streams: !!state.settings.unmute_streams,
        force_resume: !!state.settings.force_resume,
        autoplay_streams: !!state.settings.autoplay_streams
      }
    });
  } catch {}
}

function scheduleTabRepokes(tabId) {
  for (const delay of REPOKE_DELAYS_MS) {
    setTimeout(() => {
      pokeChannelTab(tabId).catch(() => {});
    }, delay);
  }
}

function shouldSoftWake(tabId) {
  if (!state.settings.soft_wake_tabs) return false;

  const status = getPlayerStatus(tabId);
  if (!status) return false;
  if (!status.hasVideo) return false;
  if (status.adPlaying) return false;
  if (!status.paused && !status.muted) return false;

  const now = Date.now();
  const firstSeenBadAt = status.firstSeenBadAt || now;
  const lastWakeAt = softWakeByTab.get(tabId) || 0;

  if (now - firstSeenBadAt < SOFT_WAKE_MIN_STUCK_MS) return false;
  if (now - lastWakeAt < SOFT_WAKE_COOLDOWN_MS) return false;

  return true;
}

async function canSoftWakeWithoutStealingFromOtherApps() {
  if (!state.settings.soft_wake_tabs) return false;
  if (!state.settings.soft_wake_only_when_browser_focused) return true;

  try {
    const currentWindow = await chrome.windows.getLastFocused();
    return !!currentWindow?.focused;
  } catch {
    return false;
  }
}

async function softWakeTab(tabId) {
  if (!(await canSoftWakeWithoutStealingFromOtherApps())) return false;

  let currentActiveTabId = null;
  let currentWindowId = null;
  let targetWindowId = null;

  try {
    const activeTabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    currentActiveTabId = activeTabs?.[0]?.id ?? null;
    currentWindowId = activeTabs?.[0]?.windowId ?? null;

    const targetTab = await chrome.tabs.get(tabId);
    targetWindowId = targetTab?.windowId ?? null;
    if (!targetWindowId) return false;

    await chrome.windows.update(targetWindowId, { focused: true });
    await chrome.tabs.update(tabId, { active: true });
    await pokeChannelTab(tabId);

    await new Promise((resolve) => setTimeout(resolve, SOFT_WAKE_TAB_MS));

    if (currentActiveTabId != null) {
      if (currentWindowId != null) {
        try {
          await chrome.windows.update(currentWindowId, { focused: true });
        } catch {}
      }

      try {
        await chrome.tabs.update(currentActiveTabId, { active: true });
      } catch {}
    }

    softWakeByTab.set(tabId, Date.now());
    log("soft_wake_ok", { tabId });
    return true;
  } catch (e) {
    log("soft_wake_error", { tabId, error: String(e) });
    return false;
  }
}

async function reviewManagedTabsForSoftWake() {
  const managedChannels = new Set(await listManaged());
  if (!managedChannels.size) return;

  try {
    const tabs = await chrome.tabs.query({
      url: ["*://www.twitch.tv/*", "*://twitch.tv/*"]
    });

    for (const tab of tabs) {
      const ch = channelFromUrl(tab.url || tab.pendingUrl || "");
      if (!ch || !managedChannels.has(ch)) continue;

      const status = getPlayerStatus(tab.id);
      if (!status) continue;

      if (status.hasVideo && !status.adPlaying && (status.paused || status.muted)) {
        if (!status.firstSeenBadAt) {
          rememberPlayerStatus(tab.id, { firstSeenBadAt: Date.now() });
        }
      } else {
        rememberPlayerStatus(tab.id, { firstSeenBadAt: 0 });
      }

      if (shouldSoftWake(tab.id)) {
        await softWakeTab(tab.id);
      }
    }
  } catch (e) {
    log("soft_wake_review_error", String(e));
  }
}

async function repokeManagedTabs() {
  const managedChannels = new Set(await listManaged());
  if (!managedChannels.size) return;

  try {
    const tabs = await chrome.tabs.query({
      url: ["*://www.twitch.tv/*", "*://twitch.tv/*"]
    });

    for (const tab of tabs) {
      const ch = channelFromUrl(tab.url || tab.pendingUrl || "");
      if (!ch || !managedChannels.has(ch)) continue;
      await pokeChannelTab(tab.id);
    }

    await reviewManagedTabsForSoftWake();
  } catch (e) {
    log("repoke_error", String(e));
  }
}

async function closeManagedChannelTab(login, reason = "manual", cooldownMs = REOPEN_COOLDOWN_MS) {
  const key = normalizeName(login);
  if (!key) return false;

  const managedChannels = await listManaged();
  if (!managedChannels.includes(key)) {
    return false;
  }

  try {
    const closed = await ensureClosed(key);
    if (closed) {
      noteManagedClosed(key, cooldownMs);
      log("closed_channel_tab", { login: key, reason, cooldownMs });
      return true;
    }
  } catch (e) {
    log("close_channel_tab_error", { login: key, reason, error: String(e) });
  }

  return false;
}

function scheduleOfflineClose(login) {
  const key = normalizeName(login);
  if (!key) return;

  if (raidTimers.has(key)) {
    log("offline_close_skipped_raid_pending", { login: key });
    return;
  }

  if (isInOpenGrace(key)) {
    log("offline_ignored_in_open_grace", { login: key, graceMs: OPEN_GRACE_MS });
    return;
  }

  if (Array.isArray(state.lastLive) && state.lastLive.includes(key)) {
    log("offline_ignored_still_in_last_live", { login: key });
    return;
  }

  if (offlineTimers.has(key)) {
    return;
  }

  offlinePendingSinceByChannel.set(key, Date.now());

  const timer = setTimeout(async () => {
    offlineTimers.delete(key);

    const pendingSince = offlinePendingSinceByChannel.get(key) || Date.now();
    offlinePendingSinceByChannel.delete(key);

    if (raidTimers.has(key)) {
      log("offline_close_cancelled_raid_pending", { login: key });
      return;
    }

    if (isInOpenGrace(key)) {
      log("offline_close_cancelled_open_grace", { login: key });
      return;
    }

    if (Array.isArray(state.lastLive) && state.lastLive.includes(key)) {
      log("offline_close_cancelled_still_in_last_live", {
        login: key,
        pendingMs: Date.now() - pendingSince
      });
      return;
    }

    const closed = await closeManagedChannelTab(key, "offline", REOPEN_COOLDOWN_MS);
    log("offline_close_fired", {
      login: key,
      delayMs: OFFLINE_CLOSE_DELAY_MS,
      pendingMs: Date.now() - pendingSince,
      closed
    });
  }, OFFLINE_CLOSE_DELAY_MS);

  offlineTimers.set(key, timer);
  log("offline_close_scheduled", { login: key, delayMs: OFFLINE_CLOSE_DELAY_MS });
}

function scheduleRaidClose(login) {
  const key = normalizeName(login);
  if (!key) return;

  clearRaidTimer(key);

  const timer = setTimeout(async () => {
    raidTimers.delete(key);
    await closeManagedChannelTab(key, "raid", RAID_REOPEN_COOLDOWN_MS);
    log("raid_close_fired", { login: key, delayMs: RAID_CLOSE_DELAY_MS });
  }, RAID_CLOSE_DELAY_MS);

  raidTimers.set(key, timer);
  log("raid_close_scheduled", { login: key, delayMs: RAID_CLOSE_DELAY_MS });
}
async function closeManagedChannelsThatAreNowBlocked() {
  const managedChannels = await listManaged();
  if (!managedChannels.length) return;

  const allowed = new Set(uniqNames(state.settings.followUnion || []));
  const blacklist = new Set(uniqNames(state.settings.blacklist || []));

  for (const login of managedChannels) {
    const key = normalizeName(login);
    if (!key) continue;

    if (blacklist.has(key)) {
      await closeManagedChannelTab(key, "blacklist", RAID_REOPEN_COOLDOWN_MS);
      continue;
    }

    if (!allowed.has(key)) {
      await closeManagedChannelTab(key, "no_longer_allowed", RAID_REOPEN_COOLDOWN_MS);
    }
  }
}
async function poll({ force = false } = {}) {
  await loadSettings();
  await closeManagedChannelsThatAreNowBlocked();

  if (!force && state.settings.enabled === false) {
    log("poll_skip", { reason: "disabled" });
    return { ok: true, skipped: "disabled" };
  }

  let liveList = [];

  try {
    const getter = globalThis.bgLive?.getLiveNowByConfigSafe;
    const live = typeof getter === "function" ? await getter(state.settings) : [];
    liveList = uniqNames(Array.isArray(live) ? live : [...(live || [])]);
  } catch (e) {
    log("poll_live_error", String(e));
  }

  liveList = liveList.filter((login) => {
  const key = normalizeName(login);
  if (!key) return false;
  if (isReopenBlocked(key)) return false;
  if (state.settings.blacklist.includes(key)) return false;
  return true;
  });

  const currentlyOpen = Array.isArray(state.openChannels) ? state.openChannels : [];

  if (liveList.length === 0 && currentlyOpen.length > 0 && state.settings.followUnion.length > 0) {
  log("poll_keep_open", {
    reason: "transient_empty_live_set",
    open_count: currentlyOpen.length,
    configured_count: state.settings.followUnion.length
  });

  // Even when keeping current managed tabs open during a transient empty live set,
  // still close channels that are explicitly blocked or no longer allowed.
  await closeManagedChannelsThatAreNowBlocked();
} else {
  try {
    const now = Date.now();
    const managedNow = await listManaged();
    const liveNowSet = new Set(liveList);

    for (const ch of managedNow) {
      if (liveNowSet.has(ch)) {
        missingLiveSinceByChannel.delete(ch);
      } else if (!missingLiveSinceByChannel.has(ch)) {
        missingLiveSinceByChannel.set(ch, now);
      }
    }

    const debouncedLiveList = uniqNames([
      ...liveList,
      ...managedNow.filter((ch) => {
        const missingSince = missingLiveSinceByChannel.get(ch);
        if (!missingSince) return false;
        return now - missingSince < LIVE_MISS_CLOSE_DELAY_MS;
      })
    ]);

    await reconcileTabs(debouncedLiveList, state.settings);
  } catch (e) {
    log("poll_reconcile_error", String(e));
  }
}

  try {
    const managed = await listManaged();
    state.lastLive = liveList;

  await recordPollMeta("ok", {
  ttm_last_poll_live_count: Array.isArray(liveList) ? liveList.length : 0,
  ttm_last_poll_error: ""
});
    state.openChannels = managed;

    log("poll_done", {
      live_count: liveList.length,
      open_count: managed.length,
      max_tabs: state.settings.max_tabs,
      force: !!force
    });

    return {
      ok: true,
      live_count: liveList.length,
      open_count: managed.length
    };

  } catch (e) {
  await recordPollMeta("error", {
    ttm_last_poll_error: String(e)
  });
  log("poll_list_error", String(e));
  return { ok: false, error: String(e) };
}
}

globalThis.TTM.poll = poll;
globalThis.TTM.armAlarm = armAlarm;
globalThis.TTM.getSettings = () => state.settings;
globalThis.TTM.scheduleTabRepokes = scheduleTabRepokes;
globalThis.TTM.noteManagedOpen = noteManagedOpen;

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status !== "complete") return;
  if (!isChannelUrl(tab?.url)) return;

  pokeChannelTab(tabId).catch(() => {});
  scheduleTabRepokes(tabId);
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!isChannelUrl(tab?.url)) return;
    await pokeChannelTab(tabId);
  } catch {}
});

let booted = false;

async function bootOnce() {
  if (booted) return;
  await loadSettings();
  await ensureAlarm();

  let adoptedInfo = { adopted: 0, total: 0 };

  try {
    adoptedInfo = await adoptOpenTabs(state.settings.followUnion || []);
  } catch (e) {
    log("boot_adopt_error", String(e));
  }

  try {
    await chrome.alarms.create(TTM_REPOKE_ALARM, { periodInMinutes: 1 });
  } catch {}

  booted = true;
  log("boot", {
    enabled: state.settings.enabled,
    everySec: state.settings.check_interval_sec,
    adopted_tabs: adoptedInfo.adopted,
    managed_total: adoptedInfo.total
  });
}

chrome.runtime.onInstalled.addListener(() => {
  booted = false;
  bootOnce().catch((e) => log("boot_err", String(e)));
});

chrome.runtime.onStartup?.addListener(() => {
  booted = false;
  bootOnce().catch((e) => log("boot_err", String(e)));
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm?.name === "ttm-tick") {
    poll().catch((e) => log("alarm_poll_error", String(e)));
    return;
  }

  if (alarm?.name === TTM_REPOKE_ALARM) {
    repokeManagedTabs().catch((e) => log("alarm_repoke_error", String(e)));
  }
});

chrome.runtime.onMessage.addListener((msg, sender, send) => {
  (async () => {
    await bootOnce();
    const kind = normalizeType(msg?.type);

    if (kind === "ping") {
      return void send({
        ok: true,
        alive: true,
        enabled: state.settings.enabled !== false
      });
    }

    if (kind === "toggle") {
      const on = msg?.enabled === undefined ? !state.settings.enabled : !!msg.enabled;
      const enabled = await setEnabled(on);

      state.settings = {
        ...state.settings,
        enabled
      };

      await chrome.storage.local.set({
        settings: state.settings,
        config: state.settings,
        enabled
      });

      return void send({ ok: true, enabled });
    }

    if (kind === "reload") {
  await loadSettings();
  await ensureAlarm();

  let adoptedInfo = { adopted: 0, total: 0 };
  try {
    adoptedInfo = await adoptOpenTabs(state.settings.followUnion || []);
  } catch (e) {
    log("reload_adopt_error", String(e));
  }

  return void send({
    ok: true,
    settings: redactForDiag(state.settings),
    adopted_tabs: adoptedInfo.adopted,
    managed_total: adoptedInfo.total
  });
  }

    if (kind === "force") {
      log("poll_start", { enabled: state.settings.enabled !== false, force: true });
      const result = await poll({ force: true });
      return void send(result);
    }

    if (kind === "diag" || kind === "diagnose") {
      return void send(await diagnose());
    }

    if (kind === "fetch_follows") {
      return void send(await fetchMyFollows(msg?.mode || "active"));
    }

    if (kind === "get_logs") {
      return void send({
        ok: true,
        logs: Array.isArray(state.logs) ? state.logs.slice(-200) : []
      });
    }

    if (kind === "clear_logs") {
      state.logs = [];
      await chrome.storage.local.remove("ttm_logs_v1");
      return void send({ ok: true });
    }

    if (kind === "ttm_player_status") {
      const tabId = sender?.tab?.id;
      if (tabId != null) {
        const prev = getPlayerStatus(tabId);
        const wasBad = !!(prev && prev.hasVideo && !prev.adPlaying && (prev.paused || prev.muted));

        const next = {
          login: normalizeName(msg?.login),
          hasVideo: !!msg?.hasVideo,
          paused: !!msg?.paused,
          muted: !!msg?.muted,
          volume: msg?.volume ?? null,
          adPlaying: !!msg?.adPlaying,
          visible: !!msg?.visible,
          focused: !!msg?.focused
        };

        const isBad = !!(next.hasVideo && !next.adPlaying && (next.paused || next.muted));

        if (isBad) {
          next.firstSeenBadAt = wasBad && prev?.firstSeenBadAt ? prev.firstSeenBadAt : Date.now();
        } else {
          next.firstSeenBadAt = 0;
        }

        rememberPlayerStatus(tabId, next);
      }

      return void send({ ok: true });
    }

    if (kind === "channel_status") {
  const login = normalizeName(msg?.login);
  if (!login) {
    return void send({ ok: false, error: "missing_login" });
  }

  if (msg?.isOffline) {
    if (Array.isArray(state.lastLive) && state.lastLive.includes(login)) {
      log("channel_status_offline_ignored_still_in_last_live", { login });
      return void send({ ok: true, ignored: "still_in_last_live" });
    }

    scheduleOfflineClose(login);
    return void send({ ok: true, pending: true, delay_ms: OFFLINE_CLOSE_DELAY_MS });
  }

  clearOfflineTimer(login);
  clearRaidTimer(login);
  return void send({ ok: true, live: true });
  }

    if (kind === "raid_detected") {
      const login = normalizeName(msg?.login);
      if (!login) {
        return void send({ ok: false, error: "missing_login" });
      }

      scheduleRaidClose(login);
      return void send({ ok: true, scheduled: true, delay_ms: RAID_CLOSE_DELAY_MS });
    }

    return void send({
      ok: false,
      error: "unknown_message",
      received: { type: msg?.type },
      accepted_types: ACCEPTED_TYPES
    });
  })().catch((e) => {
    log("msg_err", String(e));
    try {
      send({ ok: false, error: "handler_crash", detail: String(e) });
    } catch {}
  });

  return true;
});

bootOnce().catch((e) => log("boot_err", String(e)));