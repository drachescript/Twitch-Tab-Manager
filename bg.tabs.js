import { log } from "./bg.core.js";

const RE_CHAN = /^https?:\/\/(?:www\.)?twitch\.tv\/([a-z0-9_]+)(?:\/|$)/i;
const CHANNEL_KEY = "ttm.managed.channels";
const OWNED_KEY = "ttm.managed.owned";
const OPENING_TTL_MS = 5000;

let managedChannels = {};
let ownedTabs = {};
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

async function loadManagedState() {
  const bag = await chrome.storage.session.get([CHANNEL_KEY, OWNED_KEY]);
  managedChannels = bag?.[CHANNEL_KEY] && typeof bag[CHANNEL_KEY] === "object" ? bag[CHANNEL_KEY] : {};
  ownedTabs = bag?.[OWNED_KEY] && typeof bag[OWNED_KEY] === "object" ? bag[OWNED_KEY] : {};
}

async function saveManagedState() {
  await chrome.storage.session.set({
    [CHANNEL_KEY]: managedChannels,
    [OWNED_KEY]: ownedTabs
  });
}

async function rehydrateManagedFromReality() {
  const nextChannels = {};
  const nextOwned = {};

  for (const [tabIdRaw] of Object.entries(ownedTabs)) {
    const tabId = Number(tabIdRaw);
    if (!tabId) continue;

    try {
      const tab = await chrome.tabs.get(tabId);
      const actual = chanFromUrl(tab.url || tab.pendingUrl || "");
      if (!actual) continue;

      nextOwned[String(tabId)] = true;
      nextChannels[actual] = tabId;
    } catch {}
  }

  managedChannels = nextChannels;
  ownedTabs = nextOwned;
  await saveManagedState();
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

function buildPriorityMap(priority) {
  const map = new Map();
  (priority || []).map(norm).forEach((channel, index) => {
    if (!map.has(channel)) map.set(channel, index);
  });
  return map;
}

function getChannelRank(channel, priorityMap) {
  const ch = norm(channel);

  if (priorityMap.has(ch)) {
    return priorityMap.get(ch);
  }

  return 1000000;
}

function compareRank(a, b, priorityMap) {
  return getChannelRank(a, priorityMap) - getChannelRank(b, priorityMap);
}

async function closeWorstManagedFor(candidateChannel, openSet, priorityMap) {
  const candidateRank = getChannelRank(candidateChannel, priorityMap);

  const managedOpen = Array.from(openSet)
    .filter((channel) => managedChannels[channel])
    .sort((a, b) => compareRank(b, a, priorityMap));

  if (!managedOpen.length) return null;

  const worstOpen = managedOpen[0];
  const worstRank = getChannelRank(worstOpen, priorityMap);

  if (candidateRank >= worstRank) {
    return null;
  }

  await ensureClosed(worstOpen);
  return worstOpen;
}

export async function ensureOpen(channel, via = "manager") {
  const ch = norm(channel);
  if (!ch) return null;

  purgeOpening();
  log("ensure_open_start", { ch, via });

  if (managedChannels[ch]) {
    try {
      await chrome.tabs.get(managedChannels[ch]);
      return managedChannels[ch];
    } catch {
      delete managedChannels[ch];
      await saveManagedState();
    }
  }

    const existing = await findExistingChannelTab(ch);
  if (existing?.id) {
    ownedTabs[String(existing.id)] = true;
    managedChannels[ch] = existing.id;
    await saveManagedState();

    log("ensure_open_adopt_existing", { ch, tabId: existing.id, via });

    if (globalThis.TTM_STAB?.setTab) globalThis.TTM_STAB.setTab(ch, existing.id, `${via}:adopted`);
    if (globalThis.TTM_STAB?.markAction) globalThis.TTM_STAB.markAction(ch);

    if (globalThis.TTM?.scheduleTabRepokes) {
      globalThis.TTM.scheduleTabRepokes(existing.id);
    }

    if (globalThis.TTM?.noteManagedOpen) {
      globalThis.TTM.noteManagedOpen(ch);
    }

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

    ownedTabs[String(tab.id)] = true;
    managedChannels[ch] = tab.id;
    await saveManagedState();

    log("ensure_open_created", { ch, tabId: tab.id });

    if (globalThis.TTM_STAB?.setTab) globalThis.TTM_STAB.setTab(ch, tab.id, via);
    if (globalThis.TTM_STAB?.markAction) globalThis.TTM_STAB.markAction(ch);

    if (globalThis.TTM?.scheduleTabRepokes) {
      globalThis.TTM.scheduleTabRepokes(tab.id);
    }

    if (globalThis.TTM?.noteManagedOpen) {
      globalThis.TTM.noteManagedOpen(ch);
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
  const tabId = managedChannels[ch];
  if (!tabId) return false;

  const isOwned = !!ownedTabs[String(tabId)];
  if (!isOwned) return false;

  try {
    await chrome.tabs.remove(tabId);
  } catch {}

  delete managedChannels[ch];
  delete ownedTabs[String(tabId)];
  await saveManagedState();
  return true;
}

export async function reconcileTabs(live, cfg) {
  await loadManagedState();
  await rehydrateManagedFromReality();

  const maxTabs = Math.max(1, Number(cfg?.max_tabs || 4));
  const priority = (cfg?.priority || []).map(norm);
  const priorityMap = buildPriorityMap(priority);

  const seen = new Set();
  const desired = [];

  for (const ch of (live || []).map(norm)) {
    if (!seen.has(ch)) {
      seen.add(ch);
      desired.push(ch);
    }
  }

  desired.sort((a, b) => {
    const byPriority = compareRank(a, b, priorityMap);
    if (byPriority !== 0) return byPriority;

    const aLive = globalThis.TTM_STAB?._get?.(a)?.lastLiveTs || 0;
    const bLive = globalThis.TTM_STAB?._get?.(b)?.lastLiveTs || 0;
    return bLive - aLive;
  });

  const desiredAlreadyOpen = await scanOpenDesiredChannels(desired);
  const openSet = new Set([
    ...Object.keys(managedChannels),
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

    try {
      const closed = await closeWorstManagedFor(ch, openSet, priorityMap);
      if (closed) {
        openSet.delete(closed);

        const tabId = await ensureOpen(ch, "manager");
        if (tabId) {
          openSet.add(ch);
        }

        log("priority_preempt", { opened: ch, closed });
      }
    } catch (e) {
      log("priority_preempt_error", { login: ch, error: String(e) });
    }
  }

  for (const ch of Object.keys(managedChannels)) {
    if (!seen.has(ch)) {
      await ensureClosed(ch);
      openSet.delete(ch);
    }
  }
}

export async function listManaged() {
  await loadManagedState();
  await rehydrateManagedFromReality();
  return Object.keys(managedChannels).sort();
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