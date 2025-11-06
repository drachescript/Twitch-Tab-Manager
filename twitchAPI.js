// twitchAPI.js
import { loadConfig } from "./loadConfig.js";

// Helix check; returns array of login names currently live.
export async function checkStreamers(streamers) {
  const cfg = await loadConfig();
  const { access_token, client_id } = cfg;
  if (!access_token || !client_id || !streamers?.length) return [];

  const qs = streamers.map(u => `user_login=${encodeURIComponent(u)}`).join("&");
  try {
    const res = await fetch(`https://api.twitch.tv/helix/streams?${qs}`, {
      headers: { "Client-ID": client_id, "Authorization": `Bearer ${access_token}` }
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.data || []).map(s => (s.user_login || "").toLowerCase()).filter(Boolean);
  } catch { return []; }
}

export async function helixGetLiveByLogins(logins, { client_id, access_token }) {
  const users = Array.from(new Set(
    (logins || []).map(s => (s || '').toLowerCase().trim()).filter(Boolean)
  ));
  if (!client_id || !access_token || users.length === 0) {
    throw new Error('helix.misconfig');
  }

  const headers = {
    'Client-ID': client_id,
    'Authorization': `Bearer ${access_token}`,
  };

  const chunks = [];
  for (let i = 0; i < users.length; i += 100) chunks.push(users.slice(i, i + 100));

  const live = [];
  for (const batch of chunks) {
    const qs = batch.map(u => 'user_login=' + encodeURIComponent(u)).join('&');
    const url = `https://api.twitch.tv/helix/streams?${qs}`;
    const r = await fetch(url, { headers });
    if (!r.ok) {
      const body = await r.text().catch(() => '');
      if (r.status === 400 || r.status === 422) {
        throw new Error(`helix 400 ${body || ''}`.trim());
      }
      console.warn('[TTM] Helix batch failed', r.status, body);
      continue;
    }
    const j = await r.json().catch(() => ({ data: [] }));
    for (const s of (j.data || [])) {
      if (s?.user_login) live.push(String(s.user_login).toLowerCase());
    }
  }

  return Array.from(new Set(live));
}
