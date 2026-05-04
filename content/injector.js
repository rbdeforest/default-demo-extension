// Main-world injector — monkey-patches fetch + XHR.
// Belt-and-suspenders for forms our DOM hooks miss.
// Cancels POSTs that look like form submissions and dispatches "default-demo:fetch-intercepted".

(function () {
  const INTERCEPT_ENABLED = true;
  const EVENT_NAME = "default-demo:fetch-intercepted";
  const EMAIL_KEY_RE = /e[-_]?mail/i;

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

  // ---- fetch ----
  const origFetch = window.fetch;
  window.fetch = function (input, init) {
    if (!INTERCEPT_ENABLED) return origFetch.apply(this, arguments);
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

      if (
        (method === "POST" || method === "PUT") &&
        bodyContainsEmail(body, contentType)
      ) {
        dispatchIntercept({
          source: "fetch",
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
    if (!INTERCEPT_ENABLED) return origSend.apply(this, arguments);
    try {
      const method = this.__ddMethod || "GET";
      const ct = (this.__ddHeaders && this.__ddHeaders["content-type"]) || "";
      if ((method === "POST" || method === "PUT") && bodyContainsEmail(body, ct)) {
        dispatchIntercept({
          source: "xhr",
          url: this.__ddUrl,
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

  // Expose a small marker so the isolated content script can confirm injection.
  Object.defineProperty(window, "__defaultDemoInjected", {
    value: true,
    configurable: true
  });
})();
