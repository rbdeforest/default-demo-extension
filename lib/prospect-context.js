// Step 10 will fill this in. Returns { domain, pageUrl, pageTitle, companyName, detectedTech }.

export function getProspectContext() {
  return {
    domain: location.hostname,
    pageUrl: location.href,
    pageTitle: document.title,
    companyName: null,
    detectedTech: []
  };
}
