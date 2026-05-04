// Service worker — minimal in v1.
// Forwards messages from inner iframes (HubSpot/Pardot) to the top frame's content script.

import { MessageTypes } from "./lib/messaging.js";

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!sender.tab) return;

  if (message?.type === MessageTypes.FORM_INTERCEPTED) {
    // Forward to the top frame in the same tab so the overlay can mount there.
    chrome.tabs.sendMessage(sender.tab.id, {
      type: MessageTypes.FORM_INTERCEPTED,
      payload: message.payload,
      sourceFrameId: sender.frameId
    });
  }

  if (message?.type === MessageTypes.FORMS_DETECTED) {
    chrome.tabs.sendMessage(sender.tab.id, {
      type: MessageTypes.FORMS_DETECTED,
      payload: message.payload,
      sourceFrameId: sender.frameId
    });
  }
});
