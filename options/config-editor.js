import { $, cfgTA, downloadText, err, note, ok, readFileText, rpc } from "./core.js";
import { clampConfig, packagedConfig, writeConfigEverywhere, loadUI } from "./storage.js";

export function setupConfigEditor() {
  $("#saveCfg")?.addEventListener("click", async () => {
    try {
      const parsed = JSON.parse(cfgTA()?.value || "{}");
      const clean = await writeConfigEverywhere(clampConfig(parsed));
      if (cfgTA()) cfgTA().value = JSON.stringify(clean, null, 2);
      ok($("#cfgStatus"), "Config saved.");
    } catch (e) {
      err($("#cfgStatus"), `Config save failed: ${e.message || e}`);
    }
  });

  $("#applyReload")?.addEventListener("click", async () => {
    try {
      const parsed = JSON.parse(cfgTA()?.value || "{}");
      const clean = await writeConfigEverywhere(clampConfig(parsed));
      if (cfgTA()) cfgTA().value = JSON.stringify(clean, null, 2);

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