import { log } from "./bg.core.js";

const RE_CHAN = /^https?:\/\/(?:www\.)?twitch\.tv\/([a-z0-9_]+)(?:\/|$)/i;
const SESSION_KEY = "ttm.managed";
const OPENING_TTL_MS = 5000;

let managed = {};
const opening = new Map();

function now() {
  return Date.now();
}

function norm(value) {
  return String(value || "").trim().toLowerCase();
}

function chanFromUrl(url) {
  const match = String(url || "").match(RE_CHAN);
  return match ? norm(match[1]) : null;
}

function purgeOpening() {
  const t = now();
  for (const [channel, expiresAt] of opening.entries()) {
    if (expiresAt <= t) opening.delete(channel);
  }
}

async function loadManaged() {
  const bag = await chrome.storage.session.get(SESSION_KEY);
  const value = bag?.[SESSION_KEY];
  managed = value && typeof value === "object" ? value : {};
}

async function saveManaged() {
  await chrome.storage.session.set({ [SESSION_KEY]: managed });
}

async function rehydrateManagedFromReality() {
  const next = {};

  for (const [channel, tabId] of Object.entries(managed)) {
    try {
      const tab = await chrome.tabs.get(tabId);
      const actual = chanFromUrl(tab.url || tab.pendingUrl || "");
      if (actual === channel) next[channel] = tabId;
    } catch {}
  }

  managed = next;
  await saveManaged();
}

async function findExistingChannelTab(channel) {
  const ch = norm(channel);
  if (!ch) return null;

  try {
    const tabs = await chrome.tabs.query({
      url: ["*://www.twitch.tv/*", "*://twitch.tv/*"]
    });

    for (const tab of tabs) {
      const actual = chanFromUrl(tab.url || tab.pendingUrl || "");
      if (actual === ch) return tab;
    }
  } catch {}

  return null;
}

async function findPreferredTwitchWindow() {
  try {
    const tabs = await chrome.tabs.query({
      url: ["*://www.twitch.tv/*", "*://twitch.tv/*"]
    });

    if (!tabs.length) return null;

    const byWindow = new Map();

    for (const tab of tabs) {
      if (!tab.windowId || tab.windowId < 0) continue;
      const entry = byWindow.get(tab.windowId) || { count: 0, lastIndex: -1 };
      entry.count += 1;
      entry.lastIndex = Math.max(entry.lastIndex, Number(tab.index || 0));
      byWindow.set(tab.windowId, entry);
    }

    let best = null;
    for (const [windowId, info] of byWindow.entries()) {
      if (!best || info.count > best.count) {
        best = { windowId, lastIndex: info.lastIndex, count: info.count };
      }
    }

    return best;
  } catch {
    return null;
  }
}

async function scanOpenDesiredChannels(desiredList) {
  const desired = new Set((desiredList || []).map(norm));
  const out = new Set();

  if (!desired.size) return out;

  try {
    const tabs = await chrome.tabs.query({
      url: ["*://www.twitch.tv/*", "*://twitch.tv/*"]
    });

    for (const tab of tabs) {
      const ch = chanFromUrl(tab.url || tab.pendingUrl || "");
      if (ch && desired.has(ch)) out.add(ch);
    }
  } catch {}

  return out;
}

function priorityRanker(priority) {
  const set = new Set((priority || []).map(norm));
  return (channel) => (set.has(channel) ? 0 : 1);
}

async function closeOneLowRank(openSet, priority) {
  const rank = priorityRanker(priority);
  const candidates = Array.from(openSet).sort((a, b) => rank(b) - rank(a));
  const pick = candidates.find((channel) => rank(channel) === 1 && managed[channel]);

  if (!pick) return null;

  await ensureClosed(pick);
  return pick;
}

