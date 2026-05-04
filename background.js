// Service worker — minimal in v1.
// Forwards messages from inner iframes (HubSpot/Pardot) to the top frame's content script.

const MessageTypes = {
  FORMS_DETECTED: "forms-detected",
  FORM_INTERCEPTED: "form-intercepted"
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!sender.tab) return;

  if (message?.type === MessageTypes.FORM_INTERCEPTED) {
    chrome.tabs.sendMessage(
      sender.tab.id,
      {
        type: MessageTypes.FORM_INTERCEPTED,
        payload: message.payload,
        sourceFrameId: sender.frameId
      },
      { frameId: 0 } // route to top frame only
    );
  }

  // FORMS_DETECTED is per-frame; popup queries directly via chrome.tabs.sendMessage.
  // No forwarding needed today, but logging helps debugging.
  if (message?.type === MessageTypes.FORMS_DETECTED) {
    console.log("[Default Demo bg] forms detected", {
      tabId: sender.tab.id,
      frameId: sender.frameId,
      count: message.payload?.forms?.length
    });
  }
});
