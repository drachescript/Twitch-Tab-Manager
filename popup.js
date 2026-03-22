document.addEventListener("DOMContentLoaded", () => {
  const elToggle = document.getElementById("toggleManager");
  const elStatus = document.getElementById("statusText");
  const elStateTitle = document.getElementById("stateText");
  const elVersion = document.getElementById("popupVersion");
  const elUpdatedVersion = document.getElementById("updatedVersion");
  const elLastPoll = document.getElementById("lastPoll");
  const elStatOpen = document.getElementById("statOpen");
  const elStatLive = document.getElementById("statLive");
  const elStatMax = document.getElementById("statMax");
  const elFlash = document.getElementById("popupFlash");

  const btnPoll = document.getElementById("btnPoll");
  const btnReload = document.getElementById("btnReload");
  const btnOptions = document.getElementById("btnOptions");
  const btnDiag = document.getElementById("btnDiag");

  let busy = false;

  function normalizeName(value) {
    return String(value || "").trim().toLowerCase();
  }

  function uniqNames(list) {
    return [...new Set((list || []).map(normalizeName).filter(Boolean))];
  }

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

  function clampConfig(input = {}) {
    const cfg = { ...(input || {}) };

    cfg.live_source = String(cfg.live_source || "auto").trim().toLowerCase() || "auto";
    cfg.client_id = String(cfg.client_id || "");
    cfg.access_token = String(cfg.access_token || "");

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
    cfg.check_interval_sec = Math.max(10, Number(cfg.check_interval_sec || 60) || 60);
    cfg.max_tabs = Math.max(1, Number(cfg.max_tabs || 4) || 4);

    if (!cfg.temp_whitelist_entries || typeof cfg.temp_whitelist_entries !== "object" || Array.isArray(cfg.temp_whitelist_entries)) {
      cfg.temp_whitelist_entries = {};
    }

    cfg.follows = uniqNames(cfg.follows);
    cfg.priority = uniqNames(cfg.priority);
    cfg.blacklist = uniqNames(cfg.blacklist);
    cfg.followUnion = uniqNames([...(cfg.follows || []), ...(cfg.priority || [])]);

    return cfg;
  }

  function pickObject(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  }

  function getLegacyFlatConfig(bag = {}) {
    return {
      enabled: bag.enabled,
      live_source: bag.live_source,
      client_id: bag.client_id,
      access_token: bag.access_token,
      force_unmute: bag.force_unmute,
      unmute_streams: bag.unmute_streams,
      force_resume: bag.force_resume,
      autoplay_streams: bag.autoplay_streams,
      soft_wake_tabs: bag.soft_wake_tabs,
      soft_wake_only_when_browser_focused: bag.soft_wake_only_when_browser_focused,
      close_unfollowed_tabs: bag.close_unfollowed_tabs,
      allow_extra_twitch_tabs: bag.allow_extra_twitch_tabs,
      temp_whitelist_hours: bag.temp_whitelist_hours,
      temp_whitelist_entries: bag.temp_whitelist_entries,
      check_interval_sec: bag.check_interval_sec,
      max_tabs: bag.max_tabs,
      follows: Array.isArray(bag.follows) ? bag.follows : [],
      priority: Array.isArray(bag.priority) ? bag.priority : [],
      followUnion: Array.isArray(bag.followUnion) ? bag.followUnion : [],
      blacklist: Array.isArray(bag.blacklist) ? bag.blacklist : []
    };
  }

  function getStoredConfig(bag = {}) {
    const legacy = getLegacyFlatConfig(bag);
    const nestedSources = [
      pickObject(bag.ttm_settings_v1),
      pickObject(bag.config),
      pickObject(bag.settings)
    ].filter(Boolean);

    return clampConfig(Object.assign({}, legacy, ...nestedSources));
  }

  async function backupCurrentBrowserConfig(reason = "popup_edit") {
    try {
      const bag = await chrome.storage.local.get(null);
      const cfg = getStoredConfig(bag);

      const snapshot = {
        saved_at: new Date().toISOString(),
        reason,
        summary: {
          follows_count: cfg.follows.length,
          priority_count: cfg.priority.length,
          blacklist_count: cfg.blacklist.length,
          has_client_id: !!cfg.client_id,
          has_access_token: !!cfg.access_token
        },
        settings: cfg
      };

      const keyLast = "ttm_backup_last_good_config_v2";
      const keyHistory = "ttm_backup_history_v2";
      const got = await chrome.storage.local.get([keyHistory]);
      const history = Array.isArray(got[keyHistory]) ? got[keyHistory] : [];

      history.push(snapshot);
      while (history.length > 25) history.shift();

      await chrome.storage.local.set({
        [keyLast]: snapshot,
        [keyHistory]: history
      });
    } catch {}
  }

  async function writeConfigEverywhere(cfg) {
    const clean = clampConfig(cfg);

    await chrome.storage.local.set({
      settings: clean,
      config: clean,
      ttm_settings_v1: clean,
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

  function setBusy(nextBusy) {
    busy = !!nextBusy;

    elToggle.disabled = busy;
    btnPoll.disabled = busy;
    btnReload.disabled = busy;
    btnOptions.disabled = busy;
    btnDiag.disabled = busy;

    document.body.classList.toggle("is-busy", busy);
  }

  function flash(message, kind = "info") {
    elFlash.textContent = message || "";
    elFlash.className = `flash ${kind}`;
  }

  function setVersionText() {
    try {
      const version = chrome.runtime.getManifest()?.version || "unknown";
      elVersion.textContent = `v${version}`;
    } catch {
      elVersion.textContent = "v?";
    }
  }

  function formatPollTime(ts) {
    if (!ts) return "—";

    const date = new Date(ts);
    if (Number.isNaN(date.getTime())) return "—";

    const now = Date.now();
    const diffMs = Math.max(0, now - date.getTime());
    const diffSec = Math.floor(diffMs / 1000);

    let ago = "";
    if (diffSec < 10) ago = "just now";
    else if (diffSec < 60) ago = `${diffSec}s ago`;
    else if (diffSec < 3600) ago = `${Math.floor(diffSec / 60)}m ago`;
    else ago = `${Math.floor(diffSec / 3600)}h ago`;

    return `${date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} (${ago})`;
  }

  function getChannelFromUrl(url = "") {
    try {
      const u = new URL(url);
      if (!/^(www\.)?twitch\.tv$/i.test(u.hostname)) return "";
      const first = u.pathname.replace(/^\/+/, "").split("/")[0] || "";
      return first.toLowerCase();
    } catch {
      return "";
    }
  }

  async function getActiveTabChannel() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const channel = getChannelFromUrl(tab?.url || tab?.pendingUrl || "");
      return { tab, channel };
    } catch {
      return { tab: null, channel: "" };
    }
  }

  function setStatusText(enabled) {
    const on = enabled !== false;

    elStateTitle.textContent = on ? "Enabled" : "Disabled";
    elStateTitle.className = on ? "state-title is-on" : "state-title is-off";

    elStatus.textContent = on
      ? "Watching your configured follows and priority channels."
      : "Manager is currently disabled.";
  }

  function setStats({ openCount, liveCount, maxTabs, loading = false }) {
    if (loading) {
      elStatOpen.textContent = "Loading…";
      elStatLive.textContent = "Loading…";
      elStatMax.textContent = Number.isFinite(maxTabs) ? String(maxTabs) : "—";
      return;
    }

    elStatOpen.textContent = Number.isFinite(openCount) ? String(openCount) : "—";
    elStatLive.textContent = Number.isFinite(liveCount) ? String(liveCount) : "—";
    elStatMax.textContent = Number.isFinite(maxTabs) ? String(maxTabs) : "—";
  }

  function send(type, payload) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ type, ...(payload || {}) }, (resp) => {
          if (chrome.runtime.lastError) {
            resolve({ ok: false, error: chrome.runtime.lastError.message });
            return;
          }
          resolve(resp || null);
        });
      } catch (e) {
        resolve({ ok: false, error: String(e) });
      }
    });
  }

  async function readStorageFallback() {
    try {
      return await chrome.storage.local.get([
        "settings",
        "config",
        "ttm_settings_v1",
        "enabled",
        "live_source",
        "max_tabs",
        "follows",
        "priority",
        "followUnion",
        "blacklist",
        "ttm_last_update_notified_version",
        "ttm_last_poll_at",
        "ttm_last_poll_status"
      ]);
    } catch {
      return {};
    }
  }

  async function refreshMeta() {
    const bag = await readStorageFallback();

    const updatedVersion =
      bag.ttm_last_update_notified_version ||
      chrome.runtime.getManifest()?.version ||
      "unknown";

    elUpdatedVersion.textContent = updatedVersion;
    elLastPoll.textContent = formatPollTime(bag.ttm_last_poll_at);
  }

  async function refreshUI() {
    setBusy(true);
    flash("");

    const actionWrap = document.getElementById("twitchTabActions");
    const channelLabel = document.getElementById("currentTwitchChannel");

    const active = await getActiveTabChannel();
    if (active.channel) {
      if (actionWrap) actionWrap.style.display = "";
      if (channelLabel) channelLabel.textContent = active.channel;
    } else {
      if (actionWrap) actionWrap.style.display = "none";
    }

    const ping =
      (await send("ttm/ping")) ||
      (await send("PING")) ||
      (await send("TTM_STATUS"));

    const bag = await readStorageFallback();
    const stored = getStoredConfig(bag);

    const enabled =
      ping && typeof ping.enabled === "boolean"
        ? ping.enabled
        : stored.enabled;

    elToggle.checked = enabled !== false;
    setStatusText(enabled);

    let diag = null;
    try {
      diag =
        (await send("ttm/diagnose")) ||
        (await send("DIAGNOSE")) ||
        (await send("TTM_DIAG"));
    } catch {}

    const openCount =
      Number.isFinite(diag?.open_count) ? diag.open_count :
      Number.isFinite(diag?.managed_count) ? diag.managed_count :
      null;

    const liveCount =
      Number.isFinite(diag?.live_count) ? diag.live_count :
      null;

    const maxTabs =
      Number.isFinite(diag?.max_tabs) ? diag.max_tabs :
      stored.max_tabs;

    const isLoading = !!(ping?.loading || diag?.loading);

    setStats({
      openCount,
      liveCount,
      maxTabs,
      loading: isLoading
    });

    await refreshMeta();

    setBusy(false);
  }

  async function addCurrentChannelToConfig(kind) {
    const active = await getActiveTabChannel();
    if (!active.channel) {
      flash("Open a Twitch channel tab first.", "error");
      return;
    }

    const bag = await chrome.storage.local.get(null);
    const cfg = getStoredConfig(bag);
    const ch = active.channel;

    if (kind === "follow" && !cfg.follows.includes(ch)) cfg.follows.push(ch);
    if (kind === "priority" && !cfg.priority.includes(ch)) cfg.priority.push(ch);
    if (kind === "blacklist" && !cfg.blacklist.includes(ch)) cfg.blacklist.push(ch);

    cfg.follows = uniqNames(cfg.follows);
    cfg.priority = uniqNames(cfg.priority);
    cfg.blacklist = uniqNames(cfg.blacklist);
    cfg.followUnion = uniqNames([...(cfg.follows || []), ...(cfg.priority || [])]);

    await backupCurrentBrowserConfig(`popup_add_${kind}`);
    await writeConfigEverywhere(cfg);

    const reloadResp = await send("ttm/reload_config");
    if (!reloadResp?.ok) {
      flash(reloadResp?.error || `Updated ${ch}, but reload failed.`, "error");
      return;
    }

    flash(`Updated ${ch}.`, "ok");
  }

  async function tempAllowCurrentChannel() {
    const active = await getActiveTabChannel();
    if (!active.channel) {
      flash("Open a Twitch channel tab first.", "error");
      return;
    }

    const resp = await send("ttm/temp_allow_channel", { login: active.channel });
    if (resp?.ok) flash(`Temp allowed ${active.channel}.`, "ok");
    else flash(resp?.error || "Temp allow failed.", "error");
  }

  document.getElementById("btnAddFollow")?.addEventListener("click", () => addCurrentChannelToConfig("follow"));
  document.getElementById("btnAddPriority")?.addEventListener("click", () => addCurrentChannelToConfig("priority"));
  document.getElementById("btnAddBlacklist")?.addEventListener("click", () => addCurrentChannelToConfig("blacklist"));
  document.getElementById("btnTempAllow")?.addEventListener("click", () => tempAllowCurrentChannel());

  async function onToggleChanged() {
    if (busy) return;

    setBusy(true);
    flash("");

    const enabled = !!elToggle.checked;
    const resp = await send("ttm/enable", { enabled });

    if (!resp?.ok) {
      elToggle.checked = !enabled;
      flash(resp?.error || "Could not change manager state.", "error");
    } else {
      flash(enabled ? "Manager enabled." : "Manager disabled.", "ok");
    }

    await refreshUI();
    setBusy(false);
  }

  elToggle.addEventListener("change", onToggleChanged);

  btnPoll.addEventListener("click", async () => {
    if (busy) return;
    setBusy(true);
    flash("");

    const resp = await send("ttm/force_poll");
    if (resp?.ok) {
      flash("Force poll sent.", "ok");
    } else {
      flash(resp?.error || "Force poll failed.", "error");
    }

    await refreshUI();
    setBusy(false);
  });

  btnReload.addEventListener("click", async () => {
    if (busy) return;
    setBusy(true);
    flash("");

    const resp = await send("ttm/reload_config");
    if (resp?.ok) {
      flash("Config reloaded.", "ok");
    } else {
      flash(resp?.error || "Reload failed.", "error");
    }

    await refreshUI();
    setBusy(false);
  });

  btnOptions.addEventListener("click", () => {
    try {
      chrome.runtime.openOptionsPage();
    } catch {}
  });

  btnDiag.addEventListener("click", async () => {
    if (busy) return;
    setBusy(true);
    flash("");

    const diag =
      (await send("ttm/diagnose")) ||
      (await send("DIAGNOSE")) ||
      (await send("TTM_DIAG"));

    setBusy(false);

    if (!diag) {
      flash("Diagnostics failed.", "error");
      return;
    }

    const shortText = JSON.stringify(diag, null, 2);
    try {
      await navigator.clipboard.writeText(shortText);
      flash("Diagnostics copied to clipboard.", "ok");
    } catch {
      alert(shortText);
    }
  });

  setVersionText();
  refreshUI();
});