import { $, folTA, downloadText, err, note, ok, readFileText, rpc, uniqNames } from "./core.js";
import { clampConfig, getStoredConfig, loadUI, packagedFollows, readStorage, writeConfigEverywhere } from "./storage.js";

const FOLLOW_SYNC_HISTORY_KEY = "ttm_follow_sync_history_v1";
const FOLLOW_SYNC_LAST_KEY = "ttm_follow_sync_last_v1";
const FOLLOW_SYNC_LIMIT = 20;

function ensureFollowSyncHistoryUI() {
  if ($("#followSyncHistoryWrap")) return;

  const status = $("#folStatus");
  if (!status || !status.parentElement) return;

  const wrap = document.createElement("div");
  wrap.id = "followSyncHistoryWrap";
  wrap.style.marginTop = "12px";

  wrap.innerHTML = `
    <div class="small" style="margin-bottom:6px;"><strong>Last Follow Sync</strong></div>
    <pre id="followSyncHistoryOut" class="miniTA" style="min-height:120px; white-space:pre-wrap;"></pre>
  `;

  status.parentElement.insertBefore(wrap, status.nextSibling);
}

function formatWhen(iso) {
  if (!iso) return "never";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString();
}

async function readFollowSyncHistory() {
  const got = await chrome.storage.local.get([FOLLOW_SYNC_HISTORY_KEY, FOLLOW_SYNC_LAST_KEY]);
  return {
    last: got[FOLLOW_SYNC_LAST_KEY] || null,
    history: Array.isArray(got[FOLLOW_SYNC_HISTORY_KEY]) ? got[FOLLOW_SYNC_HISTORY_KEY] : []
  };
}

async function pushFollowSyncHistory(entry) {
  const got = await chrome.storage.local.get([FOLLOW_SYNC_HISTORY_KEY]);
  const history = Array.isArray(got[FOLLOW_SYNC_HISTORY_KEY]) ? got[FOLLOW_SYNC_HISTORY_KEY] : [];

  history.push(entry);
  while (history.length > FOLLOW_SYNC_LIMIT) history.shift();

  await chrome.storage.local.set({
    [FOLLOW_SYNC_LAST_KEY]: entry,
    [FOLLOW_SYNC_HISTORY_KEY]: history
  });
}

function renderFollowSyncHistory(last) {
  ensureFollowSyncHistoryUI();

  const out = $("#followSyncHistoryOut");
  if (!out) return;

  if (!last) {
    out.textContent = "No follow sync has been recorded yet.";
    return;
  }

  const added = Array.isArray(last.added) ? last.added : [];
  const removed = Array.isArray(last.removed) ? last.removed : [];

  out.textContent =
    `When: ${formatWhen(last.at)}\n` +
    `Mode: ${last.mode || "unknown"}\n` +
    `Fetched: ${last.count ?? 0}\n` +
    `Added (${added.length}): ${added.length ? added.join(", ") : "none"}\n` +
    `Removed (${removed.length}): ${removed.length ? removed.join(", ") : "none"}`;
}

async function refreshFollowSyncHistoryUI() {
  const { last } = await readFollowSyncHistory();
  renderFollowSyncHistory(last);
}

