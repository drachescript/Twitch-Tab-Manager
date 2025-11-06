// content_unmute.js 
(() => {
  const JITTER = () => 300 + Math.floor(Math.random() * 450);
  let tries = 0, maxTries = 12, done = false;

  const q = (sel, root = document) => {
    try { return root.querySelector(sel); } catch { return null; }
  };

  function findVideo() {
    const v = q('video');
    if (v) return v;
    const roots = document.querySelectorAll(
      '[data-a-target="player-overlay-root"], .video-player, .persistent-player'
    );
    for (const r of roots) {
      const nv = r.querySelector?.('video');
      if (nv) return nv;
    }
    return null;
  }

  function tryUiUnmute() {
    const btn = q('button[data-a-target="player-mute-unmute-button"]');
    if (!btn) return false;
    try { btn.click(); return true; } catch { return false; }
  }

  function onVisibleOnce(fn) {
    const h = () => { document.removeEventListener('visibilitychange', h); setTimeout(fn, JITTER()); };
    document.addEventListener('visibilitychange', h);
  }

  async function unmuteIfSafe(video) {
    // If already playing & unmuted, we’re done
    if (!video.paused && !video.muted) { done = true; return; }

    // If the tab is hidden, defer any UI interaction to avoid autoplay NotAllowed
    if (document.visibilityState !== 'visible') { onVisibleOnce(tick); return; }

    // First, try Twitch’s own UI toggle (harmless if already unmuted)
    tryUiUnmute();

    // Clear muted flags gently; don’t force play here
    try { video.muted = false; video.removeAttribute('muted'); } catch {}

    // If volume is zero, nudge slightly (keeps it quiet but audible)
    if (typeof video.volume === 'number' && video.volume === 0) {
      try { video.volume = 0.2; } catch {}
    }

    // If it’s already playing, avoid calling play() to prevent the warning
    if (!video.paused) { done = !video.muted; return; }

    // If paused, *only* attempt play when visible (we are), wrapped in try/catch
    try {
      const p = video.play?.();
      if (p && typeof p.then === 'function') await p;
    } catch {
      // Don’t loop on NotAllowed; wait for next visibility change/user gesture
      onVisibleOnce(tick);
      return;
    }
    done = !video.muted;
  }

  function tick() {
    if (done) return;
    if (tries++ > maxTries) return;

    const video = findVideo();
    if (!video) { setTimeout(tick, JITTER()); return; }

    unmuteIfSafe(video);
    if (!done) setTimeout(tick, JITTER());
  }

  setTimeout(tick, JITTER());
})();
