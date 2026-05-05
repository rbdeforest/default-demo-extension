const statusEl = document.getElementById("status");
const formsEl = document.getElementById("forms");
const openBtn = document.getElementById("open-trace");
const sandboxBtn = document.getElementById("run-sandbox");
const workflowPicker = document.getElementById("workflow-picker");
const autoOpenToggle = document.getElementById("auto-open-toggle");

chrome.storage.local.get({ autoOpenOverlay: true }, ({ autoOpenOverlay }) => {
  autoOpenToggle.checked = !!autoOpenOverlay;
});

autoOpenToggle.addEventListener("change", () => {
  chrome.storage.local.set({ autoOpenOverlay: autoOpenToggle.checked });
  statusEl.textContent = `auto-open ${autoOpenToggle.checked ? "ON" : "OFF"}`;
});

const VENDOR_LABEL = {
  html: "Plain HTML",
  hubspot: "HubSpot",
  marketo: "Marketo",
  pardot: "Pardot",
  "react-custom": "React/custom",
  unknown: "Unknown"
};

let cachedForms = [];
let selectedFormIndex = 0;

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function fetchForms() {
  const tab = await activeTab();
  if (!tab?.id) return { forms: [] };

  return new Promise((resolve) => {
    chrome.tabs.sendMessage(
      tab.id,
      { type: "get-detected-forms" },
      { frameId: 0 },
      (response) => {
        if (chrome.runtime.lastError) {
          resolve({ error: chrome.runtime.lastError.message, forms: [] });
        } else {
          resolve(response ?? { forms: [] });
        }
      }
    );
  });
}

function render({ forms = [], error } = {}) {
  cachedForms = forms;

  if (error) {
    statusEl.textContent = "extension can't read this page";
    formsEl.innerHTML = `<div class="empty">${error}</div>`;
    openBtn.disabled = true;
    return;
  }

  if (forms.length === 0) {
    statusEl.textContent = "no forms detected";
    formsEl.innerHTML = `<div class="empty">No forms detected on this page yet. Use "Run demo without a form" below.</div>`;
    openBtn.disabled = true;
    return;
  }

  statusEl.textContent = `${forms.length} form${forms.length === 1 ? "" : "s"} detected`;
  formsEl.innerHTML = forms
    .map((f, i) => {
      const fieldNames = f.fields
        .filter((x) => x.name || x.label)
        .slice(0, 4)
        .map((x) => x.name || x.label)
        .join(", ");
      const selected = i === selectedFormIndex ? " selected" : "";
      return `
        <div class="form-card${selected}" data-index="${i}">
          <div class="form-vendor">${VENDOR_LABEL[f.vendor] ?? f.vendor}</div>
          <div class="form-meta">
            ${f.fields.length} field${f.fields.length === 1 ? "" : "s"}
            · confidence ${(f.confidence * 100).toFixed(0)}%
          </div>
          ${fieldNames ? `<div class="form-fields">${fieldNames}</div>` : ""}
        </div>
      `;
    })
    .join("");

  formsEl.querySelectorAll(".form-card").forEach((card) => {
    card.addEventListener("click", () => {
      selectedFormIndex = Number(card.dataset.index);
      formsEl.querySelectorAll(".form-card").forEach((c) => c.classList.remove("selected"));
      card.classList.add("selected");
    });
  });

  openBtn.disabled = false;
}

async function openOverlay({ formIndex = selectedFormIndex } = {}) {
  const tab = await activeTab();
  if (!tab?.id) return;
  chrome.tabs.sendMessage(
    tab.id,
    {
      type: "open-overlay",
      payload: { formIndex, workflowId: workflowPicker.value }
    },
    { frameId: 0 },
    () => {
      if (chrome.runtime.lastError) {
        statusEl.textContent = chrome.runtime.lastError.message;
        return;
      }
      window.close(); // close the popup so the AE can see the overlay
    }
  );
}

openBtn.addEventListener("click", () => openOverlay());

sandboxBtn.addEventListener("click", async () => {
  const tab = await activeTab();
  if (!tab?.id) return;
  chrome.tabs.sendMessage(
    tab.id,
    {
      type: "open-overlay",
      payload: { mode: "sandbox", workflowId: workflowPicker.value }
    },
    { frameId: 0 },
    () => {
      if (chrome.runtime.lastError) {
        statusEl.textContent = chrome.runtime.lastError.message;
        return;
      }
      window.close();
    }
  );
});

fetchForms().then(render);
