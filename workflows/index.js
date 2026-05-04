import { placeholderWorkflow } from "./_placeholder.js";

// Add new workflow imports here. Each must export the standard workflow shape:
//   { id, name, description, async *run(formData, context) }
export const workflows = [placeholderWorkflow];

export function getWorkflow(id) {
  return workflows.find((w) => w.id === id);
}
