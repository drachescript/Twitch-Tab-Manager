// content_unmute.js (autoplay NotAllowedError safe handling)

(() => {
  const JITTER = () => 300 + Math.floor(Math.random() * 450);
  let tries = 0, maxTries = 12, done = false;

  function q(sel, root = document) { try { return root.querySelector(sel); } catch { return null; } }

  function findVideo() {
    // native <video>
    const v = q('video');
    if (v) return v;

    // Twitch sometimes nests shadow DOM; quick scan of known roots
    const roots = document.querySelectorAll('[data-a-target="player-overlay-root"], .video-player, .persistent-player');
    for (const r of roots) {
      const nv = r.querySelector?.('video');
      if (nv) return nv;
    }
    return null;
  }

  function tryUiUnmute() {
    // Best-effort click on Twitch’s own mute button (safe if present)
    const btn = q('button[data-a-target="player-mute-unmute-button"]');
    if (!btn) return false;
    try { btn.click(); return true; } catch { return false; }
  }

  function canRetryLater() {
    // Defer until the tab is visible; this usually clears the autoplay gate
    if (document.visibilityState === 'visible') return false;
    const onVis = () => {
      document.removeEventListener('visibilitychange', onVis);
      setTimeout(tick, JITTER());
    };
    document.addEventListener('visibilitychange', onVis);
    return true;
  }

  async function unmutePlay(video) {
    try { video.muted = false; video.removeAttribute('muted'); } catch {}
    if (typeof video.volume === 'number' && video.volume === 0) {
      try { video.volume = 0.2; } catch {}
    }
    // If already playing & unmuted, we’re done
    if (!video.paused && !video.muted) { done = true; return; }

    try {
      const p = video.play?.();
      if (p && typeof p.then === 'function') await p;
      done = !video.muted;
    } catch (e) {
      // NotAllowedError → wait for visibility or do a soft UI click + backoff
      if (String(e?.name || e).includes('NotAllowed') || String(e?.message || '').includes('user didn\'t interact')) {
        // Try UI mute toggle once (harmless if blocked)
        tryUiUnmute();
        if (!canRetryLater()) setTimeout(tick, JITTER());
        return;
      }
      // Other errors → soft retry
      setTimeout(tick, JITTER());
    }
  }

  function tick() {
    if (done) return;
    if (tries++ > maxTries) return;

    const video = findVideo();
    if (!video) { setTimeout(tick, JITTER()); return; }

    // Some pages load the player muted; poke UI first, then play
    tryUiUnmute();
    unmutePlay(video);
  }

  // Start after a tiny delay to let the player mount
  setTimeout(tick, JITTER());
})();