export function setupFollowsPanel() {
  ensureFollowSyncHistoryUI();
  refreshFollowSyncHistoryUI().catch(() => {});

  $("#saveFol")?.addEventListener("click", async () => {
    try {
      const bag = await readStorage();
      const cfg = getStoredConfig(bag);
      const follows = uniqNames((folTA()?.value || "").split("\n"));
      const clean = await writeConfigEverywhere(clampConfig({
        ...cfg,
        follows,
        followUnion: uniqNames([...follows, ...(cfg.priority || [])])
      }));

      if (folTA()) folTA().value = clean.follows.join("\n");
      if ($("#cfg")) $("#cfg").value = JSON.stringify(clean, null, 2);
      ok($("#folStatus"), "Follows saved.");
    } catch (e) {
      err($("#folStatus"), `Follows save failed: ${e.message || e}`);
    }
  });

  $("#exportFol")?.addEventListener("click", () => {
    downloadText("ttm-follows.txt", folTA()?.value || "", "text/plain");
  });

  $("#importFol")?.addEventListener("click", () => {
    $("#fileFol")?.click();
  });

  $("#fileFol")?.addEventListener("change", async (ev) => {
    const file = ev.target?.files?.[0];
    if (!file) return;

    try {
      const text = await readFileText(file);
      const follows = uniqNames(text.split(/\r?\n/));
      if (folTA()) folTA().value = follows.join("\n");
      note($("#folStatus"), "Follows imported into editor. Save to apply.");
    } catch (e) {
      err($("#folStatus"), `Follows import failed: ${e.message || e}`);
    }

    ev.target.value = "";
  });

  $("#resetFol")?.addEventListener("click", async () => {
    const follows = await packagedFollows();
    if (folTA()) folTA().value = follows.join("\n");
    note($("#folStatus"), "Follows reset to packaged follows. Save to apply.");
  });

  $("#refreshFol")?.addEventListener("click", async () => {
    await loadUI();
    await refreshFollowSyncHistoryUI();
    ok($("#folStatus"), "Follows refreshed from storage.");
  });

  $("#fetchFollows")?.addEventListener("click", async () => {
    const mode = $("#fetchMode")?.value || "active";
    note($("#folStatus"), "Fetching follows...");

    const bag = await readStorage();
    const cfg = getStoredConfig(bag);
    const before = uniqNames(Array.isArray(cfg.follows) ? cfg.follows : []);

    const resp = await rpc("TTM_FETCH_FOLLOWS", { mode });
    if (!resp?.ok) {
      err($("#folStatus"), resp?.error || "Fetch follows failed.");
      return;
    }

    const follows = uniqNames(resp.usernames || []);
    if (folTA()) folTA().value = follows.join("\n");

    const added = follows.filter((x) => !before.includes(x));
    const removed = before.filter((x) => !follows.includes(x));

    const entry = {
      at: new Date().toISOString(),
      mode,
      count: follows.length,
      added,
      removed
    };

    await pushFollowSyncHistory(entry);
    renderFollowSyncHistory(entry);

    note(
      $("#folStatus"),
      `Fetched ${follows.length} follows. Added ${added.length}, removed ${removed.length}. Save to apply.`
    );
  });

  $("#forcePoll")?.addEventListener("click", async () => {
    note($("#folStatus"), "Requesting force poll...");
    const resp = await rpc("ttm/force_poll");
    if (resp?.ok) ok($("#folStatus"), "Force poll requested.");
    else err($("#folStatus"), resp?.error || "Force poll failed.");
  });

  $("#reloadConfig")?.addEventListener("click", async () => {
    note($("#folStatus"), "Reloading config...");
    const resp = await rpc("ttm/reload_config");
    if (resp?.ok) ok($("#folStatus"), "Config reloaded in background.");
    else err($("#folStatus"), resp?.error || "Reload config failed.");
  });
}

export function setupPriorityEditor() {
  $("#prioritySave")?.addEventListener("click", async () => {
    try {
      const bag = await readStorage();
      const cfg = getStoredConfig(bag);
      const priority = uniqNames(($("#priorityBox")?.value || "").split("\n"));

      const clean = await writeConfigEverywhere(clampConfig({
        ...cfg,
        priority,
        followUnion: uniqNames([...(cfg.follows || []), ...priority])
      }));

      if ($("#priorityBox")) $("#priorityBox").value = clean.priority.join("\n");
      if ($("#cfg")) $("#cfg").value = JSON.stringify(clean, null, 2);

      ok($("#folStatus"), "Priority saved.");
    } catch (e) {
      err($("#folStatus"), `Priority save failed: ${e.message || e}`);
    }
  });
}