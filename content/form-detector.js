// Plain-HTML form detection. Other vendors land in steps 6-9.
// Exposes window.DefaultDemo.detectForms() and helpers.

(function () {
  const ns = (window.DefaultDemo = window.DefaultDemo || {});

  const FIELD_SELECTOR = "input, select, textarea";
  const SKIP_INPUT_TYPES = new Set(["hidden", "submit", "button", "reset", "image", "file"]);

  function resolveLabel(input) {
    // 1. Explicit <label for="id">
    if (input.id) {
      const explicit = input.ownerDocument.querySelector(
        `label[for="${CSS.escape(input.id)}"]`
      );
      if (explicit && explicit.textContent.trim()) return explicit.textContent.trim();
    }
    // 2. Wrapping <label>
    const wrapping = input.closest("label");
    if (wrapping) {
      const clone = wrapping.cloneNode(true);
      clone.querySelectorAll("input, select, textarea, button").forEach((el) => el.remove());
      const text = clone.textContent.trim();
      if (text) return text;
    }
    // 3. aria-labelledby
    const labelledBy = input.getAttribute("aria-labelledby");
    if (labelledBy) {
      const ref = input.ownerDocument.getElementById(labelledBy);
      if (ref && ref.textContent.trim()) return ref.textContent.trim();
    }
    // 4. aria-label
    const ariaLabel = input.getAttribute("aria-label");
    if (ariaLabel) return ariaLabel.trim();
    // 5. placeholder
    const placeholder = input.getAttribute("placeholder");
    if (placeholder) return placeholder.trim();
    // 6. Nearest preceding text node within parent
    const prev = input.previousSibling;
    if (prev && prev.nodeType === Node.TEXT_NODE && prev.textContent.trim()) {
      return prev.textContent.trim();
    }
    return null;
  }

  function extractField(input) {
    const tag = input.tagName.toLowerCase();
    const type = (input.getAttribute("type") || (tag === "select" ? "select" : "text")).toLowerCase();
    if (SKIP_INPUT_TYPES.has(type)) return null;

    const name =
      input.getAttribute("name") ||
      input.getAttribute("id") ||
      resolveLabel(input) ||
      null;

    const required =
      input.hasAttribute("required") || input.getAttribute("aria-required") === "true";

    return {
      name,
      type,
      label: resolveLabel(input),
      required,
      element: input
    };
  }

  function looksLikeEmailField(field) {
    if (!field) return false;
    if (field.type === "email") return true;
    const haystack = `${field.name || ""} ${field.label || ""}`.toLowerCase();
    return /email|e-mail/.test(haystack);
  }

  function scoreConfidence(fields) {
    const visible = fields.filter((f) => f.element.offsetParent !== null || f.element.type === "hidden");
    if (visible.length === 0) return 0.2;
    const hasEmail = fields.some(looksLikeEmailField);
    if (hasEmail && fields.length >= 2) return 0.95;
    if (hasEmail) return 0.7;
    if (fields.length >= 3) return 0.55;
    return 0.35;
  }

  function detectHtmlForms(root) {
    const forms = Array.from(root.querySelectorAll("form"));
    return forms.map((form) => {
      const fields = Array.from(form.querySelectorAll(FIELD_SELECTOR))
        .map(extractField)
        .filter(Boolean);
      return {
        vendor: "html",
        element: form,
        iframe: null,
        fields,
        confidence: scoreConfidence(fields)
      };
    });
  }

  function detectForms() {
    // Steps 6-9 will append marketo/hubspot/pardot/react-custom detectors here.
    const all = [...detectHtmlForms(document)];
    return all.sort((a, b) => b.confidence - a.confidence);
  }

  // Lightweight, postMessage-safe summary (no DOM nodes).
  function summarize(detected) {
    return detected.map((d, i) => ({
      index: i,
      vendor: d.vendor,
      confidence: d.confidence,
      fields: d.fields.map((f) => ({
        name: f.name,
        type: f.type,
        label: f.label,
        required: f.required
      }))
    }));
  }

  ns.detectForms = detectForms;
  ns.summarizeDetected = summarize;
})();
