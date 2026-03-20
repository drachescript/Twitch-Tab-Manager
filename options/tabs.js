import { $$ } from "./core.js";
import { loadChangelogTab } from "./changelog.js";

export function setupTabs() {
  $$(".tab").forEach((tab) => {
    tab.addEventListener("click", async () => {
      $$(".tab").forEach((x) => x.classList.remove("active"));
      $$(".panel").forEach((x) => x.classList.remove("active"));

      tab.classList.add("active");
      document.getElementById("panel-" + tab.dataset.tab)?.classList.add("active");

      if (tab.dataset.tab === "changelog") {
        await loadChangelogTab();
      }
    });
  });
}