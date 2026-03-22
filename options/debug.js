import { $, format, ok, err, rpc, downloadText } from "./core.js";
import {
  backupCurrentBrowserConfig,
  getStoredConfig,
  listStoredBackups,
  loadUI,
  readStorage,
  restoreBackupByIndex
} from "./storage.js";

function ensureBackupTools() {
  const panel = $("#panel-debug .card");
  if (!panel) return null;
  if ($("#dbgBackupBar")) return $("#dbgBackupBar");

  const wrap = document.createElement("div");
  wrap.id = "dbgBackupWrap";
  wrap.style.marginTop = "16px";

  wrap.innerHTML = `
    <h3 style="margin: 0 0 10px;">Config Backups</h3>
    <p class="small" style="margin: 0 0 10px;">
      Backups are stored in browser storage and include client ID / access token.
      Restore here instead of using the service worker console.
    </p>

    <div id="dbgBackupBar" class="btns">
      <button id="dbgMakeBackup">Make Snapshot Now</button>
      <button id="dbgRefreshBackups">Refresh Backup List</button>
      <button id="dbgRestoreLatest" class="primary">Restore Latest Backup</button>
      <button id="dbgRestoreSelected">Restore Selected Backup</button>
      <button id="dbgExportCurrent">Export Current Config</button>
      <button id="dbgExportSelectedBackup">Export Selected Backup</button>
    </div>

    <div class="row" style="margin-top: 10px;">
      <select id="dbgBackupSelect" style="flex:1; min-width: 300px;"></select>
    </div>

    <div id="dbgBackupStatus" class="status"></div>
  `;

  panel.appendChild(wrap);
  return wrap;
}

async function refreshBackupList() {
  ensureBackupTools();

  const select = $("#dbgBackupSelect");
  if (!select) return;

  const { history } = await listStoredBackups();
  select.innerHTML = "";

  if (!history.length) {
    const opt = document.createElement("option");
    opt.value = "-1";
    opt.textContent = "No backups found yet";
    select.appendChild(opt);
    return;
  }

  history.forEach((item, index) => {
    const opt = document.createElement("option");
    opt.value = String(index);

    const summary = item?.summary || {};
    const when = item?.saved_at || "unknown time";
    opt.textContent =
      `${index + 1}. ${when} | ${item?.reason || "unknown"} | ` +
      `f:${summary.follows_count ?? 0} p:${summary.priority_count ?? 0} ` +
      `cid:${summary.has_client_id ? "yes" : "no"} tok:${summary.has_access_token ? "yes" : "no"}`;

    select.appendChild(opt);
  });

  select.value = String(history.length - 1);
}

