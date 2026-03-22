import { $, cfgTA, downloadText, err, note, ok, readFileText, rpc } from "./core.js";
import { clampConfig, packagedConfig, writeConfigEverywhere, loadUI, getStoredConfig, readStorage } from "./storage.js";

function getEditorNames(selector) {
  const raw = ($(selector)?.value || "")
    .split(/\r?\n/)
    .map((x) => String(x || "").trim().toLowerCase())
    .filter(Boolean);

  return [...new Set(raw)];
}

async function buildSafeMergedConfigFromEditor() {
  const parsed = JSON.parse(cfgTA()?.value || "{}");

  const bag = await readStorage();
  const current = getStoredConfig(bag);

  const followsFromEditor = getEditorNames("#fol");
  const priorityFromEditor = getEditorNames("#priorityBox");

  const follows = Array.isArray(parsed.follows)
    ? parsed.follows
    : (followsFromEditor.length ? followsFromEditor : (Array.isArray(bag.follows) ? bag.follows : current.follows));

  const priority = Array.isArray(parsed.priority)
    ? parsed.priority
    : (priorityFromEditor.length ? priorityFromEditor : (Array.isArray(bag.priority) ? bag.priority : current.priority));

  const merged = clampConfig({
    ...current,
    ...parsed,
    follows,
    priority,
    followUnion: [...new Set([...(follows || []), ...(priority || [])])]
  });

  merged.client_id = parsed.client_id ?? current.client_id ?? "";
  merged.access_token = parsed.access_token ?? current.access_token ?? "";
  merged.temp_whitelist_entries = parsed.temp_whitelist_entries ?? current.temp_whitelist_entries ?? {};

  return clampConfig(merged);
}

export function setupConfigEditor() {
  $("#saveCfg")?.addEventListener("click", async () => {
    try {
      const clean = await buildSafeMergedConfigFromEditor();
      const saved = await writeConfigEverywhere(clean, { reason: "config_editor_save" });

      if (cfgTA()) cfgTA().value = JSON.stringify(saved, null, 2);
      if ($("#fol")) $("#fol").value = saved.follows.join("\n");
      if ($("#priorityBox")) $("#priorityBox").value = saved.priority.join("\n");
      if ($("#blacklistBox")) $("#blacklistBox").value = saved.blacklist.join("\n");

      ok($("#cfgStatus"), "Config saved.");
    } catch (e) {
      err($("#cfgStatus"), `Config save failed: ${e.message || e}`);
    }
  });

  $("#applyReload")?.addEventListener("click", async () => {
    try {
      const clean = await buildSafeMergedConfigFromEditor();
      const saved = await writeConfigEverywhere(clean, { reason: "config_editor_save_reload" });

      if (cfgTA()) cfgTA().value = JSON.stringify(saved, null, 2);
      if ($("#fol")) $("#fol").value = saved.follows.join("\n");
      if ($("#priorityBox")) $("#priorityBox").value = saved.priority.join("\n");
      if ($("#blacklistBox")) $("#blacklistBox").value = saved.blacklist.join("\n");

      const resp = await rpc("ttm/reload_config");
      if (resp?.ok) ok($("#cfgStatus"), "Config saved and reloaded.");
      else err($("#cfgStatus"), "Config saved, but reload failed.");
    } catch (e) {
      err($("#cfgStatus"), `Apply & reload failed: ${e.message || e}`);
    }
  });

  $("#exportCfg")?.addEventListener("click", async () => {
    downloadText("ttm-config.json", cfgTA()?.value || "{}", "application/json");
  });

  $("#importCfg")?.addEventListener("click", () => {
    $("#fileCfg")?.click();
  });

  $("#fileCfg")?.addEventListener("change", async (ev) => {
    const file = ev.target?.files?.[0];
    if (!file) return;

    try {
      const text = await readFileText(file);
      const parsed = JSON.parse(text);
      const clean = clampConfig(parsed);
      if (cfgTA()) cfgTA().value = JSON.stringify(clean, null, 2);
      note($("#cfgStatus"), "Config imported into editor. Save to apply.");
    } catch (e) {
      err($("#cfgStatus"), `Config import failed: ${e.message || e}`);
    }

    ev.target.value = "";
  });

  $("#resetCfg")?.addEventListener("click", async () => {
    const cfg = await packagedConfig();
    if (cfgTA()) cfgTA().value = JSON.stringify(cfg, null, 2);
    note($("#cfgStatus"), "Editor reset to packaged config. Save to apply.");
  });

  $("#refreshCfg")?.addEventListener("click", async () => {
    await loadUI();
    ok($("#cfgStatus"), "Config refreshed from storage.");
  });
}