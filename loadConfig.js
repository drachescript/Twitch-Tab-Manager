// loadConfig.js
export async function loadConfig() {
  const DEF = {
    force_unmute: true,
    force_resume: true,
    check_interval_sec: 60,
    unmute_streams: true,
    max_tabs: 8,
    blacklist: [],
    // New: select live source. "auto" tries helix, falls back to following_html.
    live_source: "auto"
  };

  const store = await new Promise(r => chrome.storage.local.get(["config", "follows"], r));

  const packagedCfg = await fetch(chrome.runtime.getURL("config.json"))
    .then(r => r.json()).catch(() => ({}));

  const packagedFollows = await fetch(chrome.runtime.getURL("follows.txt"))
    .then(r => r.text())
    .then(t => t.split("\n").map(s => s.trim().toLowerCase()).filter(Boolean))
    .catch(() => []);

  const cfg = { ...DEF, ...packagedCfg, ...(store.config || {}) };
  const follows = Array.isArray(store.follows) ? store.follows : packagedFollows;

  // Guards
  if (typeof cfg.check_interval_sec !== "number" || cfg.check_interval_sec < 10) cfg.check_interval_sec = 60;
  if (typeof cfg.max_tabs !== "number" || cfg.max_tabs < 1) cfg.max_tabs = 8;
  if (!Array.isArray(cfg.blacklist)) cfg.blacklist = [];
  if (!["auto","helix","following_html"].includes((cfg.live_source||"").toLowerCase())) cfg.live_source = "auto";

  return { ...cfg, follows };
}
