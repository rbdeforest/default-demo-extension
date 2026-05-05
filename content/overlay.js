// Trace panel overlay. Mounts a shadow-DOM container into the top frame.
// Exposes: window.DefaultDemo.overlay = { open, close, isOpen, pushTraceEvent, setFormData, clearTrace }

(function () {
  const ns = window.DefaultDemo;
  const BRAND = ns.BRAND;

  let host = null;
  let shadow = null;
  let root = null; // <div class="panel">
  let formFieldsEl = null;
  let traceListEl = null;
  let workflowSelectEl = null;
  let runBtn = null;
  let titleEl = null;
  let toastEl = null;
  let currentFormData = {};
  let currentWorkflowId = "placeholder";
  let currentRun = null; // { abort: fn, generator }
  let lastUserCloseAt = 0; // remember explicit close so stray intercepts can't reopen

  const OVERLAY_HOST_ID = "default-demo-overlay-root";

  function ensureMounted() {
    if (host && document.documentElement.contains(host)) return;

    // <dialog> + showModal() is the most reliable way to enter the browser's
    // top layer (above any z-index, above any other modal). Yes, it makes the
    // rest of the page inert while open — the AE has to close our overlay to
    // get back to the prospect's page, which is fine for a demo trace.
    host = document.createElement("dialog");
    host.id = OVERLAY_HOST_ID;
    // The host occupies the full 480px right rail at all times so the dialog's
    // paint area (and therefore its top-layer rendering) covers the panel.
    // Slide-in animation lives on the inner .panel element.
    host.style.cssText = [
      "position: fixed",
      "top: 0", "right: 0", "bottom: 0", "left: auto",
      "width: 480px", "height: 100vh",
      "max-width: none", "max-height: none",
      "margin: 0", "padding: 0", "border: 0",
      "background: transparent",
      "overflow: visible",
      "color: inherit",
      "display: block",
      "pointer-events: none",
      "z-index: 2147483647"
    ].join("; ") + ";";
    document.documentElement.appendChild(host);

    // Disable the default <dialog> backdrop dim so we don't grey out the page.
    if (!document.getElementById("default-demo-backdrop-fix")) {
      const fix = document.createElement("style");
      fix.id = "default-demo-backdrop-fix";
      fix.textContent = `#${OVERLAY_HOST_ID}::backdrop { background: transparent; }`;
      document.head.appendChild(fix);
    }

    shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = TEMPLATE;

    root = shadow.querySelector(".panel");
    formFieldsEl = shadow.querySelector(".form-fields");
    traceListEl = shadow.querySelector(".trace-list");
    workflowSelectEl = shadow.querySelector(".workflow-select");
    runBtn = shadow.querySelector(".run-btn");
    titleEl = shadow.querySelector(".vendor-pill");
    toastEl = shadow.querySelector(".safety-toast");

    populateWorkflowOptions();

    shadow.querySelector(".close-btn").addEventListener("click", close);
    runBtn.addEventListener("click", () => {
      if (currentRun) {
        cancelRun();
      } else {
        runWorkflow();
      }
    });
    workflowSelectEl.addEventListener("change", (e) => {
      currentWorkflowId = e.target.value;
    });

    // In-overlay "Show" toggle — same storage key as the popup.
    const toggleInput = shadow.querySelector(".overlay-toggle-input");
    if (toggleInput && chrome.storage?.local) {
      try {
        chrome.storage.local.get({ autoOpenOverlay: true }, (s) => {
          try { toggleInput.checked = !!s.autoOpenOverlay; } catch (e) {}
        });
        toggleInput.addEventListener("change", () => {
          try { chrome.storage.local.set({ autoOpenOverlay: toggleInput.checked }); } catch (e) {}
        });
      } catch (e) {}
    }
  }

  function populateWorkflowOptions() {
    workflowSelectEl.innerHTML = "";
    ns.workflows.forEach((w) => {
      const opt = document.createElement("option");
      opt.value = w.id;
      opt.textContent = w.name;
      workflowSelectEl.appendChild(opt);
    });
    if (ns.getWorkflow(currentWorkflowId)) {
      workflowSelectEl.value = currentWorkflowId;
    } else if (ns.workflows[0]) {
      currentWorkflowId = ns.workflows[0].id;
      workflowSelectEl.value = currentWorkflowId;
    }
  }

  const VENDOR_DISPLAY = {
    html: "HTML Form",
    hubspot: "HubSpot Form",
    marketo: "Marketo Form",
    pardot: "Pardot Form",
    chilipiper: "ChiliPiper Form",
    calendly: "Calendly Form",
    "react-custom": "Custom React Form",
    network: "Network Capture",
    sandbox: "Sandbox",
    manual: "Manual Picks",
    form: "Form"
  };

  function setFormData(data, vendor, source) {
    currentFormData = { ...(data || {}) };
    const friendly = VENDOR_DISPLAY[vendor] || vendor || "Form";
    titleEl.textContent = friendly;

    const vendorBigEl = shadow.querySelector(".vendor-big");
    if (vendorBigEl) vendorBigEl.textContent = friendly;

    const sourceLineEl = shadow.querySelector(".source-line");
    if (vendor === "sandbox") {
      if (sourceLineEl) sourceLineEl.textContent = "No form on this page";
    } else {
      if (sourceLineEl) sourceLineEl.innerHTML = `Captured from <span class="source-host">${source || location.hostname}</span>`;
    }

    const techEl = shadow.querySelector(".source-tech");
    const ctx = ns.getProspectContext ? ns.getProspectContext() : null;
    if (techEl) {
      const tech = ctx?.detectedTech || [];
      if (tech.length) {
        techEl.textContent = "Detected: " + tech.join(", ");
        techEl.style.display = "block";
      } else {
        techEl.style.display = "none";
      }
    }

    formFieldsEl.innerHTML = "";
    const entries = Object.entries(currentFormData);
    if (entries.length === 0) {
      formFieldsEl.innerHTML = `<div class="empty">No fields captured. Use the picker or sandbox form.</div>`;
      return;
    }
    entries.forEach(([name, value]) => {
      const row = document.createElement("label");
      row.className = "field";
      const labelText = document.createElement("span");
      labelText.className = "field-label";
      labelText.textContent = name;
      const input = document.createElement("input");
      input.className = "field-input";
      input.value = value ?? "";
      input.dataset.name = name;
      input.addEventListener("input", (e) => {
        currentFormData[name] = e.target.value;
      });
      row.appendChild(labelText);
      row.appendChild(input);
      formFieldsEl.appendChild(row);
    });
  }

  function clearTrace() {
    traceListEl.innerHTML = "";
  }

  function pushTraceEvent(event) {
    const ts = new Date();
    const stamp =
      String(ts.getHours()).padStart(2, "0") + ":" +
      String(ts.getMinutes()).padStart(2, "0") + ":" +
      String(ts.getSeconds()).padStart(2, "0") + "." +
      String(ts.getMilliseconds()).padStart(3, "0");

    // Update existing row when status transitions running → success/failed.
    const existing = traceListEl.querySelector(`[data-step="${CSS.escape(event.step)}"]`);
    if (existing && (event.status === "success" || event.status === "failed")) {
      existing.dataset.status = event.status;
      existing.querySelector(".trace-icon").textContent = iconFor(event.status);
      existing.querySelector(".trace-duration").textContent = event.durationMs != null ? `${event.durationMs}ms` : "";
      existing.querySelector(".trace-message").textContent = summaryFor(event);
      attachExpandable(existing, event);
      traceListEl.scrollTop = traceListEl.scrollHeight;
      return;
    }

    const row = document.createElement("div");
    row.className = "trace-row";
    row.dataset.step = event.step;
    row.dataset.status = event.status;
    row.innerHTML = `
      <span class="trace-icon">${iconFor(event.status)}</span>
      <span class="trace-time">${stamp}</span>
      <span class="trace-step">${event.step}</span>
      <span class="trace-duration">${event.durationMs != null ? event.durationMs + "ms" : (event.status === "running" ? "…" : "")}</span>
      <span class="trace-message">${summaryFor(event)}</span>
    `;
    attachExpandable(row, event);
    traceListEl.appendChild(row);
    traceListEl.scrollTop = traceListEl.scrollHeight;
  }

  function attachExpandable(row, event) {
    row.style.cursor = "pointer";
    row.onclick = () => {
      const existingPanel = row.nextElementSibling;
      if (existingPanel && existingPanel.classList.contains("trace-detail")) {
        existingPanel.remove();
        return;
      }
      const panel = document.createElement("pre");
      panel.className = "trace-detail";
      panel.textContent = JSON.stringify({ input: event.input, output: event.output, error: event.error }, null, 2);
      row.after(panel);
    };
  }

  function iconFor(status) {
    return { pending: "○", running: "▸", success: "✓", failed: "✗" }[status] || "·";
  }

  function summaryFor(event) {
    if (event.status === "failed" && event.error) return event.error;
    if (event.output) {
      const o = event.output;
      if (typeof o === "object") {
        const parts = Object.entries(o).slice(0, 2).map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`);
        return parts.join(" · ");
      }
      return String(o);
    }
    if (event.status === "running") return "running…";
    return "";
  }

  async function runWorkflow() {
    const workflow = ns.getWorkflow(currentWorkflowId);
    if (!workflow) return;
    clearTrace();
    runBtn.textContent = "Cancel";
    runBtn.dataset.state = "running";

    const context = ns.getProspectContext ? ns.getProspectContext() : { domain: location.hostname };
    const generator = workflow.run({ ...currentFormData }, context);
    let aborted = false;
    currentRun = { abort: () => { aborted = true; }, generator };

    try {
      for await (const event of generator) {
        if (aborted) break;
        pushTraceEvent(event);
      }
      if (!aborted) showToast(`Form intercepted by Default Demo — no data was sent to ${location.hostname}`);
    } catch (err) {
      pushTraceEvent({ step: "runner", status: "failed", error: err?.message || String(err) });
    } finally {
      currentRun = null;
      runBtn.textContent = "Re-run";
      runBtn.dataset.state = "idle";
    }
  }

  function cancelRun() {
    if (currentRun) currentRun.abort();
  }

  function showToast(message) {
    toastEl.textContent = message;
    toastEl.classList.add("visible");
    setTimeout(() => toastEl.classList.remove("visible"), 4000);
  }

  function sandboxDefaults() {
    const ctx = ns.getProspectContext ? ns.getProspectContext() : null;
    const domain = (ctx?.domain || "example.com").replace(/^www\./, "");
    return {
      email: `alex.kim@${domain}`,
      name: "Alex Kim"
    };
  }

  function ensureTopLayer() {
    if (!host) return;
    try {
      if (host.open) host.close();
      if (typeof host.showModal === "function") {
        host.showModal();
        console.log("[Default Demo] overlay showModal — open:", host.open);
      } else {
        console.log("[Default Demo] showModal not available on host");
      }
    } catch (e) {
      console.warn("[Default Demo] showModal failed:", e?.message);
    }
  }

  function open(opts = {}) {
    if (window !== window.top) return;
    if (!opts.force && Date.now() - lastUserCloseAt < 5000) return;
    ensureMounted();
    ensureTopLayer();

    if (opts.mode === "sandbox") {
      const defaults = sandboxDefaults();
      setFormData(defaults, "sandbox", opts.sourceUrl);
    } else if (opts.formData) {
      setFormData(opts.formData, opts.vendor, opts.sourceUrl);
    } else if (Object.keys(currentFormData).length === 0) {
      setFormData({}, opts.vendor, opts.sourceUrl);
    }

    if (opts.workflowId) {
      currentWorkflowId = opts.workflowId;
      workflowSelectEl.value = opts.workflowId;
    }
    requestAnimationFrame(() => {
      host.style.pointerEvents = "auto";
      root.classList.add("open");
    });
    if (opts.autoRun) {
      // Tiny delay so the user sees the captured values flash in before the trace starts.
      setTimeout(() => { if (!currentRun) runWorkflow(); }, 220);
    }
  }

  function close(reason) {
    if (!root) return;
    if (reason !== "auto") lastUserCloseAt = Date.now();
    root.classList.remove("open");
    cancelRun();
    setTimeout(() => {
      host.style.pointerEvents = "none";
      try { if (host.open) host.close(); } catch (e) {}
    }, 240);
  }

  function isOpen() {
    return !!root && root.classList.contains("open");
  }

  ns.overlay = { open, close, isOpen, pushTraceEvent, setFormData, clearTrace };

  // ---- template ----
  const TEMPLATE = `
    <style>
      :host { all: initial; }
      * { box-sizing: border-box; margin: 0; padding: 0; }

      .panel {
        position: absolute;
        top: 0; right: 0; bottom: 0;
        width: 480px;
        background: ${BRAND.black};
        color: ${BRAND.white};
        font-family: "Inter", -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
        font-size: 13px;
        line-height: 1.45;
        border-left: 1px solid rgba(255, 255, 255, 0.08);
        box-shadow: -16px 0 48px rgba(0, 0, 0, 0.7);
        transform: translateX(100%);
        transition: transform 240ms cubic-bezier(0.16, 1, 0.3, 1);
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }
      .panel.open { transform: translateX(0); }

      .header {
        display: flex; align-items: center; justify-content: space-between;
        padding: 14px 18px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.08);
        flex-shrink: 0;
      }
      .header-left { display: flex; align-items: center; gap: 10px; }
      .logo-dot {
        width: 8px; height: 8px; border-radius: 50%;
        background: ${BRAND.purple};
        box-shadow: 0 0 10px ${BRAND.purple};
      }
      .header-title { font-size: 13px; font-weight: 600; letter-spacing: -0.01em; }
      .vendor-pill {
        margin-left: 8px;
        font-family: "JetBrains Mono", "SF Mono", ui-monospace, monospace;
        font-size: 10px;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        padding: 2px 6px;
        background: rgba(99, 0, 255, 0.18);
        color: ${BRAND.purple};
        border: 1px solid rgba(99, 0, 255, 0.4);
        border-radius: 3px;
      }
      .close-btn {
        background: transparent; border: none;
        color: rgba(255, 255, 255, 0.55);
        font-size: 18px;
        cursor: pointer;
        padding: 4px 8px;
      }
      .close-btn:hover { color: ${BRAND.white}; }

      .section {
        padding: 14px 18px;
      }
      .section + .section {
        border-top: 1px solid rgba(255, 255, 255, 0.06);
      }
      .section-label {
        font-family: "JetBrains Mono", "SF Mono", ui-monospace, monospace;
        font-size: 10px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: rgba(255, 255, 255, 0.4);
        margin-bottom: 10px;
      }

      .vendor-big {
        font-size: 18px;
        font-weight: 600;
        letter-spacing: -0.01em;
        color: ${BRAND.white};
        margin-bottom: 6px;
      }
      .source {
        font-size: 11px;
        color: rgba(255, 255, 255, 0.45);
        margin-bottom: 4px;
        font-family: "JetBrains Mono", "SF Mono", ui-monospace, monospace;
      }
      .source-host { color: ${BRAND.purple}; }
      .source-tech {
        display: none;
        font-size: 10.5px;
        color: rgba(255, 255, 255, 0.5);
        margin-bottom: 10px;
        font-family: "JetBrains Mono", "SF Mono", ui-monospace, monospace;
      }

      .form-fields {
        display: flex; flex-direction: column; gap: 8px;
        max-height: 240px;
        overflow-y: auto;
      }
      .form-fields .empty {
        color: rgba(255, 255, 255, 0.4);
        font-size: 12px;
        padding: 8px 0;
      }
      .field { display: flex; flex-direction: column; gap: 3px; }
      .field-label {
        font-family: "JetBrains Mono", "SF Mono", ui-monospace, monospace;
        font-size: 10px;
        color: rgba(255, 255, 255, 0.55);
      }
      .field-input {
        background: rgba(255, 255, 255, 0.04);
        color: ${BRAND.white};
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 4px;
        padding: 7px 9px;
        font-family: inherit;
        font-size: 13px;
        outline: none;
        transition: border-color 120ms ease;
      }
      .field-input:focus { border-color: ${BRAND.purple}; }

      .trace-section {
        flex: 1;
        display: flex;
        flex-direction: column;
        min-height: 200px;
      }
      .trace-list {
        flex: 1;
        overflow-y: auto;
        font-family: "JetBrains Mono", "SF Mono", ui-monospace, monospace;
        font-size: 11.5px;
        line-height: 1.6;
        padding-bottom: 8px;
      }
      .trace-list:empty::after {
        content: "Click Run to simulate this workflow.";
        display: block;
        color: rgba(255, 255, 255, 0.35);
        font-family: "Inter", system-ui, sans-serif;
        font-size: 12px;
        padding: 24px 0;
        text-align: center;
      }
      .trace-row {
        display: grid;
        grid-template-columns: 18px 92px 1fr 64px;
        gap: 8px;
        padding: 5px 2px;
        border-radius: 3px;
        align-items: baseline;
      }
      .trace-row[data-status="running"] .trace-icon { color: ${BRAND.purple}; animation: pulse 1.2s ease-in-out infinite; }
      .trace-row[data-status="success"] .trace-icon { color: ${BRAND.purple}; }
      .trace-row[data-status="failed"] .trace-icon { color: ${BRAND.error}; }
      .trace-row[data-status="pending"] .trace-icon { color: rgba(255, 255, 255, 0.4); }
      .trace-time { color: rgba(255, 255, 255, 0.35); }
      .trace-step { color: ${BRAND.white}; }
      .trace-duration { color: rgba(255, 255, 255, 0.4); text-align: right; }
      .trace-message {
        grid-column: 3 / 5;
        color: rgba(255, 255, 255, 0.55);
        font-family: "Inter", system-ui, sans-serif;
        font-size: 11.5px;
      }
      .trace-detail {
        margin: 4px 0 8px 26px;
        padding: 8px 10px;
        background: rgba(255, 255, 255, 0.03);
        border: 1px solid rgba(255, 255, 255, 0.06);
        border-radius: 4px;
        font-family: "JetBrains Mono", "SF Mono", ui-monospace, monospace;
        font-size: 10.5px;
        color: rgba(255, 255, 255, 0.7);
        white-space: pre-wrap;
        word-break: break-word;
      }
      @keyframes pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.4; }
      }

      .actions {
        display: flex; align-items: center; gap: 8px;
        padding: 12px 18px;
        border-top: 1px solid rgba(255, 255, 255, 0.08);
        background: rgba(255, 255, 255, 0.02);
        flex-shrink: 0;
      }
      .run-btn {
        background: ${BRAND.purple};
        color: ${BRAND.white};
        border: none;
        border-radius: 5px;
        padding: 8px 16px;
        font-size: 13px;
        font-weight: 500;
        cursor: pointer;
        font-family: inherit;
      }
      .run-btn[data-state="running"] { background: ${BRAND.error}; }

      .workflow-select {
        background: rgba(255, 255, 255, 0.04);
        color: ${BRAND.white};
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 5px;
        padding: 7px 9px;
        font-size: 12px;
        font-family: inherit;
      }
      .overlay-toggle {
        margin-left: auto;
        display: flex;
        align-items: center;
        gap: 6px;
        cursor: pointer;
        user-select: none;
      }
      .overlay-toggle input { display: none; }
      .overlay-toggle-track {
        position: relative;
        width: 26px;
        height: 14px;
        background: rgba(255, 255, 255, 0.12);
        border-radius: 999px;
        transition: background 140ms ease;
      }
      .overlay-toggle-thumb {
        position: absolute;
        top: 2px; left: 2px;
        width: 10px; height: 10px;
        background: ${BRAND.white};
        border-radius: 50%;
        transition: left 140ms ease;
      }
      .overlay-toggle input:checked ~ .overlay-toggle-track { background: ${BRAND.purple}; }
      .overlay-toggle input:checked ~ .overlay-toggle-track .overlay-toggle-thumb { left: 14px; }
      .overlay-toggle-label {
        font-size: 11px;
        color: rgba(255, 255, 255, 0.75);
      }

      .safety-toast {
        position: absolute;
        bottom: 70px; left: 18px; right: 18px;
        padding: 10px 12px;
        background: rgba(99, 0, 255, 0.12);
        border: 1px solid rgba(99, 0, 255, 0.45);
        color: ${BRAND.white};
        border-radius: 5px;
        font-size: 12px;
        opacity: 0;
        transform: translateY(8px);
        transition: opacity 200ms ease, transform 200ms ease;
        pointer-events: none;
      }
      .safety-toast.visible { opacity: 1; transform: translateY(0); }
    </style>

    <div class="panel">
      <div class="header">
        <div class="header-left">
          <div class="logo-dot"></div>
          <div class="header-title">Default Demo</div>
          <div class="vendor-pill">form</div>
        </div>
        <button class="close-btn" aria-label="Close">×</button>
      </div>

      <div class="section">
        <div class="section-label">Source</div>
        <div class="vendor-big">Form</div>
        <div class="source"><span class="source-line">Captured from <span class="source-host">${location.hostname}</span></span></div>
        <div class="source-tech"></div>
        <div class="form-fields"></div>
      </div>

      <div class="section trace-section">
        <div class="section-label">Workflow trace</div>
        <div class="trace-list"></div>
      </div>

      <div class="safety-toast"></div>

      <div class="actions">
        <button class="run-btn" data-state="idle">Run</button>
        <select class="workflow-select"></select>
        <label class="overlay-toggle" title="Hide on this page (still blocks form)">
          <input type="checkbox" class="overlay-toggle-input" checked />
          <span class="overlay-toggle-track"><span class="overlay-toggle-thumb"></span></span>
          <span class="overlay-toggle-label">Show</span>
        </label>
      </div>
    </div>
  `;
})();
