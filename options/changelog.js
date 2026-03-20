import { $, ok, err } from "./core.js";

async function loadBundledReadme() {
  const url = chrome.runtime.getURL("README.md");
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`README load failed: ${res.status}`);
  }
  return await res.text();
}

function extractChangelogSection(md) {
  const text = String(md || "");
  const match = text.match(/^##\s+Changelog\b[\t ]*\r?\n([\s\S]*)$/im);
  return match ? match[1].trim() : "";
}

export async function loadChangelogTab() {
  const out = $("#changelogOut");
  const status = $("#changelogStatus");
  if (out) out.textContent = "Loading changelog...";
  if (status) status.textContent = "";

  try {
    const md = await loadBundledReadme();
    const section = extractChangelogSection(md);

    if (!section) {
      if (out) out.textContent = "No '## Changelog' section was found in README.md.";
      err(status, "Could not find changelog section.");
      return;
    }

    if (out) out.textContent = section;
    ok(status, "Changelog loaded.");
  } catch (e) {
    if (out) out.textContent = "";
    err(status, `Failed to load changelog: ${e.message || e}`);
  }
}

export function setupChangelogTab() {
  $("#reloadChangelog")?.addEventListener("click", () => {
    loadChangelogTab();
  });
}