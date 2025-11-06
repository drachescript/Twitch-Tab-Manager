// popup.js
const $ = (s) => document.querySelector(s);
const on = (el, ev, fn) => el && el.addEventListener(ev, fn);

const elToggle  = $('#toggleManager');
const elStatus  = $('#statusText');
const elNext    = $('#nextCheck');
const btnForce  = $('#btnForce');
const btnReload = $('#btnReload');
const btnOpts   = $('#btnOptions');
const btnDiag   = $('#btnDiag');
const prioArea  = $('#priority-area');

const rpc = (type, payload={}) => new Promise((resolve)=> {
  try { chrome.runtime.sendMessage({ type, ...payload }, (r)=>resolve(r||{})); } catch { resolve({}); }
});

async function pingStatus() {
  const r = await rpc('TTM_STATUS');
  if (r && 'enabled' in r) return r;
  const local = await chrome.storage.local.get(['enabled']);
  return { enabled: !!local.enabled, next_check_sec: 60 };
}
// popup.js — handshake helpers (no removals needed)
async function bgPing() {
  try {
    const r = await chrome.runtime.sendMessage({ type: 'TTM_PING' });
    return r || { alive: false };
  } catch {
    return { alive: false };
  }
}

async function bgToggle() {
  try {
    const r = await chrome.runtime.sendMessage({ type: 'TTM_TOGGLE' });
    return r || { ok: false };
  } catch {
    return { ok: false };
  }
}

async function forcePoll() {
  try {
    const r = await chrome.runtime.sendMessage({ type: 'TTM_FORCE_POLL' });
    return r || { ok: false };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

let tickTimer = null;
function setCountdown(sec) {
  if (!elNext) return;
  if (tickTimer) clearInterval(tickTimer);
  let left = Math.max(0, sec|0);
  elNext.textContent = left ? `• Next check in ${left}s` : '';
  tickTimer = setInterval(()=> {
    left = Math.max(0, left - 1);
    elNext.textContent = left ? `• Next check in ${left}s` : '';
  }, 1000);
}

function twitchLoginFrom(urlStr) {
  try {
    const u = new URL(urlStr);
    if (!/(\.|^)twitch\.tv$/i.test(u.hostname)) return null;
    const p = u.pathname.replace(/^\/+/, '');
    const a = p.split('/');
    if ((a[0] || '').toLowerCase() === 'moderator') return (a[1] || '').toLowerCase() || null;
    const head = (a[0] || '').toLowerCase();
    if (/^(directory|videos|settings|subscriptions|inventory|drops|friends|rules|jobs|prime|search|turbo|about|profile)$/i.test(head)) return null;
    return head || null;
  } catch { return null; }
}

async function renderPriorityHelper() {
  if (!prioArea) return;
  prioArea.innerHTML = '';
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const login = tab ? twitchLoginFrom(tab.url || '') : null;
  if (!login) return;
  const wrap = document.createElement('div');
  wrap.innerHTML = `
    <div style="display:flex;gap:8px;align-items:center;">
      <span>Priority for <strong>${login}</strong>:</span>
      <button id="btnAddPrio">Add</button>
      <button id="btnRemPrio">Remove</button>
    </div>`;
  prioArea.appendChild(wrap);
  on($('#btnAddPrio'), 'click', async ()=>{ await rpc('ADD_PRIORITY', { channel: login }); wrap.remove(); await renderPriorityHelper(); });
  on($('#btnRemPrio'), 'click', async ()=>{ await rpc('REMOVE_PRIORITY', { channel: login }); wrap.remove(); await renderPriorityHelper(); });
}

async function renderStatus() {
  const s = await pingStatus();
  if (elStatus) elStatus.innerHTML = `Extension is <strong>${s.enabled ? 'on' : 'off'}</strong>`;
  if (elToggle) elToggle.checked = !!s.enabled;
  setCountdown(s.next_check_sec ?? 0);
}

on(elToggle,  'change', async ()=>{ await chrome.storage.local.set({ enabled: !!elToggle.checked }); renderStatus(); });
on(btnForce,  'click',  async ()=>{ if(elStatus) elStatus.innerHTML='Polling…'; await rpc('TTM_FORCE_POLL'); await rpc('FORCE_POLL'); await renderStatus(); });
on(btnReload, 'click',  async ()=>{ await rpc('TTM_RELOAD_CONFIG'); await rpc('RELOAD_CONFIG'); await renderStatus(); });
on(btnOpts,   'click',  ()=>{ try { chrome.runtime.openOptionsPage(); } catch {} });
on(btnDiag,   'click',  async ()=>{
  const d = await rpc('TTM_DIAG'); const s = d?.settings ?? {};
  const txt = [
    '=== DIAGNOSTICS ===',
    JSON.stringify({
      ok:true,
      settings:{
        live_source:s.live_source,
        max_tabs:s.max_tabs,
        follows_count:s.follows_count??0,
        priority_count:s.priority_count??0,
        followUnion_count:s.followUnion_count??0
      },
      live_count:d?.live_count??0,
      open_count:d?.open_count??0,
      capacity:d?.capacity??0
    }, null, 2),
    '\n=== LOGS ===',
    JSON.stringify(d?.logs ?? [], null, 2)
  ].join('\n');
  alert(txt); // quick copy-friendly; we can add a “Copy” button later
});

(async function init(){ await renderStatus(); await renderPriorityHelper(); setInterval(renderStatus, 1000); })();
