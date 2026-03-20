const $ = (sel) => document.querySelector(sel);

const cfgTA = $("#cfg");
const folTA = $("#fol");
const cfgStatus = $("#cfgStatus");
const folStatus = $("#folStatus");

const CFG_DEFAULT = {
  live_source: "auto",
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
async function showManifestVersion() {
  try {
    const manifest = chrome.runtime.getManifest();
    const el = document.getElementById("versionLine");
    if (!el) return;
    el.textContent = `Version: ${manifest.version}`;
  } catch {}
}
function showStatus(el, text, kind = "ok", ms = 2600) {
  if (!el) return;
  el.textContent = text;
  el.className = `status ${kind}`;
  window.clearTimeout(el._ttmTimer);
  el._ttmTimer = window.setTimeout(() => {
    el.textContent = "";
    el.className = "status";
  }, ms);
}

function ok(el, text, ms) {
  showStatus(el, text, "ok", ms);
}

function err(el, text, ms) {
  showStatus(el, text, "err", ms || 3400);
}

function normalizeName(value) {
  return String(value || "").trim().toLowerCase();
}

function uniqNames(list) {
  return [...new Set((list || []).map(normalizeName).filter(Boolean))];
}

function mergeDefaults(obj) {
  return { ...CFG_DEFAULT, ...(obj || {}) };
}

function parseBool(value, fallback = false) {
  if (value === true || value === false) return value;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (v === "true") return true;
    if (v === "false") return false;
  }
  return fallback;
}

function clampConfig(input) {
  const cfg = mergeDefaults(input);

  cfg.close_unfollowed_tabs = parseBool(cfg.close_unfollowed_tabs, true);
  cfg.allow_extra_twitch_tabs = parseBool(cfg.allow_extra_twitch_tabs, true);
  cfg.temp_whitelist_hours = Math.max(1, Number(cfg.temp_whitelist_hours || 12) || 12);

  if (!cfg.temp_whitelist_entries || typeof cfg.temp_whitelist_entries !== "object" || Array.isArray(cfg.temp_whitelist_entries)) {
    cfg.temp_whitelist_entries = {};
  }

  cfg.close_unfollowed_tabs = parseBool(cfg.close_unfollowed_tabs, true);
  cfg.enabled = parseBool(cfg.enabled, true);
  cfg.force_unmute = parseBool(cfg.force_unmute, true);
  cfg.unmute_streams = parseBool(cfg.unmute_streams, true);
  cfg.force_resume = parseBool(cfg.force_resume, true);
  cfg.autoplay_streams = parseBool(cfg.autoplay_streams, false);
  cfg.soft_wake_tabs = parseBool(cfg.soft_wake_tabs, false);
  cfg.soft_wake_only_when_browser_focused = parseBool(cfg.soft_wake_only_when_browser_focused, true);

  cfg.check_interval_sec = Math.max(10, Number(cfg.check_interval_sec || 60) || 60);
  cfg.max_tabs = Math.max(1, Number(cfg.max_tabs || 4) || 4);

  cfg.follows = uniqNames(cfg.follows);
  cfg.priority = uniqNames(cfg.priority);
  cfg.followUnion = uniqNames([...(cfg.follows || []), ...(cfg.priority || [])]);
  cfg.blacklist = uniqNames(cfg.blacklist);

  return cfg;
}

async function packagedConfig() {
  try {
    const res = await fetch(chrome.runtime.getURL("config.json"));
    if (!res.ok) return {};
    return await res.json();
  } catch {
    return {};
  }
}

async function packagedFollows() {
  try {
    const res = await fetch(chrome.runtime.getURL("follows.txt"));
    if (!res.ok) return [];
    const text = await res.text();
    return uniqNames(text.replace(/\r\n/g, "\n").split("\n"));
  } catch {
    return [];
  }
}

async function readStorage() {
  return await new Promise((resolve) => chrome.storage.local.get(null, resolve));
}

function getStoredConfig(bag) {
  return clampConfig(bag.settings ?? bag.config ?? bag);
}

