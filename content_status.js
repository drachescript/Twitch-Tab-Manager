(() => {
  if (window.__TTM_STATUS_LOADED__) return;
  window.__TTM_STATUS_LOADED__ = true;

  const login = location.pathname.replace(/^\/+/, "").split("/")[0]?.toLowerCase() || "";

  function hasOfflineText(node) {
    if (!node) return false;
    const text = (node.textContent || "").trim().toLowerCase();
    return /\boffline\b/.test(text);
  }

  function isOfflineNow() {
    const offlineBadge = document.querySelector(".channel-status-info--offline strong");
    const cardStat = document.querySelector(".ScMediaCardStatWrapper-sc-anph5i-0, .tw-media-card-stat");
    const liveBadge = document.querySelector('[data-a-target="stream-live-indicator"], .live-time, .tw-indicator-live');

    if (offlineBadge && hasOfflineText(offlineBadge)) return true;
    if (cardStat && hasOfflineText(cardStat)) return true;
    if (liveBadge) return false;

    return Array.from(document.querySelectorAll("strong, div, span")).some(hasOfflineText);
  }

  function hasRaidText(text) {
    const value = String(text || "").toLowerCase();
    return (
      value.includes("being raided by") ||
      value.includes("join raid") ||
      value.includes("leave raid") ||
      value.includes("starting raid")
    );
  }

  function detectRaid() {
    const raidBanner =
      document.querySelector('[data-a-target="raid-banner"]') ||
      document.querySelector('[data-test-selector="raid-banner"]') ||
      document.querySelector(".raid-banner");

    const leaveButton =
      document.querySelector('button[data-a-target="raid-leave-button"]') ||
      Array.from(document.querySelectorAll("button")).find((btn) => hasRaidText(btn.textContent));

    if (raidBanner || leaveButton) return true;

    return Array.from(document.querySelectorAll("div, span, strong")).some((el) => hasRaidText(el.textContent));
  }

  let lastOffline = null;
  let raidSent = false;

  function send(type, payload) {
    try {
      chrome.runtime.sendMessage({ type, login, ...(payload || {}) }, () => {});
    } catch {}
  }

  function check() {
    const offline = isOfflineNow();

    if (offline !== lastOffline) {
      lastOffline = offline;
      send("channel_status", { isOffline: !!offline });
    }

    if (!raidSent && detectRaid()) {
      raidSent = true;
      send("raid_detected");
    }
  }

  const obs = new MutationObserver(() => check());
  obs.observe(document.documentElement, {
    subtree: true,
    childList: true,
    characterData: true
  });

  setInterval(check, 5000);
  check();
})();