export async function ensureOpen(channel, via = "manager") {
  const ch = norm(channel);
  if (!ch) return null;

  purgeOpening();
  log("ensure_open_start", { ch, via });

  if (managed[ch]) {
    try {
      await chrome.tabs.get(managed[ch]);
      return managed[ch];
    } catch {
      delete managed[ch];
      await saveManaged();
    }
  }

  const existing = await findExistingChannelTab(ch);
  if (existing?.id) {
    log("ensure_open_found_existing", { ch, tabId: existing.id });
    return existing.id;
  }

  if (opening.has(ch)) {
    log("ensure_open_skip_opening", { ch });
    return null;
  }

  opening.set(ch, now() + OPENING_TTL_MS);

  try {
    const preferredWindow = await findPreferredTwitchWindow();

    const createOptions = {
      url: `https://www.twitch.tv/${ch}`,
      active: false
    };

    if (preferredWindow?.windowId != null) {
      createOptions.windowId = preferredWindow.windowId;
      createOptions.index = preferredWindow.lastIndex + 1;
    }

    log("ensure_open_before_create", {
      ch,
      windowId: createOptions.windowId ?? null
    });

    const tab = await chrome.tabs.create(createOptions);

    managed[ch] = tab.id;
    await saveManaged();

    log("ensure_open_created", { ch, tabId: tab.id });

    if (globalThis.TTM_STAB?.setTab) globalThis.TTM_STAB.setTab(ch, tab.id, via);
    if (globalThis.TTM_STAB?.markAction) globalThis.TTM_STAB.markAction(ch);

    if (globalThis.TTM?.scheduleTabRepokes) {
      globalThis.TTM.scheduleTabRepokes(tab.id);
    }

    return tab.id;
  } catch (e) {
    log("ensure_open_error", { ch, error: String(e) });
    throw e;
  } finally {
    opening.delete(ch);
  }
}

export async function ensureClosed(channel) {
  const ch = norm(channel);
  const tabId = managed[ch];
  if (!tabId) return false;

  try {
    await chrome.tabs.remove(tabId);
  } catch {}

  delete managed[ch];
  await saveManaged();
  return true;
}

export async function reconcileTabs(live, cfg) {
  await loadManaged();
  await rehydrateManagedFromReality();

  const maxTabs = Math.max(1, Number(cfg?.max_tabs || 4));
  const priority = (cfg?.priority || []).map(norm);
  const rank = priorityRanker(priority);

  const seen = new Set();
  const desired = [];

  for (const ch of (live || []).map(norm)) {
    if (!seen.has(ch)) {
      seen.add(ch);
      desired.push(ch);
    }
  }

  desired.sort((a, b) => {
    const aPri = priority.includes(a) ? 1 : 0;
    const bPri = priority.includes(b) ? 1 : 0;
    if (aPri !== bPri) return bPri - aPri;

    const aLive = globalThis.TTM_STAB?._get?.(a)?.lastLiveTs || 0;
    const bLive = globalThis.TTM_STAB?._get?.(b)?.lastLiveTs || 0;
    return bLive - aLive;
  });

  const desiredAlreadyOpen = await scanOpenDesiredChannels(desired);
  const openSet = new Set([
    ...Object.keys(managed),
    ...Array.from(desiredAlreadyOpen)
  ]);

  const want = [];
  for (const ch of desired) {
    if (!openSet.has(ch)) want.push(ch);
  }

  let capacity = maxTabs - openSet.size;
  if (capacity < 0) capacity = 0;

  log("reconcile_info", {
    desired: desired.length,
    want: want.length,
    open_now: openSet.size,
    capacity
  });

  for (const ch of want) {
    if (capacity > 0) {
      try {
        const tabId = await ensureOpen(ch, "manager");
        if (tabId) {
          openSet.add(ch);
          capacity -= 1;
        }
      } catch (e) {
        log("open_err", { login: ch, error: String(e) });
      }
      continue;
    }

    if (rank(ch) === 0) {
      const closed = await closeOneLowRank(openSet, priority);
      if (closed) {
        openSet.delete(closed);
        try {
          const tabId = await ensureOpen(ch, "manager");
          if (tabId) openSet.add(ch);
        } catch (e) {
          log("open_err", { login: ch, error: String(e) });
        }
      }
    }
  }

  for (const ch of Object.keys(managed)) {
    if (!seen.has(ch)) {
      await ensureClosed(ch);
      openSet.delete(ch);
    }
  }
}

export async function listManaged() {
  await loadManaged();
  return Object.keys(managed).sort();
}

try {
  if (typeof self === "object") {
    self.bgTabs = self.bgTabs || {};
    self.bgTabs.reconcile = (liveCfg) =>
      reconcileTabs(liveCfg.liveList || liveCfg, {
        max_tabs: liveCfg.maxTabs || liveCfg.max_tabs,
        priority: liveCfg.priority || []
      });
    self.bgTabs.listManaged = listManaged;
  }
} catch {}