async function writeConfigEverywhere(rawCfg) {
  const cfg = clampConfig(rawCfg);

   await chrome.storage.local.set({
    settings: cfg,
    config: cfg,
    enabled: cfg.enabled,
    live_source: cfg.live_source,
    force_unmute: cfg.force_unmute,
    unmute_streams: cfg.unmute_streams,
    force_resume: cfg.force_resume,
    autoplay_streams: cfg.autoplay_streams,
    soft_wake_tabs: cfg.soft_wake_tabs,
    soft_wake_only_when_browser_focused: cfg.soft_wake_only_when_browser_focused,
    close_unfollowed_tabs: cfg.close_unfollowed_tabs,
    check_interval_sec: cfg.check_interval_sec,
    allow_extra_twitch_tabs: cfg.allow_extra_twitch_tabs,
    temp_whitelist_hours: cfg.temp_whitelist_hours,
    temp_whitelist_entries: cfg.temp_whitelist_entries,
    max_tabs: cfg.max_tabs,
    follows: cfg.follows,
    priority: cfg.priority,
    followUnion: cfg.followUnion,
    blacklist: cfg.blacklist
  });

  return cfg;
}
function fillQuickSettings(cfg) {
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
  const blacklistBox = $("#blacklistBox");
  const closeUnfollowedTabs = $("#closeUnfollowedTabs");
  const allowExtraTwitchTabs = $("#allowExtraTwitchTabs");
  const tempWhitelistHours = $("#tempWhitelistHours");

  if (allowExtraTwitchTabs) allowExtraTwitchTabs.checked = !!cfg.allow_extra_twitch_tabs;
  if (tempWhitelistHours) tempWhitelistHours.value = String(cfg.temp_whitelist_hours ?? 12);
  if (closeUnfollowedTabs) closeUnfollowedTabs.checked = !!cfg.close_unfollowed_tabs;
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
  if (blacklistBox) blacklistBox.value = uniqNames(cfg.blacklist).join("\n");
}

function readQuickSettings(baseCfg = {}) {
  return clampConfig({
    ...baseCfg,
    live_source: $("#liveSource")?.value || baseCfg.live_source || "auto",
    check_interval_sec: Number($("#checkIntervalSec")?.value || baseCfg.check_interval_sec || 60),
    max_tabs: Number($("#maxTabs")?.value || baseCfg.max_tabs || 4),
    enabled: parseBool($("#enabledSelect")?.value, baseCfg.enabled !== false),
    force_unmute: !!$("#forceUnmute")?.checked,
    unmute_streams: !!$("#unmuteStreams")?.checked,
    force_resume: !!$("#forceResume")?.checked,
    close_unfollowed_tabs: !!$("#closeUnfollowedTabs")?.checked,
    allow_extra_twitch_tabs: !!$("#allowExtraTwitchTabs")?.checked,
    temp_whitelist_hours: Number($("#tempWhitelistHours")?.value || baseCfg.temp_whitelist_hours || 12),
    autoplay_streams: !!$("#autoplayStreams")?.checked,
    soft_wake_tabs: !!$("#softWakeTabs")?.checked,
    soft_wake_only_when_browser_focused: !!$("#softWakeFocusedOnly")?.checked,
    blacklist: uniqNames(($("#blacklistBox")?.value || "").split("\n"))
  });
}
async function loadUI() {
  const bag = await readStorage();
  const cfg = getStoredConfig(bag);
  const follows = Array.isArray(bag.follows) && bag.follows.length ? uniqNames(bag.follows) : cfg.follows.length ? cfg.follows : await packagedFollows();
  const priority = Array.isArray(bag.priority) && bag.priority.length ? uniqNames(bag.priority) : cfg.priority;

  const fullCfg = clampConfig({ ...cfg, follows, priority, followUnion: uniqNames([...follows, ...priority]) });
  cfgTA.value = JSON.stringify(fullCfg, null, 2);
  folTA.value = follows.join("\n");
  fillQuickSettings(fullCfg);

  const priorityBox = $("#priorityBox");
  if (priorityBox) priorityBox.value = priority.join("\n");

  renderTokenSnippets();
}

