// Main content script (isolated world). Runs on every frame.
// In top frame: orchestrates detection, overlay open/close, and message handling.
// In sub-frames: detection only; overlay lives in the top frame.

(function () {
  const ns = window.DefaultDemo;
  const MessageTypes = ns.MessageTypes;

  let detectedForms = [];

  function runDetection() {
    detectedForms = ns.detectForms();
    const summary = ns.summarizeDetected(detectedForms);
    chrome.runtime
      .sendMessage({
        type: MessageTypes.FORMS_DETECTED,
        payload: { url: location.href, forms: summary }
      })
      .catch(() => {});
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

  function buildFormDataForOverlay(detected) {
    if (!detected) return { formData: {}, vendor: "form" };
    const formData = {};
    detected.fields.forEach((f) => {
      const key = f.name || f.label;
      if (!key) return;
      // Read live value if available; fall back to empty string.
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
      // Only the top frame mounts the overlay.
      if (window !== window.top) return;
      const idx = message.payload?.formIndex ?? 0;
      const detected = detectedForms[idx];
      const { formData, vendor } = buildFormDataForOverlay(detected);
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
  });
})();
