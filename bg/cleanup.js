import { state, log } from "./core.js";
import { normalizeName, uniqNames } from "./config.js";
import { listManaged, ensureClosed } from "./tabs.js";

const T = (globalThis.TTM = globalThis.TTM || {});

const OPEN_GRACE_MS = 20000;
const REOPEN_COOLDOWN_MS = 90000;
const RAID_CLOSE_DELAY_MS = 60000;
const RAID_REOPEN_COOLDOWN_MS = 5 * 60 * 1000;
const OFFLINE_CLOSE_DELAY_MS = 20000;

const openedAtByChannel = new Map();
const reopenBlockedUntilByChannel = new Map();
const raidTimers = new Map();
const offlineTimers = new Map();
const offlinePendingSinceByChannel = new Map();

function getTempWhitelistEntries() {
  return state.settings.temp_whitelist_entries || {};
}

function isTemporarilyAllowed(login) {
  const key = normalizeName(login);
  if (!key) return false;

  const entries = getTempWhitelistEntries();
  const expiresAt = Number(entries[key] || 0);
  if (!expiresAt) return false;

  if (Date.now() >= expiresAt) {
    delete entries[key];
    state.settings.temp_whitelist_entries = entries;
    chrome.storage.local.set({
      settings: state.settings,
      config: state.settings,
      temp_whitelist_entries: entries
    }).catch(() => {});
    return false;
  }

  return true;
}

async function tempAllowChannel(login) {
  const key = normalizeName(login);
  if (!key) return false;

  const hours = Math.max(1, Number(state.settings.temp_whitelist_hours || 12) || 12);
  const entries = getTempWhitelistEntries();
  entries[key] = Date.now() + (hours * 60 * 60 * 1000);

  state.settings.temp_whitelist_entries = entries;

  await chrome.storage.local.set({
    settings: state.settings,
    config: state.settings,
    temp_whitelist_entries: entries
  });

  log("temp_whitelist_added", { login: key, hours });
  return true;
}

function isRaidLikeUrl(url = "") {
  const value = String(url || "").toLowerCase();
  return value.includes("referrer=raid");
}

function isManagerEnabled() {
  return state.settings.enabled !== false;
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
  if (!isManagerEnabled()) return;

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
  if (!isManagerEnabled()) return;

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
  if (!isManagerEnabled()) return;

  const managedChannels = await listManaged();
  if (!managedChannels.length) return;

  const allowed = new Set(uniqNames(state.settings.followUnion || []));
  const blacklist = new Set(uniqNames(state.settings.blacklist || []));

  for (const login of managedChannels) {
    const key = normalizeName(login);
    if (!key) continue;
    if (isTemporarilyAllowed(key)) continue;

    if (blacklist.has(key)) {
      await closeManagedChannelTab(key, "blacklist", RAID_REOPEN_COOLDOWN_MS);
      continue;
    }

    if (state.settings.close_unfollowed_tabs !== false && !allowed.has(key)) {
      await closeManagedChannelTab(key, "not_followed_or_priority", RAID_REOPEN_COOLDOWN_MS);
    }
  }
}

async function closeSenderTabIfNowUnwanted(sender, reason = "drifted_unwanted") {
  if (!isManagerEnabled()) return false;

  const tabId = sender?.tab?.id;
  const currentUrl = sender?.tab?.url || sender?.tab?.pendingUrl || "";
  const currentLogin = T.channelFromUrl(currentUrl);
  if (!tabId || !currentLogin) return false;

  if (isTemporarilyAllowed(currentLogin)) {
    return false;
  }

  const allowed = new Set(uniqNames(state.settings.followUnion || []));
  const blacklist = new Set(uniqNames(state.settings.blacklist || []));

  const isBlocked = blacklist.has(currentLogin);
  const isAllowed = allowed.has(currentLogin);
  const raidLike = isRaidLikeUrl(currentUrl);

  if (isBlocked) {
    try {
      await chrome.tabs.remove(tabId);
      noteManagedClosed(currentLogin, RAID_REOPEN_COOLDOWN_MS);
      log("closed_sender_tab_now_unwanted", { tabId, login: currentLogin, reason: "blacklist" });
      return true;
    } catch (e) {
      log("close_sender_tab_now_unwanted_error", { tabId, login: currentLogin, reason: "blacklist", error: String(e) });
      return false;
    }
  }

  if (!isAllowed) {
    if (state.settings.close_unfollowed_tabs === false) return false;

    if (state.settings.allow_extra_twitch_tabs !== false && !raidLike) {
      log("kept_extra_twitch_tab_open", { tabId, login: currentLogin, reason });
      return false;
    }

    try {
      await chrome.tabs.remove(tabId);
      noteManagedClosed(currentLogin, RAID_REOPEN_COOLDOWN_MS);
      log("closed_sender_tab_now_unwanted", { tabId, login: currentLogin, reason });
      return true;
    } catch (e) {
      log("close_sender_tab_now_unwanted_error", { tabId, login: currentLogin, reason, error: String(e) });
      return false;
    }
  }

  return false;
}

T.OPEN_GRACE_MS = OPEN_GRACE_MS;
T.REOPEN_COOLDOWN_MS = REOPEN_COOLDOWN_MS;
T.RAID_CLOSE_DELAY_MS = RAID_CLOSE_DELAY_MS;
T.RAID_REOPEN_COOLDOWN_MS = RAID_REOPEN_COOLDOWN_MS;
T.OFFLINE_CLOSE_DELAY_MS = OFFLINE_CLOSE_DELAY_MS;

T.getTempWhitelistEntries = getTempWhitelistEntries;
T.isTemporarilyAllowed = isTemporarilyAllowed;
T.tempAllowChannel = tempAllowChannel;
T.isRaidLikeUrl = isRaidLikeUrl;
T.isManagerEnabled = isManagerEnabled;
T.noteManagedOpen = noteManagedOpen;
T.noteManagedClosed = noteManagedClosed;
T.clearRaidTimer = clearRaidTimer;
T.clearOfflineTimer = clearOfflineTimer;
T.isInOpenGrace = isInOpenGrace;
T.isReopenBlocked = isReopenBlocked;
T.closeManagedChannelTab = closeManagedChannelTab;
T.scheduleOfflineClose = scheduleOfflineClose;
T.scheduleRaidClose = scheduleRaidClose;
T.closeManagedChannelsThatAreNowBlocked = closeManagedChannelsThatAreNowBlocked;
T.closeSenderTabIfNowUnwanted = closeSenderTabIfNowUnwanted;

export {
  OPEN_GRACE_MS,
  REOPEN_COOLDOWN_MS,
  RAID_CLOSE_DELAY_MS,
  RAID_REOPEN_COOLDOWN_MS,
  OFFLINE_CLOSE_DELAY_MS,
  getTempWhitelistEntries,
  isTemporarilyAllowed,
  tempAllowChannel,
  isRaidLikeUrl,
  isManagerEnabled,
  noteManagedOpen,
  noteManagedClosed,
  clearRaidTimer,
  clearOfflineTimer,
  isInOpenGrace,
  isReopenBlocked,
  closeManagedChannelTab,
  scheduleOfflineClose,
  scheduleRaidClose,
  closeManagedChannelsThatAreNowBlocked,
  closeSenderTabIfNowUnwanted
};