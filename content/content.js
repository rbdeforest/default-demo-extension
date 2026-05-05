// Main content script (isolated world). Runs on every frame.

(function () {
  const ns = window.DefaultDemo;
  const MessageTypes = ns.MessageTypes;

  let detectedForms = [];
  const detachByForm = new WeakMap();
  let autoOpenOverlay = true;
  let extensionAlive = true;
  let observer = null;

  function isExtensionAlive() {
    try { return !!chrome.runtime?.id; } catch (e) { return false; }
  }

  function safeSend(message) {
    if (!extensionAlive) return;
    try {
      const p = chrome.runtime.sendMessage(message);
      if (p && typeof p.catch === "function") p.catch(() => {});
    } catch (err) {
      if (err?.message?.includes("Extension context invalidated")) {
        teardown();
      }
    }
  }

  function teardown() {
    extensionAlive = false;
    try { observer?.disconnect(); } catch (e) {}
  }

  try {
    if (chrome.storage?.sync) {
      chrome.storage.sync.get({ autoOpenOverlay: true }, (s) => {
        try { autoOpenOverlay = !!s.autoOpenOverlay; } catch (e) { teardown(); }
      });
      chrome.storage.onChanged.addListener((changes, area) => {
        try {
          if (area === "sync" && "autoOpenOverlay" in changes) {
            autoOpenOverlay = !!changes.autoOpenOverlay.newValue;
          }
        } catch (e) { teardown(); }
      });
    }
  } catch (e) { teardown(); }

  function onSubmitIntercepted({ formData, vendor, source }) {
    if (!autoOpenOverlay) {
      console.log("[Default Demo] form intercepted (overlay disabled)", { vendor, formData });
      return;
    }
    if (window === window.top) {
      ns.overlay.open({
        formData,
        vendor,
        sourceUrl: location.hostname
      });
    } else {
      safeSend({
        type: MessageTypes.FORM_INTERCEPTED,
        payload: { formData, vendor, sourceUrl: location.hostname }
      });
    }
  }

  function attachInterceptors() {
    detectedForms.forEach((d) => {
      if (!d || !d.element) return;
      if (detachByForm.has(d.element)) return;
      const detach = ns.attachInterceptor(d, onSubmitIntercepted);
      detachByForm.set(d.element, detach);
    });
  }

  function runDetection() {
    if (!extensionAlive) return;
    detectedForms = ns.detectForms();
    const summary = ns.summarizeDetected(detectedForms);
    safeSend({
      type: MessageTypes.FORMS_DETECTED,
      payload: { url: location.href, forms: summary }
    });
    attachInterceptors();
  }

  runDetection();

  let mutationTimer = null;
  observer = new MutationObserver(() => {
    if (mutationTimer || !extensionAlive) return;
    mutationTimer = setTimeout(() => {
      mutationTimer = null;
      runDetection();
    }, 500);
  });
  try {
    observer.observe(document.documentElement, { childList: true, subtree: true });
  } catch (e) { teardown(); }

  // Mark user intent on any click/submit so the main-world injector knows when to
  // intercept network calls. Without this gate, SaaS apps' background API calls
  // (which include emails in payloads) would constantly trigger the overlay.
  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest("button, input[type=submit], input[type=button], [role=button], a[href]");
    if (!button) return;
    if (ns.markUserIntent) ns.markUserIntent();
  }, { capture: true });
  document.addEventListener("submit", () => {
    if (ns.markUserIntent) ns.markUserIntent();
  }, { capture: true });

  // Listen for the injector's main-world fetch/XHR interception.
  window.addEventListener("default-demo:fetch-intercepted", (event) => {
    if (!ns.INTERCEPT_ENABLED) return;
    if (!ns.hasRecentUserIntent || !ns.hasRecentUserIntent()) return; // double-check on the iso-world side
    if (ns.interceptorRecentlyFired && ns.interceptorRecentlyFired()) return;
    if (ns.markInterceptorFired) ns.markInterceptorFired();

    const detail = event.detail || {};
    const formData = detail.body || {};
    onSubmitIntercepted({
      formData,
      vendor: "network",
      source: detail.url || location.hostname
    });
  });

  function buildFormDataFromDetected(detected) {
    if (!detected) return { formData: {}, vendor: "form" };
    const formData = {};
    detected.fields.forEach((f) => {
      const key = f.name || f.label;
      if (!key) return;
      let value = "";
      try { value = f.element?.value ?? ""; } catch (e) {}
      formData[key] = value;
    });
    return { formData, vendor: detected.vendor };
  }

  function onRuntimeMessage(message, sender, sendResponse) {
    if (!extensionAlive) return;
    if (message?.type === MessageTypes.GET_DETECTED_FORMS) {
      sendResponse({
        url: location.href,
        isTopFrame: window === window.top,
        forms: ns.summarizeDetected(detectedForms)
      });
      return true;
    }

    if (message?.type === MessageTypes.OPEN_OVERLAY) {
      if (window !== window.top) return;
      const payload = message.payload || {};
      if (payload.mode === "sandbox" || payload.formIndex === -1) {
        ns.overlay.open({
          mode: "sandbox",
          sourceUrl: location.hostname,
          workflowId: payload.workflowId,
          force: true
        });
      } else {
        const idx = payload.formIndex ?? 0;
        const detected = detectedForms[idx];
        const { formData, vendor } = buildFormDataFromDetected(detected);
        ns.overlay.open({
          formData,
          vendor,
          sourceUrl: location.hostname,
          workflowId: payload.workflowId,
          force: true
        });
      }
      sendResponse({ ok: true });
      return true;
    }

    if (message?.type === MessageTypes.CLOSE_OVERLAY) {
      if (window === window.top) ns.overlay.close();
      sendResponse({ ok: true });
      return true;
    }

    // Forwarded from sub-frames via background.
    if (message?.type === MessageTypes.FORM_INTERCEPTED && window === window.top) {
      if (!autoOpenOverlay) {
        console.log("[Default Demo] cross-frame intercept (overlay disabled)", message.payload);
        return;
      }
      ns.overlay.open({
        formData: message.payload?.formData ?? {},
        vendor: message.payload?.vendor || "form",
        sourceUrl: message.payload?.sourceUrl || location.hostname
      });
    }
  }

  try {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      try {
        return onRuntimeMessage(message, sender, sendResponse);
      } catch (err) {
        if (err?.message?.includes("Extension context invalidated")) teardown();
      }
    });
  } catch (e) { teardown(); }
})();
