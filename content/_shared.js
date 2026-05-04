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
