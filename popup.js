// popup.js — Twitch Tab Manager (matches popup.html IDs)

const elToggle  = document.getElementById('toggleManager');
const elStatus  = document.getElementById('statusText');
const elPoll    = document.getElementById('btnPoll');
const elReload  = document.getElementById('btnReload');
const elOptions = document.getElementById('btnOptions');
const elDiag    = document.getElementById('btnDiag');

function setBusy(b) {
  for (const btn of [elPoll, elReload, elOptions, elDiag]) if (btn) btn.disabled = !!b;
  if (elToggle) elToggle.disabled = !!b;
}

function statusLine(enabled) {
  return `Extension is <strong>${enabled ? 'on' : 'off'}</strong>`;
}

async function send(type, extra = {}) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type, ...extra }, (resp) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message });
      } else {
        resolve(resp || { ok: false, error: 'no_response' });
      }
    });
  });
}

async function ping() {
  // background accepts several aliases; use canonical
  return await send('ttm/ping');
}

async function refreshUI() {
  const s = await ping();
  const alive = !!(s && (s.ok || s.alive));
  const enabled = !!(s && (s.enabled ?? false));

  if (elToggle) elToggle.checked = enabled;
  if (elStatus) elStatus.innerHTML = statusLine(enabled);

  // If BG not alive yet, keep buttons guarded
  setBusy(!alive);
  return { alive, enabled };
}

async function toggle() {
  setBusy(true);
  const on = !!elToggle?.checked;
  const resp = await send('ttm/enable', { enabled: on });
  await refreshUI();
  if (!resp?.ok) console.warn('[TTM] toggle failed:', resp);
  setBusy(false);
}

async function forcePoll() {
  setBusy(true);
  const r = await send('ttm/force_poll');
  if (!r?.ok) console.warn('[TTM] force_poll failed:', r);
  setBusy(false);
}

async function reloadCfg() {
  setBusy(true);
  const r = await send('ttm/reload_config');
  if (!r?.ok) console.warn('[TTM] reload_config failed:', r);
  await refreshUI();
  setBusy(false);
}

async function diagnose() {
  setBusy(true);
  const r = await send('ttm/diagnose');
  setBusy(false);
  // Privacy: the BG already redacts; show a compact toast-ish alert
  if (r?.ok) {
    console.log('[TTM] DIAGNOSTICS', r);
    alert('Diagnostics copied to console.');
  } else {
    alert('Diagnostics failed: ' + (r?.error || 'unknown'));
  }
}

function openOptions() {
  if (chrome.runtime.openOptionsPage) chrome.runtime.openOptionsPage();
  else window.open('options.html', '_blank');
}

// Wire up
if (elToggle)  elToggle.addEventListener('change', toggle);
if (elPoll)    elPoll.addEventListener('click', forcePoll);
if (elReload)  elReload.addEventListener('click', reloadCfg);
if (elOptions) elOptions.addEventListener('click', openOptions);
if (elDiag)    elDiag.addEventListener('click', diagnose);

// Initial draw
refreshUI();
