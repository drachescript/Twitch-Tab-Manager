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
