// options.js 
const $ = s => document.querySelector(s);
const cfgTA = $("#cfg"), folTA = $("#fol");
const cfgStatus = $("#cfgStatus"), folStatus = $("#folStatus");

// tabs
document.querySelectorAll(".tab").forEach(t => {
  t.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(x => x.classList.remove("active"));
    document.querySelectorAll(".panel").forEach(x => x.classList.remove("active"));
    t.classList.add("active");
    document.getElementById("panel-" + t.dataset.tab).classList.add("active");
  });
});

const ok = (el,msg)=>{ if(!el) return; el.textContent=msg; el.className="status ok";
  setTimeout(()=>{el.textContent=""; el.className="status";},2200); };
const err = (el,msg)=>{ if(!el) return; el.textContent=msg; el.className="status err";
  setTimeout(()=>{el.textContent=""; el.className="status";},3200); };

// packaged fallbacks (only used for "Reset to Packaged")
async function packagedCfg(){ try{ return await fetch(chrome.runtime.getURL("config.json")).then(r=>r.json()); }catch{ return {}; } }
async function packagedFollows(){ try{ const t=await fetch(chrome.runtime.getURL("follows.txt")).then(r=>r.text());
  return t.split("\n").map(s=>s.trim().toLowerCase()).filter(Boolean);}catch{ return []; } }

// keep your existing keys; allow space for newer ones
const CFG_DEFAULT = {
  live_source: "auto",
  client_id: "",
  access_token: "",
  force_unmute: true,
  unmute_streams: true,
  force_resume: true,
  autoplay_streams: false,
  check_interval_sec: 60,
  max_tabs: 8,
  blacklist: []
};

function mergeDefaults(j){ return { ...CFG_DEFAULT, ...(j||{}) }; }

// Load UI from storage (prefer top-level; fallback to nested config)
async function loadUI(){
  const s = await new Promise(r => chrome.storage.local.get(null, r));
  const cfg = mergeDefaults(s.config ?? s); // textarea shows what you'll save
  cfgTA.value = JSON.stringify(cfg, null, 2);
  const follows = Array.isArray(s.follows) ? s.follows : await packagedFollows();
  folTA.value = follows.join("\n");
}
await loadUI();

// Write BOTH: top-level keys (background consumes) AND nested {config: ...} for UI/compat
async function writeConfigBoth(j){
  const flat = mergeDefaults(j);
  await chrome.storage.local.set({ ...flat, config: flat });
}

// config save / apply & reload
$("#saveCfg").addEventListener("click", async ()=>{
  try{
    const j = JSON.parse(cfgTA.value);
    await writeConfigBoth(j);
    ok(cfgStatus,"Saved.");
  } catch{ err(cfgStatus,"Invalid JSON."); }
});

$("#applyReload").addEventListener("click", async ()=>{
  try{
    const j = JSON.parse(cfgTA.value);
    await writeConfigBoth(j);
    chrome.runtime.sendMessage({type:"TTM_RELOAD_CONFIG"}, ()=>ok(cfgStatus,"Applied & reloaded."));
  } catch{ err(cfgStatus,"Invalid JSON."); }
});

// export
const dl=(n,c,t)=>{ const u=URL.createObjectURL(new Blob([c],{type:t}));
  if (chrome.downloads?.download) chrome.downloads.download({url:u,filename:n,saveAs:true},()=>URL.revokeObjectURL(u));
  else { const a=document.createElement("a"); a.href=u; a.download=n; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(u); }
};
$("#exportCfg").addEventListener("click",()=>dl("config.json",cfgTA.value,"application/json"));
$("#exportFol").addEventListener("click",()=>dl("follows.txt",folTA.value,"text/plain"));
// import
const fileCfg=$("#fileCfg"), fileFol=$("#fileFol");
const readText=f=>new Promise((res,rej)=>{ const fr=new FileReader();
  fr.onload=()=>res(String(fr.result||"")); fr.onerror=()=>rej(fr.error||new Error()); fr.readAsText(f); });
$("#importCfg").addEventListener("click",()=>fileCfg.click());
$("#importFol").addEventListener("click",()=>fileFol.click());

