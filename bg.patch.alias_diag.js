// bg.patch.alias_diag.js

// Accept every legacy/alias message type.
const TTM_ALIAS = new Map([
  ['ttm/ping','ping'], ['ttm/enable','toggle'], ['ttm/reload_config','reload'], ['ttm/force_poll','force'], ['ttm/diagnose','diag'],
  ['TTM_PING','ping'], ['TTM_TOGGLE','toggle'], ['TTM_RELOAD_CONFIG','reload'], ['TTM_FORCE_POLL','force'], ['TTM_DIAGNOSE','diag'], ['TTM_DIAG','diag'],
  ['PING','ping'], ['TOGGLE','toggle'], ['RELOAD_CONFIG','reload'], ['FORCE_POLL','force'], ['DIAGNOSE','diag']
]);
function aliasKind(t){ return TTM_ALIAS.get(String(t||'').trim()) || String(t||'').trim().toLowerCase(); }

// Redact arrays → counts only (keeps tokens masked).
function redactForDiag(s) {
  const r = { ...(s||{}) };
  if (r.access_token) r.access_token = '***';
  if (r.client_id)    r.client_id = '***';
  const follows_count     = Array.isArray(r.follows) ? r.follows.length : 0;
  const priority_count    = Array.isArray(r.priority) ? r.priority.length : 0;
  const followUnion_count = Array.isArray(r.followUnion) ? r.followUnion.length : 0;
  delete r.follows; delete r.priority; delete r.followUnion;
  r.follows_count = follows_count;
  r.priority_count = priority_count;
  r.followUnion_count = followUnion_count;
  return r;
}

if (!globalThis.__ttm_patch_alias_diag) {
  globalThis.__ttm_patch_alias_diag = true;

  chrome.runtime.onMessage.addListener((msg, _sender, send) => {
    (async () => {
      const kind = aliasKind(msg?.type);

      if (kind === 'force') {
        // Use your existing poll()
        try { await poll({ force: true }); } catch(e) { /* swallow */ }
        send({ ok: true });
        return;
      }
      if (kind === 'diag') {
        const s = (globalThis.state?.settings) || {};
        const res = {
          ok: true,
          settings: redactForDiag(s),
          live_count: Array.isArray(globalThis.state?.lastLive) ? globalThis.state.lastLive.length : 0,
          open_count: Array.isArray(globalThis.state?.openChannels) ? globalThis.state.openChannels.length : 0,
          capacity: Math.max(0, Number(s.max_tabs||0) - (globalThis.state?.openChannels?.length||0)),
          logs: (globalThis.state?.logs||[]).slice(-12),
        };
        send(res);
        return;
      }
    })().catch(e => send({ ok:false, error:String(e) }));

    return true; // async
  });
}
