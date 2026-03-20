import { $, format, ok, err, rpc } from "./core.js";

export function setupDebugPanel() {
  const out = $("#dbgOut");
  const btnRun = $("#dbgRun");
  const btnCopy = $("#dbgCopy");
  const btnClear = $("#dbgClear");
  const dbgOpen = $("#dbgOpen");

  const setOut = (text) => {
    if (out) out.value = text || "";
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
}