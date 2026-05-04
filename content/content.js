// Main content script (isolated world). Runs on every frame.

(function () {
  const ns = window.DefaultDemo;
  const MessageTypes = ns.MessageTypes;

  let detectedForms = [];

  function runDetection() {
    detectedForms = ns.detectForms();
    const summary = ns.summarizeDetected(detectedForms);
    console.log("[Default Demo] detection ran", {
      url: location.href,
      isTopFrame: window === window.top,
      count: detectedForms.length,
      summary
    });

    // Tell the background/popup we have new results for this frame.
    chrome.runtime
      .sendMessage({
        type: MessageTypes.FORMS_DETECTED,
        payload: { url: location.href, forms: summary }
      })
      .catch(() => {});
  }

  // Run once on load, then on DOM mutations (cheap throttle).
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

  // Popup asks for the current frame's detected forms.
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === MessageTypes.GET_DETECTED_FORMS) {
      sendResponse({
        url: location.href,
        isTopFrame: window === window.top,
        forms: ns.summarizeDetected(detectedForms)
      });
      return true; // keep the channel open for sync response
    }
  });
})();