function downloadText(filename, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  if (chrome.downloads?.download) {
    chrome.downloads.download({ url, filename, saveAs: true }, () => URL.revokeObjectURL(url));
    return;
  }

  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function readFileText(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result || ""));
    fr.onerror = () => reject(fr.error || new Error("read failed"));
    fr.readAsText(file);
  });
}

function rpc(type, payload = {}) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ type, ...payload }, (resp) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: chrome.runtime.lastError.message });
          return;
        }
        resolve(resp || { ok: true });
      });
    } catch (e) {
      resolve({ ok: false, error: String(e) });
    }
  });
}

function buildPS1(clientId, clientSecret) {
  return `$client_id = "${clientId}"
$client_secret = "${clientSecret}"
$body = @{
  client_id     = $client_id
  client_secret = $client_secret
  grant_type    = "client_credentials"
}
$response = Invoke-RestMethod -Method Post -Uri "https://id.twitch.tv/oauth2/token" -Body $body
$response | Format-List`;
}

function buildCurl(clientId, clientSecret) {
  return `curl -X POST "https://id.twitch.tv/oauth2/token" \\
  -d "client_id=${clientId}" \\
  -d "client_secret=${clientSecret}" \\
  -d "grant_type=client_credentials"`;
}

function renderTokenSnippets() {
  const cid = $("#cid");
  const csecret = $("#csecret");
  const ps1Out = $("#ps1Out");
  const curlOut = $("#curlOut");

  if (!ps1Out || !curlOut) return;

  const id = (cid?.value || "").trim() || "YOUR_CLIENT_ID_HERE";
  const secret = (csecret?.value || "").trim() || "YOUR_CLIENT_SECRET_HERE";

  ps1Out.value = buildPS1(id, secret);
  curlOut.value = buildCurl(id, secret);
}

function updateConfigField(field, value) {
  try {
    const cfg = clampConfig(JSON.parse(cfgTA.value || "{}"));
    cfg[field] = value;
    cfgTA.value = JSON.stringify(clampConfig(cfg), null, 2);
    return true;
  } catch {
    return false;
  }
}

async function saveFollowsOnlyFromTextarea() {
  const bag = await readStorage();
  const cfg = getStoredConfig(bag);
  const priority = Array.isArray(bag.priority) ? uniqNames(bag.priority) : cfg.priority;
  const follows = uniqNames(folTA.value.split("\n"));
  const nextCfg = clampConfig({ ...cfg, follows, priority, followUnion: uniqNames([...follows, ...priority]) });
  await writeConfigEverywhere(nextCfg);
  return nextCfg;
}

async function syncFetchedFollows(usernames) {
  const fetched = uniqNames(usernames);
  if (!fetched.length) {
    err(folStatus, "Fetch returned 0 follows. Existing follows were kept.");
    return null;
  }

  const bag = await readStorage();
  const cfg = getStoredConfig(bag);

  const currentFollows = uniqNames(Array.isArray(bag.follows) ? bag.follows : cfg.follows);
  const priority = uniqNames(Array.isArray(bag.priority) ? bag.priority : cfg.priority);

  const currentSet = new Set(currentFollows);
  const fetchedSet = new Set(fetched);

  const added = fetched.filter((name) => !currentSet.has(name));
  const removed = currentFollows.filter((name) => !fetchedSet.has(name));
  const followUnion = uniqNames([...fetched, ...priority]);

  const nextCfg = clampConfig({
    ...cfg,
    follows: fetched,
    priority,
    followUnion
  });

  const entry = {
    at: new Date().toISOString(),
    added,
    removed,
    previous_count: currentFollows.length,
    fetched_count: fetched.length,
    final_follow_count: fetched.length
  };

  const previousHistory = Array.isArray(bag.followSyncLog?.history) ? bag.followSyncLog.history : [];
  const followSyncLog = {
    last_run_at: entry.at,
    last_added: added,
    last_removed: removed,
    previous_count: currentFollows.length,
    fetched_count: fetched.length,
    final_follow_count: fetched.length,
    history: [entry, ...previousHistory].slice(0, 20)
  };

  await writeConfigEverywhere(nextCfg);
  await chrome.storage.local.set({ followSyncLog });

  folTA.value = fetched.join("\n");
  cfgTA.value = JSON.stringify(nextCfg, null, 2);

  const addedText = added.length ? `Added: ${added.join(", ")}` : "Added: 0";
  const removedText = removed.length ? `Removed: ${removed.join(", ")}` : "Removed: 0";
  ok(folStatus, `Synced ${fetched.length} follows. ${addedText}. ${removedText}.`, 4200);

  return followSyncLog;
}