export function setupDebugPanel() {
  const out = $("#dbgOut");
  const btnRun = $("#dbgRun");
  const btnCopy = $("#dbgCopy");
  const btnClear = $("#dbgClear");
  const dbgOpen = $("#dbgOpen");

  const setOut = (text) => {
    if (out) out.value = text || "";
  };

  ensureBackupTools();

  btnRun?.addEventListener("click", async () => {
    btnRun.disabled = true;

    try {
      const diag = await rpc("TTM_DIAG");
      const logs = await rpc("TTM_GET_LOGS");
      const stalled = Array.isArray(diag?.stalled_tabs) ? diag.stalled_tabs : [];
      const storage = await readStorage();
      const current = getStoredConfig(storage);
      const backups = await listStoredBackups();

      setOut(
        `=== DIAGNOSTICS ===\n${format(diag)}\n\n` +
        `=== CURRENT CONFIG ===\n${format(current)}\n\n` +
        `=== STALLED START TABS ===\n${format(stalled)}\n\n` +
        `=== BACKUPS ===\n${format(backups)}\n\n` +
        `=== LOGS ===\n${format(logs?.logs || [])}`
      );

      await refreshBackupList();
    } finally {
      btnRun.disabled = false;
    }
  });

  btnCopy?.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(out?.value || "");
      ok($("#dbgStatus"), "Debug output copied.");
    } catch {
      err($("#dbgStatus"), "Copy failed.");
    }
  });

  btnClear?.addEventListener("click", async () => {
    const resp = await rpc("TTM_CLEAR_LOGS");
    if (resp?.ok) {
      setOut("");
      ok($("#dbgStatus"), "Logs cleared.");
    } else {
      err($("#dbgStatus"), resp?.error || "Clear logs failed.");
    }
  });

  dbgOpen?.addEventListener("click", async () => {
    const channel = ($("#dbgChannel")?.value || "").trim().toLowerCase();
    if (!channel) {
      err($("#dbgStatus"), "Enter a channel login first.");
      return;
    }

    try {
      await chrome.tabs.create({
        url: `https://www.twitch.tv/${channel}`,
        active: true
      });
      ok($("#dbgStatus"), `Opened ${channel}.`);
    } catch (e) {
      err($("#dbgStatus"), `Open failed: ${e.message || e}`);
    }
  });

  $("#dbgMakeBackup")?.addEventListener("click", async () => {
    try {
      const snapshot = await backupCurrentBrowserConfig("manual_debug_snapshot");
      await refreshBackupList();

      if (snapshot) ok($("#dbgBackupStatus"), "Backup snapshot saved.");
      else err($("#dbgBackupStatus"), "No meaningful browser config found to back up.");
    } catch (e) {
      err($("#dbgBackupStatus"), `Backup failed: ${e.message || e}`);
    }
  });

  $("#dbgRefreshBackups")?.addEventListener("click", async () => {
    try {
      await refreshBackupList();
      ok($("#dbgBackupStatus"), "Backup list refreshed.");
    } catch (e) {
      err($("#dbgBackupStatus"), `Refresh failed: ${e.message || e}`);
    }
  });

  $("#dbgRestoreLatest")?.addEventListener("click", async () => {
    try {
      await restoreBackupByIndex(-1);
      await rpc("ttm/reload_config");
      await loadUI();
      await refreshBackupList();
      ok($("#dbgBackupStatus"), "Latest backup restored.");
    } catch (e) {
      err($("#dbgBackupStatus"), `Restore failed: ${e.message || e}`);
    }
  });

  $("#dbgRestoreSelected")?.addEventListener("click", async () => {
    try {
      const idx = Number($("#dbgBackupSelect")?.value ?? -1);
      if (Number.isNaN(idx) || idx < 0) {
        err($("#dbgBackupStatus"), "Pick a backup first.");
        return;
      }

      await restoreBackupByIndex(idx);
      await rpc("ttm/reload_config");
      await loadUI();
      await refreshBackupList();
      ok($("#dbgBackupStatus"), "Selected backup restored.");
    } catch (e) {
      err($("#dbgBackupStatus"), `Restore failed: ${e.message || e}`);
    }
  });

  $("#dbgExportCurrent")?.addEventListener("click", async () => {
    try {
      const bag = await readStorage();
      const cfg = getStoredConfig(bag);
      downloadText("ttm-current-config.json", JSON.stringify(cfg, null, 2), "application/json");
      ok($("#dbgBackupStatus"), "Current config exported.");
    } catch (e) {
      err($("#dbgBackupStatus"), `Export failed: ${e.message || e}`);
    }
  });

  $("#dbgExportSelectedBackup")?.addEventListener("click", async () => {
    try {
      const idx = Number($("#dbgBackupSelect")?.value ?? -1);
      const { history, last } = await listStoredBackups();
      const chosen = idx >= 0 ? history[idx] : last;

      if (!chosen?.settings) {
        err($("#dbgBackupStatus"), "No backup selected.");
        return;
      }

      const stamp = String(chosen.saved_at || "backup").replace(/[:.]/g, "-");
      downloadText(
        `ttm-backup-${stamp}.json`,
        JSON.stringify(chosen.settings, null, 2),
        "application/json"
      );
      ok($("#dbgBackupStatus"), "Selected backup exported.");
    } catch (e) {
      err($("#dbgBackupStatus"), `Export failed: ${e.message || e}`);
    }
  });

  refreshBackupList().catch(() => {});
}