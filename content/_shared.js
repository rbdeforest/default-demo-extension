// Loaded first in every content-script frame. Exposes shared constants on window.DefaultDemo.
// Service worker uses lib/messaging.js (ES module) instead — keep these in sync.

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
})();
