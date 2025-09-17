# Twitch Tab Manager (MV3)

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
- [Get `client_id` & `access_token`](#get-client_id--access_token)
  - [Create a Twitch app (one-time)](#create-a-twitch-app-one-time)
  - [Generate an App Access Token](#generate-an-app-access-token)
    - [PowerShell (Windows)](#powershell-windows)
    - [curl](#curl)
  - [Token expiry & renewal](#token-expiry--renewal)
- [How It Works (high level)](#how-it-works-high-level)
- [Usage (popup controls)](#usage-popup-controls)
- [Advanced Notes (MV3 specifics)](#advanced-notes-mv3-specifics)
- [Troubleshooting](#troubleshooting)
- [FAQ](#faq)
- [Packaging Tips](#packaging-tips)
- [Privacy & Safety Notes](#privacy--safety-notes)
- [Changelog](#changelog)

---

## Features
- Auto-open/close Twitch channel tabs based on **live** status (Helix API).
- **Unmute + resume** playback with gentle, randomized retries.
- Per-channel **de-duplication** (keeps a single tab per channel).
- Ignores non-player pages (e.g., `/drops`, `/moderator`, `/inventory`, `/directory`).
- **Max tab cap** (`max_tabs`) with least-recently-used closing.
- **MV3 service worker + chrome.alarms** for reliable, low-overhead polling.
- Minimal UI popup: **On/Off**, **Reload Config**, **Force Poll**.

---

## Requirements
- **Chrome** or Chromium-based browser with **Developer Mode**.
- A Twitch **Client ID** and an **App Access Token** (see below).  
  **Important:** Without `client_id` and `access_token`, the extension cannot detect who is live and **will not open any tabs**.

---

## Folder Layout
```
/ (extension root)
├─ manifest.json
├─ background.js           # service worker: polling, open/close, dedupe, max_tabs
├─ content_unmute.js       # injected into Twitch pages to unmute/resume playback
├─ loadConfig.js
├─ twitchAPI.js
├─ tabManager.js
├─ popup.html
├─ popup.js
├─ style.css
├─ follows.txt             # one channel login per line (lowercase)
├─ config.json             # your settings + Twitch credentials
└─ icons/
   ├─ icon16.png
   ├─ icon32.png
   └─ icon192.png
```

---

## Quick Start
1. Fill **`follows.txt`** with channel logins (one per line, lowercase). Example:
   ```
   xqc
   shroud
   amouranth
   ```
2. Open **`config.json`** and set:
   - `"client_id"` = your Twitch app’s Client ID  
   - `"access_token"` = your App Access Token (generated locally)  
   - (Optionally) adjust `"check_interval_sec"`, `"max_tabs"`, etc.  
   See full config reference below.
3. In Chrome: go to `chrome://extensions` → enable **Developer mode** → **Load unpacked** → select this folder.
4. Click the extension icon → toggle **On** → click **Force Poll** to test instantly.

> Tip: After editing `follows.txt` or `config.json`, click **Reload Config** in the popup.

---

## Configuration

### `follows.txt`
- One **login name** per line (lowercase).  
  Example:
  ```
  asmongold
  pokimane
  moistcr1tikal
  ```
- The login name is the part in the channel URL: `https://www.twitch.tv/<login>`.

### `config.json`
```json
{
  "client_id": "YOUR_TWITCH_CLIENT_ID",
  "access_token": "YOUR_APP_ACCESS_TOKEN",
  "force_unmute": true,
  "force_resume": true,
  "check_interval_sec": 60,
  "unmute_streams": true,
  "max_tabs": 8,
  "blacklist": []
}
```
- **client_id** — From your Twitch application (see steps below).  
- **access_token** — App Access Token (Client Credentials flow).  
- **force_unmute / force_resume / unmute_streams** — Playback helpers.  
- **check_interval_sec** — Poll cadence; keep **≥ 30s** for human-like behavior (default 60s).  
- **max_tabs** — Cap on simultaneously open channel tabs; least-recently-used tabs beyond this will close.  
- **blacklist** — Array of channel logins the manager should never auto-open.

---

## Get `client_id` & `access_token`

### Create a Twitch app (one-time)
1. Go to the **Twitch Developer Console** → *Your Console*.  
2. Click **Register Your Application**:
   - **Name:** e.g., `Twitch Tab Manager Local`  
   - **OAuth Redirect URL:** `http://localhost` (placeholder is fine for this use)  
   - **Category:** Website Integration (or similar)
3. Open your app:
   - Copy the **Client ID** (safe to put in `config.json`).  
   - Copy the **Client Secret** (keep it private; do **not** commit to GitHub).

### Generate an App Access Token
Use the **Client Credentials** grant to get a non-user token.

#### PowerShell (Windows)
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
# Copy the "access_token" into config.json: "access_token": "<value>"
```

#### curl
```bash
curl -X POST "https://id.twitch.tv/oauth2/token" \
  -d "client_id=YOUR_CLIENT_ID_HERE" \
  -d "client_secret=YOUR_CLIENT_SECRET_HERE" \
  -d "grant_type=client_credentials"
```

You’ll get:
```json
{
  "access_token": "xxxxxxxx",
  "expires_in": 5184000,
  "token_type": "bearer"
}
```

### Token expiry & renewal
- The token eventually expires (`expires_in` seconds).  
- If live checks start failing (**HTTP 401**), re-run the command to get a new token and update `config.json`.

> **Security:** Never share or commit your **client secret** or **access token** to public repos.

---

## How It Works (high level)
- The service worker (background) wakes on an **alarm** (default every 60s).  
- It fetches your config + follows list and queries Twitch Helix for **live** channels (batching `user_login` params).  
- For channels that just went **live**:
  - Opens tabs up to **`max_tabs`**, staggered slightly to avoid robotic patterns.  
  - Injects **`content_unmute.js`** to resume/unmute playback with gentle retries.  
- For channels that went **offline** or are **unfollowed**:
  - Closes those tabs (LRU beyond `max_tabs` also close).  
- It **de-duplicates** per channel (keeps one tab per channel).

---

## Usage (popup controls)
- **Toggle** — Enables/disables the manager (saved in local storage).  
- **Reload Config** — Re-reads `config.json` & `follows.txt` without reloading the extension.  
- **Force Poll** — Triggers an immediate live check (useful for testing).

---

## Advanced Notes (MV3 specifics)
- **No persistent background page.** MV3 uses a **service worker**; we use **`chrome.alarms`** for heartbeat.  
- **No long `setInterval` loops.** The alarm wakes the worker; we respect `check_interval_sec` with a simple gate.  
- **Script injection:** uses **`chrome.scripting.executeScript`** to inject `content_unmute.js` after a short, randomized delay.  
- **Permissions:** declared in `manifest.json` (`tabs`, `storage`, `alarms`, `scripting` + `host_permissions` for Twitch).

---

## Troubleshooting
- **No tabs open:**  
  - Ensure `config.json` has a valid **`client_id`** and **non-expired `access_token`**.  
  - Ensure **`follows.txt`** has correct **lowercase** logins (one per line).  
  - Click **Force Poll** to test now.
- **401 Unauthorized in logs:**  
  - Your access token expired → generate a fresh token and update `config.json`.
- **Opens the wrong pages or extra tabs:**  
  - Make sure logins in `follows.txt` match the Twitch login exactly (lowercase).  
  - The manager ignores `/drops`, `/moderator`, `/inventory`, `/directory`.
- **Extension seems inactive:**  
  - Check the popup toggle is **On**.  
  - Open `chrome://extensions`, click **Service worker** under the extension to view background logs.

---

## FAQ
**Q: Can this run without Twitch credentials?**  
**A:** No. The Helix API requires `client_id` + an App Access Token to read live status.

**Q: Will this spam Twitch?**  
**A:** No. The manager batches all `user_login` checks into a single request per poll and uses coarse intervals (default 60s).

**Q: Why Manifest V3?**  
**A:** MV2 is deprecated/disabled in current Chrome; MV3 service worker + alarms is the stable path forward.

**Q: Can I favorite or prioritize some channels?**  
**A:** Not yet—roadmap includes priority tiers and smarter selection when more than `max_tabs` are live.

---

## Packaging Tips
- Do **not** include `node_modules/` or unused icon sizes in your packed zip.  
- Keep `check_interval_sec ≥ 30` to avoid robotic behavior.  
- If distributing publicly, don’t ship a real `access_token` or **client secret**.

---

## Privacy & Safety Notes
- All credentials are stored **locally** in `config.json` on your machine.  
- No data is sent anywhere except the standard Twitch API requests your browser makes.  
- Keep your **client secret** offline and out of any public repo.

```
::contentReference[oaicite:0]{index=0}
