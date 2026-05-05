// Inbound demo workflow — mirrors a condensed version of Default's actual
// "Inbound Form" workflow. Replace with the real definition when ready.

(function () {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  window.DefaultDemo.registerWorkflow({
    id: "placeholder",
    name: "Inbound Demo Workflow",
    description: "Form submit → enrichment → qualify → match → SMB route → AI score → SF upsert → calendar → Slack → sequence",
    async *run(formData, context) {
      yield { step: "form.submit", status: "running", input: { email: formData.email, name: formData.name } };
      await sleep(40);
      yield {
        step: "form.submit",
        status: "success",
        durationMs: 40,
        output: { form: "Default's Inbound Form", source: context?.domain ?? location.hostname }
      };

      yield { step: "enrichment.waterfall", status: "running" };
      await sleep(620);
      yield {
        step: "enrichment.waterfall",
        status: "success",
        durationMs: 620,
        output: {
          providers: ["Apollo", "Clearbit", "ZoomInfo"],
          title: "VP RevOps",
          company: context?.companyName ?? "Acme Corp",
          employees: 240,
          industry: "Software",
          detected_stack: context?.detectedTech ?? []
        }
      };

      yield { step: "qualify", status: "running" };
      await sleep(45);
      yield {
        step: "qualify",
        status: "success",
        durationMs: 45,
        output: { qualified: true, conditions_passed: "4 of 4" }
      };

      yield { step: "match.account", status: "running" };
      await sleep(180);
      yield {
        step: "match.account",
        status: "success",
        durationMs: 180,
        output: {
          record_type: "Account",
          matched: true,
          account_id: "001Hp00003ZqXyzABC",
          match_conditions: 6
        }
      };

      yield { step: "branch.segment", status: "running" };
      await sleep(18);
      yield {
        step: "branch.segment",
        status: "success",
        durationMs: 18,
        output: { segment: "SMB", criteria: "employees < 500", branch: "smb" }
      };

      yield { step: "route.round-robin", status: "running" };
      await sleep(28);
      yield {
        step: "route.round-robin",
        status: "success",
        durationMs: 28,
        output: { queue: "SMB Reps", assigned_to: "george@default.com" }
      };

      yield { step: "score.ai-lead", status: "running" };
      await sleep(540);
      yield {
        step: "score.ai-lead",
        status: "success",
        durationMs: 540,
        output: {
          model: "gpt-4o",
          score: 87,
          tier: "tier 1",
          reasoning: "VP-level title, technology fit, recent funding, mid-market headcount"
        }
      };

      yield { step: "sf.account.update", status: "running" };
      await sleep(220);
      yield {
        step: "sf.account.update",
        status: "success",
        durationMs: 220,
        output: {
          record_type: "Account",
          fields_updated: ["Owner__c", "Tier__c", "Lead_Score__c", "Industry"]
        }
      };

      yield { step: "sf.opportunity.create", status: "running" };
      await sleep(260);
      yield {
        step: "sf.opportunity.create",
        status: "success",
        durationMs: 260,
        output: {
          record_type: "Opportunity",
          stage: "Discovery",
          amount: 24000,
          close_date: "2026-08-04"
        }
      };

      yield { step: "calendar.display", status: "running" };
      await sleep(120);
      yield {
        step: "calendar.display",
        status: "success",
        durationMs: 120,
        output: {
          rep: "george@default.com",
          slots_available: 8,
          week_of: "2026-05-12",
          embed: "rendered to /thank-you?slug=george-default"
        }
      };

      yield { step: "notify.slack", status: "running" };
      await sleep(180);
      yield {
        step: "notify.slack",
        status: "success",
        durationMs: 180,
        output: { channel: "#leads-smb", posted: true, mentions: ["george"] }
      };

      yield { step: "sequence.add", status: "running" };
      await sleep(140);
      yield {
        step: "sequence.add",
        status: "success",
        durationMs: 140,
        output: { sequence: "SMB · Inbound Demo Booked", step: 1, scheduled_for: "now + 5m" }
      };
    }
  });
})();
