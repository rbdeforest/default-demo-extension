// Per-vendor form interception. html + react-custom for now; other vendors land in steps 7-9.
// Exposes window.DefaultDemo.attachInterceptor(detected, onSubmit).

(function () {
  const ns = window.DefaultDemo;
  const BRAND = ns.BRAND;
  const MARKER_CLASS = "default-demo-marker";
  const markers = new WeakMap();

  const VENDOR_BADGE_NAME = {
    html: "HTML form",
    hubspot: "HubSpot form",
    marketo: "Marketo form",
    pardot: "Pardot form",
    "react-custom": "Custom form",
    manual: "Manual picks"
  };

  function ensureMarker(formEl, vendor) {
    if (markers.has(formEl)) return markers.get(formEl);
    const wrapper = document.createElement("div");
    wrapper.className = MARKER_CLASS;
    wrapper.style.cssText = `
      position: absolute; pointer-events: none;
      border: 2px solid ${BRAND.purple};
      border-radius: 4px;
      box-shadow: 0 0 0 2px rgba(99, 0, 255, 0.15);
      z-index: 2147483646;
      transition: opacity 200ms ease;
    `;
    const badge = document.createElement("div");
    badge.dataset.role = "default-demo-badge";
    badge.style.cssText = `
      position: absolute; top: -22px; left: -2px;
      background: ${BRAND.purple}; color: ${BRAND.white};
      font-family: "Inter", -apple-system, system-ui, sans-serif;
      font-size: 11px; font-weight: 600; letter-spacing: 0.04em;
      padding: 4px 10px; border-radius: 4px 4px 0 0;
      pointer-events: none; white-space: nowrap; text-transform: uppercase;
    `;
    const vendorName = VENDOR_BADGE_NAME[vendor] || "Form";
    badge.textContent = `⚡ Default Demo · ${vendorName}`;
    wrapper.appendChild(badge);
    document.body.appendChild(wrapper);
    markers.set(formEl, wrapper);
    return wrapper;
  }

  const MARKER_PAD = 12;

  function positionMarker(formEl, marker) {
    const r = formEl.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) {
      marker.style.opacity = "0";
      return;
    }
    marker.style.opacity = "1";
    marker.style.top = `${window.scrollY + r.top - MARKER_PAD}px`;
    marker.style.left = `${window.scrollX + r.left - MARKER_PAD}px`;
    marker.style.width = `${r.width + MARKER_PAD * 2}px`;
    marker.style.height = `${r.height + MARKER_PAD * 2}px`;
  }

  function attachMarker(formEl, vendor) {
    const marker = ensureMarker(formEl, vendor);
    positionMarker(formEl, marker);
    if (!ns.overlayVisible) marker.style.display = "none";
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

  // Toggle every existing marker's visibility. Called when the popup toggle changes.
  function setMarkersVisible(visible) {
    document.querySelectorAll("." + MARKER_CLASS).forEach((el) => {
      el.style.display = visible ? "block" : "none";
    });
  }
  ns.setMarkersVisible = setMarkersVisible;

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

  // Dedupe DOM-click vs network-injector intercepts (whichever fires first wins).
  let lastSubmitAt = 0;
  function recentlyFired() { return Date.now() - lastSubmitAt < 1500; }
  function markFired() { lastSubmitAt = Date.now(); }

  function attachHtmlInterceptor(detected, onSubmit) {
    const form = detected.element;
    if (!form || form.dataset.defaultDemoAttached === "1") return () => {};
    form.dataset.defaultDemoAttached = "1";
    const removeMarker = attachMarker(form, detected.vendor);

    const submitHandler = (event) => {
      if (!ns.INTERCEPT_ENABLED || recentlyFired()) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      markFired();
      onSubmit({ formData: readFieldValues(detected), vendor: detected.vendor, source: form });
    };

    const clickHandler = (event) => {
      const target = event.target;
      if (!target || !(target instanceof Element)) return;
      const button = target.closest("button, input[type=submit], input[type=button], [role=button]");
      if (!button || !form.contains(button)) return;
      const type = (button.getAttribute("type") || "").toLowerCase();
      const text = (button.textContent || button.value || "").trim().toLowerCase();
      const looksSubmitty = type === "submit" || /demo|contact|talk|book|request|schedule|get started|sign up|trial|subscribe|submit|send/.test(text);
      if (!looksSubmitty) return;
      if (!ns.INTERCEPT_ENABLED || recentlyFired()) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      markFired();
      onSubmit({ formData: readFieldValues(detected), vendor: detected.vendor, source: form });
    };

    form.addEventListener("submit", submitHandler, { capture: true });
    form.addEventListener("click", clickHandler, { capture: true });
    return () => {
      form.removeEventListener("submit", submitHandler, { capture: true });
      form.removeEventListener("click", clickHandler, { capture: true });
      delete form.dataset.defaultDemoAttached;
      removeMarker();
    };
  }

  function attachReactCustomInterceptor(detected, onSubmit) {
    const container = detected.element;
    const trigger = detected.trigger;
    if (!container || !trigger) return () => {};
    if (container.dataset.defaultDemoAttached === "1") return () => {};
    container.dataset.defaultDemoAttached = "1";
    const removeMarker = attachMarker(container, detected.vendor);

    const handler = (event) => {
      if (!ns.INTERCEPT_ENABLED || recentlyFired()) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      markFired();
      onSubmit({ formData: readFieldValues(detected), vendor: "react-custom", source: container });
    };
    trigger.addEventListener("click", handler, { capture: true });

    return () => {
      trigger.removeEventListener("click", handler, { capture: true });
      delete container.dataset.defaultDemoAttached;
      removeMarker();
    };
  }

  function attachMarketoInterceptor(detected, onSubmit) {
    const form = detected.element;
    if (!form || form.dataset.defaultDemoAttached === "1") return () => {};
    form.dataset.defaultDemoAttached = "1";
    const removeMarker = attachMarker(form, detected.vendor);

    // Backup capture-phase click handler. The real interception is in the injector
    // (MktoForms2 onSubmit returning false + URL-pattern network block).
    const handler = (event) => {
      const target = event.target;
      if (!target || !(target instanceof Element)) return;
      const button = target.closest("button[type=submit], input[type=submit], button");
      if (!button || !form.contains(button)) return;
      if (!ns.INTERCEPT_ENABLED || recentlyFired()) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      markFired();
      onSubmit({ formData: readFieldValues(detected), vendor: "marketo", source: form });
    };
    form.addEventListener("click", handler, { capture: true });

    return () => {
      form.removeEventListener("click", handler, { capture: true });
      delete form.dataset.defaultDemoAttached;
      removeMarker();
    };
  }

  function attachIframeOutlineOnly(detected) {
    const iframe = detected.element;
    if (!iframe || iframe.dataset.defaultDemoAttached === "1") return () => {};
    iframe.dataset.defaultDemoAttached = "1";
    const removeMarker = attachMarker(iframe, detected.vendor);
    return () => {
      delete iframe.dataset.defaultDemoAttached;
      removeMarker();
    };
  }

  function attachManualInterceptor(detected, onSubmit) {
    // For manually picked fields the container is just a wrapper — there's no
    // form element. Show the outline; submit-blocking happens via the network
    // injector + user-intent gate if anything actually fires.
    const container = detected.element;
    if (!container || container.dataset.defaultDemoAttached === "1") return () => {};
    container.dataset.defaultDemoAttached = "1";
    const removeMarker = attachMarker(container, "manual");
    return () => {
      delete container.dataset.defaultDemoAttached;
      removeMarker();
    };
  }

  function attachInterceptor(detected, onSubmit) {
    if (detected.element instanceof HTMLIFrameElement) {
      return attachIframeOutlineOnly(detected);
    }
    if (detected.vendor === "react-custom") return attachReactCustomInterceptor(detected, onSubmit);
    if (detected.vendor === "marketo") return attachMarketoInterceptor(detected, onSubmit);
    if (detected.vendor === "manual") return attachManualInterceptor(detected, onSubmit);
    // html / hubspot inner / pardot inner all share the html capture-phase pattern.
    return attachHtmlInterceptor(detected, onSubmit);
  }

  ns.attachInterceptor = attachInterceptor;
  ns.markInterceptorFired = markFired;
  ns.interceptorRecentlyFired = recentlyFired;
})();
