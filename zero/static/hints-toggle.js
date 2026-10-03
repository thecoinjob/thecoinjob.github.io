(() => {
  const STORAGE_KEY = "0scan1.hints-enabled.v1";
  const loadEnabled = () => {
    try { return localStorage.getItem(STORAGE_KEY) === "true"; } catch (_) { return false; }
  };
  const saveEnabled = value => {
    try { localStorage.setItem(STORAGE_KEY, value ? "true" : "false"); } catch (_) {}
  };

  let enabled = loadEnabled();

  function hide() {
    const tooltip = document.getElementById("scanner-tooltip");
    if (tooltip) tooltip.classList.remove("visible");
  }

  function renderToggle() {
    const controls = document.querySelector(".controls");
    if (!controls || document.getElementById("hints-toggle")) return;
    const label = document.createElement("label");
    label.className = "hints-toggle-control";
    label.htmlFor = "hints-toggle";
    label.textContent = "Hints";

    const select = document.createElement("select");
    select.id = "hints-toggle";
    select.setAttribute("aria-label", "Scanner hints");
    select.innerHTML = '<option value="off">Off</option><option value="on">On</option>';
    select.value = enabled ? "on" : "off";
    select.addEventListener("change", () => {
      enabled = select.value === "on";
      saveEnabled(enabled);
      if (!enabled) hide();
    });

    controls.append(label, select);
  }

  // Existing app.js owns tooltip rendering. These capture handlers prevent
  // tooltip events from reaching it while hints are disabled.
  function blockWhenDisabled(event) {
    if (enabled) return;
    if (!event.target?.closest?.("[data-tooltip]")) return;
    event.stopPropagation();
  }

  document.addEventListener("mouseover", blockWhenDisabled, true);
  document.addEventListener("mousemove", blockWhenDisabled, true);
  document.addEventListener("mouseout", blockWhenDisabled, true);
  document.addEventListener("focusin", blockWhenDisabled, true);
  document.addEventListener("focusout", blockWhenDisabled, true);

  const start = () => {
    renderToggle();
    if (!enabled) hide();
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
