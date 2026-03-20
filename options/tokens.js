import { $, ok, err, note } from "./core.js";

function buildPS1(clientId, clientSecret) {
  return `$client_id = "${clientId}"
$client_secret = "${clientSecret}"
$body = @{
  client_id     = $client_id
  client_secret = $client_secret
  grant_type    = "client_credentials"
}
$response = Invoke-RestMethod -Method Post -Uri "https://id.twitch.tv/oauth2/token" -Body $body
$response | Format-List`;
}

function buildCurl(clientId, clientSecret) {
  return `curl -X POST "https://id.twitch.tv/oauth2/token" \\
  -d "client_id=${clientId}" \\
  -d "client_secret=${clientSecret}" \\
  -d "grant_type=client_credentials"`;
}

export function renderTokenSnippets() {
  const clientId = $("#cid")?.value || "";
  const clientSecret = $("#csecret")?.value || "";

  if ($("#ps1Out")) $("#ps1Out").value = buildPS1(clientId, clientSecret);
  if ($("#curlOut")) $("#curlOut").value = buildCurl(clientId, clientSecret);
}

function copyText(text) {
  return navigator.clipboard.writeText(String(text || ""));
}

function patchConfigJson(mutator) {
  const cfgTA = $("#cfg");
  if (!cfgTA) return false;

  try {
    const parsed = JSON.parse(cfgTA.value || "{}");
    mutator(parsed);
    cfgTA.value = JSON.stringify(parsed, null, 2);
    return true;
  } catch {
    return false;
  }
}

export function setupTokenTools() {
  $("#cid")?.addEventListener("input", renderTokenSnippets);
  $("#csecret")?.addEventListener("input", renderTokenSnippets);

  $("#btnCopyPS1")?.addEventListener("click", async () => {
    try {
      await copyText($("#ps1Out")?.value || "");
      ok($("#cfgStatus"), "PowerShell copied.");
    } catch {
      err($("#cfgStatus"), "Copy failed.");
    }
  });

  $("#btnCopyCurl")?.addEventListener("click", async () => {
    try {
      await copyText($("#curlOut")?.value || "");
      ok($("#cfgStatus"), "cURL copied.");
    } catch {
      err($("#cfgStatus"), "Copy failed.");
    }
  });

  $("#btnApplyCIDToCfg")?.addEventListener("click", () => {
    const clientId = $("#cid")?.value || "";
    const done = patchConfigJson((cfg) => {
      cfg.client_id = clientId;
    });

    if (done) note($("#cfgStatus"), "Client ID inserted into config editor.");
    else err($("#cfgStatus"), "Could not patch config JSON.");
  });

  $("#btnApplyToken")?.addEventListener("click", () => {
    const token = $("#tok")?.value || "";
    const done = patchConfigJson((cfg) => {
      cfg.access_token = token;
    });

    if (done) note($("#cfgStatus"), "Token inserted into config editor.");
    else err($("#cfgStatus"), "Could not patch config JSON.");
  });
}