function setupTabs() {
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", async () => {
      document.querySelectorAll(".tab").forEach((x) => x.classList.remove("active"));
      document.querySelectorAll(".panel").forEach((x) => x.classList.remove("active"));
      tab.classList.add("active");
      document.getElementById("panel-" + tab.dataset.tab)?.classList.add("active");

      if (tab.dataset.tab === "changelog") {
        await loadChangelogTab();
      }
    });
  });
}

function setupConfigButtons() {
  $("#saveCfg")?.addEventListener("click", async () => {
    try {
      const cfg = clampConfig(JSON.parse(cfgTA.value));
      await writeConfigEverywhere(cfg);
      cfgTA.value = JSON.stringify(cfg, null, 2);
      ok(cfgStatus, "Saved.");
    } catch {
      err(cfgStatus, "Invalid JSON.");
    }
  });

  $("#applyReload")?.addEventListener("click", async () => {
    try {
      const cfg = clampConfig(JSON.parse(cfgTA.value));
      await writeConfigEverywhere(cfg);
      cfgTA.value = JSON.stringify(cfg, null, 2);
      const resp = await rpc("ttm/reload_config");
      if (resp?.ok) ok(cfgStatus, "Applied and reloaded.");
      else err(cfgStatus, "Saved, but background reload failed.");
    } catch {
      err(cfgStatus, "Invalid JSON.");
    }
  });

  $("#refreshCfg")?.addEventListener("click", async () => {
    const bag = await readStorage();
    cfgTA.value = JSON.stringify(getStoredConfig(bag), null, 2);
    ok(cfgStatus, "Refreshed.");
  });

  $("#resetCfg")?.addEventListener("click", async () => {
    const base = clampConfig(await packagedConfig());
    await writeConfigEverywhere(base);
    cfgTA.value = JSON.stringify(base, null, 2);
    ok(cfgStatus, "Reset to packaged values.");
  });

  $("#exportCfg")?.addEventListener("click", () => {
    downloadText("config.json", cfgTA.value, "application/json");
  });

  const fileCfg = $("#fileCfg");
  $("#importCfg")?.addEventListener("click", () => fileCfg?.click());

  fileCfg?.addEventListener("change", async (event) => {
    try {
      const file = event.target.files?.[0];
      if (!file) return;
      const text = await readFileText(file);
      const cfg = clampConfig(JSON.parse(text));
      await writeConfigEverywhere(cfg);
      cfgTA.value = JSON.stringify(cfg, null, 2);
      ok(cfgStatus, "Imported and saved.");
    } catch {
      err(cfgStatus, "Import failed.");
    }
    fileCfg.value = "";
  });
}

