function activateTabs(buttons, panels, dataKey) {
  for (const button of buttons) {
    button.addEventListener("click", () => {
      const selected = button.dataset[dataKey];
      for (const candidate of buttons) {
        const active = candidate === button;
        candidate.classList.toggle("active", active);
        candidate.setAttribute("aria-selected", String(active));
      }
      for (const panel of panels) {
        const active = panel.id.endsWith(selected);
        panel.classList.toggle("active", active);
        panel.hidden = !active;
      }
    });
  }
}

activateTabs(
  document.querySelectorAll("[data-route]"),
  document.querySelectorAll(".route-panel"),
  "route",
);

activateTabs(
  document.querySelectorAll("[data-install]"),
  document.querySelectorAll(".install-panel"),
  "install",
);

for (const button of document.querySelectorAll("[data-copy]")) {
  button.addEventListener("click", async () => {
    const target = document.getElementById(button.dataset.copy);
    if (!target) return;
    const value = target.textContent.trim();
    try {
      await navigator.clipboard.writeText(value);
      button.textContent = "コピー済み";
      window.setTimeout(() => {
        button.textContent = "コピー";
      }, 1800);
    } catch {
      button.textContent = "選択してコピー";
      const range = document.createRange();
      range.selectNodeContents(target);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);
    }
  });
}

