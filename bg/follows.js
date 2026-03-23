import { log } from "./core.js";
import { uniqNames } from "./config.js";

const T = (globalThis.TTM = globalThis.TTM || {});

async function fetchFollowLoginsFromPage(tabId) {
  const [{ result } = {}] = await chrome.scripting.executeScript({
    target: { tabId },
    func: async () => {
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const normalizeName = (value) => String(value || "").trim().toLowerCase();

      const getFollowedCards = () => {
        const out = new Set();

        const cardLinks = Array.from(
          document.querySelectorAll(
            'main a[href^="/"], section a[href^="/"], [data-a-target="user-card-modal"] a[href^="/"]'
          )
        );

        for (const link of cardLinks) {
          const href = link.getAttribute("href") || "";
          if (!href.startsWith("/")) continue;

          const parts = href.split("?")[0].split("#")[0].split("/").filter(Boolean);
          const first = normalizeName(parts[0]);
          if (!first) continue;
          if (!/^[a-z0-9_]+$/.test(first)) continue;

          const card =
            link.closest('[data-a-target="user-card-modal"]') ||
            link.closest(".user-card") ||
            link.closest('[class*="channel-follow-listing"]');

          if (!card) continue;

          const unfollowBtn = card.querySelector('[data-a-target="unfollow-button"]');
          if (!unfollowBtn) continue;

          out.add(first);
        }

        return [...out];
      };

      const clickShowMore = () => {
        const buttons = Array.from(document.querySelectorAll("button, a"));
        let clicked = false;

        for (const el of buttons) {
          const text = (el.textContent || "").trim().toLowerCase();
          const target = el.getAttribute("data-a-target") || "";
          const inSidebar = !!el.closest('[data-test-selector="side-nav"]');

          if (inSidebar) continue;

          if (
            target === "side-nav-show-more-button" ||
            target === "side-nav-show-more" ||
            text !== "show more"
          ) {
            continue;
          }

          el.click();
          clicked = true;
        }

        return clicked;
      };

      const scroller =
        document.querySelector('[data-a-target="root-scroller"]') ||
        document.scrollingElement ||
        document.documentElement;

      let best = [];
      let stablePasses = 0;

      for (let i = 0; i < 20; i += 1) {
        const beforeCount = getFollowedCards().length;
        const clicked = clickShowMore();

        scroller.scrollTo({
          top: scroller.scrollHeight,
          behavior: "instant"
        });

        await sleep(clicked ? 1800 : 1400);

        const after = getFollowedCards();
        if (after.length > best.length) best = after;

        if (after.length <= beforeCount) stablePasses += 1;
        else stablePasses = 0;

        if (stablePasses >= 3 && !clicked) break;
      }

      scroller.scrollTo({ top: 0, behavior: "instant" });
      await sleep(250);

      return best;
    }
  });

  return uniqNames(result || []);
}

async function waitForFollowingPage(tabId, timeoutMs = 30000) {
  return await new Promise((resolve) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      resolve(false);
    }, timeoutMs);

    function onUpdated(id, info, tab) {
      if (id !== tabId) return;
      const url = tab?.url || tab?.pendingUrl || "";
      if (info.status !== "complete") return;
      if (!/\/directory\/following\/channels/i.test(url)) return;

      clearTimeout(timeout);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      resolve(true);
    }

    chrome.tabs.onUpdated.addListener(onUpdated);
  });
}

async function getActiveCurrentWindowTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

async function fetchMyFollows(mode = "active") {
  let tabId = null;
  let createdTab = false;
  let restoredOriginalUrl = false;
  let originalUrl = "";
  let usedCurrentTab = false;

  try {
    const targetUrl = "https://www.twitch.tv/directory/following/channels";

    if (mode === "current") {
      const activeTab = await getActiveCurrentWindowTab();
      const currentUrl = activeTab?.url || activeTab?.pendingUrl || "";

      if (!activeTab?.id || !/https:\/\/www\.twitch\.tv\//i.test(currentUrl)) {
        return { ok: false, error: "Your current active tab is not a Twitch tab." };
      }

      tabId = activeTab.id;
      usedCurrentTab = true;
      originalUrl = currentUrl;

      if (!/\/directory\/following\/channels/i.test(currentUrl)) {
        await chrome.tabs.update(tabId, { url: targetUrl });
      }
    } else {
      const tab = await chrome.tabs.create({
        url: targetUrl,
        active: false
      });

      tabId = tab.id;
      createdTab = true;
    }

    const ready = await waitForFollowingPage(tabId, 30000);
    if (!ready) {
      return { ok: false, error: "Timed out waiting for Twitch Following → Channels page." };
    }

    await new Promise((resolve) => setTimeout(resolve, 2500));

    const usernames = await fetchFollowLoginsFromPage(tabId);

    if (!usernames.length) {
      return { ok: false, error: "No follows were found on the page." };
    }

    log("fetch_follows_ok", {
      mode,
      usedCurrentTab,
      count: usernames.length
    });

    return {
      ok: true,
      usernames,
      mode,
      used_current_tab: usedCurrentTab,
      restored_original_url: false
    };
  } catch (e) {
    log("fetch_follows_error", { mode, error: String(e) });
    return { ok: false, error: String(e) };
  } finally {
    if (createdTab && tabId != null) {
      try {
        await chrome.tabs.remove(tabId);
      } catch {}
    }

    if (!createdTab && usedCurrentTab && tabId != null && originalUrl) {
      try {
        await chrome.tabs.update(tabId, { url: originalUrl });
        restoredOriginalUrl = true;
        log("fetch_follows_restored_tab", { tabId, originalUrl });
      } catch (e) {
        log("fetch_follows_restore_error", { tabId, error: String(e) });
      }
    }
  }
}

T.fetchFollowLoginsFromPage = fetchFollowLoginsFromPage;
T.fetchMyFollows = fetchMyFollows;

export { fetchFollowLoginsFromPage, fetchMyFollows };