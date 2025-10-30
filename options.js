// options.js — default-preserving saves + existing UI wiring
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

const ok = (el,msg)=>{ if(!el) return; el.textContent=msg; el.className="status ok"; setTimeout(()=>{el.textContent=""; el.className="status";},2200); };
const err = (el,msg)=>{ if(!el) return; el.textContent=msg; el.className="status err"; setTimeout(()=>{el.textContent=""; el.className="status";},3200); };

async function packagedCfg(){ try{ return await fetch(chrome.runtime.getURL("config.json")).then(r=>r.json()); }catch{ return {}; } }
async function packagedFollows(){ try{ const t=await fetch(chrome.runtime.getURL("follows.txt")).then(r=>r.text()); return t.split("\n").map(s=>s.trim().toLowerCase()).filter(Boolean);}catch{ return []; } }

const CFG_DEFAULT = {
  force_unmute: true,
  force_resume: true,
  check_interval_sec: 60,
  unmute_streams: true,
  max_tabs: 8,
  blacklist: [],
  live_source: "auto"
};

function mergeDefaults(j){ return { ...CFG_DEFAULT, ...(j||{}) }; }

async function loadUI(){
  const s = await new Promise(r=>chrome.storage.local.get(["config","follows"],r));
  const cfg = mergeDefaults(s.config ?? await packagedCfg());
  cfgTA.value = JSON.stringify(cfg, null, 2);
  folTA.value = (s.follows ?? await packagedFollows()).join("\n");
}
await loadUI();

// config save/apply/export/import
$("#saveCfg").addEventListener("click", async ()=>{
  try{ const j=mergeDefaults(JSON.parse(cfgTA.value)); await chrome.storage.local.set({config:j}); ok(cfgStatus,"Saved."); }
  catch{ err(cfgStatus,"Invalid JSON."); }
});
$("#applyReload").addEventListener("click", async ()=>{
  try{
    const j=mergeDefaults(JSON.parse(cfgTA.value));
    await chrome.storage.local.set({config:j});
    chrome.runtime.sendMessage({type:"TTM_RELOAD_CONFIG"}, ()=>ok(cfgStatus,"Applied & reloaded."));
  } catch{ err(cfgStatus,"Invalid JSON."); }
});

const dl=(n,c,t)=>{ const u=URL.createObjectURL(new Blob([c],{type:t})); chrome.downloads?.download
  ? chrome.downloads.download({url:u,filename:n,saveAs:true},()=>URL.revokeObjectURL(u))
  : (()=>{ const a=document.createElement("a"); a.href=u; a.download=n; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(u); })();
};
$("#exportCfg").addEventListener("click",()=>dl("config.json",cfgTA.value,"application/json"));
$("#exportFol").addEventListener("click",()=>dl("follows.txt",folTA.value,"text/plain"));

const fileCfg=$("#fileCfg"), fileFol=$("#fileFol");
const readText=f=>new Promise((res,rej)=>{ const fr=new FileReader(); fr.onload=()=>res(String(fr.result||"")); fr.onerror=()=>rej(fr.error||new Error()); fr.readAsText(f); });
$("#importCfg").addEventListener("click",()=>fileCfg.click());
$("#importFol").addEventListener("click",()=>fileFol.click());
fileCfg.addEventListener("change", async e=>{
  try{ const f=e.target.files?.[0]; if(!f) return; const j=mergeDefaults(JSON.parse(await readText(f)));
       cfgTA.value=JSON.stringify(j,null,2); await chrome.storage.local.set({config:j}); ok(cfgStatus,"Imported + saved."); }
  catch{ err(cfgStatus,"Import failed/invalid."); } fileCfg.value="";
});
fileFol.addEventListener("change", async e=>{
  try{ const f=e.target.files?.[0]; if(!f) return; const t=(await readText(f)).replace(/\r\n/g,"\n");
       const lines=t.split("\n").map(s=>s.trim().toLowerCase()).filter(Boolean);
       folTA.value=lines.join("\n"); await chrome.storage.local.set({follows:lines}); ok(folStatus,"Imported + saved."); }
  catch{ err(folStatus,"Import failed."); } fileFol.value="";
});

// follows save
$("#saveFol").addEventListener("click", async ()=>{
  const lines=folTA.value.split("\n").map(s=>s.trim().toLowerCase()).filter((v,i,a)=>v && a.indexOf(v)===i);
  await chrome.storage.local.set({follows:lines.sort()}); ok(folStatus,"Saved.");
});

// Fetch My Follows
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
$("#refreshCfg").addEventListener("click",async()=>{ const s=await new Promise(r=>chrome.storage.local.get(["config"],r)); cfgTA.value=JSON.stringify(mergeDefaults(s.config??{}),null,2); ok(cfgStatus,"Refreshed."); });
$("#refreshFol").addEventListener("click",async()=>{ const s=await new Promise(r=>chrome.storage.local.get(["follows"],r)); folTA.value=(s.follows??[]).join("\n"); ok(folStatus,"Refreshed."); });

// -------- Token snippet helpers (kept from your file) --------
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
$response | Format-List
# Copy the "access_token" from $response.access_token and paste it into config.json`;
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

$("#btnApplyToken")?.addEventListener("click", ()=>{
  try { const j = mergeDefaults(JSON.parse(cfgTA.value || "{}"));
        const tok = ($("#tok")?.value || "").trim(); if (tok) j.access_token = tok;
        cfgTA.value = JSON.stringify(j, null, 2); ok(cfgStatus, "Token inserted into config JSON."); }
  catch { err(cfgStatus, "Config JSON is invalid."); }
});
function copyTA(el){ el.select(); document.execCommand("copy"); el.blur(); }
$("#btnCopyPS1")?.addEventListener("click", ()=>copyTA(ps1Out));
$("#btnCopyCurl")?.addEventListener("click", ()=>copyTA(curlOut));
$("#btnApplyCIDToCfg")?.addEventListener("click", ()=>{
  try{ const j = mergeDefaults(JSON.parse(cfgTA.value || "{}"));
       const id = (cid?.value || "").trim(); if (id) j.client_id = id;
       cfgTA.value = JSON.stringify(j, null, 2); ok(cfgStatus, "Client ID inserted into config JSON."); }
  catch{ err(cfgStatus, "Config JSON is invalid."); }
});
