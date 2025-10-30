# Twitch Tab Manager

Opens Twitch stream tabs for your followed channels, auto-unmutes/resumes playback, de-duplicates per channel, and enforces a max open tab limit. Windows-friendly and shareable with friends.

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
- [Roadmap](#roadmap)

---

## Features
- Auto-open/close Twitch channel tabs based on **live** status via **Helix API** or token-less **HTML** fallback (Following → Live).
- **Unmute + resume** playback with gentle, randomized retries.
- Per-channel **de-duplication** (single tab per channel).
- Ignores non-player pages (`/drops`, `/moderator`, `/inventory`, `/directory`, etc.).
- **Max tab cap** (`max_tabs`) with least-recently-used trimming of manager-opened tabs.
- **Popup timer** shows “Next check in Xs”.
- **Options** includes **Fetch My Follows** (pulls your full follow list automatically).

---

## Requirements
- **Chrome** or Chromium-based browser with **Developer Mode**.
- Either a Twitch **Client ID** + **App Access Token** (**Helix**) or choose token-less mode (see [Get `client_id` & `access_token`](#get_client_id--access_token) for setup).

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
├─ twitchAPI.js
└─ icons/
   ├─ icon16.png
   ├─ icon32.png
   └─ icon192.png
````

---

## Quick Start

0. **Install from the Chrome Web Store** — [https://chromewebstore.google.com/detail/twitch-tab-manager/dagoljomgoainmmfldhnikegghjhbdaf](https://chromewebstore.google.com/detail/twitch-tab-manager/dagoljomgoainmmfldhnikegghjhbdaf)

1. Open `chrome://extensions` → enable **Developer mode** → **Load unpacked** (for local/dev builds) → select this folder.

2. Click the extension icon (popup) → toggle **On** → (optional) **Force Poll** to test instantly.

3. Open **Options** → **Follows** → click **Fetch My Follows**

   * **Open active tab (auto-scroll)**: opens `https://www.twitch.tv/directory/following/channels`, auto-scrolls to load all, saves usernames.
   * **Use my current Twitch tab**: if you already opened that page and scrolled, it scrapes your open tab.

4. (Optional) **Export/Import** your follows and **Export/Import** settings for backup/restore.

---

## Settings

Settings are stored locally (no separate `config.json` required). Key options:

```json
{
  "live_source": "auto",        // "helix" | "following_html" | "auto"
  "client_id": "",
  "access_token": "",
  "check_interval_sec": 60,
  "max_tabs": 8,
  "force_unmute": true,         // persistent: periodically re-enforce audio unmuted
  "unmute_streams": true,       // one-shot: try unmute once when a tab becomes active
  "force_resume": true,         // resume playback if paused/stalled
  "autoplay_streams": false     // if paused with Play button visible, click to start
}
```

**Notes**

* `live_source: "auto"` tries Helix first (needs `client_id` + token), then falls back to HTML.
* You can **Export/Import** these settings as JSON from Options.

---

## Fetch My Follows

In **Options → Follows**:

* **Open active tab (auto-scroll)** — launches the official Following → Channels page, finds the real scroll container, synthesizes wheel events, auto-scrolls to load **all** follows, and saves them locally.
* **Use my current Twitch tab** — scrapes the page you already opened and scrolled.

You can still Export/Import your follows list as text if you prefer.

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
```

**curl**

```bash
curl -X POST "https://id.twitch.tv/oauth2/token" \
  -d "client_id=YOUR_CLIENT_ID_HERE" \
  -d "client_secret=YOUR_CLIENT_SECRET_HERE" \
  -d "grant_type=client_credentials"
```

> Tokens expire. If live checks return **401**, generate a new token.

---

## How It Works

The background poller wakes on a schedule → loads settings + follows → determines who is **live** → opens streams (up to `max_tabs`), injects `content_unmute.js` to resume/unmute → de-dupes channels → trims extra manager-opened tabs by LRU → closes offline channels after a short grace period.

---

## Usage

### Popup

* **On/Off** — master toggle (persisted locally)
* **Force Poll** — immediate check (override)
* **Reload Config** — reloads settings in the background
* **Open Settings** — quick link to Options
* Shows **Next check in Xs** countdown

### Options

* **Settings (JSON)** — Edit / **Save** / **Apply & Reload** / **Export** / **Import**
* **Follows** — Edit / **Save** / **Export** / **Import** / **Fetch My Follows**

---

## Troubleshooting

* **No tabs open** — Helix: token expired (401) → re-issue; HTML: ensure follows exist or use **Fetch My Follows**.
* **Force Poll seems ignored** — Toggle **On** in popup; in Options, click **Apply & Reload**.
* **Didn’t fetch all follows** — Open **Following → Channels** yourself, scroll to bottom, then use **Use my current Twitch tab** mode.

---

## Feedback & Support

* Bugs & feature requests: [https://github.com/drachescript/Twitch-Tab-Manager/issues/new/choose](https://github.com/drachescript/Twitch-Tab-Manager/issues/new/choose)
* Source code & releases: [https://github.com/drachescript/Twitch-Tab-Manager](https://github.com/drachescript/Twitch-Tab-Manager)

---

## FAQ

* **Can it run without tokens?** — Yes: set `live_source = "following_html"` or `"auto"`.
* **Does it spam Twitch?** — No: batched requests and coarse intervals by default.
* **Can I favorite or prioritize?** — In progress (see [Roadmap](#roadmap)).

---

## Privacy Policy

We don’t collect, sell, or share personal data. All configuration stays on your device.
Full policy: [https://docs.google.com/document/d/1SkvBWapQawvzuhaYT-iHOoUSV0go4PgFhtxi6Z6nwjA/edit?usp=sharing](https://docs.google.com/document/d/1SkvBWapQawvzuhaYT-iHOoUSV0go4PgFhtxi6Z6nwjA/edit?usp=sharing)

---

## Changelog

All notable changes use `DD/MM/YYYY`.

### [1.0.6] — Unreleased

* Docs: README updated (streamlined Features, Requirements link to setup, Quick Start includes Web Store, Support links fixed).
* Settings: documented `autoplay_streams`, `force_unmute` vs `unmute_streams`.
* Note: If you want to **try WIP features for 1.0.6**, ask for the files.

### [1.0.5] — 30/10/2025

* **Fetch My Follows**: ignores sidebar; scrapes the **Following → Channels** grid; reliably auto-scrolls the real container.
* **Background hydration**: waits for tab `complete`, prevents early auto-discard while booting, then injects `content_unmute.js` and explicitly unmutes—reduces “ghost muted” tabs.
* **Auto-close**: more consistent cleanup of tabs for channels that went offline (with a short grace period).
* **Moderator View aware**: won’t open a duplicate `/login` tab if `/moderator/login` is already open.
* **Config auto-migration**: when new options are introduced, missing keys are added without overwriting existing values.
* **Token helpers** in Options → Help: PowerShell / curl snippet generators.

### [1.0.4] — 18/09/2025

* Initial public release with live detection (Helix or HTML), per-channel de-duplication, `max_tabs` cap, popup controls, and dark styling.

### [1.0.3] — 12/09/2025

* HTML scraping prototype; basic unmute/resume content script.

### [1.0.2] — 10/09/2025

* Stability fixes around opening multiple tabs at once.

### [1.0.1] — 08/09/2025

* First working background poller; minimal config.

### [1.0.0] — 05/09/2025

* Project scaffolding; initial commit.

---

## Roadmap

* **Priority from Popup**: when on a streamer page, popup shows **Add to Priority** / **Remove from Priority**.
* **Popup Quick Unmute**: one-click unmute using Twitch’s `player-mute-unmute-button`.
* **Autoplay toggle**: when the player is paused (`player-play-pause-button` shows “Play”), auto-start playback.
* **Ad-aware audio**: mute during ads, restore after, with safe backoff (no spam).
* **Debug tab**: recent errors, open/close reasons, and actions log.
* **Optional `!lurk`** chat message for a whitelist of streamers.
* **Auto-claim**: Moments + Channel Points (no Drops).
* **Max tabs**: stricter enforcement without touching user-opened tabs except when the streamer is offline.

```

