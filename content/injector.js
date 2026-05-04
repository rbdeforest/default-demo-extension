// Main-world injector. Step 2 stub — fetch/XHR monkey-patch lands in step 6.

const INTERCEPT_ENABLED = true;

console.log("[Default Demo] injector loaded (main world)", {
  url: location.href,
  intercept: INTERCEPT_ENABLED
});
