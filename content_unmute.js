(() => {
  if (window.__TTM_PLAYER_HELPER__) return;
  window.__TTM_PLAYER_HELPER__ = true;

  const $ = (sel) => document.querySelector(sel);

  const state = {
    settings: {
      force_unmute: false,
      unmute_streams: false,
      force_resume: false,
      autoplay_streams: false
    },
    loopStarted: false,
    lastStatusSentAt: 0
  };

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function isOnChannelPage() {
    try {
      const url = new URL(location.href);
      if (url.hostname !== "www.twitch.tv") return false;

      const first = url.pathname.split("/").filter(Boolean)[0] || "";
      const blocked = new Set([
        "directory",
        "p",
        "videos",
        "friends",
        "inventory",
        "drops",
        "settings",
        "messages",
        "login",
        "logout",
        "downloads",
        "moderator"
      ]);

      return !!first && !blocked.has(first);
    } catch {
      return false;
    }
  }

  function isAdPlaying() {
    return !!(
      document.querySelector('[data-test-selector="ad-banner-default-text"]') ||
      document.querySelector('[data-a-player-state="advertising"]')
    );
  }

  function getVideo() {
    return $("video");
  }

  function getMuteButton() {
    return $('[data-a-target="player-mute-unmute-button"]');
  }

  function getPlayButton() {
    return $('[data-a-target="player-play-pause-button"]');
  }

  function getChannelLogin() {
    try {
      const url = new URL(location.href);
      return (url.pathname.split("/").filter(Boolean)[0] || "").toLowerCase();
    } catch {
      return "";
    }
  }

  function canSafelyForceUnmute() {
    return !document.hidden && document.hasFocus();
  }

  async function clickUnmuteIfNeeded() {
    const btn = getMuteButton();
    if (!btn) return false;

    const label = btn.getAttribute("aria-label") || "";
    if (/unmute/i.test(label)) {
      btn.click();
      return true;
    }

    return false;
  }

  async function clickPlayIfNeeded() {
    const btn = getPlayButton();
    if (!btn) return false;

    const label = btn.getAttribute("aria-label") || "";
    if (/play/i.test(label)) {
      btn.click();
      return true;
    }

    return false;
  }

  function collectStatus() {
    const video = getVideo();
    const ad = isAdPlaying();

    return {
      login: getChannelLogin(),
      url: location.href,
      hasVideo: !!video,
      paused: !!video?.paused,
      muted: !!video?.muted,
      volume: typeof video?.volume === "number" ? video.volume : null,
      adPlaying: ad,
      visible: !document.hidden,
      focused: document.hasFocus()
    };
  }

  function shouldSendStatus(force = false) {
    const now = Date.now();

    if (force) {
      state.lastStatusSentAt = now;
      return true;
    }

    if (now - state.lastStatusSentAt >= 5000) {
      state.lastStatusSentAt = now;
      return true;
    }

    return false;
  }

  async function sendStatus(force = false) {
    if (!isOnChannelPage()) return;
    if (!shouldSendStatus(force)) return;

    try {
      chrome.runtime.sendMessage({
        type: "TTM_PLAYER_STATUS",
        ...collectStatus()
      }, () => {});
    } catch {}
  }

  async function enforceOnce() {
    if (!isOnChannelPage()) return;

    if (isAdPlaying()) {
      await sendStatus();
      return;
    }

    const opts = state.settings || {};
    const video = getVideo();

    if (opts.force_unmute || opts.unmute_streams) {
      await clickUnmuteIfNeeded();

      // Do not force video.muted = false in a background tab.
      // Chrome can treat that like autoplay-with-sound and pause playback.
      if (video && canSafelyForceUnmute()) {
        try {
          video.muted = false;
        } catch {}
      }
    }

    if (opts.force_resume || opts.autoplay_streams) {
      await clickPlayIfNeeded();

      if (video?.paused) {
        try {
          await video.play();
        } catch {}
      }
    }

    await sendStatus();
  }

  async function startLoop() {
    if (state.loopStarted) return;
    state.loopStarted = true;

    while (true) {
      try {
        await enforceOnce();
      } catch {}
      await wait(2500);
    }
  }

  document.addEventListener("visibilitychange", () => {
    enforceOnce().catch(() => {});
  });

  window.addEventListener("focus", () => {
    enforceOnce().catch(() => {});
  });

  window.addEventListener("pageshow", () => {
    enforceOnce().catch(() => {});
  });

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === "TTM_ENFORCE" && msg?.settings) {
      state.settings = { ...state.settings, ...msg.settings };
      enforceOnce().catch(() => {});
      startLoop().catch(() => {});
      sendResponse?.({ ok: true });
      return true;
    }

    if (msg?.type === "TTM_ENFORCE_NOW") {
      enforceOnce().catch(() => {});
      sendResponse?.({ ok: true });
      return true;
    }

    if (msg?.type === "TTM_GET_PLAYER_STATUS") {
      sendResponse?.({ ok: true, ...collectStatus() });
      return true;
    }
  });

  startLoop().catch(() => {});
})();