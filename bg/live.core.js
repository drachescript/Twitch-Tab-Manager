// bg.live.core.js
(() => { const T = (globalThis.TTM = globalThis.TTM || {}); 

async function liveFromHelix(list){
  const s=T.state.settings; if(!s.client_id || !s.access_token || !list.length) return [];
  try{
    const chunk=100, out=[];
    for(let i=0;i<list.length;i+=chunk){
      const q=list.slice(i,i+chunk).map(u=>`user_login=${encodeURIComponent(u)}`).join('&');
      const r=await fetch(`https://api.twitch.tv/helix/streams?${q}`,{
        headers:{'Client-ID':s.client_id,'Authorization':`Bearer ${s.access_token}`}
      });
      if(!r.ok) throw new Error('helix '+r.status);
      const json=await r.json(); json.data?.forEach(d=>out.push(d.user_login.toLowerCase()));
    }
    return [...new Set(out)];
  }catch(e){ T.log('live_helix_error',String(e)); return []; }
}

async function liveFromHTML(list){
  // very light fallback: query following page and grep channels
  try{
    const r=await fetch('https://www.twitch.tv/directory/following/live',{cache:'no-cache'});
    const ht=await r.text(); const seen=new Set(); 
    for(const u of list){ if(new RegExp(`"/${u}"`).test(ht)) seen.add(u); }
    T.log('live_result_html',{count:seen.size}); return [...seen];
  }catch{ T.log('live_result_html',{count:0}); return []; }
}

T.poll ??= async ({force}={})=>{
  const s=T.state.settings; if(!s.enabled && !force) return;
  const all = s.followUnion?.filter(ch=>!s.blacklist?.includes(ch)) || [];
  const live = (await liveFromHelix(all)).length? await liveFromHelix(all) : await liveFromHTML(all);
  T.log('live_result',{ count:live.length, source: (s.client_id&&s.access_token)?'helix':'html' });

  // reconcile
  const open = await T.listOpenTabs();
  const openByCh = new Map(open.map(t=>[T.channelFromUrl(t.url||''), t]).filter(([c])=>c));

  // open up to capacity; never close non-managed
  const managedOpen = open.filter(t=>T.isManaged(t));
  const capacity = Math.max(0, s.max_tabs - managedOpen.length);
  T.log('capacity',{ open: managedOpen.length, max:s.max_tabs });

  // open priority first
  const want = [...(s.priority||[]), ...all.filter(c=>!(s.priority||[]).includes(c))];
  const targets = want.filter(c=>live.includes(c) && !openByCh.has(c)).slice(0, capacity);
  for (const ch of targets) await T.openChannel(ch,{via:'manager'});

  // gentle close: only our managed tabs, only if channel not live for >90s
  const now=Date.now();
  for(const t of managedOpen){
    const ch=T.channelFromUrl(t.url||''); if(!ch) continue;
    if (live.includes(ch)) { T.state.lastSeen.set(ch, now); continue; }
    const last=T.state.lastSeen.get(ch)||0;
    if (now - last > 90_000) await T.closeTabSafe(t.id,'closed non-live >90s');
  }
};

})();
