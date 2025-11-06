// background.js
import { state, DEFAULTS, readAll, saveSettings, armAlarm, log, diagnose,
         setOpenChannels, setLastLive, getSettings } from "./bg.core.js";
import * as Live from "./bg.live.js";   // keep your existing file
import * as Tabs from "./bg.tabs.js";   // keep your existing file

// ---- bootstrap ----
(async function init() {
  await readAll();
  if (state.settings.enabled) await armAlarm();
  log("boot", { enabled: state.settings.enabled, everySec: state.settings.check_interval_sec });
})();

// ---- runtime messaging ----
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      switch (msg?.type) {
        case "ttm/ping": {
          // popup heartbeat
          sendResponse({
            alive: true,
            enabled: !!state.settings.enabled,
            next_check_sec: Math.max(0, Math.floor((state.nextCheckAt - Date.now()) / 1000))
          });
          return;
        }
        case "ttm/enable": {
          const enabled = !!msg.enabled;
          await saveSettings({ enabled });
          if (enabled) await armAlarm(); else await chrome.alarms.clear("ttm-tick");
          sendResponse({ ok: true, enabled });
          log("toggle", { enabled });
          return;
        }
        case "ttm/reload_config": {
          await readAll();
          if (state.settings.enabled) await armAlarm();
          sendResponse({ ok: true, everySec: state.settings.check_interval_sec });
          log("reload_config", { everySec: state.settings.check_interval_sec });
          return;
        }
        case "ttm/force_poll": {
          const out = await doPoll(true);
          sendResponse({ ok: true, ...out });
          return;
        }
        case "ttm/diagnose": {
          sendResponse(await diagnose());
          return;
        }
        case "ttm/save_priority": {
          const list = (msg.list || []).map(s => String(s || "").toLowerCase()).filter(Boolean);
          await saveSettings({ priority: Array.from(new Set(list)) });
          sendResponse({ ok: true, count: state.settings.priority.length });
          log("priority_saved", { count: state.settings.priority.length });
          return;
        }
        default:
          // allow other modules to hook if they exported onMessage
          if (typeof Live.onMessage === "function") {
            const r = await Live.onMessage(msg, _sender);
            if (r !== undefined) { sendResponse(r); return; }
          }
          if (typeof Tabs.onMessage === "function") {
            const r = await Tabs.onMessage(msg, _sender);
            if (r !== undefined) { sendResponse(r); return; }
          }
          sendResponse({ ok: false, error: "unknown_message" });
      }
    } catch (e) {
      log("bg_onMessage_error", String(e && e.stack || e));
      sendResponse({ ok: false, error: "exception" });
    }
  })();
  // keep channel alive for async
  return true;
});

// ---- alarms → periodic poll ----
chrome.alarms.onAlarm.addListener(async (a) => {
  if (a?.name !== "ttm-tick") return;
  if (!state.settings.enabled) return;
  await doPoll(false);
});

async function doPoll(force) {
  try {
    log("poll_start", { mode: state.settings.live_source || "auto", enabled: !!state.settings.enabled, force: !!force });

    // 1) ask Live module to resolve live channels (it should already implement: helix→gql→html)
    //    Pass only the redaction-safe pieces the module needs.
    const settings = getSettings();
    const live = await (Live.getLive
      ? Live.getLive(settings, log)     // preferred — if your bg.live.js exports getLive()
      : Live.default?.(settings, log)); // fallback if it default-exports

    if (Array.isArray(live)) {
      setLastLive(live);
      log(live.helixError ? "live_helix_error" : "live_result", {
        count: live.length || 0,
        source: live.source || (settings.live_source || "auto")
      });
    } else {
      setLastLive([]);
      log("live_result", { count: 0, source: settings.live_source || "auto" });
    }

    // 2) hand over to Tabs module to reconcile open tabs (respect max_tabs + priority)
    //    Tabs module should return { opened:[..], kept:[..], closed:[..], openNowCount: n }
    const tabReport = await (Tabs.reconcile
      ? Tabs.reconcile(getSettings(), state.lastLive, log)
      : Tabs.default?.(getSettings(), state.lastLive, log));

    if (tabReport && Array.isArray(tabReport.openChannels)) {
      setOpenChannels(tabReport.openChannels);
    }
    log("capacity", { open: state.openChannels.length, max: getSettings().max_tabs });

    // 3) re-arm countdown UX
    await armAlarm();

    return {
      live_count: state.lastLive.length,
      open_count: state.openChannels.length
    };
  } catch (e) {
    log("poll_error", String(e && e.stack || e));
    return { live_count: 0, open_count: state.openChannels.length, error: "poll_error" };
  }
}
