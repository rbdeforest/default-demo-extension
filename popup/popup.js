const statusEl = document.getElementById("status");
const formsEl = document.getElementById("forms");
const openBtn = document.getElementById("open-trace");
const sandboxBtn = document.getElementById("run-sandbox");

const VENDOR_LABEL = {
  html: "Plain HTML",
  hubspot: "HubSpot",
  marketo: "Marketo",
  pardot: "Pardot",
  "react-custom": "React/custom",
  unknown: "Unknown"
};

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function fetchForms() {
  const tab = await activeTab();
  if (!tab?.id) return { forms: [] };

  // Ask all frames; merge results so we see iframe-embedded forms too.
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(
      tab.id,
      { type: "get-detected-forms" },
      { frameId: 0 }, // top frame; iframes report via background in step 8
      (response) => {
        if (chrome.runtime.lastError) {
          // Content script not injected (e.g., chrome:// pages). Surface gracefully.
          resolve({ error: chrome.runtime.lastError.message, forms: [] });
        } else {
          resolve(response ?? { forms: [] });
        }
      }
    );
  });
}

function render({ forms = [], error } = {}) {
  if (error) {
    statusEl.textContent = "extension can't read this page";
    formsEl.innerHTML = `<div class="empty">${error}</div>`;
    openBtn.disabled = true;
    return;
  }

  if (forms.length === 0) {
    statusEl.textContent = "no forms detected";
    formsEl.innerHTML = `<div class="empty">No forms detected on this page yet.</div>`;
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
      return `
        <div class="form-card" data-index="${i}">
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

  openBtn.disabled = false;
}

sandboxBtn.addEventListener("click", () => {
  statusEl.textContent = "sandbox flow lands in step 11";
});

openBtn.addEventListener("click", () => {
  // Wired in step 4 once the overlay exists.
  statusEl.textContent = "overlay UI lands in step 4";
});

fetchForms().then(render);
