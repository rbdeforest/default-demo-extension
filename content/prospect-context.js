// Prospect context + tech stack scan. Exposes window.DefaultDemo.getProspectContext().

(function () {
  const ns = (window.DefaultDemo = window.DefaultDemo || {});

  const TECH_SIGNATURES = [
    { name: "HubSpot",  patterns: [/hs-scripts\.com/, /js\.hsforms\.net/, /js\.hs-scripts\.com/, /track\.hubspot\.com/, /js\.hsadspixel\.net/, /hsforms\.com/] },
    { name: "Marketo",  patterns: [/munchkin\.marketo\.net/, /forms2\.min\.js/, /\.mktoresp\.com/, /\.marketo\.com/] },
    { name: "Pardot",   patterns: [/pi\.pardot\.com/, /go\.pardot\.com/, /\.pardot\.com/] },
    { name: "Salesforce", patterns: [/cdn\.salesforce\.com/, /lightning\.force\.com/] },
    { name: "Drift",    patterns: [/js\.driftt\.com/, /widget\.drift\.com/, /js\.drift\.com/] },
    { name: "ChiliPiper", patterns: [/chilipiper\.com/, /concierge-js/] },
    { name: "Calendly", patterns: [/assets\.calendly\.com/, /calendly\.com\/embed/] },
    { name: "Intercom", patterns: [/widget\.intercom\.io/, /intercomcdn\.com/, /js\.intercomcdn\.com/] },
    { name: "Zendesk",  patterns: [/zdassets\.com/, /static\.zdassets\.com/] },
    { name: "Gong",     patterns: [/track\.gong\.io/, /\.gong\.io/] },
    { name: "6sense",   patterns: [/6sc\.co/, /\.6si\.com/] },
    { name: "Qualified", patterns: [/qualified\.com/, /js\.qualified\.com/] },
    { name: "Segment",  patterns: [/cdn\.segment\.com/, /api\.segment\.io/] },
    { name: "Mixpanel", patterns: [/cdn\.mxpnl\.com/, /api\.mixpanel\.com/] },
    { name: "Amplitude", patterns: [/cdn\.amplitude\.com/, /amplitude\.com\/libs/] },
    { name: "Heap",     patterns: [/cdn\.heapanalytics\.com/, /heapanalytics\.com/] },
    { name: "Google Tag Manager", patterns: [/googletagmanager\.com/] },
    { name: "Google Analytics",   patterns: [/google-analytics\.com/] },
    { name: "Default",  patterns: [/embed\.default\.com/, /js\.default\.com/] }
  ];

  function scanForTechStack() {
    const scripts = Array.from(document.querySelectorAll("script[src]"))
      .map((s) => s.src || "")
      .filter(Boolean);
    const iframes = Array.from(document.querySelectorAll("iframe[src]"))
      .map((i) => i.src || "")
      .filter(Boolean);
    const sources = [...scripts, ...iframes];
    const detected = [];
    for (const tech of TECH_SIGNATURES) {
      if (tech.patterns.some((re) => sources.some((src) => re.test(src)))) {
        detected.push(tech.name);
      }
    }
    return detected;
  }

  function extractCompanyFromMeta() {
    const og = document.querySelector('meta[property="og:site_name"]')?.content;
    if (og && og.trim()) return og.trim();
    const app = document.querySelector('meta[name="application-name"]')?.content;
    if (app && app.trim()) return app.trim();
    const h1 = document.querySelector("h1")?.textContent;
    if (h1 && h1.trim() && h1.trim().length < 80) return h1.trim();
    const host = (location.hostname || "").replace(/^www\./, "").split(".")[0];
    if (!host) return null;
    return host.charAt(0).toUpperCase() + host.slice(1);
  }

  ns.getProspectContext = function () {
    return {
      domain: location.hostname,
      pageUrl: location.href,
      pageTitle: document.title,
      companyName: extractCompanyFromMeta(),
      detectedTech: scanForTechStack()
    };
  };
})();
