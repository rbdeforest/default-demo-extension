// Main content script (isolated world). Runs on every frame.

(function () {
  const ns = window.DefaultDemo;
  const MessageTypes = ns.MessageTypes;

  let detectedForms = [];
  const detachByForm = new WeakMap();
  let autoOpenOverlay = true;

  if (chrome.storage?.sync) {
    chrome.storage.sync.get({ autoOpenOverlay: true }, (s) => {
      autoOpenOverlay = !!s.autoOpenOverlay;
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "sync" && "autoOpenOverlay" in changes) {
        autoOpenOverlay = !!changes.autoOpenOverlay.newValue;
      }
    });
  }

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
      chrome.runtime
        .sendMessage({
          type: MessageTypes.FORM_INTERCEPTED,
          payload: { formData, vendor, sourceUrl: location.hostname }
        })
        .catch(() => {});
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
    detectedForms = ns.detectForms();
    const summary = ns.summarizeDetected(detectedForms);
    chrome.runtime
      .sendMessage({
        type: MessageTypes.FORMS_DETECTED,
        payload: { url: location.href, forms: summary }
      })
      .catch(() => {});
    attachInterceptors();
  }

  runDetection();

  let mutationTimer = null;
  const observer = new MutationObserver(() => {
    if (mutationTimer) return;
    mutationTimer = setTimeout(() => {
      mutationTimer = null;
      runDetection();
    }, 500);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

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

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
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
  });
})();
