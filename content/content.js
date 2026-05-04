// Main content script (isolated world). Runs on every frame.

(function () {
  const ns = window.DefaultDemo;
  const MessageTypes = ns.MessageTypes;

  let detectedForms = [];
  const detachByForm = new WeakMap();

  function onSubmitIntercepted({ formData, vendor, source }) {
    // Forward to top frame's overlay. Same-frame fast path when we ARE the top frame.
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

  // Listen for the injector's main-world fetch/XHR interception.
  window.addEventListener("default-demo:fetch-intercepted", (event) => {
    if (!ns.INTERCEPT_ENABLED) return;
    if (ns.interceptorRecentlyFired && ns.interceptorRecentlyFired()) return; // DOM hook already won
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
      const idx = message.payload?.formIndex ?? 0;
      const detected = idx >= 0 ? detectedForms[idx] : null;
      const { formData, vendor } = buildFormDataFromDetected(detected);
      ns.overlay.open({
        formData,
        vendor,
        sourceUrl: location.hostname,
        workflowId: message.payload?.workflowId
      });
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
      ns.overlay.open({
        formData: message.payload?.formData ?? {},
        vendor: message.payload?.vendor || "form",
        sourceUrl: message.payload?.sourceUrl || location.hostname
      });
    }
  });
})();
