# Twitch Tab Manager

Opens Twitch stream tabs for your followed channels, auto-unmutes/resumes playback, de-duplicates per channel, and enforces a max open tab limit. Built for **Chrome Manifest V3** (service worker + alarms). Windows-friendly, shareable with friends.

---

## Table of Contents
- [Features](#features)
- [Requirements](#requirements)
- [Folder Layout](#folder-layout)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
  - [`follows.txt`](#followstxt)
  - [`config.json`](#configjson)
- [Fetch My Follows (no files needed)](#fetch-my-follows-no-files-needed)
- [Get `client_id` & `access_token`](#get-client_id--access_token)
  - [Create a Twitch app](#create-a-twitch-app)
  - [Generate an App Access Token](#generate-an-app-access-token)
- [How It Works](#how-it-works)
- [Usage](#usage)
  - [Popup](#popup)
  - [Options](#options)
- [Advanced Notes (MV3 specifics)](#advanced-notes-mv3-specifics)
- [Troubleshooting](#troubleshooting)
- [Feedback & Support](#feedback--support)
- [FAQ](#faq)
- [Privacy Policy](#privacy-policy)
- [Changelog](#changelog)

---

## Features
- Auto-open/close Twitch channel tabs based on **live** status via **Helix API** (`client_id` + `access_token`) or token-less **HTML fallback** (Following → Live).
- **Unmute + resume** playback with gentle, randomized retries.
- Per-channel **de-duplication** (keeps a single tab per channel).
- Ignores non-player pages (`/drops`, `/moderator`, `/inventory`, `/directory`).
- **Max tab cap** (`max_tabs`) with least-recently-used closing.
- **MV3** service worker + `chrome.alarms` for reliable, low-overhead polling.
- **Dark mode** popup & options.
- **Options** includes **Fetch My Follows** (pulls your full follow list automatically).

---

## Requirements
- **Chrome** or Chromium-based browser with **Developer Mode**.
- Either a Twitch **Client ID** + **App Access Token** (**Helix**) or set `"live_source": "following_html"` in `config.json` for **token-less** mode.  
  Tip: Without credentials, use `"live_source": "following_html"` or `"auto"` (auto tries Helix first, then falls back to HTML).

---

## Folder Layout
```text
/ (extension root)
├─ manifest.json
├─ background.js              # polling, open/close, dedupe, max_tabs, Fetch My Follows
├─ content_unmute.js          # unmute/resume helper injected on twitch.tv
├─ loadConfig.js
├─ popup.html
├─ popup.js
├─ options.html
├─ options.js
├─ style.css
├─ follows.txt                # one username per line (lowercase) — optional if using Fetch My Follows
├─ config.json                # settings + credentials (optional if using HTML fallback)
└─ icons/
   ├─ icon16.png
   ├─ icon32.png
   └─ icon192.png
````

---

## Quick Start

1. Open `chrome://extensions` → enable **Developer mode** → **Load unpacked** → select this folder.
2. Click the extension icon (popup) → toggle **On** → (optional) **Force Poll** to test instantly.
3. Open **Options** → **Follows** → click **Fetch My Follows**

   * **Open active tab (auto-scroll)**: opens `https://www.twitch.tv/directory/following/channels`, auto-scrolls to load all, saves usernames.
   * **Use my current Twitch tab**: if you already opened that page and scrolled, it scrapes your open tab.
4. (Optional) **Export/Import** your follows and **Export/Import** config for backup/restore.

---

## Configuration

### `follows.txt`

One **username** per line (lowercase). Example (`twitch.tv/sery_bot` → `sery_bot`):

```txt
sery_bot
shroud
pokimane
```

You can skip this file if you use **Fetch My Follows**.

### `config.json`

```json
{
  "client_id": "YOUR_TWITCH_CLIENT_ID",
  "access_token": "YOUR_APP_ACCESS_TOKEN",
  "live_source": "auto",
  "force_unmute": true,
  "force_resume": true,
  "check_interval_sec": 60,
  "unmute_streams": true,
  "max_tabs": 8,
  "blacklist": []
}
```

* **live_source** — `"helix"` | `"following_html"` | `"auto"` (default)

  * **helix**: Twitch API (needs `client_id` + `access_token`)
  * **following_html**: token-less; scrapes Following → Live
  * **auto**: try Helix, then fallback to HTML
* **check_interval_sec** — poll cadence; keep ≥ 30s (default 60s)
* **max_tabs** — cap for simultaneously open channels (LRU closes extras)
* **blacklist** — array of usernames that should never auto-open

---

## Fetch My Follows (no files needed)

In **Options → Follows**:

* **Fetch My Follows**

  * **Open active tab (auto-scroll)** — opens the official Following → Channels page, finds the real scroll container, synthesizes wheel events, auto-scrolls to load all follows, and saves them locally.
  * **Use my current Twitch tab** — scrapes the page you already opened and scrolled.

You can still **Export/Import** your list as `follows.txt`.

---

## Get `client_id` & `access_token`

### Create a Twitch app

* Go to **Developer Console** → [https://dev.twitch.tv/console/apps](https://dev.twitch.tv/console/apps) → **Register Your Application**
* OAuth Redirect: `http://localhost` (placeholder OK)
* Copy **Client ID** (keep **Client Secret** private).

### Generate an App Access Token

**PowerShell (Windows)**

```powershell
$client_id = "YOUR_CLIENT_ID_HERE"
$client_secret = "YOUR_CLIENT_SECRET_HERE"
$body = @{
  client_id     = $client_id
  client_secret = $client_secret
  grant_type    = "client_credentials"
}
$response = Invoke-RestMethod -Method Post -Uri "https://id.twitch.tv/oauth2/token" -Body $body
$response | Format-List
# Put the value of $response.access_token into config.json ("access_token")
```

**curl**

```bash
curl -X POST "https://id.twitch.tv/oauth2/token" \
  -d "client_id=YOUR_CLIENT_ID_HERE" \
  -d "client_secret=YOUR_CLIENT_SECRET_HERE" \
  -d "grant_type=client_credentials"
```

> Tokens expire. If live checks return **401**, generate a new token and update `config.json`.

---

## How It Works

Service worker wakes via `chrome.alarms` (default ~60s) → loads config + follows → determines who is **live** (Helix or HTML) → opens streams (up to `max_tabs`), injects `content_unmute.js` to resume/unmute → closes duplicates, unfollowed, or over-cap tabs using LRU.

---

## Usage

### Popup

* **On/Off** — master enable/disable (stored locally)
* **Force Poll** — immediate check (hard override)
* **Reload Config** — reloads config in the background
* **Open Settings** — opens the Options page

### Options

* **Config (JSON)** — Edit / **Save** / **Apply & Reload** / **Export** / **Import**
* **Follows** — Edit / **Save** / **Export** / **Import** / **Fetch My Follows**

  * Hint: one username per line — the `sery_bot` part of `twitch.tv/sery_bot`.

---

## Advanced Notes (MV3 specifics)

* MV3 service worker sleeps between polls; uses `chrome.alarms` as a heartbeat.
* Script injection via `chrome.scripting.executeScript`.
* Host scope limited to `twitch.tv`.
* No analytics or telemetry.

---

## Troubleshooting

* **No tabs open** — Helix: token expired (401) → re-issue; HTML: ensure follows exist or use **Fetch My Follows**.
* **Force Poll seems ignored** — Toggle **On** in popup; in Options, click **Apply & Reload**.
* **Wrong usernames pulled** — Ensure lowercase; fetcher reads **Following → Channels** cards (not Live/Recommended).
* **Didn’t fetch all follows** — Open **Following → Channels** yourself, scroll to bottom, then use **Use my current Twitch tab** mode.

---

## Feedback & Support

* Bugs and feature requests: [https://github.com/drachescript/Twitch-Tab-Manager/issues/new/choose](https://github.com/drachescript/Twitch-Tab-Manager/issues/new/choose)
* Discussions and tips: [https://github.com/drachescript/Twitch-Tab-Manager/discussions](https://github.com/drachescript/Twitch-Tab-Manager/discussions)
* Source code and README: [https://github.com/drachescript/Twitch-Tab-Manager](https://github.com/drachescript/Twitch-Tab-Manager)

---

## FAQ

* **Can it run without tokens?** — Yes: set `"live_source": "following_html"` or `"auto"`.
* **Does it spam Twitch?** — No: batched requests and coarse intervals by default.
* **Can I favorite or prioritize?** — Not yet; planned.

---

## Privacy Policy

We don’t collect, sell, or share personal data. All configuration stays on your device.
Full policy (Google Doc): [https://docs.google.com/document/d/1SkvBWapQawvzuhaYT-iHOoUSV0go4PgFhtxi6Z6nwjA/edit?usp=sharing](https://docs.google.com/document/d/1SkvBWapQawvzuhaYT-iHOoUSV0go4PgFhtxi6Z6nwjA/edit?usp=sharing)

---

# Changelog

All notable changes to **Twitch Tab Manager** are documented here.
Dates use `DD/MM/YYYY`.

---

## [1.0.5] — 30/10/2025

### Fixed

* **Fetch My Follows**: ignores the left sidebar and scrapes only the **Following → Channels** grid; reliably auto-scrolls the real scroll container to load the full list.
* **Background hydration**: waits for tab `complete`, prevents early auto-discard while booting, then injects `content_unmute.js` and explicitly unmutes—reduces “ghost muted” tabs.
* **Auto-close**: more consistent cleanup of tabs for channels that went offline (with a short grace period).
* **Moderator View aware**: if `/moderator/<login>` (or equivalent) is already open, the extension won’t open a second `/ <login>` tab for that streamer.

### Added

* **Config auto-migration**: when new options are introduced, missing keys are added without overwriting the user’s values.
* **Follow fetch modes** in Options → Follows:

  * *Open active tab (auto-scroll)* — launches the official page and scrolls it to harvest all usernames.
  * *Use my current Twitch tab* — scrapes the page you already opened & scrolled.
* **Token helpers** in Options → Help: PowerShell / curl snippet generators with copy buttons and quick “insert into config” actions.

### Changed

* **Deduplication & tab cap** tuned; keeps one tab per channel and trims by LRU beyond `max_tabs`.
* More human retry/backoff in `content_unmute.js` (gentle resume + unmute attempts).
* README & privacy link included; setup instructions clarified.

---

## [1.0.4] — 18/09/2025

### Added

* Initial public **MV3** release (service worker + alarms).
* Live detection via **Helix** (`client_id` + `access_token`) or token-less **HTML fallback**.
* Per-channel de-duplication; `max_tabs` limit with LRU closing.
* Basic popup controls: **On/Off**, **Force Poll**, **Reload Config**.
* Dark Options/Popup styling; manual `follows.txt` + import/export.

---

## [1.0.3] — 12/09/2025

### Added

* Early HTML scraping prototype for Following pages.
* Basic unmute/resume content script.

### Changed

* Polished folder layout; icons; initial README.

---

## [1.0.2] — 10/09/2025

### Fixed

* Stability fixes around opening multiple tabs at once.

---

## [1.0.1] — 08/09/2025

### Added

* First working background poller; minimal config.

---

## [1.0.0] — 05/09/2025

### Added

* Project scaffolding; initial commit.

---

## Unreleased / Roadmap 

* Per-channel behavior (priority, open muted, optional “!lurk” chat message).
* Automatic Helix→HTML fallback with exponential backoff & a Debug log tab.

```
