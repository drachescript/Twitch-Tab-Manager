export const $ = (sel) => document.querySelector(sel);
export const $$ = (sel) => Array.from(document.querySelectorAll(sel));

export const cfgTA = () => $("#cfg");
export const folTA = () => $("#fol");

export function parseBool(value, fallback) {
  if (value === true || value === false) return value;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (v === "true") return true;
    if (v === "false") return false;
  }
  if (value === undefined || value === null) return fallback;
  return !!value;
}

export function normalizeName(value) {
  return String(value || "").trim().toLowerCase();
}

export function uniqNames(list) {
  return [...new Set((list || []).map(normalizeName).filter(Boolean))];
}

export function ok(el, msg) {
  if (!el) return;
  el.textContent = msg || "";
  el.className = "status ok";
}

export function err(el, msg) {
  if (!el) return;
  el.textContent = msg || "";
  el.className = "status err";
}

export function note(el, msg) {
  if (!el) return;
  el.textContent = msg || "";
  el.className = "status";
}

export function format(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function downloadText(filename, content, type = "text/plain") {
  const url = URL.createObjectURL(new Blob([content], { type }));
  if (chrome.downloads?.download) {
    chrome.downloads.download({ url, filename, saveAs: true }, () => URL.revokeObjectURL(url));
    return;
  }

  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function readFileText(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result || ""));
    fr.onerror = () => reject(fr.error || new Error("read failed"));
    fr.readAsText(file);
  });
}

export function rpc(type, payload = {}) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ type, ...payload }, (resp) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: chrome.runtime.lastError.message });
          return;
        }
        resolve(resp || { ok: true });
      });
    } catch (e) {
      resolve({ ok: false, error: String(e) });
    }
  });
}

export async function showManifestVersion() {
  const line = $("#versionLine");
  if (!line) return;

  try {
    const version = chrome.runtime.getManifest()?.version || "unknown";
    line.textContent = `Version: ${version}`;
  } catch {
    line.textContent = "Version: ?";
  }
}