function setupFollowButtons() {
  $("#saveFol")?.addEventListener("click", async () => {
    await saveFollowsOnlyFromTextarea();
    ok(folStatus, "Saved.");
  });

  $("#refreshFol")?.addEventListener("click", async () => {
    const bag = await readStorage();
    const cfg = getStoredConfig(bag);
    const follows = uniqNames(Array.isArray(bag.follows) ? bag.follows : cfg.follows);
    folTA.value = follows.join("\n");
    ok(folStatus, "Refreshed.");
  });

  $("#resetFol")?.addEventListener("click", async () => {
    const follows = await packagedFollows();
    const bag = await readStorage();
    const cfg = getStoredConfig(bag);
    const priority = uniqNames(Array.isArray(bag.priority) ? bag.priority : cfg.priority);
    const nextCfg = clampConfig({ ...cfg, follows, priority, followUnion: uniqNames([...follows, ...priority]) });
    await writeConfigEverywhere(nextCfg);
    folTA.value = follows.join("\n");
    cfgTA.value = JSON.stringify(nextCfg, null, 2);
    ok(folStatus, "Reset to packaged values.");
  });

  $("#exportFol")?.addEventListener("click", () => {
    downloadText("follows.txt", folTA.value, "text/plain");
  });

  const fileFol = $("#fileFol");
  $("#importFol")?.addEventListener("click", () => fileFol?.click());

  fileFol?.addEventListener("change", async (event) => {
    try {
      const file = event.target.files?.[0];
      if (!file) return;
      const text = await readFileText(file);
      folTA.value = uniqNames(text.replace(/\r\n/g, "\n").split("\n")).join("\n");
      await saveFollowsOnlyFromTextarea();
      ok(folStatus, "Imported and saved.");
    } catch {
      err(folStatus, "Import failed.");
    }
    fileFol.value = "";
  });

  $("#fetchFollows")?.addEventListener("click", async () => {
    const btn = $("#fetchFollows");
    const mode = $("#fetchMode")?.value || "active";

    if (btn) btn.disabled = true;
    const resp = await rpc("TTM_FETCH_FOLLOWS", { mode });
    if (btn) btn.disabled = false;

    if (!resp?.ok) {
      err(folStatus, resp?.error ? `Fetch failed: ${resp.error}` : "Fetch failed.");
      return;
    }

    await syncFetchedFollows(resp.usernames || []);
  });

  $("#forcePoll")?.addEventListener("click", async () => {
    await rpc("ttm/force_poll");
    ok(folStatus, "Poll queued.");
  });

  $("#reloadConfig")?.addEventListener("click", async () => {
    const resp = await rpc("ttm/reload_config");
    if (resp?.ok) ok(folStatus, "Background reloaded.");
    else err(folStatus, "Reload failed.");
  });
}
async function saveQuickSettings({ reload = false } = {}) {
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

    await writeConfigEverywhere(nextCfg);
    cfgTA.value = JSON.stringify(nextCfg, null, 2);

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

function setupQuickSettings() {
  $("#quickSave")?.addEventListener("click", () => {
    saveQuickSettings({ reload: false });
  });

  $("#quickApplyReload")?.addEventListener("click", () => {
    saveQuickSettings({ reload: true });
  });
}
function setupPriorityEditor() {
  const box = $("#priorityBox");
  const save = $("#prioritySave");
  if (!box || !save) return;

  save.addEventListener("click", async () => {
    const bag = await readStorage();
    const cfg = getStoredConfig(bag);
    const follows = uniqNames(Array.isArray(bag.follows) ? bag.follows : cfg.follows);
    const priority = uniqNames(box.value.split("\n"));
    const nextCfg = clampConfig({ ...cfg, follows, priority, followUnion: uniqNames([...follows, ...priority]) });
    await writeConfigEverywhere(nextCfg);
    cfgTA.value = JSON.stringify(nextCfg, null, 2);
    ok(cfgStatus, "Priority saved.");
  });
}

function setupTokenTools() {
  const cid = $("#cid");
  const csecret = $("#csecret");
  const tok = $("#tok");
  const ps1Out = $("#ps1Out");
  const curlOut = $("#curlOut");

  cid?.addEventListener("input", renderTokenSnippets);
  csecret?.addEventListener("input", renderTokenSnippets);

  $("#btnCopyPS1")?.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(ps1Out?.value || "");
      ok(cfgStatus, "PowerShell copied.");
    } catch {
      err(cfgStatus, "Copy failed.");
    }
  });

  $("#btnCopyCurl")?.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(curlOut?.value || "");
      ok(cfgStatus, "cURL copied.");
    } catch {
      err(cfgStatus, "Copy failed.");
    }
  });

  $("#btnApplyCIDToCfg")?.addEventListener("click", () => {
    const value = (cid?.value || "").trim();
    if (!value) {
      err(cfgStatus, "Enter a Client ID first.");
      return;
    }
    if (!updateConfigField("client_id", value)) {
      err(cfgStatus, "Config JSON is not valid.");
      return;
    }
    ok(cfgStatus, "Client ID inserted into config.");
  });

  $("#btnApplyToken")?.addEventListener("click", () => {
    const value = (tok?.value || "").trim();
    if (!value) {
      err(cfgStatus, "Paste a token first.");
      return;
    }
    if (!updateConfigField("access_token", value)) {
      err(cfgStatus, "Config JSON is not valid.");
      return;
    }
    ok(cfgStatus, "Token inserted into config.");
  });
}

