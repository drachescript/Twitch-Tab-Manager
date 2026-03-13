document.addEventListener("DOMContentLoaded", () => {
  const elToggle = document.getElementById("toggle") || document.getElementById("toggleManager");
  const elStatus = document.getElementById("statusText") || document.getElementById("status") || document.getElementById("stateText");
  const btnPoll = document.getElementById("btnPoll") || document.getElementById("btnForcePoll");
  const btnReload = document.getElementById("btnReload") || document.getElementById("btnReloadConfig");
  const btnOptions = document.getElementById("btnOptions") || document.getElementById("btnOpenOptions");
  const btnDiag = document.getElementById("btnDiag");

  function setBusy(busy) {
    if (elToggle) elToggle.disabled = !!busy;
    if (btnPoll) btnPoll.disabled = !!busy;
    if (btnReload) btnReload.disabled = !!busy;
    if (btnDiag) btnDiag.disabled = !!busy;
  }

  function setStatusText(enabled) {
    if (!elStatus) return;
    const on = enabled !== false;
    elStatus.innerHTML = `Extension is <strong>${on ? "on" : "off"}</strong>`;
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

  async function readEnabledFallback() {
    try {
      const got = await chrome.storage.local.get(["settings", "config", "enabled"]);
      const fromSettings = got?.settings?.enabled;
      const fromConfig = got?.config?.enabled;

      if (fromSettings === true || fromSettings === false) return fromSettings;
      if (fromConfig === true || fromConfig === false) return fromConfig;
      if (got?.enabled === true || got?.enabled === false) return got.enabled;
    } catch {}
    return true;
  }

  async function refreshUI() {
    setBusy(true);

    const resp = (await send("ttm/ping")) || (await send("PING")) || (await send("TTM_STATUS"));
    let enabled = resp && typeof resp.enabled === "boolean" ? resp.enabled : await readEnabledFallback();

    if (elToggle) elToggle.checked = enabled !== false;
    setStatusText(enabled);

    setBusy(false);
  }

  async function onToggleChanged() {
    if (!elToggle) return;
    setBusy(true);

    const enabled = !!elToggle.checked;
    const resp = await send("ttm/enable", { enabled });

    if (!resp?.ok) {
      elToggle.checked = !enabled;
    }

    await refreshUI();
    setBusy(false);
  }

  if (elToggle) elToggle.addEventListener("change", onToggleChanged);

  btnPoll?.addEventListener("click", async () => {
    setBusy(true);
    await send("ttm/force_poll");
    await refreshUI();
    setBusy(false);
  });

  btnReload?.addEventListener("click", async () => {
    setBusy(true);
    await send("ttm/reload_config");
    await refreshUI();
    setBusy(false);
  });

  btnOptions?.addEventListener("click", () => {
    try {
      chrome.runtime.openOptionsPage();
    } catch {}
  });

  btnDiag?.addEventListener("click", async () => {
    setBusy(true);
    const diag = await send("ttm/diagnose");
    setBusy(false);

    if (!diag) {
      alert("Diagnostics failed.");
      return;
    }

    const shortText = JSON.stringify(diag, null, 2);
    try {
      await navigator.clipboard.writeText(shortText);
      alert("Diagnostics copied to clipboard.");
    } catch {
      alert(shortText);
    }
  });

  refreshUI();
});