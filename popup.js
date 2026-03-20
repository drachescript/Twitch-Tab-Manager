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
        "enabled",
        "max_tabs",
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
      

    const enabled =
      ping && typeof ping.enabled === "boolean"
        ? ping.enabled
        : (await readStorageFallback())?.settings?.enabled ??
          (await readStorageFallback())?.config?.enabled ??
          (await readStorageFallback())?.enabled ??
          true;

    elToggle.checked = enabled !== false;
    setStatusText(enabled);

    let diag = null;
    try {
      diag =
        (await send("ttm/diagnose")) ||
        (await send("DIAGNOSE")) ||
        (await send("TTM_DIAG"));
    } catch {}

    const bag = await readStorageFallback();

    const openCount =
      Number.isFinite(diag?.open_count) ? diag.open_count :
      Number.isFinite(diag?.managed_count) ? diag.managed_count :
      null;

    const liveCount =
      Number.isFinite(diag?.live_count) ? diag.live_count :
      null;

    const maxTabs =
      Number.isFinite(diag?.max_tabs) ? diag.max_tabs :
      Number(bag?.settings?.max_tabs) ||
      Number(bag?.config?.max_tabs) ||
      Number(bag?.max_tabs) ||
      null;

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

  const got = await chrome.storage.local.get(["settings", "config"]);
  const cfg = { ...(got.settings || got.config || {}) };

  cfg.follows = Array.isArray(cfg.follows) ? cfg.follows : [];
  cfg.priority = Array.isArray(cfg.priority) ? cfg.priority : [];
  cfg.blacklist = Array.isArray(cfg.blacklist) ? cfg.blacklist : [];
  cfg.followUnion = Array.isArray(cfg.followUnion) ? cfg.followUnion : [];

  const ch = active.channel;

  if (kind === "follow" && !cfg.follows.includes(ch)) cfg.follows.push(ch);
  if (kind === "priority" && !cfg.priority.includes(ch)) cfg.priority.push(ch);
  if (kind === "blacklist" && !cfg.blacklist.includes(ch)) cfg.blacklist.push(ch);

  cfg.followUnion = [...new Set([...(cfg.follows || []), ...(cfg.priority || [])])];

  await chrome.storage.local.set({
    settings: cfg,
    config: cfg,
    follows: cfg.follows,
    priority: cfg.priority,
    followUnion: cfg.followUnion,
    blacklist: cfg.blacklist
  });

  await send("ttm/reload_config");
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