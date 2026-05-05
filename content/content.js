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

  function applyOverlayVisibility(visible) {
    // Toggle controls the on-form marker outline only. The slide-in trace panel
    // always opens on form detection / submit regardless of this setting.
    ns.overlayVisible = !!visible;
    if (typeof ns.setMarkersVisible === "function") ns.setMarkersVisible(!!visible);
  }

  try {
    if (chrome.storage?.local) {
      chrome.storage.local.get({ autoOpenOverlay: true }, (s) => {
        try {
          applyOverlayVisibility(!!s.autoOpenOverlay);
          console.log("[Default Demo] overlay visible (initial):", autoOpenOverlay);
        } catch (e) { teardown(); }
      });
      chrome.storage.onChanged.addListener((changes, area) => {
        if (!isExtensionAlive()) { teardown(); return; }
        try {
          if (area === "local" && changes && "autoOpenOverlay" in changes) {
            applyOverlayVisibility(!!changes.autoOpenOverlay.newValue);
            console.log("[Default Demo] overlay visible (changed):", autoOpenOverlay);
          }
        } catch (e) { teardown(); }
      });
    }
  } catch (e) { teardown(); }

  function onSubmitIntercepted({ formData, vendor, source }) {
    const normalized = normalizeFormData(formData);
    console.log("[Default Demo] intercept fired. vendor:", vendor, "normalized:", normalized);
    if (window === window.top) {
      ns.overlay.open({
        formData: normalized,
        vendor,
        sourceUrl: location.hostname,
        autoRun: true,
        force: true
      });
    } else {
      safeSend({
        type: MessageTypes.FORM_INTERCEPTED,
        payload: { formData: normalized, vendor, sourceUrl: location.hostname, autoRun: true }
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

  let hasAutoOpened = false;

  function maybeAutoOpen() {
    if (hasAutoOpened) return;
    if (window !== window.top) return;
    if (!detectedForms || detectedForms.length === 0) return;
    if (!ns.overlay?.open) return;

    const detected = detectedForms[0];
    if (detected.element instanceof HTMLIFrameElement) return;
    const { formData, vendor } = buildFormDataFromDetected(detected);
    console.log("[Default Demo] auto-opening overlay for", vendor);
    ns.overlay.open({
      formData,
      vendor,
      sourceUrl: location.hostname,
      force: true
    });
    hasAutoOpened = true;
  }

  let injectorDisabled = false;

  function syncInjectorState() {
    const isMarketing = !ns.looksLikeMarketingPage || ns.looksLikeMarketingPage();
    const shouldDisable = !isMarketing;
    if (shouldDisable === injectorDisabled) return;
    injectorDisabled = shouldDisable;
    try {
      window.dispatchEvent(new CustomEvent(
        shouldDisable ? "default-demo:disable-injector" : "default-demo:enable-injector"
      ));
    } catch (e) {}
  }

  function runDetection() {
    if (!extensionAlive) return;
    detectedForms = ns.detectForms();
    const summary = ns.summarizeDetected(detectedForms);
    safeSend({
      type: MessageTypes.FORMS_DETECTED,
      payload: { url: location.href, forms: summary }
    });
    syncInjectorState();
    attachInterceptors();
    maybeAutoOpen();
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
    if (!ns.hasRecentUserIntent || !ns.hasRecentUserIntent()) return;
    if (ns.interceptorRecentlyFired && ns.interceptorRecentlyFired()) return;
    if (ns.markInterceptorFired) ns.markInterceptorFired();

    const detail = event.detail || {};
    const formData = detail.body || {};
    onSubmitIntercepted({
      formData,
      vendor: detail.vendor || "network",
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
    return { formData: normalizeFormData(formData), vendor: detected.vendor };
  }

  // v1 only pushes Email + Name through to the workflow. Pull them out of
  // whatever shape the source form used (first_name + last_name, full name, etc.).
  function normalizeFormData(input) {
    const result = { email: "", name: "" };
    let firstName = "";
    let lastName = "";
    for (const [key, value] of Object.entries(input || {})) {
      if (typeof value !== "string") continue;
      const lk = String(key).toLowerCase();
      if (!result.email && /e[-_]?mail/.test(lk)) result.email = value;
      if (!firstName && /(^|[^a-z])(first[-_]?name|fname|firstname|givenname)([^a-z]|$)/.test(lk)) firstName = value;
      if (!lastName && /(^|[^a-z])(last[-_]?name|lname|lastname|surname|familyname)([^a-z]|$)/.test(lk)) lastName = value;
      if (!result.name && /^(name|full[-_]?name|fullname)$/.test(lk)) result.name = value;
    }
    if (!result.name && (firstName || lastName)) result.name = `${firstName} ${lastName}`.trim();
    return result;
  }
  ns.normalizeFormData = normalizeFormData;

  // Saved-picks lookup. When set, form-detector returns a "manual" detected form.
  ns.savedPicks = [];
  async function refreshSavedPicks() {
    if (!ns.picker?.loadSavedPicks) return;
    try {
      const saved = await ns.picker.loadSavedPicks();
      ns.savedPicks = ns.picker.readSavedPicksFromDOM(saved);
    } catch (e) { ns.savedPicks = []; }
  }
  refreshSavedPicks().then(() => runDetection());

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

    if (message?.type === MessageTypes.ENTER_PICKER_MODE) {
      if (window !== window.top) return;
      ns.picker?.enter().then(() => refreshSavedPicks().then(runDetection));
      sendResponse({ ok: true });
      return true;
    }

    if (message?.type === MessageTypes.CLEAR_SAVED_PICKS) {
      if (window !== window.top) return;
      try {
        chrome.storage.local.remove(ns.picker?.storageKey, () => {
          ns.savedPicks = [];
          runDetection();
          sendResponse({ ok: true });
        });
      } catch (e) { sendResponse({ ok: false }); }
      return true;
    }

    // Forwarded from sub-frames via background.
    if (message?.type === MessageTypes.FORM_INTERCEPTED && window === window.top) {
      ns.overlay.open({
        formData: normalizeFormData(message.payload?.formData ?? {}),
        vendor: message.payload?.vendor || "form",
        sourceUrl: message.payload?.sourceUrl || location.hostname,
        autoRun: !!message.payload?.autoRun,
        force: true
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
