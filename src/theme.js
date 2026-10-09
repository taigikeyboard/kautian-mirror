// Theme toggle: pins light/dark on <html data-theme>; picking the system's own theme
// clears the pin so the page follows the system again.
const STORAGE_KEY = "theme";
const systemDark = window.matchMedia("(prefers-color-scheme: dark)");

function savePinned(theme) {
  try {
    if (theme) localStorage.setItem(STORAGE_KEY, theme);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // storage blocked (private mode): the toggle still works for this page view
  }
}

export function initThemeToggle(button) {
  const root = document.documentElement;
  button.addEventListener("click", () => {
    const current = root.dataset.theme ?? (systemDark.matches ? "dark" : "light");
    const next = current === "dark" ? "light" : "dark";
    const systemTheme = systemDark.matches ? "dark" : "light";
    if (next === systemTheme) delete root.dataset.theme;
    else root.dataset.theme = next;
    savePinned(root.dataset.theme);
  });
}
