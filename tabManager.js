// Lightweight helpers for UI or future modules.
// Background service worker does the heavy lifting.

export function forcePoll() {
  return new Promise(resolve => {
    chrome.runtime.sendMessage({ type: "TTM_FORCE_POLL" }, res => resolve(!!(res && res.ok)));
  });
}

export function reloadConfig() {
  return new Promise(resolve => {
    chrome.runtime.sendMessage({ type: "TTM_RELOAD_CONFIG" }, res => resolve(!!(res && res.ok)));
  });
}

export function toggleBot() {
  return new Promise(resolve => {
    chrome.runtime.sendMessage({ type: "TOGGLE_BOT" }, res => resolve(res?.enabled));
  });
}

export function getEnabled() {
  return new Promise(resolve => {
    chrome.storage.local.get("enabled", d => resolve(d.enabled !== false));
  });
}