function setupDebugPanel() {
  const out = $("#dbgOut");
  const btnRun = $("#dbgRun");
  const btnCopy = $("#dbgCopy");
  const btnClear = $("#dbgClear");
  const btnOpen = $("#dbgOpen");
  const inputChannel = $("#dbgChannel");

  const format = (obj) => {
    try {
      return JSON.stringify(obj, null, 2);
    } catch {
      return String(obj);
    }
  };

  const setOut = (text) => {
    if (!out) return;
    out.value = text;
    out.scrollTop = out.scrollHeight;
  };

  btnRun?.addEventListener("click", async () => {
  btnRun.disabled = true;

  const diag = await rpc("TTM_DIAG");
  const logs = await rpc("TTM_GET_LOGS");

  const stalled = Array.isArray(diag?.stalled_tabs) ? diag.stalled_tabs : [];

  setOut(
    `=== DIAGNOSTICS ===\n${format(diag)}\n\n` +
    `=== STALLED START TABS ===\n${format(stalled)}\n\n` +
    `=== LOGS ===\n${format(logs?.logs || [])}`
  );

  btnRun.disabled = false;
  });

  btnCopy?.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(out?.value || "");
      ok(cfgStatus, "Debug output copied.");
    } catch {
      err(cfgStatus, "Copy failed.");
    }
  });

  btnClear?.addEventListener("click", async () => {
    await rpc("TTM_CLEAR_LOGS");
    setOut("");
    ok(cfgStatus, "Logs cleared.");
  });

  btnOpen?.addEventListener("click", async () => {
    const channel = normalizeName(inputChannel?.value);
    if (!channel) return;
    const resp = await rpc("TTM_OPEN_CHANNEL", { channel });
    const line = `Open test for "${channel}": ${resp?.ok ? "ok" : "failed"}`;
    setOut((out?.value ? out.value + "\n\n" : "") + line);
  });
}
async function loadBundledReadme() {
  const url = chrome.runtime.getURL("README.md");
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`README load failed: ${res.status}`);
  }
  return await res.text();
}

function extractChangelogSection(md) {
  const text = String(md || "");
  const lines = text.split(/\r?\n/);

  let start = -1;
  let end = lines.length;

  for (let i = 0; i < lines.length; i++) {
    if (/^##\s+changelog\b/i.test(lines[i].trim())) {
      start = i + 1;
      break;
    }
  }

  if (start === -1) {
    return "";
  }

  for (let i = start; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i].trim())) {
      end = i;
      break;
    }
  }

  return lines.slice(start, end).join("\n").trim();
}

async function loadChangelogTab() {
  const out = $("#changelogOut");
  const status = $("#changelogStatus");
  if (out) out.textContent = "Loading changelog...";
  if (status) status.textContent = "";

  try {
    const md = await loadBundledReadme();
    const section = extractChangelogSection(md);

    if (!section) {
      if (out) out.textContent = "No '## Changelog' section was found in README.md.";
      if (status) {
        status.textContent = "Could not find changelog section.";
        status.className = "status err";
      }
      return;
    }

    if (out) out.textContent = section;
    if (status) {
      status.textContent = "Changelog loaded.";
      status.className = "status ok";
    }
  } catch (e) {
    if (out) out.textContent = "";
    if (status) {
      status.textContent = `Failed to load changelog: ${e.message || e}`;
      status.className = "status err";
    }
  }
}

function setupChangelogTab() {
  $("#reloadChangelog")?.addEventListener("click", () => {
    loadChangelogTab();
  });
}

async function init() {
  setupTabs();
  setupConfigButtons();
  setupFollowButtons();
  setupQuickSettings();
  setupPriorityEditor();
  setupTokenTools();
  setupDebugPanel();
  setupChangelogTab();
  await showManifestVersion();
  await loadUI();
}

init();