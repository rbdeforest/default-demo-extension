// Main-world injector — monkey-patches fetch + XHR.
// Belt-and-suspenders for forms our DOM hooks miss.
// Cancels POSTs that look like form submissions and dispatches "default-demo:fetch-intercepted".

(function () {
  const INTERCEPT_ENABLED = true;
  const EVENT_NAME = "default-demo:fetch-intercepted";
  const EMAIL_KEY_RE = /e[-_]?mail/i;

  // Known marketing-automation endpoints. Block by URL even if body shape is ambiguous.
  // Whether to suppress all interception. Set by the isolated-world content
  // script via custom events when it classifies the page as a SaaS app
  // (single source of truth — same heuristic as form-detector.js).
  let injectorDisabled = false;
  window.addEventListener("default-demo:disable-injector", () => { injectorDisabled = true; });
  window.addEventListener("default-demo:enable-injector", () => { injectorDisabled = false; });

  const MAS_URL_RE = new RegExp(
    [
      "\\.marketo\\.com\\/index\\.php",
      "\\.mktoresp\\.com",
      "munchkin",
      "\\.hsforms\\.com",
      "\\.hsforms\\.net",
      "forms\\.hubspot\\.com",
      "api\\.hsforms\\.com",
      "track\\.hubspot\\.com\\/__ptq",
      "\\.pardot\\.com\\/l\\/",
      "pi\\.pardot\\.com",
      "go\\.pardot\\.com",
      "\\.chilipiper\\.com",
      "concierge\\.chilipiper",
      "calendly\\.com\\/api"
    ].join("|"),
    "i"
  );
  function isMasEndpoint(url) {
    return typeof url === "string" && MAS_URL_RE.test(url);
  }

  function emailLikeInString(s) {
    if (typeof s !== "string" || !s) return false;
    return /e[-_]?mail/i.test(s);
  }

  function bodyContainsEmail(body, contentType) {
    if (!body) return false;
    if (typeof FormData !== "undefined" && body instanceof FormData) {
      for (const k of body.keys()) if (EMAIL_KEY_RE.test(k)) return true;
      return false;
    }
    if (typeof URLSearchParams !== "undefined" && body instanceof URLSearchParams) {
      for (const k of body.keys()) if (EMAIL_KEY_RE.test(k)) return true;
      return false;
    }
    if (typeof Blob !== "undefined" && body instanceof Blob) {
      // Skipping blob inspection (would require async read). Treat as not email-shaped.
      return false;
    }
    if (typeof body === "string") {
      const ct = (contentType || "").toLowerCase();
      if (ct.includes("json")) {
        try {
          const parsed = JSON.parse(body);
          return JSON.stringify(parsed).match(/"[a-z0-9_]*e[-_]?mail/i) != null;
        } catch (e) { /* fallthrough to string check */ }
      }
      if (ct.includes("urlencoded") || /[?&][^=]+=/.test(body)) {
        return emailLikeInString(body);
      }
      return emailLikeInString(body);
    }
    return false;
  }

  function bodyToObject(body, contentType) {
    if (!body) return {};
    if (typeof FormData !== "undefined" && body instanceof FormData) {
      const obj = {};
      for (const [k, v] of body.entries()) obj[k] = typeof v === "string" ? v : "(file)";
      return obj;
    }
    if (typeof URLSearchParams !== "undefined" && body instanceof URLSearchParams) {
      const obj = {};
      for (const [k, v] of body.entries()) obj[k] = v;
      return obj;
    }
    if (typeof body === "string") {
      const ct = (contentType || "").toLowerCase();
      if (ct.includes("json")) {
        try { return JSON.parse(body); } catch (e) { return { raw: body }; }
      }
      if (ct.includes("urlencoded") || /[?&][^=]+=/.test(body)) {
        try {
          const params = new URLSearchParams(body);
          const obj = {};
          for (const [k, v] of params.entries()) obj[k] = v;
          return obj;
        } catch (e) { return { raw: body }; }
      }
      return { raw: body };
    }
    return {};
  }

  function readHeaderCT(headers) {
    if (!headers) return "";
    if (headers instanceof Headers) return headers.get("content-type") || "";
    if (Array.isArray(headers)) {
      const found = headers.find(([k]) => /content-type/i.test(k));
      return found ? found[1] : "";
    }
    if (typeof headers === "object") {
      const key = Object.keys(headers).find((k) => /content-type/i.test(k));
      return key ? headers[key] : "";
    }
    return "";
  }

  function dispatchIntercept(detail) {
    try {
      window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail }));
    } catch (e) {}
  }

  // User-intent gate. The isolated-world content script dispatches this whenever
  // the user clicks something that looks like a form trigger (or a real submit).
  // Without recent intent we let network calls pass through untouched — otherwise
  // background API calls on SaaS apps would constantly fire the overlay.
  let lastIntentAt = 0;
  window.addEventListener("default-demo:user-intent", () => {
    lastIntentAt = Date.now();
  });
  function hasRecentIntent() {
    return Date.now() - lastIntentAt < 2500;
  }

  // ---- fetch ----
  const origFetch = window.fetch;
  window.fetch = function (input, init) {
    if (!INTERCEPT_ENABLED || injectorDisabled) return origFetch.apply(this, arguments);
    try {
      let url = "";
      let method = "GET";
      let body = null;
      let contentType = "";

      if (typeof input === "string" || input instanceof URL) {
        url = String(input);
      } else if (input && typeof input === "object" && "url" in input) {
        url = input.url;
        method = input.method || "GET";
      }
      if (init) {
        method = init.method || method;
        body = init.body;
        contentType = readHeaderCT(init.headers);
      }
      method = (method || "GET").toUpperCase();

      const masMatch = isMasEndpoint(url);
      const looksLikeForm = (method === "POST" || method === "PUT") && bodyContainsEmail(body, contentType);
      if ((masMatch || looksLikeForm) && hasRecentIntent()) {
        dispatchIntercept({
          source: masMatch ? "mas" : "fetch",
          url,
          method,
          body: bodyToObject(body, contentType)
        });
        return Promise.resolve(new Response("", { status: 200, statusText: "OK" }));
      }
    } catch (e) { /* fall through */ }
    return origFetch.apply(this, arguments);
  };

  // ---- XMLHttpRequest ----
  const origOpen = XMLHttpRequest.prototype.open;
  const origSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
  const origSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url) {
    this.__ddMethod = (method || "GET").toUpperCase();
    this.__ddUrl = url;
    this.__ddHeaders = {};
    return origOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
    if (!this.__ddHeaders) this.__ddHeaders = {};
    this.__ddHeaders[name.toLowerCase()] = value;
    return origSetRequestHeader.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function (body) {
    if (!INTERCEPT_ENABLED || injectorDisabled) return origSend.apply(this, arguments);
    try {
      const method = this.__ddMethod || "GET";
      const ct = (this.__ddHeaders && this.__ddHeaders["content-type"]) || "";
      const url = this.__ddUrl;
      const masMatch = isMasEndpoint(url);
      const looksLikeForm = (method === "POST" || method === "PUT") && bodyContainsEmail(body, ct);
      if ((masMatch || looksLikeForm) && hasRecentIntent()) {
        dispatchIntercept({
          source: masMatch ? "mas-xhr" : "xhr",
          url,
          method,
          body: bodyToObject(body, ct)
        });
        // Fake a successful completion so the page's success handlers fire harmlessly.
        const xhr = this;
        setTimeout(() => {
          try {
            Object.defineProperty(xhr, "readyState", { value: 4, configurable: true });
            Object.defineProperty(xhr, "status", { value: 200, configurable: true });
            Object.defineProperty(xhr, "statusText", { value: "OK", configurable: true });
            Object.defineProperty(xhr, "response", { value: "", configurable: true });
            Object.defineProperty(xhr, "responseText", { value: "", configurable: true });
            xhr.dispatchEvent(new Event("readystatechange"));
            xhr.dispatchEvent(new Event("load"));
            xhr.dispatchEvent(new Event("loadend"));
          } catch (e) {}
        }, 0);
        return; // don't call original send
      }
    } catch (e) {}
    return origSend.apply(this, arguments);
  };

  // ---- Marketo Forms 2.0 hook ----
  function hookMarketoForm(form) {
    if (!form || form.__defaultDemoHooked) return;
    form.__defaultDemoHooked = true;
    try {
      if (typeof form.onSubmit === "function") {
        form.onSubmit(function () { return false; });
      }
      if (typeof form.onSuccess === "function") {
        form.onSuccess(function (values) {
          dispatchIntercept({ source: "marketo", body: values, vendor: "marketo" });
          return false; // prevent navigation to followUpUrl
        });
      }
      const formElem = typeof form.getFormElem === "function" ? form.getFormElem() : null;
      const realForm = formElem && formElem[0];
      if (realForm) {
        realForm.addEventListener(
          "click",
          function (e) {
            const btn = e.target && e.target.closest && e.target.closest("button[type=submit], input[type=submit]");
            if (!btn) return;
            try {
              const vals = typeof form.vals === "function" ? form.vals() : {};
              dispatchIntercept({ source: "marketo", body: vals, vendor: "marketo" });
            } catch (err) {}
          },
          true
        );
      }
    } catch (err) { /* swallow */ }
  }

  function tryHookMktoForms2() {
    const M = window.MktoForms2;
    if (!M || M.__defaultDemoHooked) return;
    try {
      if (typeof M.whenReady === "function") {
        M.whenReady(hookMarketoForm);
      } else if (typeof M.allForms === "function") {
        M.allForms().forEach(hookMarketoForm);
      }
      M.__defaultDemoHooked = true;
    } catch (err) {}
  }

  // Poll for MktoForms2 to load (form lib may load async after page).
  let mktoChecks = 0;
  const mktoInterval = setInterval(() => {
    if (window.MktoForms2) tryHookMktoForms2();
    if (++mktoChecks > 100) clearInterval(mktoInterval); // ~10s
  }, 100);

  // Expose a small marker so the isolated content script can confirm injection.
  Object.defineProperty(window, "__defaultDemoInjected", {
    value: true,
    configurable: true
  });
})();
