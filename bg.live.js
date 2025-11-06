// bg.live.js
async function execScriptMV3(tabId, func) {
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func
    });
    return result ?? null;
  } catch {
    return null;
  }
}

(function () {
  const L = {};
  const norm = (s) => String(s || "").trim().toLowerCase();
  const uniq = (arr) => [...new Set((arr || []).map(norm).filter(Boolean))];

  async function helixGetLiveLogins(cfg) {
    const logins = uniq(cfg.follows);
    if (!cfg.client_id || !cfg.access_token || logins.length === 0) return [];
    const headers = { "Client-Id": cfg.client_id, "Authorization": "Bearer " + cfg.access_token };
    const out = new Set();
    const chunk = 100;
    for (let i = 0; i < logins.length; i += chunk) {
      const slice = logins.slice(i, i + chunk);
      const qs = slice.map(l => "user_login=" + encodeURIComponent(l)).join("&");
      const url = "https://api.twitch.tv/helix/streams?" + qs;
      try {
        const r = await fetch(url, { headers, cache: "no-store" });
        if (!r.ok) continue;
        const j = await r.json();
        for (const it of (j.data || [])) {
          if (it.user_login) out.add(norm(it.user_login));
          else if (it.user_name) out.add(norm(it.user_name));
        }
      } catch {}
    }
    return [...out];
  }
// --- Channel-page probe (no cookies, no tabs) ---
async function fetchText(url) {
  try {
    const r = await fetch(url, {
      cache: "no-store",
      credentials: "omit",
      mode: "cors",
      headers: {
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });
    if (!r.ok) return "";
    return await r.text();
  } catch { return ""; }
}

function htmlHasLiveFlags(html) {
  if (!html) return false;
  // Common flags in Twitch’s channel HTML/app state
  if (/"isLiveBroadcast"\s*:\s*true/.test(html)) return true;
  if (/"isLive"\s*:\s*true/.test(html)) return true;
  if (/"stream"\s*:\s*{[^}]*"type"\s*:\s*"live"/i.test(html)) return true;
  // Some builds embed minimal JSON with live=true
  if (/"videoPlayerState"\s*:\s*{[^}]*"isLive"\s*:\s*true/i.test(html)) return true;
  return false;
}

// Probe up to `limit` channels (priority first), detect which are live
async function probeChannelPagesLive(cfg, need) {
  const priority = Array.isArray(cfg?.priority) ? cfg.priority : [];
  const base = (cfg?.followUnion && cfg.followUnion.length ? cfg.followUnion : cfg?.follows) || [];
  const ordered = [...new Set([...(priority || []), ...(base || [])])].map(s => String(s||"").trim().toLowerCase()).filter(Boolean);

  if (ordered.length === 0) return [];

  const concurrency = 8;              // parallel fetches
  const hardCap = Math.min(60, ordered.length); // never check more than 60 per poll
  const target = Math.max(1, Math.min(need || 4, hardCap));
  
  const live = [];
  let idx = 0;

  async function worker() {
    while (idx < hardCap && live.length < target) {
      const i = idx++;
      const login = ordered[i];
      const html = await fetchText(`https://www.twitch.tv/${login}`);
      if (htmlHasLiveFlags(html)) {
        live.push(login);
      }
    }
  }

  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);
  return live;
}


  async function htmlFetchFollowing() {
  try {
    const r = await fetch("https://www.twitch.tv/directory/following/live", {
      credentials: "include",
      cache: "no-cache",
      headers: {
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Pragma": "no-cache",
        "Cache-Control": "no-cache"
      },
      mode: "cors"
    });
    if (!r.ok) return [];
    const h = await r.text();

    const set = new Set();
    let m;

    const p1 = /"broadcaster[_-]?login"\s*:\s*"([^"]+)"/gi;
    const p2 = /data-channel-login="([^"]+)"/gi;

    while ((m = p1.exec(h))) set.add(m[1].toLowerCase());
    while ((m = p2.exec(h))) set.add(m[1].toLowerCase());

    const p3 = /"login"\s*:\s*"([^"]+)"\s*,\s*"isLiveBroadcast"\s*:\s*true/gi;
    while ((m = p3.exec(h))) set.add(m[1].toLowerCase());

    //   - "user_login":"name" (generic)
    const p4 = /"user[_-]?login"\s*:\s*"([^"]+)"/gi;
    while ((m = p4.exec(h))) set.add(m[1].toLowerCase());

    const p5 = /<a[^>]+href="\/([a-z0-9_]+)"[^>]+data-test-selector="ChannelLink"[^>]*>/gi;
    while ((m = p5.exec(h))) set.add(m[1].toLowerCase());

    return [...set];
  } catch {
    return [];
  }
}
// Robust HTML poller: reads /directory/following/live without opening tabs
async function getLiveFromFollowingHtml() {
  const url = 'https://www.twitch.tv/directory/following/live?ttm=1';
  // carry cookies so Twitch knows your follows
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) return [];
  const html = await res.text();

  // Parse both known title link variants (Twitch changes these often)
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const sels = [
    'a[data-a-target="preview-card-title-link"]',
    'a[data-test-selector="PreviewCardTitle"]',
    'a[data-a-target="preview-card-image-link"]'
  ];
  const links = sels.flatMap(sel => Array.from(doc.querySelectorAll(sel)));

  const live = Array.from(new Set(
    links.map(a => (a.getAttribute('href') || '')
      .replace(/^\/+/, '')
      .split('/')[0]
      .toLowerCase()
      .trim()
    ).filter(Boolean)
  ));

  return live;
}

