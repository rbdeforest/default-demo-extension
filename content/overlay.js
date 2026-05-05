// Trace panel overlay. Mounts a shadow-DOM container into the top frame.
// Exposes: window.DefaultDemo.overlay = { open, close, isOpen, pushTraceEvent, setFormData, clearTrace }

(function () {
  const ns = window.DefaultDemo;
  const BRAND = ns.BRAND;

  const CALENDAR_URL = "https://scheduler.default.com/default/ryan-deforest/30";

  let host = null;
  let shadow = null;
  let root = null; // <div class="panel">
  let formFieldsEl = null;
  let traceListEl = null;
  let workflowSelectEl = null;
  let runBtn = null;
  let titleEl = null;
  let toastEl = null;
  // Separate floating scheduler modal that pops up over the prospect's page.
  let schedulerHost = null;
  let schedulerShadow = null;
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
    // <div> host with popover="manual" — gets top-layer behavior on every modern
    // Chromium build, and unlike <dialog> it supports shadow DOM.
    host = document.createElement("div");
    host.id = OVERLAY_HOST_ID;
    try { host.setAttribute("popover", "manual"); } catch (e) {}
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
    if (techEl) techEl.style.display = "none";

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
    setSummary(null);
  }

  function setSummary(text) {
    const el = shadow?.querySelector(".workflow-summary");
    if (!el) return;
    if (text) {
      el.textContent = text;
      el.hidden = false;
    } else {
      el.textContent = "";
      el.hidden = true;
    }
  }

  function ensureSchedulerMounted() {
    if (schedulerHost && document.documentElement.contains(schedulerHost)) return;
    schedulerHost = document.createElement("div");
    schedulerHost.id = "default-demo-scheduler-root";
    try { schedulerHost.setAttribute("popover", "manual"); } catch (e) {}
    schedulerHost.style.cssText = [
      "position: fixed",
      "top: 0", "left: 0", "right: 0", "bottom: 0",
      "width: 100vw", "height: 100vh",
      "max-width: none", "max-height: none",
      "margin: 0", "padding: 0", "border: 0",
      "background: transparent",
      "overflow: hidden",
      "color: inherit",
      "display: block",
      "pointer-events: none",
      "z-index: 2147483647"
    ].join("; ") + ";";
    document.documentElement.appendChild(schedulerHost);

    schedulerShadow = schedulerHost.attachShadow({ mode: "open" });
    schedulerShadow.innerHTML = `
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        .backdrop {
          position: fixed; inset: 0;
          background: rgba(0, 0, 0, 0.55);
          opacity: 0;
          transition: opacity 200ms ease;
          pointer-events: auto;
        }
        .backdrop.open { opacity: 1; }
        .modal {
          position: fixed;
          top: 50%; left: 50%;
          transform: translate(-50%, -45%) scale(0.96);
          width: min(720px, 92vw);
          height: min(640px, 88vh);
          background: ${BRAND.white};
          border-radius: 12px;
          box-shadow: 0 32px 80px rgba(0, 0, 0, 0.5);
          opacity: 0;
          transition: opacity 200ms ease, transform 280ms cubic-bezier(0.16, 1, 0.3, 1);
          pointer-events: auto;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          font-family: "Inter", -apple-system, system-ui, sans-serif;
        }
        .modal.open {
          transform: translate(-50%, -50%) scale(1);
          opacity: 1;
        }
        .header {
          display: flex; align-items: center; justify-content: space-between;
          padding: 14px 18px;
          border-bottom: 1px solid #ececec;
          font-size: 14px;
          font-weight: 600;
          color: #111;
          flex-shrink: 0;
        }
        .header .dot {
          width: 8px; height: 8px; border-radius: 50%;
          background: ${BRAND.purple};
          display: inline-block;
          margin-right: 8px;
          vertical-align: middle;
        }
        .close-btn {
          background: transparent; border: none;
          font-size: 22px; cursor: pointer;
          color: #888;
          padding: 0 4px;
          line-height: 1;
        }
        .close-btn:hover { color: #111; }
        iframe {
          flex: 1;
          width: 100%;
          border: 0;
          background: ${BRAND.white};
        }
      </style>
      <div class="backdrop"></div>
      <div class="modal">
        <div class="header">
          <span><span class="dot"></span>Schedule a meeting</span>
          <button class="close-btn" aria-label="Close">×</button>
        </div>
        <iframe class="scheduler-iframe" title="Scheduler"></iframe>
      </div>
    `;

    schedulerShadow.querySelector(".close-btn").addEventListener("click", hideScheduler);
    schedulerShadow.querySelector(".backdrop").addEventListener("click", hideScheduler);
  }

  function showScheduler(url) {
    ensureSchedulerMounted();
    const iframe = schedulerShadow.querySelector(".scheduler-iframe");
    if (iframe.src !== url) iframe.src = url;
    schedulerHost.style.pointerEvents = "auto";
    try {
      if (schedulerHost.matches?.(":popover-open")) schedulerHost.hidePopover();
    } catch (e) {}
    try { schedulerHost.showPopover?.(); } catch (e) {}
    requestAnimationFrame(() => {
      schedulerShadow.querySelector(".backdrop").classList.add("open");
      schedulerShadow.querySelector(".modal").classList.add("open");
    });
  }

  function hideScheduler() {
    if (!schedulerShadow || !schedulerHost) return;
    schedulerShadow.querySelector(".backdrop")?.classList.remove("open");
    schedulerShadow.querySelector(".modal")?.classList.remove("open");
    setTimeout(() => {
      try {
        if (schedulerHost.matches?.(":popover-open")) schedulerHost.hidePopover();
      } catch (e) {}
      schedulerHost.style.pointerEvents = "none";
    }, 220);
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

    const startedAt = Date.now();
    let calendarShownAt = null;

    try {
      for await (const event of generator) {
        if (aborted) break;
        pushTraceEvent(event);
        if (event.step === "calendar.display" && event.status === "success" && calendarShownAt === null) {
          calendarShownAt = Date.now();
        }
      }
      if (!aborted) {
        const totalMs = Date.now() - startedAt;
        const calendarMs = calendarShownAt ? calendarShownAt - startedAt : null;
        const calendarLabel = calendarMs != null ? `${calendarMs}ms` : "n/a";
        setSummary(`Workflow completed: time to calendar ${calendarLabel} and time to complete workflow ${totalMs}ms`);
        showToast(`Form intercepted by Default Demo — no data was sent to ${location.hostname}`);
        showScheduler(CALENDAR_URL);
      }
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
    // Re-promote into the top layer on every open so we sit above any modal
    // the page may have promoted after we mounted (LIFO ordering).
    try {
      if (typeof host.matches === "function" && host.matches(":popover-open")) {
        host.hidePopover();
      }
      if (typeof host.showPopover === "function") {
        host.showPopover();
        console.log("[Default Demo] overlay showPopover — open:", host.matches(":popover-open"));
      }
    } catch (e) {
      console.warn("[Default Demo] showPopover failed:", e?.message);
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
    hideScheduler();
    setTimeout(() => {
      host.style.pointerEvents = "none";
      try {
        if (typeof host.hidePopover === "function" && host.matches(":popover-open")) {
          host.hidePopover();
        }
      } catch (e) {}
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
      .workflow-summary {
        font-family: "JetBrains Mono", "SF Mono", ui-monospace, monospace;
        font-size: 11px;
        color: #34d399;
        background: rgba(52, 211, 153, 0.08);
        border: 1px solid rgba(52, 211, 153, 0.3);
        border-radius: 4px;
        padding: 7px 10px;
        margin-bottom: 8px;
        line-height: 1.5;
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
        <div class="workflow-summary" hidden></div>
        <div class="trace-list"></div>
      </div>

      <div class="safety-toast"></div>

      <div class="actions">
        <button class="run-btn" data-state="idle">Run</button>
        <select class="workflow-select"></select>
        <label class="overlay-toggle" title="Show the marker outline on detected forms">
          <input type="checkbox" class="overlay-toggle-input" checked />
          <span class="overlay-toggle-track"><span class="overlay-toggle-thumb"></span></span>
          <span class="overlay-toggle-label">Outline</span>
        </label>
      </div>
    </div>
  `;
})();
