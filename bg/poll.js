import { state, armAlarm, log } from "./core.js";
import { loadSettings, recordPollMeta } from "./config.js";
import { ensureAlarm } from "./compat.js";
import { listManaged, adoptOpenTabs, reconcileTabs } from "./tabs.js";
import {
  isManagerEnabled,
  closeManagedChannelsThatAreNowBlocked,
  isReopenBlocked
} from "./cleanup.js";

const T = (globalThis.TTM = globalThis.TTM || {});

const missingLiveSinceByChannel = new Map();
const LIVE_MISS_CLOSE_DELAY_MS = 45000;

let booted = false;

async function poll({ force = false } = {}) {
  await loadSettings();

  if (!force && state.settings.enabled === false) {
    log("poll_skip", { reason: "disabled" });
    return { ok: true, skipped: "disabled" };
  }

  state.loading = true;
  await closeManagedChannelsThatAreNowBlocked();

  let liveList = [];

  try {
    const getter = globalThis.bgLive?.getLiveNowByConfigSafe;
    const live = typeof getter === "function" ? await getter(state.settings) : [];
    liveList = T.uniqNames(Array.isArray(live) ? live : [...(live || [])]);
  } catch (e) {
    log("poll_live_error", String(e));
  }

  state.lastLiveCount = liveList.length;

  liveList = liveList.filter((login) => {
    const key = T.normalizeName(login);
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

      const debouncedLiveList = T.uniqNames([
        ...liveList,
        ...managedNow.filter((ch) => {
          const missingSince = missingLiveSinceByChannel.get(ch);
          if (!missingSince) return false;
          return now - missingSince < LIVE_MISS_CLOSE_DELAY_MS;
        })
      ]);

      await reconcileTabs(debouncedLiveList, state.settings);
      await closeManagedChannelsThatAreNowBlocked();
    } catch (e) {
      log("poll_reconcile_error", String(e));
    }
  }

  try {
    const managed = await listManaged();

    state.lastLive = Array.isArray(liveList) ? liveList.slice() : [];
    state.openChannels = managed;
    state.loading = false;

    await recordPollMeta("ok", {
      ttm_last_poll_live_count: Number(state.lastLiveCount || 0),
      ttm_last_poll_error: ""
    });

    log("poll_done", {
      live_count: Number(state.lastLiveCount || 0),
      open_count: managed.length,
      max_tabs: state.settings.max_tabs,
      force: !!force
    });

    return {
      ok: true,
      live_count: Number(state.lastLiveCount || 0),
      open_count: managed.length,
      max_tabs: state.settings.max_tabs,
      force: !!force
    };
  } catch (e) {
    state.loading = false;

    await recordPollMeta("error", {
      ttm_last_poll_live_count: Number(state.lastLiveCount || 0),
      ttm_last_poll_error: String(e)
    });

    log("poll_list_error", String(e));
    return { ok: false, error: String(e) };
  }
}

async function bootOnce() {
  if (booted) return;

  state.loading = true;

  await loadSettings();
  await ensureAlarm();

  let adoptedInfo = { adopted: 0, total: 0 };

  if (isManagerEnabled()) {
    try {
      adoptedInfo = await adoptOpenTabs(state.settings.followUnion || []);
    } catch (e) {
      log("boot_adopt_error", String(e));
    }
  }

  try {
    await chrome.alarms.create(T.TTM_REPOKE_ALARM, { periodInMinutes: 1 });
  } catch {}

  booted = true;
  state.loading = false;

  log("boot", {
    enabled: state.settings.enabled,
    everySec: state.settings.check_interval_sec,
    adopted_tabs: adoptedInfo.adopted,
    managed_total: adoptedInfo.total
  });
}

T.poll = poll;
T.bootOnce = bootOnce;
T.armAlarm = armAlarm;
T.getSettings = () => state.settings;

export { poll, bootOnce, LIVE_MISS_CLOSE_DELAY_MS };