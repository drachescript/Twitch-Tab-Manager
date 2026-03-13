# Twitch Tab Manager

Opens Twitch stream tabs for your followed channels, keeps them grouped together, tries to keep playback alive, de-duplicates per channel, and respects a strict max open tab limit. Built for local use, Windows-friendly, and easy to share with friends.

---

## Table of Contents
- [Features](#features)
- [Requirements](#requirements)
- [Folder Layout](#folder-layout)
- [Quick Start](#quick-start)
- [Settings](#settings)
- [Fetch My Follows](#fetch-my-follows)
- [Get `client_id` & `access_token`](#get-client_id--access_token)
  - [Create a Twitch app](#create-a-twitch-app)
  - [Generate an App Access Token](#generate-an-app-access-token)
- [How It Works](#how-it-works)
- [Usage](#usage)
  - [Popup](#popup)
  - [Options](#options)
- [Troubleshooting](#troubleshooting)
- [Feedback & Support](#feedback--support)
- [FAQ](#faq)
- [Privacy Policy](#privacy-policy)
- [Changelog](#changelog)
- [Roadmap / To Do](#roadmap--to-do)

---

## Features
- Auto-open and auto-close Twitch channel tabs based on **live status**
- **Helix-first** live detection when `client_id` + `access_token` are configured
- HTML fallback/live probing for setups that do not use Helix
- Per-channel **de-duplication**
- Keeps Twitch tabs together in the same browser window where possible
- Respects a strict **max tab cap** (`max_tabs`)
- Background **re-pokes** managed Twitch tabs to help resume playback/unmute when Twitch stalls hidden tabs
- Popup controls for:
  - **On / Off**
  - **Force Poll**
  - **Reload Config**
  - **Open Settings**
  - **Diagnose**
- Options page includes:
  - JSON config editor
  - follows editor
  - priority channels editor
  - **Fetch My Follows**
  - import / export helpers
  - debug tools

---

## Requirements
- **Chrome** or another Chromium-based browser with **Developer Mode**
- For best live detection, a Twitch **Client ID** + **App Access Token**
- Token-less setups can still work through HTML/fallback methods, but Helix is preferred

---

## Folder Layout
```text
/ (extension root)
├─ manifest.json
├─ background.js
├─ bg.core.js
├─ bg.compat.js
├─ bg.live.js
├─ bg.tabs.js
├─ bg.stability.js
├─ content_unmute.js
├─ content_status.js
├─ popup.html
├─ popup.js
├─ options.html
├─ options.js
├─ config.json
└─ icons/
   ├─ icon16.png
   ├─ icon32.png
   └─ icon192.png
````

---

## Quick Start

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select this extension folder
5. Open the popup and turn it **On**
6. Open **Settings**
7. Check your config / follows / priority
8. Use **Fetch My Follows** if needed
9. Use **Force Poll** to test immediately

---

## Settings

Settings are stored locally. Typical example:

```json
{
  "live_source": "auto",
  "client_id": "",
  "access_token": "",
  "check_interval_sec": 60,
  "max_tabs": 4,
  "enabled": true,
  "force_unmute": false,
  "unmute_streams": true,
  "force_resume": false,
  "autoplay_streams": true,
  "follows": [],
  "priority": [],
  "followUnion": [],
  "blacklist": [],
  "soft_wake_tabs": false,
  "soft_wake_only_when_browser_focused": true
}
```

### Notes

* `live_source: "auto"` prefers Helix first, then falls back when needed
* `priority` is separate from `follows`
* `followUnion` is the combined set used internally
* `max_tabs` is always enforced
* `soft_wake_tabs` is intended for harder cases where Twitch background tabs stay paused/muted
* `soft_wake_only_when_browser_focused` is meant to avoid interrupting gaming or other apps

---

## Fetch My Follows

The Options page supports two fetch modes:

* **Open active tab (auto-scroll)**
  Opens the official `Following → Channels` page, scrolls it, and saves the usernames found there.

* **Use my current Twitch tab**
  Reuses an already-open Twitch tab and moves it to the correct page if needed before scraping.

### Current behavior

* Newly fetched follows are synced into your stored `follows`
* Channels you no longer follow can be removed during sync
* `priority` is left alone
* `followUnion` is rebuilt from `follows + priority`

### Planned improvement

* clearer follow sync changelog in the UI
* better visibility for “added” and “removed” usernames after a fetch

---

## Get `client_id` & `access_token`

### Create a Twitch app

* Go to the Twitch Developer Console
* Register an application
* A placeholder redirect like `http://localhost` is fine for this use
* Copy your **Client ID**
* Keep your **Client Secret** private

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
```

**curl**

```bash
curl -X POST "https://id.twitch.tv/oauth2/token" \
  -d "client_id=YOUR_CLIENT_ID_HERE" \
  -d "client_secret=YOUR_CLIENT_SECRET_HERE" \
  -d "grant_type=client_credentials"
```

> If Helix starts returning 401 errors, generate a new token.

---

## How It Works

The background worker loads settings, checks who is live, compares that list against already-open Twitch tabs, and opens or closes manager-controlled tabs as needed.

For Twitch player reliability, managed tabs get:

* content scripts injected on channel pages
* delayed re-pokes after opening
* periodic re-pokes while they stay managed

The extension only closes tabs it believes it opened itself.

---

## Usage

### Popup

* **On / Off** — master toggle
* **Force Poll** — run a live check immediately
* **Reload Config** — reload settings in the background worker
* **Open Settings** — jump to Options
* **Diagnose** — quick status/debug info

### Options

* **Settings JSON**

  * Save
  * Apply & Reload
  * Export
  * Import
  * Reset to Packaged
  * Refresh From Storage
* **Follows**

  * Save
  * Export
  * Import
  * Reset to Packaged
  * Refresh From Storage
  * Fetch My Follows
* **Priority Channels**

  * manual list of preferred channels
* **Debug**

  * diagnostics
  * logs
  * helper actions

---

## Troubleshooting

### No tabs open

* Check that the extension is turned **On**
* Check that `follows` or `priority` is not empty
* If using Helix, verify `client_id` and `access_token`
* Try **Force Poll**

### Force Poll finds lives but opens nothing

* Check Diagnostics
* Check `max_tabs`
* Make sure those channels are not already open in duplicate/problem tabs
* Reload the extension and try again

### Tabs open but stay paused or muted

* Twitch background behavior can be inconsistent
* Re-pokes should help, but some cases may still require a visible/focused tab
* `soft_wake_tabs` exists for future / advanced handling, but should stay conservative

### Fetch My Follows misses channels

* Use the official `Following → Channels` page
* Let it scroll fully
* Try the auto-scroll mode first
* Helix/live detection is separate from fetching your follow list

### Tabs close and reopen unexpectedly

* This should be much better in 1.0.7
* If it still happens, use Diagnostics and logs to check whether Twitch returned a temporary empty live set

---

## Feedback & Support

* Bugs and feature requests: GitHub issues
* Source code / releases: GitHub repo

---

## FAQ

### Can it run without tokens?

Yes, but Helix is more reliable.

### Does it close my own manually opened Twitch tabs?

It is designed not to. Only manager-opened tabs should be auto-closed.

### Can I keep certain channels preferred?

Yes. Use `priority`.

### Can it always force hidden tabs to play with sound?

Not perfectly. Browser autoplay/background restrictions still apply, so some cases need retries or a future soft-wake fallback.

---

## Privacy Policy

No personal data is collected, sold, or shared. Configuration stays on your device.

---

## Changelog

All notable changes use `DD/MM/YYYY`.

### [1.0.7] — 13/03/2026

* Reworked the background service flow around the modular MV3 setup
* Improved message compatibility for popup / options / diagnostics routing
* Fixed several service worker startup and compatibility problems
* Fixed broken toggle / config reload / force poll paths
* Improved follow fetching from the official `Following → Channels` page
* Fetch now behaves more like a sync and keeps `priority` separate
* Improved Twitch tab grouping so new managed tabs prefer an existing Twitch window
* Improved duplicate-channel handling
* Added repeated background repokes for managed Twitch tabs after opening
* Added player status reporting groundwork for smarter stuck-tab handling
* Added safer protection against temporary empty live results closing everything at once
* Improved diagnostics and general debugging flow
* General cleanup and hardening across the background + tab management flow

### [1.0.6] — 06/11/2025

* Added priority handling so priority streamers are opened before regular follows
* Added Options textarea + popup add/remove tools while on a streamer page
* Better offline detection
* Stricter `max_tabs` handling
* Sturdier polling
* More human-like Twitch interaction timing
* Added Diagnostics for faster debugging

### [1.0.5] — 30/10/2025

* Fetch My Follows ignores sidebar and targets the Following → Channels grid
* More consistent cleanup of tabs for channels that went offline
* Moderator-view aware duplicate handling
* Config auto-migration for new options
* Token helpers in Options → Help

### [1.0.4] — 18/09/2025

* Initial public release with live detection, de-duplication, `max_tabs`, popup controls, and dark styling

### [1.0.3] — 12/09/2025

* HTML scraping prototype
* Basic unmute / resume content script

### [1.0.2] — 10/09/2025

* Stability fixes around opening multiple tabs at once

### [1.0.1] — 08/09/2025

* First working background poller
* Minimal config

### [1.0.0] — 05/09/2025

* Project scaffolding
* Initial commit

---

## Roadmap / To Do

### High priority

* Finish safer soft-wake fallback for stuck Twitch tabs
* Add UI toggles for:

  * `soft_wake_tabs`
  * `soft_wake_only_when_browser_focused`
* Improve player-state handling so hidden tabs are resumed/unmuted more reliably
* Add clearer follow-sync history in Options:

  * added usernames
  * removed usernames
  * last sync time

### Medium priority

* Better handling for raids
* Better handling for tab reuse vs manager-owned tabs
* Improved duplicate detection across Twitch windows
* Stronger stuck-tab detection before any wake/focus action
* More reliable “Use my current Twitch tab” fetch behavior

### Lower priority / future ideas

* Optional quality control
* Volume memory
* Better debug view in Options
* Channel points helper / notifier
* Better ad-aware behavior
* Better recovery when Twitch changes page structure
