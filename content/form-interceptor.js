// Per-vendor form interception. Step 5 covers plain HTML; later steps add other vendors.
// Exposes window.DefaultDemo.attachInterceptor(detected, onSubmit).

(function () {
  const ns = window.DefaultDemo;
  const BRAND = ns.BRAND;

  // Visual marker — outline + badge anchored to detected forms.
  const MARKER_CLASS = "default-demo-marker";
  const markers = new WeakMap();

  function ensureMarker(formEl) {
    if (markers.has(formEl)) return markers.get(formEl);

    const wrapper = document.createElement("div");
    wrapper.className = MARKER_CLASS;
    wrapper.style.cssText = `
      position: absolute;
      pointer-events: none;
      border: 2px solid ${BRAND.purple};
      border-radius: 4px;
      box-shadow: 0 0 0 2px rgba(99, 0, 255, 0.15);
      z-index: 2147483646;
      transition: opacity 200ms ease;
    `;

    const badge = document.createElement("div");
    badge.style.cssText = `
      position: absolute;
      top: -22px; left: -2px;
      background: ${BRAND.purple};
      color: ${BRAND.white};
      font-family: "Inter", -apple-system, system-ui, sans-serif;
      font-size: 10px;
      font-weight: 600;
      letter-spacing: 0.04em;
      padding: 3px 8px;
      border-radius: 3px 3px 0 0;
      pointer-events: none;
      white-space: nowrap;
      text-transform: uppercase;
    `;
    badge.textContent = "⚡ Default Demo · intercepted";
    wrapper.appendChild(badge);

    document.body.appendChild(wrapper);
    markers.set(formEl, wrapper);
    return wrapper;
  }

  function positionMarker(formEl, marker) {
    const r = formEl.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) {
      marker.style.opacity = "0";
      return;
    }
    marker.style.opacity = "1";
    marker.style.top = `${window.scrollY + r.top - 2}px`;
    marker.style.left = `${window.scrollX + r.left - 2}px`;
    marker.style.width = `${r.width + 4}px`;
    marker.style.height = `${r.height + 4}px`;
  }

  function attachMarker(formEl) {
    const marker = ensureMarker(formEl);
    positionMarker(formEl, marker);

    const reposition = () => positionMarker(formEl, marker);
    window.addEventListener("scroll", reposition, { passive: true });
    window.addEventListener("resize", reposition);
    const ro = new ResizeObserver(reposition);
    ro.observe(formEl);

    return () => {
      window.removeEventListener("scroll", reposition);
      window.removeEventListener("resize", reposition);
      ro.disconnect();
      marker.remove();
      markers.delete(formEl);
    };
  }

  function readFieldValues(detected) {
    const data = {};
    detected.fields.forEach((f) => {
      const key = f.name || f.label;
      if (!key) return;
      let value = "";
      try { value = f.element?.value ?? ""; } catch (e) {}
      data[key] = value;
    });
    return data;
  }

  function attachHtmlInterceptor(detected, onSubmit) {
    const form = detected.element;
    if (!form || form.dataset.defaultDemoAttached === "1") return () => {};
    form.dataset.defaultDemoAttached = "1";

    const removeMarker = attachMarker(form);

    const handler = (event) => {
      if (!ns.INTERCEPT_ENABLED) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const formData = readFieldValues(detected);
      onSubmit({ formData, vendor: "html", source: form });
    };

    // Capture-phase submit listener.
    form.addEventListener("submit", handler, { capture: true });

    // Click-fallback: some forms submit via JS without firing submit.
    const clickHandler = (event) => {
      const target = event.target;
      if (!target || !(target instanceof Element)) return;
      const button = target.closest("button, input[type=submit], input[type=button], [role=button]");
      if (!button || !form.contains(button)) return;

      // Only intercept buttons whose text/type indicates submission.
      const type = (button.getAttribute("type") || "").toLowerCase();
      const text = (button.textContent || button.value || "").trim().toLowerCase();
      const looksSubmitty = type === "submit" || /demo|contact|talk|book|request|schedule|get started|sign up|trial|subscribe|submit|send/.test(text);
      if (!looksSubmitty) return;

      if (!ns.INTERCEPT_ENABLED) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const formData = readFieldValues(detected);
      onSubmit({ formData, vendor: "html", source: form });
    };
    form.addEventListener("click", clickHandler, { capture: true });

    return () => {
      form.removeEventListener("submit", handler, { capture: true });
      form.removeEventListener("click", clickHandler, { capture: true });
      delete form.dataset.defaultDemoAttached;
      removeMarker();
    };
  }

  function attachInterceptor(detected, onSubmit) {
    if (detected.vendor === "html") return attachHtmlInterceptor(detected, onSubmit);
    // Other vendors land in steps 6-9.
    return () => {};
  }

  ns.attachInterceptor = attachInterceptor;
})();
