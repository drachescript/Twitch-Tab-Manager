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

async function fetchMyFollows(mode = "active") {
  let tabId = null;
  let createdTab = false;

  try {
    if (mode === "current") {
      const tabs = await chrome.tabs.query({});
      const twitchTab = tabs.find((tab) => {
        const url = tab.url || tab.pendingUrl || "";
        return /https:\/\/www\.twitch\.tv\//i.test(url);
      });

      if (!twitchTab?.id) {
        return { ok: false, error: "No Twitch tab found." };
      }

      tabId = twitchTab.id;
    } else {
      const tab = await chrome.tabs.create({
        url: "https://www.twitch.tv/directory/following/channels",
        active: false
      });

      tabId = tab.id;
      createdTab = true;
    }

    const targetUrl = "https://www.twitch.tv/directory/following/channels";

    const current = await chrome.tabs.get(tabId);
    const currentUrl = current?.url || current?.pendingUrl || "";

    if (!/\/directory\/following\/channels/i.test(currentUrl)) {
      await chrome.tabs.update(tabId, { url: targetUrl });
    }

    await new Promise((resolve) => {
      const timeout = setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(onUpdated);
        resolve();
      }, 30000);

      function onUpdated(id, info, tab) {
        if (id !== tabId) return;
        const url = tab?.url || tab?.pendingUrl || "";
        if (info.status !== "complete") return;
        if (!/\/directory\/following\/channels/i.test(url)) return;

        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(onUpdated);
        resolve();
      }

      chrome.tabs.onUpdated.addListener(onUpdated);
    });

    await new Promise((resolve) => setTimeout(resolve, 2500));

    const usernames = await fetchFollowLoginsFromPage(tabId);

    if (!usernames.length) {
      return { ok: false, error: "No follows were found on the page." };
    }

    return { ok: true, usernames };
  } catch (e) {
    return { ok: false, error: String(e) };
  } finally {
    if (createdTab && tabId != null) {
      try {
        await chrome.tabs.remove(tabId);
      } catch {}
    }
  }
}

T.fetchFollowLoginsFromPage = fetchFollowLoginsFromPage;
T.fetchMyFollows = fetchMyFollows;

export { fetchFollowLoginsFromPage, fetchMyFollows };