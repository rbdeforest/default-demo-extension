// Loaded first in every content-script frame. Exposes shared constants + workflow registry on window.DefaultDemo.

(function () {
  const ns = (window.DefaultDemo = window.DefaultDemo || {});

  ns.MessageTypes = {
    FORMS_DETECTED: "forms-detected",
    FORM_INTERCEPTED: "form-intercepted",
    OPEN_OVERLAY: "open-overlay",
    CLOSE_OVERLAY: "close-overlay",
    RUN_WORKFLOW: "run-workflow",
    TRACE_EVENT: "trace-event",
    GET_DETECTED_FORMS: "get-detected-forms"
  };

  ns.BRAND = {
    black: "#000000",
    white: "#FFFFFF",
    purple: "#6300ff",
    error: "#ff4d6d"
  };

  ns.INTERCEPT_ENABLED = true;
  // Whether the visual overlay + marker should be shown. Interception always
  // happens regardless. Synced from chrome.storage.local in content.js.
  ns.overlayVisible = true;

  // User-intent tracking — used to gate the network injector so it doesn't fire on
  // background API calls in SaaS apps. Set whenever the user clicks anything that
  // looks like a form trigger, or a submit event fires.
  ns.lastUserIntentAt = 0;
  ns.markUserIntent = function () {
    ns.lastUserIntentAt = Date.now();
    try { window.dispatchEvent(new CustomEvent("default-demo:user-intent")); } catch (e) {}
  };
  ns.hasRecentUserIntent = function (windowMs) {
    return Date.now() - ns.lastUserIntentAt < (windowMs || 2500);
  };

  // Workflow registry — workflow files call registerWorkflow on load.
  ns.workflows = ns.workflows || [];
  ns.registerWorkflow = function (workflow) {
    if (!workflow || !workflow.id) return;
    const existing = ns.workflows.findIndex((w) => w.id === workflow.id);
    if (existing >= 0) ns.workflows[existing] = workflow;
    else ns.workflows.push(workflow);
  };
  ns.getWorkflow = function (id) {
    return ns.workflows.find((w) => w.id === id);
  };
})();
