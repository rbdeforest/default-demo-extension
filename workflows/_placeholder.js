// Placeholder workflow. Real Default workflows will be added alongside this file.
// Each workflow registers itself onto window.DefaultDemo on load.

(function () {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  window.DefaultDemo.registerWorkflow({
    id: "placeholder",
    name: "Placeholder Demo Workflow",
    description: "Replace me with real Default workflows",
    async *run(formData, context) {
      const tech = context?.detectedTech || [];
      if (tech.length) {
        yield { step: "scan.tech-stack", status: "running" };
        await sleep(60);
        yield {
          step: "scan.tech-stack",
          status: "success",
          durationMs: 60,
          output: { wouldReplace: tech }
        };
      }

      yield { step: "enrich.apollo", status: "running", input: { email: formData.email } };
      await sleep(340);
      yield {
        step: "enrich.apollo",
        status: "success",
        durationMs: 340,
        output: { matched: true, title: "VP RevOps", company: context?.companyName ?? "Unknown" }
      };

      yield { step: "enrich.clearbit", status: "running" };
      await sleep(198);
      yield {
        step: "enrich.clearbit",
        status: "success",
        durationMs: 198,
        output: { company: context?.companyName ?? "Unknown", employees: 5000, industry: "Software" }
      };

      yield { step: "score.icp", status: "running" };
      await sleep(4);
      yield {
        step: "score.icp",
        status: "success",
        durationMs: 4,
        output: { score: 94, tier: "tier 1" }
      };

      yield { step: "route.assign-owner", status: "running" };
      await sleep(12);
      yield {
        step: "route.assign-owner",
        status: "success",
        durationMs: 12,
        output: { owner: "ryan@default.com" }
      };

      yield { step: "notify.slack", status: "running" };
      await sleep(220);
      yield {
        step: "notify.slack",
        status: "success",
        durationMs: 220,
        output: { channel: "#new-leads", posted: true }
      };
    }
  });
})();