fileCfg.addEventListener("change", async e=>{
  try{
    const f=e.target.files?.[0]; if(!f) return;
    const j=mergeDefaults(JSON.parse(await readText(f)));
    cfgTA.value=JSON.stringify(j,null,2);
    await writeConfigBoth(j);
    ok(cfgStatus,"Imported + saved.");
  } catch{ err(cfgStatus,"Import failed/invalid."); }
  fileCfg.value="";
});

fileFol.addEventListener("change", async e=>{
  try{
    const f=e.target.files?.[0]; if(!f) return;
    const t=(await readText(f)).replace(/\r\n/g,"\n");
    const lines=t.split("\n").map(s=>s.trim().toLowerCase()).filter(Boolean);
    folTA.value=lines.join("\n");
    await chrome.storage.local.set({follows:lines});
    ok(folStatus,"Imported + saved.");
  } catch{ err(folStatus,"Import failed."); }
  fileFol.value="";
});

// follows save
$("#saveFol").addEventListener("click", async ()=>{
  const lines=folTA.value.split("\n").map(s=>s.trim().toLowerCase())
    .filter((v,i,a)=>v && a.indexOf(v)===i);
  await chrome.storage.local.set({follows:lines.sort()});
  ok(folStatus,"Saved.");
});

// Fetch My Follows (background must handle TTM_FETCH_FOLLOWS)
$("#fetchFollows").addEventListener("click", ()=>{
  const btn = $("#fetchFollows");
  const mode = $("#fetchMode").value || "active";
  btn.disabled = true;
  chrome.runtime.sendMessage({ type: "TTM_FETCH_FOLLOWS", mode }, (resp)=>{
    btn.disabled = false;
    if (!resp || !resp.ok) { err(folStatus,"Fetch failed."); return; }
    const list = (resp.usernames || []).map(s=>s.toLowerCase()).filter(Boolean).sort();
    folTA.value = list.join("\n");
    chrome.storage.local.set({ follows: list });
    ok(folStatus, `Fetched ${list.length} usernames.`);
  });
});

// quick actions
$("#forcePoll").addEventListener("click",()=>chrome.runtime.sendMessage({type:"TTM_FORCE_POLL"},()=>{}));
$("#reloadConfig").addEventListener("click",()=>chrome.runtime.sendMessage({type:"TTM_RELOAD_CONFIG"},()=>{}));
$("#refreshCfg").addEventListener("click",async()=>{
  const s=await new Promise(r=>chrome.storage.local.get(null,r));
  const cfg = mergeDefaults(s.config ?? s);
  cfgTA.value=JSON.stringify(cfg,null,2);
  ok(cfgStatus,"Refreshed.");
});
$("#refreshFol").addEventListener("click",async()=>{
  const s=await new Promise(r=>chrome.storage.local.get(["follows"],r));
  folTA.value=(s.follows??[]).join("\n");
  ok(folStatus,"Refreshed.");
});

// NEW: Reset to Packaged (wires buttons present in HTML)
$("#resetCfg").addEventListener("click", async ()=>{
  const base = mergeDefaults(await packagedCfg());
  cfgTA.value = JSON.stringify(base, null, 2);
  await writeConfigBoth(base);
  ok(cfgStatus,"Reset to packaged & saved.");
});
$("#resetFol").addEventListener("click", async ()=>{
  const base = await packagedFollows();
  folTA.value = base.join("\n");
  await chrome.storage.local.set({ follows: base });
  ok(folStatus,"Reset to packaged & saved.");
});

