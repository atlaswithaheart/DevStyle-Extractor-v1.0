document.addEventListener("DOMContentLoaded", async () => {
  const buttons = [
    { btn: document.getElementById("inspect-btn"), mode: "element" },
    { btn: document.getElementById("font-btn"), mode: "font" },
    { btn: document.getElementById("html-btn"), mode: "html" },
    { btn: document.getElementById("tailwind-btn"), mode: "tailwind" },
    { btn: document.getElementById("sandbox-btn"), mode: "sandbox" }
  ];
  const testView = document.getElementById("test-view");
  const tailwindVersion = document.getElementById("tailwind-version");
  const paletteButton = document.getElementById("palette-btn");
  buttons.forEach(b => { b.btn.dataset.label = b.btn.textContent; });

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) return;

  const url = tab.url || "";
  const restricted = ["chrome://", "edge://", "about:", "chrome-extension://"].some(p => url.startsWith(p));

  function setActive(btn, on) {
    btn.classList.toggle("active", on);
    btn.textContent = on ? "Stop Inspecting" : btn.dataset.label;
  }

  function showError(btn, text) {
    btn.className = "btn error";
    btn.textContent = text;
  }

  async function copyPlainText(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch (err) {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      const copied = document.execCommand("copy");
      textarea.remove();
      if (!copied) throw new Error("The browser denied the clipboard request.");
    }
  }

  // Ask this tab's content script directly. Stored global state can be stale
  // after a navigation and incorrectly mark another tab as inspecting.
  let inspectMode = "none";
  let activeTestView = "none";
  let activeTailwindVersion = "v4";
  if (!restricted) {
    try {
      const state = await chrome.tabs.sendMessage(tab.id, { action: "get_inspect_state" });
      inspectMode = state && state.mode ? state.mode : "none";
      activeTestView = state && state.testView ? state.testView : "none";
      activeTailwindVersion = state && ["v2", "v3"].includes(state.tailwindVersion) ? state.tailwindVersion : "v4";
    } catch (err) {
      // The normal click path gives a clear refresh message when the content
      // script is unavailable (for example, directly after installation).
    }
  }
  buttons.forEach(b => setActive(b.btn, inspectMode === b.mode));
  testView.value = activeTestView;
  tailwindVersion.value = activeTailwindVersion;

  buttons.forEach(({ btn, mode }) => {
    btn.addEventListener("click", async () => {
      if (restricted) {
        showError(btn, "Blocked on browser pages");
        return;
      }

      try {
        if (btn.classList.contains("active")) {
          await chrome.tabs.sendMessage(tab.id, { action: "stop_inspect" });
        } else {
          await chrome.tabs.sendMessage(tab.id, {
            action: "start_inspect",
            mode: mode,
            tailwindVersion: ["tailwind", "sandbox"].includes(mode) ? tailwindVersion.value : undefined
          });
        }
        window.close();
      } catch (err) {
        // Content script not loaded yet (page needs a refresh after install/reload)
        showError(btn, "Refresh the page first");
      }
    });
  });

  testView.addEventListener("change", async () => {
    if (restricted) {
      testView.value = "none";
      return;
    }

    try {
      await chrome.tabs.sendMessage(tab.id, { action: "set_test_view", view: testView.value });
      window.close();
    } catch (err) {
      testView.value = "none";
    }
  });

  paletteButton.addEventListener("click", async () => {
    if (restricted) {
      showError(paletteButton, "Blocked on browser pages");
      return;
    }

    try {
      const response = await chrome.tabs.sendMessage(tab.id, {
        action: "generate_page_palette",
        tailwindVersion: tailwindVersion.value
      });
      if (!response || !response.palette) throw new Error("No palette was generated.");
      await copyPlainText(response.palette);
      paletteButton.className = "btn copied";
      paletteButton.textContent = "Palette copied";
      setTimeout(() => window.close(), 900);
    } catch (err) {
      showError(paletteButton, "Refresh the page first");
    }
  });
});
