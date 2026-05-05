// Detects forms across html/hubspot/marketo/pardot/react-custom.
// Exposes window.DefaultDemo.detectForms() and window.DefaultDemo.summarizeDetected().

(function () {
  const ns = (window.DefaultDemo = window.DefaultDemo || {});

  const FIELD_SELECTOR = "input, select, textarea";
  const SKIP_INPUT_TYPES = new Set(["hidden", "submit", "button", "reset", "image", "file"]);
  // Trigger words for the react-custom heuristic. Kept tight to avoid matching
  // generic SaaS-app buttons like "Subscribe to notifications" or "Submit ticket".
  const TRIGGER_TEXT_RE = /\b(get a demo|request demo|book a demo|talk to sales|contact sales|schedule a demo|get started|sign up|start (free )?trial|request access)\b/i;

  function resolveLabel(input) {
    if (input.id) {
      const explicit = input.ownerDocument.querySelector(
        `label[for="${CSS.escape(input.id)}"]`
      );
      if (explicit && explicit.textContent.trim()) return explicit.textContent.trim();
    }
    const wrapping = input.closest("label");
    if (wrapping) {
      const clone = wrapping.cloneNode(true);
      clone.querySelectorAll("input, select, textarea, button").forEach((el) => el.remove());
      const text = clone.textContent.trim();
      if (text) return text;
    }
    const labelledBy = input.getAttribute("aria-labelledby");
    if (labelledBy) {
      const ref = input.ownerDocument.getElementById(labelledBy);
      if (ref && ref.textContent.trim()) return ref.textContent.trim();
    }
    const ariaLabel = input.getAttribute("aria-label");
    if (ariaLabel) return ariaLabel.trim();
    const placeholder = input.getAttribute("placeholder");
    if (placeholder) return placeholder.trim();
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

    const label = resolveLabel(input);
    const name =
      input.getAttribute("name") ||
      input.getAttribute("id") ||
      label ||
      null;

    const required =
      input.hasAttribute("required") || input.getAttribute("aria-required") === "true";

    return { name, type, label, required, element: input };
  }

  function looksLikeEmailField(field) {
    if (!field) return false;
    if (field.type === "email") return true;
    const haystack = `${field.name || ""} ${field.label || ""}`.toLowerCase();
    return /email|e-mail/.test(haystack);
  }

  function scoreConfidence(fields) {
    if (fields.length === 0) return 0.2;
    const hasEmail = fields.some(looksLikeEmailField);
    if (hasEmail && fields.length >= 2) return 0.95;
    if (hasEmail) return 0.7;
    if (fields.length >= 3) return 0.55;
    return 0.35;
  }

  function detectHtmlForms(root) {
    const forms = Array.from(root.querySelectorAll("form"));
    return forms
      .filter((form) => !/^mktoForm_/.test(form.id || ""))   // Marketo handled separately
      .filter((form) => !/^hsForm_/.test(form.id || ""))     // HubSpot handled separately
      .map((form) => {
        const fields = Array.from(form.querySelectorAll(FIELD_SELECTOR))
          .map(extractField)
          .filter(Boolean);
        return {
          vendor: "html",
          element: form,
          iframe: null,
          trigger: null,
          fields,
          confidence: scoreConfidence(fields)
        };
      });
  }

  function detectMarketo(root) {
    const forms = Array.from(root.querySelectorAll('form[id^="mktoForm_"]'));
    return forms.map((form) => {
      const fields = Array.from(form.querySelectorAll(FIELD_SELECTOR))
        .map(extractField)
        .filter(Boolean);
      return {
        vendor: "marketo",
        element: form,
        iframe: null,
        trigger: null,
        fields,
        confidence: 0.95
      };
    });
  }

  function detectHubspotInnerForms(root) {
    // HubSpot wraps each form as <form id="hsForm_...">. Works inside the iframe.
    const forms = Array.from(root.querySelectorAll('form[id^="hsForm_"]'));
    return forms.map((form) => {
      const fields = Array.from(form.querySelectorAll(FIELD_SELECTOR))
        .map(extractField)
        .filter(Boolean);
      return {
        vendor: "hubspot",
        element: form,
        iframe: null,
        trigger: null,
        fields,
        confidence: 0.95
      };
    });
  }

  const HUBSPOT_IFRAME_RE = /hsforms\.com|hsforms\.net|forms\.hubspot\.com/i;
  const PARDOT_IFRAME_RE = /pi\.pardot\.com|go\.pardot\.com|\.pardot\.com/i;

  function detectVendoredIframes(root) {
    if (window !== window.top) return []; // only top frame outlines iframes
    const iframes = Array.from(root.querySelectorAll("iframe"));
    return iframes
      .map((iframe) => {
        const src = iframe.getAttribute("src") || iframe.src || "";
        let vendor = null;
        if (HUBSPOT_IFRAME_RE.test(src)) vendor = "hubspot";
        else if (PARDOT_IFRAME_RE.test(src)) vendor = "pardot";
        if (!vendor) return null;
        return {
          vendor,
          element: iframe,
          iframe,
          trigger: null,
          fields: [], // cross-origin; the iframe's own content script reports values on submit
          confidence: 0.85
        };
      })
      .filter(Boolean);
  }

  // If we're INSIDE a vendor iframe, relabel any html forms with the right vendor.
  function inFrameVendor() {
    if (window === window.top) return null;
    const host = location.hostname;
    if (HUBSPOT_IFRAME_RE.test(host)) return "hubspot";
    if (PARDOT_IFRAME_RE.test(host)) return "pardot";
    return null;
  }

  function buttonText(btn) {
    return ((btn.textContent || btn.value || btn.getAttribute("aria-label") || "") + "").trim();
  }

  const SKIP_ANCESTOR_SELECTOR = "nav, header, footer, [role=navigation], [role=banner], [role=contentinfo], [role=dialog], [role=menu], [role=menubar], [role=tablist], aside";

  function detectReactCustom(root, alreadyClaimed) {
    const candidates = Array.from(root.querySelectorAll('button, [role="button"], input[type=submit], input[type=button]'));
    const seenContainers = new Set();
    const results = [];

    for (const btn of candidates) {
      const text = buttonText(btn);
      if (!text || !TRIGGER_TEXT_RE.test(text)) continue;
      if (btn.closest("form")) continue;            // real form — handled by html detector
      if (btn.closest(SKIP_ANCESTOR_SELECTOR)) continue; // chrome / app shell

      let node = btn.parentElement;
      let chosenContainer = null;
      let chosenInputs = [];
      for (let depth = 0; depth < 3 && node && node !== document.body; depth++) {
        // Skip containers that are basically the whole page.
        const r = node.getBoundingClientRect();
        const tooBig = r.width > window.innerWidth * 0.7 && r.height > window.innerHeight * 0.6;
        if (tooBig) break;

        const inputs = Array.from(node.querySelectorAll(FIELD_SELECTOR))
          .filter((el) => !SKIP_INPUT_TYPES.has((el.getAttribute("type") || "").toLowerCase()));

        // 2-7 inputs is a marketing-form sweet spot. >7 is admin UI noise.
        if (inputs.length >= 2 && inputs.length <= 7) {
          const fields = inputs.map(extractField).filter(Boolean);
          const hasEmail = fields.some(looksLikeEmailField);
          if (hasEmail) {
            chosenContainer = node;
            chosenInputs = fields;
            break;
          }
        }
        node = node.parentElement;
      }

      if (!chosenContainer || seenContainers.has(chosenContainer)) continue;
      if (alreadyClaimed.has(chosenContainer)) continue;
      seenContainers.add(chosenContainer);

      results.push({
        vendor: "react-custom",
        element: chosenContainer,
        iframe: null,
        trigger: btn,
        fields: chosenInputs,
        confidence: 0.75
      });
    }
    return results;
  }

  function detectForms() {
    const marketo = detectMarketo(document);
    const hubspotInner = detectHubspotInnerForms(document);
    let html = detectHtmlForms(document);

    // Inside a vendor iframe — relabel html forms.
    const innerVendor = inFrameVendor();
    if (innerVendor) {
      html = html.map((d) => ({ ...d, vendor: innerVendor, confidence: 0.9 }));
    }

    const claimed = new Set();
    marketo.forEach((d) => claimed.add(d.element));
    hubspotInner.forEach((d) => claimed.add(d.element));
    html.forEach((d) => claimed.add(d.element));

    const reactCustom = detectReactCustom(document, claimed);
    const vendoredIframes = detectVendoredIframes(document);

    const all = [...marketo, ...hubspotInner, ...html, ...reactCustom, ...vendoredIframes];
    return all.sort((a, b) => b.confidence - a.confidence);
  }

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
