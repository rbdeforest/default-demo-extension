// Step 2 stub. Wires up to detection results in step 3+.

const statusEl = document.getElementById("status");
const formsEl = document.getElementById("forms");
const openBtn = document.getElementById("open-trace");
const sandboxBtn = document.getElementById("run-sandbox");

statusEl.textContent = "form detector loaded";

sandboxBtn.addEventListener("click", () => {
  statusEl.textContent = "sandbox flow lands in step 11";
});

openBtn.addEventListener("click", () => {
  // Wired in step 4 once the overlay exists.
});
