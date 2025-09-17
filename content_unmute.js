(() => {
  const start = Date.now();
  const deadlineMs = 30000; // keep trying for up to 30s
  let tries = 0;

  function tryFix() {
    const video = document.querySelector("video");
    if (video) {
      // resume
      if (video.paused) {
        video.play().catch(() => {});
      }
      // unmute (also clear muted attr if present)
      if (video.muted || video.getAttribute("muted") !== null) {
        try { video.muted = false; video.removeAttribute("muted"); } catch {}
      }
      // sanity: if volume is zero, bump it a bit
      if (typeof video.volume === "number" && video.volume === 0) {
        try { video.volume = 0.2; } catch {}
      }
      // if we got here and it's playing or unmuted, we can stop early
      if (!video.paused && !video.muted) return;
    }

    tries++;
    if (Date.now() - start < deadlineMs) {
      setTimeout(tryFix, Math.min(2000, 250 + tries * 150));
    }
  }

  // small randomized delay so we don't look robotic
  setTimeout(tryFix, 400 + Math.floor(Math.random() * 600));
})();
