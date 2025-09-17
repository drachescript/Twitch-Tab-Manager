import { forcePoll, reloadConfig, toggleBot, getEnabled } from "./tabManager.js";

document.addEventListener("DOMContentLoaded", async () => {
  const toggle = document.getElementById("toggleManager");
  const statusText = document.getElementById("statusText");
  const btnPoll = document.getElementById("btnPoll");
  const btnReload = document.getElementById("btnReload");

  const setStatus = (on) => statusText.innerHTML = `Extension is <strong>${on ? "on" : "off"}</strong>`;

  const enabled = await getEnabled();
  toggle.checked = enabled; setStatus(enabled);

  toggle.addEventListener("change", async () => {
    const state = await toggleBot();
    setStatus(state);
  });

  btnPoll.addEventListener("click", async () => {
    btnPoll.disabled = true;
    await forcePoll();
    btnPoll.disabled = false;
  });

  btnReload.addEventListener("click", async () => {
    btnReload.disabled = true;
    await reloadConfig();
    btnReload.disabled = false;
  });
});
