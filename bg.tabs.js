// bg.tabs.js

const TWITCH_HOSTS = ['https://www.twitch.tv/', 'https://twitch.tv/'];
const RE_CHAN = /^https?:\/\/(?:www\.)?twitch\.tv\/([a-z0-9_]+)(?:\/|$)/i;

const SKEY = 'ttm.managed';          // chrome.storage.session key
const OPENING_TTL_MS = 5000;         // prevent burst duplicates

// In-memory mirrors
let managed = {};                    // { channel: tabId }
let opening = new Map();             // channel -> expiresMs
// managed tabs registry
if (!globalThis.TTM_MANAGED) globalThis.TTM_MANAGED = Object.create(null);

function markManaged(tabId, login) {
  globalThis.TTM_MANAGED[tabId] = { login: String(login||'').toLowerCase(), ts: Date.now() };
  chrome.storage.session.set({ ttm_managed: globalThis.TTM_MANAGED }).catch(()=>{});
}
function unmarkManaged(tabId) {
  delete globalThis.TTM_MANAGED[tabId];
  chrome.storage.session.set({ ttm_managed: globalThis.TTM_MANAGED }).catch(()=>{});
}
chrome.tabs.onRemoved.addListener((tid)=>unmarkManaged(tid));

function now() { return Date.now(); }
function norm(ch) { return (ch || '').toLowerCase(); }
function isTwitchUrl(u) { return TWITCH_HOSTS.some(p => u.startsWith(p)); }
function chanFromUrl(u) {
  const m = (u || '').match(RE_CHAN);
  return m ? norm(m[1]) : null;
}

async function loadManaged() {
  const { [SKEY]: val } = await chrome.storage.session.get(SKEY);
  managed = val && typeof val === 'object' ? val : {};
}

async function saveManaged() {
  await chrome.storage.session.set({ [SKEY]: managed });
}

async function scanOpenTwitchTabs() {
  const tabs = await chrome.tabs.query({});
  const res = { all: [], byChan: {} };
  for (const t of tabs) {
    const u = t.url || t.pendingUrl || '';
    if (!isTwitchUrl(u)) continue;
    const ch = chanFromUrl(u);
    if (!ch) continue;
    res.all.push(t);
    (res.byChan[ch] ||= []).push(t);
  }
  return res;
}

function purgeOpening() {
  const t = now();
  for (const [ch, exp] of opening) if (exp <= t) opening.delete(ch);
}

async function ensureOpen(channel) {
  const ch = norm(channel);
  purgeOpening();

  if (managed[ch]) {
    // Verify the tab still exists; if not, drop it
    try {
      await chrome.tabs.get(managed[ch]);
      return managed[ch];
    } catch { delete managed[ch]; await saveManaged(); }
  }

  if (opening.has(ch)) return null; // guard against duplicate creates
  opening.set(ch, now() + OPENING_TTL_MS);

  const tab = await chrome.tabs.create({ url: `https://www.twitch.tv/${ch}` });
  managed[ch] = tab.id;
  await saveManaged();
  return tab.id;
}

async function ensureClosed(channel) {
  const ch = norm(channel);
  const id = managed[ch];
  if (!id) return false;
  try { await chrome.tabs.remove(id); } catch {}
  delete managed[ch];
  await saveManaged();
  return true;
}

async function rehydrateManagedFromReality() {
  // If a managed tabId was killed/reused, clean it up.
  const current = {};
  for (const [ch, id] of Object.entries(managed)) {
    try {
      const t = await chrome.tabs.get(id);
      const c2 = chanFromUrl(t.url || t.pendingUrl || '');
      if (c2 === ch) current[ch] = id;
    } catch { /* gone */ }
  }
  managed = current;
  await saveManaged();
}

function ranker(priority) {
  const pri = new Set((priority || []).map(norm));
  return (ch) => (pri.has(ch) ? 0 : 1); // 0 = higher priority
}

async function closeOneLowRank(openSet, priority) {
  // Choose a non-priority managed tab to close (lowest priority, arbitrary tie)
  const rank = ranker(priority);
  const candidates = Array.from(openSet).sort((a, b) => rank(b) - rank(a));
  // prefer to close non-priority (rank 1). If all are priority, do nothing.
  const pick = candidates.find(ch => rank(ch) === 1);
  if (!pick) return null;
  await ensureClosed(pick);
  return pick;
}

/**
 * Reconcile managed tabs with desired live channels.
 * @param {string[]} live - list of live channels (lowercase) sorted by caller (priority first)
 * @param {{max_tabs:number, priority:string[]}} cfg
 */
export async function reconcileTabs(live, cfg) {
  await loadManaged();
  await rehydrateManagedFromReality();

  const maxTabs = Math.max(1, Number(cfg?.max_tabs || 4));
  const priority = (cfg?.priority || []).map(norm);
  const rank = ranker(priority);

  // Dedup desired list (preserve order), and pre-trim to a soft cap (extra room for kicking)
  const seen = new Set();
  const desired = [];
  for (const ch of (live || []).map(norm)) if (!seen.has(ch)) { seen.add(ch); desired.push(ch); }

  // Build sets
  const openSet = new Set(Object.keys(managed));
  const want = [];
  for (const ch of desired) {
    if (openSet.has(ch)) continue;
    want.push(ch);
  }

  // Capacity after already-open managed tabs
  let capacity = maxTabs - openSet.size;
  if (capacity < 0) capacity = 0;

  // Fill capacity with wanted channels in order (priority first if caller sorted that way)
  for (const ch of want) {
    if (capacity > 0) {
      await ensureOpen(ch);
      openSet.add(ch);
      capacity -= 1;
    } else {
      // No room. If 'ch' is priority and an open non-priority exists, kick one.
      if (rank(ch) === 0) {
        const closed = await closeOneLowRank(openSet, priority);
        if (closed) {
          openSet.delete(closed);
          await ensureOpen(ch);
          openSet.add(ch);
        }
      }
    }
  }

  // Close any managed tab whose channel is not live anymore
  for (const ch of Array.from(openSet)) {
    if (!seen.has(ch)) {
      await ensureClosed(ch);
      openSet.delete(ch);
    }
  }
}

/** Utility for background: returns current managed channels list */
export async function listManaged() {
  await loadManaged();
  return Object.keys(managed).sort();
}

// Expose a simple global API for legacy callers / bg.compat
try {
  if (typeof self === 'object') {
    self.bgTabs = self.bgTabs || {};
    self.bgTabs.reconcile = (liveCfg) => reconcileTabs(liveCfg.liveList || liveCfg, { max_tabs: liveCfg.maxTabs || (liveCfg.max_tabs), priority: liveCfg.priority || [] });
    self.bgTabs.listManaged = listManaged;
  }
} catch (e) { /* noop */ }
