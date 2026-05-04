// Main content script (isolated world). Step 2 stub — just announces itself.
// Detection, interception, and overlay mounting land in steps 3+.

const INTERCEPT_ENABLED = true;

console.log("[Default Demo] content script loaded", {
  url: location.href,
  intercept: INTERCEPT_ENABLED,
  isTopFrame: window === window.top
});
