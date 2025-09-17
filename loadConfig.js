// Returns config + follows array with sane defaults.
export async function loadConfig() {
  const def = {
    force_unmute: true,
    force_resume: true,
    check_interval_sec: 60,
    unmute_streams: true,
    max_tabs: 8,
    blacklist: []
  };

  const cfg = await fetch(chrome.runtime.getURL("config.json")).then(r => r.json()).catch(() => ({}));
  const follows = await fetch(chrome.runtime.getURL("follows.txt"))
    .then(r => r.text()).then(t => t.split("\n").map(s => s.trim().toLowerCase()).filter(Boolean))
    .catch(() => []);

  return { ...def, ...cfg, follows };
}
