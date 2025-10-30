// popup.js — wired to popup.html ids: toggleManager, statusText, btnPoll, btnReload, btnOptions

document.addEventListener("DOMContentLoaded", () => {
  const $ = (s) => document.querySelector(s);

  const toggle     = $("#toggleManager");
  const statusText = $("#statusText");
  const btnPoll    = $("#btnPoll");
  const btnReload  = $("#btnReload");
  const btnOptions = $("#btnOptions");

  // render helpers
  const setStatus = (state = {}) => {
    const on  = !!state.enabled;
    const eta = typeof state.nextPollInSec === "number" ? ` • Next check in ${Math.max(0, state.nextPollInSec)}s` : "";
    if (toggle) toggle.checked = on;
    if (statusText) statusText.innerHTML = `Extension is <strong>${on ? "on" : "off"}</strong>${eta}`;
  };

  // ask background for a status snapshot
  const queryStatus = () =>
    new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ type: "TTM_STATUS" }, (resp) => resolve(resp || {}));
      } catch {
        resolve({});
      }
    });

  // init from storage + background status
  const init = async () => {
    try {
      const { enabled } = await chrome.storage.local.get("enabled");
      setStatus({ enabled: enabled !== false });
      const snap = await queryStatus();
      if (snap && snap.ok) setStatus(snap);
    } catch {
      setStatus({ enabled: true });
    }
  };

  // event wiring
  if (toggle) {
    toggle.addEventListener("change", () => {
      try {
        chrome.runtime.sendMessage({ type: "TOGGLE_BOT" }, (resp) => {
          if (resp && resp.ok) {
            setStatus(resp);
          } else {
            // revert UI if background rejected
            toggle.checked = !toggle.checked;
          }
        });
      } catch {
        toggle.checked = !toggle.checked;
      }
    });
  }

  if (btnPoll) {
    btnPoll.addEventListener("click", () => {
      btnPoll.disabled = true;
      try {
        chrome.runtime.sendMessage({ type: "TTM_FORCE_POLL" }, async () => {
          const snap = await queryStatus();
          setStatus(snap && snap.ok ? snap : undefined);
          btnPoll.disabled = false;
        });
      } catch {
        btnPoll.disabled = false;
      }
    });
  }

  if (btnReload) {
    btnReload.addEventListener("click", () => {
      btnReload.disabled = true;
      try {
        chrome.runtime.sendMessage({ type: "TTM_RELOAD_CONFIG" }, async () => {
          const snap = await queryStatus();
          setStatus(snap && snap.ok ? snap : undefined);
          btnReload.disabled = false;
        });
      } catch {
        btnReload.disabled = false;
      }
    });
  }

  if (btnOptions) {
    btnOptions.addEventListener("click", () => {
      try { chrome.runtime.openOptionsPage(); } catch {}
    });
  }

  // live status ticker (1s)
  let tmr = null;
  const startTicker = () => {
    if (tmr) clearInterval(tmr);
    tmr = setInterval(async () => {
      const snap = await queryStatus();
      if (snap && snap.ok) setStatus(snap);
    }, 1000);
  };

  init().then(startTicker);
});
