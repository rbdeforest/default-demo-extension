// Workflow registry — kept as documentation only.
//
// Workflows live in this directory. Each file calls window.DefaultDemo.registerWorkflow({...})
// at load time (see _placeholder.js for the template).
//
// To add a new workflow:
//   1. Create workflows/your-workflow.js with a registerWorkflow call
//   2. Add "workflows/your-workflow.js" to the content_scripts.js array in manifest.json
//      (between _shared.js and content/form-detector.js)
//
// The runtime registry lives on window.DefaultDemo.workflows — see _shared.js for the API.