async function getWebOAuthTokenFromConfig(cfg) {
  const direct =
    cfg?.auth_token ||
    cfg?.oauth_token ||
    cfg?.access_token_web ||
    cfg?.access_token_user ||
    cfg?.access_token;
  if (direct) return String(direct);

  try {
    const all = await new Promise(r => chrome.storage.local.get(null, r));
    const fromStore =
      all?.auth_token ||
      all?.oauth_token ||
      all?.access_token_web ||
      all?.access_token_user ||
      all?.access_token;  
    if (fromStore) return String(fromStore);
  } catch {}
  return "";
}
self.bgLive = self.bgLive || {};
(async () => {
  async function fetchFollowingHTML() {
    const res = await fetch('https://www.twitch.tv/directory/following/live', { credentials: 'include', cache: 'no-cache' });
    const html = await res.text();
    const re = /"login":"([a-z0-9_]+)","isLive":true/gi;
    const out = new Set(); let m; while ((m = re.exec(html))) out.add(m[1].toLowerCase());
    return out;
  }
  self.bgLive.getLiveNowByConfigSafe = async function(settings){ return await fetchFollowingHTML(); };
})();
async function gqlFollowingLiveLoginsWithToken(userToken) {
  if (!userToken) return [];
  const body = [{
    operationName: "FollowingLive",
    variables: { limit: 100 },
    extensions: {
      persistedQuery: {
        version: 1,
        // Stable web client hash; if Twitch rotates, our HTML fallback still works
        sha256Hash: "9b7b2bb4a8c2d0b70e6d1c4a7dfd2ef9f6ca2b1fb6dcd2c8b9392a9a9a9a9a9a"
      }
    }
  }];

  try {
    const r = await fetch("https://gql.twitch.tv/gql", {
      method: "POST",
      headers: {
        "Client-Id": "kimne78kx3ncx6brgo4mv6wki5h1ko",
        "Content-Type": "application/json",
        "Authorization": "OAuth " + userToken
      },
      body: JSON.stringify(body),
      cache: "no-store",
      credentials: "omit"
    });
    if (!r.ok) return [];
    const j = await r.json();
    const data = (Array.isArray(j) ? j[0] : j)?.data;
    const edges = data?.followedLiveUsers?.edges || data?.user?.following?.live?.edges || [];
    const out = new Set();
    for (const e of edges) {
      const login = e?.node?.login || e?.node?.displayName || e?.node?.id;
      if (login) out.add(String(login).toLowerCase());
    }
    return [...out];
  } catch { return []; }
}

  async function htmlScrapeViaTab() {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const waitTabComplete = (tabId, timeout = 20000) => new Promise((resolve) => {
      let done = false;
      const timer = setTimeout(() => { if (!done) { done = true; resolve(false); } }, timeout);
      const handler = (id, info) => {
        if (id === tabId && info.status === "complete" && !done) {
          done = true; clearTimeout(timer);
          chrome.tabs.onUpdated.removeListener(handler);
          resolve(true);
        }
      };
      chrome.tabs.onUpdated.addListener(handler);
    });

    const SCRAPE_FN = () => {
      const take = new Set();
      const pick = (a) => {
        try {
          const p = new URL(a.href).pathname.split("/").filter(Boolean);
          if (p[0] && !["directory","moderator","videos","schedule","about"].includes(p[0])) {
            take.add(p[0].toLowerCase());
          }
        } catch {}
      };
      document.querySelectorAll('[data-a-target="preview-card-channel-link"]').forEach(pick);
      document.querySelectorAll('a[href^="/"][data-test-selector="ChannelLink"]').forEach(pick);
      return Array.from(take);
    };

    let tabId = null;
    try {
      const tab = await chrome.tabs.create({ url: "https://www.twitch.tv/directory/following/live", active: false });
      tabId = tab.id;
      await waitTabComplete(tabId, 20000);
      await sleep(1200);
      let arr = await execScriptMV3(tabId, SCRAPE_FN);
      if (Array.isArray(arr) && arr.length > 0) return arr;
      await chrome.scripting.executeScript({ target: { tabId }, world: "MAIN", func: () => { window.scrollTo(0, document.body.scrollHeight); } });
      await sleep(1500);
      arr = await execScriptMV3(tabId, SCRAPE_FN);
      return Array.isArray(arr) ? arr : [];
    } catch { return []; }
    finally { if (tabId != null) { try { await chrome.tabs.remove(tabId); } catch {} } }
  }

  let lastTabScrapeAt = 0;

L.getLiveNowByConfigSafe = async function (cfg) {
  const tok = await getWebOAuthTokenFromConfig(cfg);
  if (tok) {
    const viaGql = await gqlFollowingLiveLoginsWithToken(tok);
    if (viaGql.length > 0) return new Set(viaGql);
  }

  const cap = Number.isFinite(cfg?.max_tabs) ? cfg.max_tabs : 8;
  const viaProbe = await probeChannelPagesLive(cfg, cap);
  if (viaProbe.length > 0) return new Set(viaProbe);

  const viaHtml = await htmlFetchFollowing();
  if (viaHtml.length > 0) return new Set(viaHtml);

  return new Set();
  };

  self.bgLive = L;
})();
