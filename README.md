# Default Demo Extension

Chrome extension (Manifest V3) for Default's AE team. Detects demo/contact forms on any prospect's website, intercepts submission, and shows a live trace panel visualizing what a Default GTM workflow would do with the lead.

This is a **demo tool**. It NEVER submits the form to the prospect's backend.

## Install (developer / sideload)

1. `git clone https://github.com/rbdeforest/default-demo-extension`
2. Open `chrome://extensions` in Chrome.
3. Toggle on **Developer mode** (top right).
4. Click **Load unpacked** and select the cloned folder.
5. Pin the Default Demo extension to your toolbar.

To pull updates: `git pull` then click the refresh icon on the extension card in `chrome://extensions`.

## Supported form vendors

- Plain HTML `<form>`
- HubSpot (embedded iframe)
- Marketo (`MktoForms2` API)
- Pardot (embedded iframe)
- React/custom (heuristic — button + nearby input cluster)

If interception fails, the AE sees a clear error in the overlay and can fall back to the sandbox form.

## Adding a workflow

Drop a new module in `workflows/` exporting the standard shape:

```js
// workflows/my-workflow.js
export const myWorkflow = {
  id: "my-workflow",
  name: "My Workflow",
  description: "...",
  async *run(formData, context) {
    yield { step: "step.name", status: "running", input: { ... } };
    // ...
    yield { step: "step.name", status: "success", durationMs: 100, output: { ... } };
  }
};
```

Then register it in `workflows/index.js`:

```js
import { myWorkflow } from "./my-workflow.js";
export const workflows = [placeholderWorkflow, myWorkflow];
```

## Known limitations (v1)

- No real backend. Workflow runs are simulated locally.
- Typeform / Calendly / other embedded scheduling tools are not intercepted — fall back to the sandbox form.
- No analytics, no auth, no central config.

## Build order

See `CLAUDE_CODE_INSTRUCTIONS.md` (not in repo) for the full sequenced build plan.
