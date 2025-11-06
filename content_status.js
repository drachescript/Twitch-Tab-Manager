// content_status.js
(function(){
  const login = location.pathname.replace(/^\/+/, '').split('/')[0]?.toLowerCase() || '';

  function hasTextOffline(n){
    if (!n) return false;
    const t = (n.textContent || '').trim().toLowerCase();
    return /\boffline\b/.test(t);
  }

  function isOfflineNow(){
    // Common offline markers seen on channel home when not live:
    //  - <strong>Offline</strong> inside channel-status-info--offline
    //  - "OFFLINE" card on the media card stat
    //  - No live-indicator anywhere
    const m1 = document.querySelector('.channel-status-info--offline strong');
    const m2 = document.querySelector('.ScMediaCardStatWrapper-sc-anph5i-0, .tw-media-card-stat');
    const liveDot = document.querySelector('[data-a-target="stream-live-indicator"], .live-time, .tw-indicator-live');

    if (m1 && hasTextOffline(m1)) return true;
    if (m2 && hasTextOffline(m2)) return true;

    // If there is a clear live indicator, treat as online.
    if (liveDot) return false;

    // Fallback heuristic: presence of “home-carousel-info … Offline”
    const anyOfflineWord = Array.from(document.querySelectorAll('strong,div,span'))
      .some(el => hasTextOffline(el));
    return anyOfflineWord;
  }

  let lastFlag = null;
  function ping(){
    const flag = isOfflineNow();
    if (flag !== lastFlag) {
      lastFlag = flag;
      try {
        chrome.runtime.sendMessage({ type:'channel_status', login, isOffline: !!flag }, ()=>{});
      } catch {}
    }
  }

  // Observe DOM for changes in status elements
  const obs = new MutationObserver(() => ping());
  obs.observe(document.documentElement, { subtree:true, childList:true, characterData:true });

  // periodic backup
  setInterval(ping, 5000);
  // initial
  ping();
})();