// -------- Token snippet helpers (kept) --------
const cid = $("#cid"), cs = $("#csecret"), ps1Out = $("#ps1Out"), curlOut = $("#curlOut");
function buildPS1(id, secret){
  return `$client_id = "${id}"
$client_secret = "${secret}"
$body = @{
  client_id     = $client_id
  client_secret = $client_secret
  grant_type    = "client_credentials"
}
$response = Invoke-RestMethod -Method Post -Uri "https://id.twitch.tv/oauth2/token" -Body $body
$response | Format-List`;
}
function buildCurl(id, secret){
  return `curl -X POST "https://id.twitch.tv/oauth2/token" \
  -d "client_id=${id}" \
  -d "client_secret=${secret}" \
  -d "grant_type=client_credentials"`;
}
function renderSnips(){
  const id = (cid?.value || "").trim();
  const sec = (cs?.value || "").trim();
  ps1Out.value = buildPS1(id || "YOUR_CLIENT_ID_HERE", sec || "YOUR_CLIENT_SECRET_HERE");
  curlOut.value = buildCurl(id || "YOUR_CLIENT_ID_HERE", sec || "YOUR_CLIENT_SECRET_HERE");
}
cid?.addEventListener("input", renderSnips);
cs?.addEventListener("input", renderSnips);
renderSnips();

function rpc(type, payload={}) {
  return new Promise(res=>{
    try {
      chrome.runtime.sendMessage({ type, ...payload }, (r)=>{
        if (chrome.runtime.lastError) return res({ ok:false, error:chrome.runtime.lastError.message });
        res(r||{ok:true});
      });
    } catch(e){ res({ ok:false, error:String(e) }); }
  });
}
document.getElementById('btnForcePoll')?.addEventListener('click', async ()=>{
  await rpc('TTM_FORCE_POLL'); // bypasses enabled guard
});
document.getElementById('btnReloadCfg')?.addEventListener('click', async ()=>{
  await rpc('TTM_RELOAD_CONFIG');
});

// Priority editor (kept)
(function setupPriorityUI(){
  const box = document.getElementById("priorityBox");
  const save = document.getElementById("prioritySave");
  if (!box || !save) return;
  chrome.storage.local.get("priority",(o)=>{
    const arr = Array.isArray(o.priority) ? o.priority : [];
    box.value = arr.join("\n");
  });
  save.addEventListener("click", ()=>{
    const arr = box.value.split("\n").map(s=>s.trim().toLowerCase()).filter(Boolean);
    chrome.storage.local.set({ priority: [...new Set(arr)] });
  });
})();
// options.js (Debug tab)
(function debugPanel(){
  const out = document.getElementById("dbgOut");
  const btnRun = document.getElementById("dbgRun");
  const btnCopy = document.getElementById("dbgCopy");
  const btnClear = document.getElementById("dbgClear");
  const btnOpen = document.getElementById("dbgOpen");
  const inpChan = document.getElementById("dbgChannel");
  const rpc = (type, payload={}) => new Promise(r=>chrome.runtime.sendMessage({type, ...payload}, x=>r(x||{})));

  function format(obj){ try{ return JSON.stringify(obj, null, 2); } catch{ return String(obj); } }
  function append(text){ out.value = text; out.scrollTop = out.scrollHeight; }

  btnRun?.addEventListener("click", async ()=>{
    btnRun.disabled = true;
    const diag = await rpc("TTM_DIAG");
    const logs = await rpc("TTM_GET_LOGS");
    append(`=== DIAGNOSTICS ===\n${format(diag)}\n\n=== LOGS ===\n${format(logs.logs||[])}`);
    btnRun.disabled = false;
  });
  document.getElementById('btnFetchFollows')?.addEventListener('click', async ()=>{
  const r = await rpc('TTM_HELIX_FETCH_FOLLOWS');
  if (!r?.ok) { alert('Fetch failed: ' + (r?.error||'unknown')); return; }
  const ta = document.getElementById('followsText'); // your textarea id
  if (ta) ta.value = r.follows.join('\n');
  });

  btnCopy?.addEventListener("click", async ()=>{
    try{ await navigator.clipboard.writeText(out.value || ""); }catch{}
  });

  btnClear?.addEventListener("click", async ()=>{
    await rpc("TTM_CLEAR_LOGS");
    append("");
  });

  btnOpen?.addEventListener("click", async ()=>{
    const ch = (inpChan?.value||"").trim().toLowerCase();
    if (!ch) return;
    const res = await rpc("TTM_OPEN_CHANNEL", { channel: ch });
    append((out.value||"") + `\n\nOpen test for "${ch}": ${res?.ok ? "ok" : "failed"}`);
  });
})();
