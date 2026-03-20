import { $, folTA, downloadText, err, note, ok, readFileText, rpc, uniqNames } from "./core.js";
import { clampConfig, getStoredConfig, loadUI, packagedFollows, readStorage, writeConfigEverywhere } from "./storage.js";

export function setupFollowsPanel() {
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
    ok($("#folStatus"), "Follows refreshed from storage.");
  });

  $("#fetchFollows")?.addEventListener("click", async () => {
    const mode = $("#fetchMode")?.value || "active";
    note($("#folStatus"), "Fetching follows...");

    const resp = await rpc("TTM_FETCH_FOLLOWS", { mode });
    if (!resp?.ok) {
      err($("#folStatus"), resp?.error || "Fetch follows failed.");
      return;
    }

    const follows = uniqNames(resp.usernames || []);
    if (folTA()) folTA().value = follows.join("\n");
    ok($("#folStatus"), `Fetched ${follows.length} follows into editor. Save to apply.`);
  });

  $("#forcePoll")?.addEventListener("click", async () => {
    const resp = await rpc("ttm/force_poll");
    if (resp?.ok) ok($("#folStatus"), "Force poll sent.");
    else err($("#folStatus"), resp?.error || "Force poll failed.");
  });

  $("#reloadConfig")?.addEventListener("click", async () => {
    const resp = await rpc("ttm/reload_config");
    if (resp?.ok) ok($("#folStatus"), "Reloaded config in background.");
    else err($("#folStatus"), resp?.error || "Reload failed.");
  });
}

export function setupPriorityEditor() {
  $("#prioritySave")?.addEventListener("click", async () => {
    try {
      const bag = await readStorage();
      const cfg = getStoredConfig(bag);
      const follows = uniqNames((folTA()?.value || "").split("\n"));
      const priority = uniqNames(($("#priorityBox")?.value || "").split("\n"));

      const clean = await writeConfigEverywhere(clampConfig({
        ...cfg,
        follows,
        priority,
        followUnion: uniqNames([...follows, ...priority])
      }));

      if ($("#priorityBox")) $("#priorityBox").value = clean.priority.join("\n");
      if ($("#cfg")) $("#cfg").value = JSON.stringify(clean, null, 2);
      ok($("#folStatus"), "Priority saved.");
    } catch (e) {
      err($("#folStatus"), `Priority save failed: ${e.message || e}`);
    }
  });
}